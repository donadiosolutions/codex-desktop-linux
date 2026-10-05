#!/usr/bin/env python3
"""Read Codex's source stamp from ELF .rodata and verify it in openai/codex.

The stamp's surrounding strings are observed compiler layout, not an upstream
metadata ABI. Unknown layouts fail closed. --resolve-version-tag can resolve
unstamped older binaries to a release commit, but does not establish their
source commit. --infer tries release Sigstore metadata, the release binary,
unique repository commit candidates, and version-to-tag inference, in that order.
No input binary is executed. Requires only Python and, for online
verification, the existing gh CLI. Outputs one JSON report; errors exit nonzero.
"""

import argparse
import base64
import functools
import gzip
import hashlib
import io
import json
import mmap
import os
import re
import struct
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

STAMP = re.compile(
    rb'stdio-to-uds\x00*([0-9a-f]{40})\x00*auth\.json'
    rb'|(?:STABLE_GIT_COMMIT|CODEX_BUILD_COMMIT|build_commit)["\x00 ]*[:=]["\x00 ]*([0-9a-f]{40})(?![0-9A-Za-z])'
)
VERSION = re.compile(
    rb"(?:version: |Codex App Server Daemon|codex-doctor/|web_search_mode)"
    rb"([0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?)"
    rb"(?=HomebrewCaskInfo|failed to send initialize|version response|`|\x00)"
)
SHA = re.compile(r"[0-9a-f]{40}\Z")
CANDIDATE = re.compile(rb"(?<![0-9A-Za-z])([0-9a-f]{40})(?![0-9A-Za-z])")
MAX_ARCHIVE = 256 * 1024 * 1024
MAX_BINARY = 600 * 1024 * 1024


def rodata_bounds(data):
    """Locate one file-backed .rodata section in a bounded ELF section table."""
    def bounds(offset, size):
        if offset < 0 or size < 0 or offset + size > len(data):
            raise ValueError("truncated ELF or out-of-bounds section")
        return offset, offset + size

    if len(data) < 16 or data[:4] != b"\x7fELF" or data[6] != 1:
        raise ValueError("not a supported ELF file")
    if data[4] not in (1, 2) or data[5] not in (1, 2):
        raise ValueError("unsupported ELF class or byte order")
    wide = data[4] == 2
    endian = "<" if data[5] == 1 else ">"
    bounds(0, 64 if wide else 52)
    table = struct.unpack_from(endian + ("Q" if wide else "I"), data, 40 if wide else 32)[0]
    stride, count, names_index = struct.unpack_from(endian + "HHH", data, 58 if wide else 46)
    layout = struct.Struct(endian + ("IIQQQQIIQQ" if wide else "IIIIIIIIII"))
    if not table or not count or names_index == 0xFFFF:
        raise ValueError("missing or extended ELF section table is unsupported")
    if stride != layout.size or not 0 < names_index < count:
        raise ValueError("invalid ELF section table")
    bounds(table, stride * count)

    def section(index):
        return layout.unpack_from(data, table + index * stride)

    names = section(names_index)
    if names[1] != 3:
        raise ValueError("invalid ELF section-name string table")
    names_start, names_end = bounds(names[4], names[5])
    found = []
    for index in range(count):
        item = section(index)
        name_start = names_start + item[0]
        if name_start >= names_end:
            raise ValueError("invalid ELF section name offset")
        name_end = data.find(b"\0", name_start, names_end)
        if name_end < 0:
            raise ValueError("unterminated ELF section name")
        if data[name_start:name_end] == b".rodata":
            if item[1] != 1 or not item[2] & 2 or item[2] & (1 | 0x800):
                raise ValueError("unsupported writable, compressed, or non-file-backed .rodata")
            found.append(bounds(item[4], item[5]))
    if len(found) != 1:
        raise ValueError("expected exactly one .rodata section")
    return found[0]


