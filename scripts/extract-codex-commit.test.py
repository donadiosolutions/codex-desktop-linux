#!/usr/bin/env python3
"""Regression tests for reading Codex provenance from ELF data."""

import importlib.util
import base64
import hashlib
import io
import json
import subprocess
import struct
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location(
    "extract_codex_commit", Path(__file__).with_name("extract-codex-commit.py")
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

COMMIT = b"b5bffd3ec4db487e7e3dec59663875b0ef7b72ca"
STAMP = b"stdio-to-uds" + COMMIT + b"auth.json"
VERSION = b"version: 0.154.0-alpha.6.2HomebrewCaskInfo"


def elf(payload, bits=64, endian="<", extra=b""):
    """Construct an ELF with .shstrtab, .rodata, and an unrelated .data."""
    wide = bits == 64
    header_size = 64 if wide else 52
    section_size = 64 if wide else 40
    names = b"\0.shstrtab\0.rodata\0.data\0"
    rodata_offset = header_size + len(names)
    data_offset = rodata_offset + len(payload)
    table_offset = data_offset + len(extra)
    header = bytearray(header_size)
    header[:16] = b"\x7fELF" + bytes([2 if wide else 1, 1 if endian == "<" else 2, 1]) + bytes(9)
    struct.pack_into(endian + ("Q" if wide else "I"), header, 40 if wide else 32, table_offset)
    struct.pack_into(endian + "HHH", header, 58 if wide else 46, section_size, 4, 1)
    section_format = endian + ("IIQQQQIIQQ" if wide else "IIIIIIIIII")
    sections = [(0,) * 10]
    sections += [
        (1, 3, 0, 0, header_size, len(names), 0, 0, 1, 0),
        (11, 1, 2, 0, rodata_offset, len(payload), 0, 0, 1, 0),
        (19, 1, 3, 0, data_offset, len(extra), 0, 0, 1, 0),
    ]
    return bytes(header) + names + payload + extra + b"".join(
        struct.pack(section_format, *section) for section in sections
    )


class ExtractionTests(unittest.TestCase):
    def test_stamp_in_rodata_all_elf_encodings(self):
        for bits in (32, 64):
            for endian in ("<", ">"):
                with self.subTest(bits=bits, endian=endian):
                    result = MODULE.extract(elf(VERSION + STAMP, bits, endian))
                    self.assertEqual(result["source_commit"], COMMIT.decode())
                    self.assertEqual(result["binary_version"], "0.154.0-alpha.6.2")
                    self.assertEqual(result["section"], ".rodata")

    def test_dependency_hashes_and_stamp_outside_rodata_are_ignored(self):
        result = MODULE.extract(elf(VERSION + b"/rustc/" + COMMIT, extra=STAMP))
        self.assertIsNone(result["source_commit"])

    def test_old_binary_without_commit_is_explicit(self):
        result = MODULE.extract(elf(b"version: 0.153.4HomebrewCaskInfo" + b"stdio-to-udsauth.json"))
        self.assertIsNone(result["source_commit"])
        self.assertEqual(result["binary_version"], "0.153.4")

    def test_other_explicit_stamp_layouts(self):
        for stamp in (b"stdio-to-uds\0" + COMMIT + b"\0auth.json",
                      b'STABLE_GIT_COMMIT=' + COMMIT + b'\0',
                      b'{"build_commit":"' + COMMIT + b'"}'):
            self.assertEqual(MODULE.extract(elf(VERSION + stamp))["source_commit"], COMMIT.decode())

    def test_alternative_version_layout(self):
        data = b"Codex App Server Daemon0.154.0-alpha.6.2failed to send initialize request"
        self.assertEqual(MODULE.extract(elf(data + STAMP))["binary_version"], "0.154.0-alpha.6.2")

    def test_missing_rodata_is_rejected(self):
        with self.assertRaises(ValueError):
            MODULE.extract(elf(STAMP).replace(b".rodata", b".other_"))

    def test_unlabelled_candidates_exclude_dependency_source_paths(self):
        result = MODULE.extract(elf(b"\0" + COMMIT + b"\0/rustc/" + b"a" * 40 + b"/library"))
        self.assertEqual(result["candidate_commits"], [COMMIT.decode()])

    def test_duplicate_rodata_is_rejected(self):
        data = bytearray(elf(STAMP))
        table = struct.unpack_from("<Q", data, 40)[0]
        struct.pack_into("<IIQ", data, table + 3 * 64, 11, 1, 2)
        with self.assertRaises(ValueError):
            MODULE.extract(data)

    def test_multiple_stamp_occurrences_are_rejected(self):
        for second in (STAMP, b"stdio-to-uds" + b"a" * 40 + b"auth.json"):
            with self.assertRaisesRegex(ValueError, "ambiguous"):
                MODULE.extract(elf(VERSION + STAMP + second))

    def test_wrong_stamp_context_is_ignored(self):
        for stamp in (b"other" + COMMIT + b"auth.json", STAMP.replace(COMMIT, COMMIT.upper()),
                      b"build_commit=" + COMMIT + b"g"):
            self.assertIsNone(MODULE.extract(elf(VERSION + stamp))["source_commit"])

    def test_truncated_and_non_elf_inputs_are_rejected(self):
        for data in (b"", b"not ELF", elf(STAMP)[:60], elf(STAMP)[:-1]):
            with self.assertRaises(ValueError):
                MODULE.extract(data)

    def test_section_bounds_are_validated(self):
        data = bytearray(elf(STAMP))
        table = struct.unpack_from("<Q", data, 40)[0]
        struct.pack_into("<Q", data, table + 2 * 64 + 24, len(data) + 1)
        with self.assertRaises(ValueError):
            MODULE.extract(data)


class VerificationTests(unittest.TestCase):
    def test_exact_public_commit_is_required(self):
        github = MODULE.GitHub()
        with patch.object(github, "get", return_value={"sha": "a" * 40}):
            with self.assertRaisesRegex(ValueError, "SHA"):
                github.verify(COMMIT.decode())

    def test_annotated_tag_is_peeled(self):
        github = MODULE.GitHub()
        with patch.object(github, "get", side_effect=[
            {"object": {"type": "tag", "sha": "a" * 40}},
            {"object": {"type": "commit", "sha": COMMIT.decode()}},
        ]):
            self.assertEqual(github.resolve_tag("0.154.0-alpha.6.2"), COMMIT.decode())

    def test_tag_must_resolve_to_commit(self):
        github = MODULE.GitHub()
        with patch.object(github, "get", return_value={"object": {"type": "tree", "sha": "a" * 40}}):
            with self.assertRaises(ValueError):
                github.resolve_tag("0.154.0-alpha.6.2")

    def test_unlabelled_inference_requires_one_public_commit(self):
        github = MODULE.GitHub()
        with patch.object(github, "verify", return_value={"sha": COMMIT.decode()}):
            self.assertEqual(github.infer_candidate([COMMIT.decode()]), COMMIT.decode())
            with self.assertRaisesRegex(ValueError, "ambiguous"):
                github.infer_candidate([COMMIT.decode(), "a" * 40])

    def test_api_failure_is_not_an_absent_commit(self):
        github = MODULE.GitHub()
        with patch.object(github, "get", side_effect=ValueError("GitHub lookup failed: HTTP 403")):
            with self.assertRaises(ValueError):
                github.commit_exists(COMMIT.decode())

    def test_not_found_commit_is_cached(self):
        github = MODULE.GitHub()
        with patch.object(github, "get", side_effect=ValueError("GitHub lookup failed: HTTP 404")) as get:
            self.assertFalse(github.commit_exists(COMMIT.decode()))
            self.assertFalse(github.commit_exists(COMMIT.decode()))
            self.assertEqual(get.call_count, 1)


class ReleaseFallbackTests(unittest.TestCase):
    def test_classic_sigstore_digest(self):
        body = {"kind": "hashedrekord", "spec": {"data": {"hash": {
            "algorithm": "sha256", "value": "a" * 64,
        }}}}
        bundle = {"rekorBundle": {"Payload": {"body": base64.b64encode(json.dumps(body).encode()).decode()}}}
        self.assertEqual(MODULE.sigstore_digest(bundle), "a" * 64)

    def test_modern_sigstore_digest(self):
        bundle = {"messageSignature": {"messageDigest": {
            "algorithm": "SHA2_256", "digest": base64.b64encode(bytes.fromhex("b" * 64)).decode(),
        }}}
        self.assertEqual(MODULE.sigstore_digest(bundle), "b" * 64)

    def test_malformed_sigstore_is_rejected(self):
        for bundle in ({}, {"messageSignature": {"messageDigest": {"algorithm": "SHA2_512", "digest": ""}}}):
            with self.assertRaises(ValueError):
                MODULE.sigstore_digest(bundle)

    def test_archive_member_hashed_without_extraction(self):
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode="w:gz") as tar:
            info = tarfile.TarInfo("codex-x86_64-unknown-linux-musl")
            info.size = 3
            tar.addfile(info, io.BytesIO(b"ELF"))
        archive.seek(0)
        self.assertEqual(MODULE.release_binary_hash(archive, "codex-x86_64-unknown-linux-musl"),
                         hashlib.sha256(b"ELF").hexdigest())

    def test_archive_symlink_is_rejected(self):
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode="w:gz") as tar:
            info = tarfile.TarInfo("codex-x86_64-unknown-linux-musl")
            info.type = tarfile.SYMTYPE
            info.linkname = "/usr/bin/true"
            tar.addfile(info)
        archive.seek(0)
        with self.assertRaises(ValueError):
            MODULE.release_binary_hash(archive, "codex-x86_64-unknown-linux-musl")

    def test_archive_extension_headers_are_rejected(self):
        archive = io.BytesIO()
        with tarfile.open(fileobj=archive, mode="w:gz", format=tarfile.PAX_FORMAT) as tar:
            info = tarfile.TarInfo("x" * 150)
            tar.addfile(info)
        archive.seek(0)
        with self.assertRaisesRegex(ValueError, "extension"):
            MODULE.release_binary_hash(archive, "codex-x86_64-unknown-linux-musl")

    def test_download_digest_mismatch_is_rejected(self):
        asset = {"size": 3, "digest": "sha256:" + "a" * 64,
                 "browser_download_url": "https://github.com/openai/codex/releases/download/tag/asset"}
        with patch.object(MODULE.urllib.request, "urlopen", return_value=io.BytesIO(b"bad")):
            with self.assertRaisesRegex(ValueError, "mismatch"):
                MODULE.download_asset(asset, io.BytesIO(), 1024)