def extract(data):
    start, end = rodata_bounds(data)
    stamps = list(STAMP.finditer(data, start, end))
    versions = {match[1].decode() for match in VERSION.finditer(data, start, end)}
    if len(stamps) > 1:
        raise ValueError("ambiguous source commit stamps")
    if len(versions) > 1:
        raise ValueError("ambiguous binary version stamps")
    group = (1 if stamps[0][1] else 2) if stamps else None
    endian = "<" if data[5] == 1 else ">"
    machine = struct.unpack_from(endian + "H", data, 18)[0]
    candidates = set()
    if not stamps:
        for match in CANDIDATE.finditer(data, start, end):
            # Exclude known toolchain and documentation provenance, not just
            # strings that happen to look unlike the expected source commit.
            before = data[max(start, match.start() - 80):match.start()]
            if any(marker in before for marker in (b"/rustc/", b"github.com/git/git/", b"zig-bootstrap ")):
                continue
            if len(set(match[1])) >= 8 and any(c in b"abcdef" for c in match[1]):
                candidates.add(match[1].decode())
    return {
        "source_commit": stamps[0][group].decode() if stamps else None,
        "source_commit_offset": hex(stamps[0].start(group)) if stamps else None,
        "binary_version": next(iter(versions)) if versions else None,
        "section": ".rodata",
        "architecture": {62: "x86_64", 183: "aarch64"}.get(machine),
        "candidate_commits": sorted(candidates),
    }


def sigstore_digest(bundle):
    """Read an artifact digest, without claiming to validate the signature."""
    if "rekorBundle" in bundle:
        body = json.loads(base64.b64decode(bundle["rekorBundle"]["Payload"]["body"], validate=True))
        if body.get("kind") != "hashedrekord":
            raise ValueError("unsupported Sigstore record type")
        digest = body["spec"]["data"]["hash"]
        algorithm, value = digest["algorithm"], digest["value"]
    elif "messageSignature" in bundle:
        digest = bundle["messageSignature"]["messageDigest"]
        algorithm = digest["algorithm"]
        value = base64.b64decode(digest["digest"], validate=True).hex()
    else:
        raise ValueError("unsupported Sigstore bundle")
    if algorithm not in ("sha256", "SHA2_256") or not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("unsupported Sigstore digest")
    return value


def release_binary_hash(archive, member_name):
    """Hash one regular archive member without extracting or executing files."""
    found, total, started = [], 0, time.monotonic()
    # Parse fixed-size tar headers ourselves. tarfile.open consumes extension
    # records internally, before a caller can enforce their allocation bounds.
    with gzip.GzipFile(fileobj=archive, mode="rb") as stream:
        def read(size):
            nonlocal total
            total += size
            if size > 1024 * 1024 or total > MAX_BINARY + 32 * 1024 or time.monotonic() - started > 180:
                raise ValueError("release archive exceeds decompression or time bound")
            block = stream.read(size)
            if len(block) != size:
                raise ValueError("truncated release archive")
            return block

        for _ in range(33):
            header = read(512)
            if header == bytes(512):
                break
            member = tarfile.TarInfo.frombuf(header, "utf-8", "strict")
            if member.type in (tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.GNUTYPE_LONGNAME,
                               tarfile.GNUTYPE_LONGLINK, tarfile.GNUTYPE_SPARSE):
                raise ValueError("release archive extension records are unsupported")
            if member.size < 0 or member.size > MAX_BINARY:
                raise ValueError("release archive exceeds member size bound")
            matches = member.name.removeprefix("./") == member_name
            if matches and not member.isfile():
                raise ValueError("release binary must be a regular file")
            digest, remaining = hashlib.sha256(), member.size
            while remaining:
                block = read(min(remaining, 1024 * 1024))
                if matches:
                    digest.update(block)
                remaining -= len(block)
            if member.size % 512:
                read(512 - member.size % 512)
            if matches:
                found.append(digest.hexdigest())
        else:
            raise ValueError("release archive exceeds member count bound")
    if len(found) != 1:
        raise ValueError("expected exactly one release binary in archive")
    return found[0]


def download_asset(asset, destination, limit):
    """Fetch an exact release asset, checking its published size and SHA-256."""
    expected = asset.get("digest", "")
    if not re.fullmatch(r"sha256:[0-9a-f]{64}", expected) or not 0 < asset["size"] <= limit:
        raise ValueError("release asset lacks an acceptable size or SHA-256")
    url = asset["browser_download_url"]
    if not url.startswith("https://github.com/openai/codex/releases/download/"):
        raise ValueError("unexpected release asset URL")
    digest, total, started = hashlib.sha256(), 0, time.monotonic()
    with urllib.request.urlopen(url, timeout=30) as source:
        while True:
            block = source.read(1024 * 1024)
            if not block:
                break
            total += len(block)
            if total > limit or time.monotonic() - started > 180:
                raise ValueError("release download exceeds size or time bound")
            destination.write(block)
            digest.update(block)
    if total != asset["size"] or "sha256:" + digest.hexdigest() != expected:
        raise ValueError("release asset size or SHA-256 mismatch")


class GitHub:
    @functools.lru_cache(maxsize=256)
    def get(self, endpoint):
        result = subprocess.run(
            ["gh", "api", "--hostname", "github.com", f"repos/openai/codex/{endpoint}"],
            capture_output=True, text=True, timeout=30, check=False,
        )
        if result.returncode:
            raise ValueError(f"GitHub lookup failed for {endpoint}: {result.stderr.strip()[:500]}")
        return json.loads(result.stdout)

    def verify(self, sha):
        if not SHA.fullmatch(sha):
            raise ValueError("invalid commit SHA")
        commit = self.get(f"commits/{sha}")
        if not isinstance(commit, dict) or commit.get("sha") != sha:
            raise ValueError("GitHub returned a different commit SHA")
        metadata = commit["commit"]
        return {
            "repository": "openai/codex",
            "sha": sha,
            "url": f"https://github.com/openai/codex/commit/{sha}",
            "title": metadata["message"].splitlines()[0],
            "committed_at": metadata["committer"]["date"],
        }

    def resolve_tag(self, version):
        ref = self.get(f"git/ref/tags/rust-v{version}")["object"]
        # Annotated tags may point to other tags; cap the traversal.
        for _ in range(4):
            sha = ref["sha"]
            if not SHA.fullmatch(sha):
                raise ValueError("tag contains an invalid SHA")
            if ref["type"] == "commit":
                return sha
            if ref["type"] != "tag":
                break
            ref = self.get(f"git/tags/{sha}")["object"]
        raise ValueError("release tag does not resolve to a commit within four steps")

    @functools.lru_cache(maxsize=256)
    def commit_exists(self, sha):
        try:
            self.verify(sha)
            return True
        except ValueError as error:
            if "HTTP 404" in str(error):
                return False
            raise

    def infer_candidate(self, candidates):
        if len(candidates) > 16:
            raise ValueError("unlabelled commit candidate bound exceeded")
        matches = [sha for sha in candidates if self.commit_exists(sha)]
        if len(matches) > 1:
            raise ValueError("ambiguous repository commit candidates")
        if not matches:
            raise ValueError("no unlabelled candidates match openai/codex")
        return matches[0]

    @functools.lru_cache(maxsize=32)
    def asset_json(self, url, size, digest):
        data = io.BytesIO()
        download_asset({"browser_download_url": url, "size": size, "digest": digest}, data, 1024 * 1024)
        return json.loads(data.getvalue())

    @functools.lru_cache(maxsize=32)
    def archive_digest(self, url, size, digest, member_name):
        cache = Path(os.environ.get("XDG_CACHE_HOME", str(Path.home() / ".cache"))) / "codex-desktop-dev/tmp"
        cache.mkdir(parents=True, exist_ok=True)
        # TemporaryFile lives on disk and is removed even if validation fails.
        with tempfile.TemporaryFile(dir=cache) as archive:
            download_asset({"browser_download_url": url, "size": size, "digest": digest}, archive, MAX_ARCHIVE)
            archive.seek(0)
            return release_binary_hash(archive, member_name)

    @functools.lru_cache(maxsize=64)
    def match_release(self, version, binary_sha, architecture, method="auto"):
        if architecture not in ("x86_64", "aarch64"):
            raise ValueError("release matching requires a supported ELF architecture")
        assets = self.get(f"releases/tags/rust-v{version}")["assets"]
        prefix = f"codex-{architecture}-unknown-linux-"
        candidates = [asset for asset in assets if re.fullmatch(
            re.escape(prefix) + r"(?:musl|gnu)\.(?:sigstore|tar\.gz)", asset["name"]
        )]
        if len(candidates) > 4:
            raise ValueError("release asset candidate bound exceeded")
        notes = []
        for extension, enabled in ((".sigstore", method != "binary"), (".tar.gz", method != "sigstore")):
            if not enabled:
                continue
            for asset in candidates:
                if not asset["name"].endswith(extension):
                    continue
                try:
                    if extension == ".sigstore":
                        bundle = self.asset_json(asset["browser_download_url"], asset["size"], asset.get("digest", ""))
                        matched = sigstore_digest(bundle) == binary_sha
                        evidence = {"method": "release-sigstore-digest", "signature_verified": False}
                    else:
                        member = asset["name"].removesuffix(".tar.gz")
                        matched = self.archive_digest(asset["browser_download_url"], asset["size"], asset.get("digest", ""), member) == binary_sha
                        evidence = {"method": "release-binary-digest"}
                    if matched:
                        return {**evidence, "asset": asset["browser_download_url"], "binary_sha256": binary_sha,
                                "fallback_notes": notes}
                    notes.append(f"{asset['name']}: binary digest differs")
                except (OSError, ValueError, KeyError, TypeError, tarfile.TarError) as error:
                    notes.append(f"{asset['name']}: {error}")
        raise ValueError("no matching release artifact: " + "; ".join(notes))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="*", type=Path, help="ELF binaries or extracted app directories")
    parser.add_argument("--samples-root", type=Path, help="scan only top-level codex-app* and .codex-app.candidate-* bundles")
    parser.add_argument("--offline", action="store_true", help="extract stamps without GitHub verification")
    parser.add_argument("--resolve-version-tag", action="store_true", help="resolve unstamped versions to release commits; source_commit stays null")
    parser.add_argument("--infer", action="store_true", help="try Sigstore digest, release binary digest, then version tag for unstamped binaries")
    parser.add_argument("--release-method", choices=("auto", "sigstore", "binary"), default="auto", help="choose artifact matching used by --infer")
    parser.add_argument("--release-tag", help="explicit rust-vX.Y.Z tag to try when a binary version cannot be read")
    args = parser.parse_args()
    if args.offline and (args.resolve_version_tag or args.infer):
        parser.error("release inference requires online GitHub lookup")
    if args.release_tag and (not (args.infer or args.resolve_version_tag) or not re.fullmatch(
        r"rust-v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?", args.release_tag
    )):
        parser.error("--release-tag requires inference and an exact rust-vX.Y.Z tag")
    paths = list(args.paths)
    if args.samples_root:
        if not args.samples_root.is_dir():
            parser.error("--samples-root must be an existing directory")
        for pattern in ("codex-app*", ".codex-app.candidate-*"):
            paths.extend(
                p / "resources/codex" for p in sorted(args.samples_root.glob(pattern))
                if (p / "resources/codex").is_file()
            )
    if not paths:
        parser.error("provide at least one binary, app directory, or --samples-root")
    paths = sorted({(p / "resources/codex" if p.is_dir() else p).absolute() for p in paths})
    github = GitHub()
    report = []
    for path in paths:
        row = {"path": str(path), "status": "error"}
        try:
            with path.open("rb") as file:
                size = os.fstat(file.fileno()).st_size
                if not size:
                    raise ValueError("empty file")
                if size > MAX_BINARY:
                    raise ValueError("local binary exceeds size bound")
                with mmap.mmap(file.fileno(), 0, access=mmap.ACCESS_READ) as data:
                    row.update(extract(data))
                    row["binary_sha256"] = hashlib.sha256(data).hexdigest()
            sha = row["source_commit"]
            if sha:
                row["method"] = "embedded-stamp"
            elif args.resolve_version_tag or args.infer:
                version = args.release_tag.removeprefix("rust-v") if args.release_tag else row["binary_version"]
                notes = []
                if version:
                    try:
                        sha = github.resolve_tag(version)
                        row.update(method="version-tag", release_tag=f"rust-v{version}", release_commit=sha)
                        if args.infer:
                            row.update(github.match_release(version, row["binary_sha256"], row["architecture"], args.release_method))
                    except ValueError as error:
                        notes.append(str(error))
                if args.infer and row.get("method", "version-tag") == "version-tag":
                    try:
                        candidate = github.infer_candidate(row["candidate_commits"])
                        sha = candidate
                        row.update(method="repository-candidate", inferred_commit=candidate)
                    except ValueError as error:
                        if "ambiguous" in str(error):
                            raise
                        notes.append(str(error))
                if notes:
                    row["fallback_notes"] = notes
                if not sha:
                    raise ValueError("source commit could not be inferred: " + "; ".join(notes))
            else:
                raise ValueError("no contextual source commit stamp found; source provenance is unknown")
            if args.offline:
                row["status"] = "extracted-unverified"
            else:
                row["verification"] = github.verify(sha)
                row["status"] = ("verified" if row["source_commit"] else
                                 "release-resolved-source-unknown" if row["method"] == "version-tag" else
                                 "repository-candidate-source-unknown" if row["method"] == "repository-candidate" else
                                 "release-artifact-matched")
        except (OSError, ValueError, KeyError, TypeError, IndexError, subprocess.SubprocessError, tarfile.TarError) as error:
            row["error"] = str(error)
        report.append(row)
    print(json.dumps({"samples": report}, indent=2))
    return int(any(row["status"] == "error" for row in report))


if __name__ == "__main__":
    sys.exit(main())