class CliTests(unittest.TestCase):
    def test_offline_inference_is_rejected(self):
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("extract-codex-commit.py")),
                                 "--offline", "--infer", "unused"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 2)

    def test_missing_sample_is_reported_and_exits_nonzero(self):
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("extract-codex-commit.py")),
                                 "--offline", "/nonexistent/codex-extractor-test"], capture_output=True, text=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout)["samples"][0]["status"], "error")

    def test_oversized_local_file_is_rejected_before_mapping(self):
        cache = Path.home() / ".cache/codex-desktop-dev/tmp"
        cache.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=cache) as directory:
            binary = Path(directory) / "codex"
            with binary.open("wb") as file:
                file.truncate(MODULE.MAX_BINARY + 1)
            result = subprocess.run([sys.executable, str(Path(__file__).with_name("extract-codex-commit.py")),
                                     "--offline", str(binary)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            self.assertIn("size bound", json.loads(result.stdout)["samples"][0]["error"])

    def test_sigstore_release_match_checks_exact_binary_digest(self):
        github = MODULE.GitHub()
        asset = {"name": "codex-x86_64-unknown-linux-musl.sigstore", "size": 100,
                 "digest": "sha256:" + "c" * 64,
                 "browser_download_url": "https://github.com/openai/codex/releases/download/rust-v0.153.4/codex-x86_64-unknown-linux-musl.sigstore"}
        with patch.object(github, "get", return_value={"assets": [asset]}), \
             patch.object(github, "asset_json", return_value={"messageSignature": {"messageDigest": {
                 "algorithm": "SHA2_256", "digest": base64.b64encode(bytes.fromhex("a" * 64)).decode(),
             }}}):
            self.assertEqual(github.match_release("0.153.4", "a" * 64, "x86_64", "sigstore")["method"],
                             "release-sigstore-digest")
            with self.assertRaisesRegex(ValueError, "no matching"):
                github.match_release("0.153.4", "b" * 64, "x86_64", "sigstore")


if __name__ == "__main__":
    unittest.main()
