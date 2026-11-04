"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const descriptors = require("./patch.js");
const { findMainProcessChunks } = require("../../scripts/patches/lib/assets.js");
const { listWebviewAssetNames } = require("../../scripts/patches/lib/assets.js");

function signedChunks() {
  const mainProcess = findMainProcessChunks(process.env.CODEX_SIGNED_EXTRACTED_APP);
  assert(mainProcess, "Expected the verified main-process chunks");
  return mainProcess.chunks.map(name => {
    const file = path.join(mainProcess.buildDir, name);
    return { name, file, source: fs.readFileSync(file, "utf8") };
  });
}

function quietly(fn) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
}

test("native metadata stays feature-owned without retired core IPC helpers", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../scripts/patches/impl/computer-use.js"), "utf8");
  assert.doesNotMatch(source, /linuxNativeDesktopAppsHelper|applyLinuxNativeDesktopAppsHandlerPatch/);
  const descriptor = descriptors.find(({ id }) => id === "native-applications");
  assert(descriptor);
  assert.equal(descriptor.phase, "main-bundle");
});

test("current signed native metadata factory patches without changing the trusted input", {
  skip: !process.env.CODEX_SIGNED_EXTRACTED_APP,
}, () => {
  // Locate the chunk holding the fetch handler semantically, not by chunk id.
  const owners = signedChunks().filter(({ source }) =>
    source.includes("nativeApplications:this.fetchHandler.nativeApplications"));
  assert.equal(owners.length, 1, "Expected one chunk exposing native Applications metadata");
  const [{ file, source: actual }] = owners;
  const patch = descriptors.find(({ id }) => id === "native-applications").apply;
  const patched = patch(actual);
  assert.notEqual(patched, actual);
  assert.equal(patch(patched), patched);
  assert.doesNotThrow(() => new vm.Script(patched));
  assert.equal(fs.readFileSync(file, "utf8"), actual);
});

test("every current signed main-process descriptor patches exactly one chunk idempotently", {
  skip: !process.env.CODEX_SIGNED_EXTRACTED_APP,
}, () => {
  const chunks = signedChunks();
  for (const descriptor of descriptors.filter(({ phase }) => phase === "main-bundle")) {
    const changed = [];
    for (const chunk of chunks) {
      let patched;
      try {
        patched = quietly(() => descriptor.apply(chunk.source));
      } catch {
        continue;
      }
      if (patched === chunk.source) continue;
      changed.push(chunk.name);
      assert.equal(quietly(() => descriptor.apply(patched)), patched, `${descriptor.id} is not idempotent`);
      assert.doesNotThrow(() => new vm.Script(patched), `${descriptor.id} produced invalid JavaScript`);
    }
    assert.equal(changed.length, 1, `${descriptor.id} changed ${changed.join(", ") || "no chunk"}`);
  }
});

test("current signed Rspack webview owners match the feature descriptors", {
  skip: !process.env.CODEX_SIGNED_EXTRACTED_APP,
}, () => {
  const assetsDir = path.join(process.env.CODEX_SIGNED_EXTRACTED_APP, "webview", "assets");
  const names = listWebviewAssetNames(assetsDir, /\.js$/);
  const assets = names.map(name => ({
    name,
    source: fs.readFileSync(path.join(assetsDir, name), "utf8"),
  }));
  const expected = [
    ["codex-app-thread-tools", source => source.includes("readDynamicTools:e=>")],
    ["ui-availability", source => source.includes("computerUseAvailability:") && source.includes(".available")],
    ["host-platform", source => source.includes("isHostCompatiblePlatform:") && source.includes('windowType:"electron"')],
    ["native-settings-visibility", source => source.includes(".plugin.id") && source.includes("new Set(")],
  ];
  for (const [id, owns] of expected) {
    const descriptor = descriptors.find(item => item.id === id);
    assert(descriptor, `missing ${id} descriptor`);
    const owners = assets.filter(({ name, source }) => descriptor.pattern.test(name) && owns(source) &&
      (descriptor.assetMatch == null || descriptor.assetMatch(source, name)));
    assert(owners.length > 0, `${id} current signed owner`);
    const changed = owners.flatMap(({ name, source }) => {
      try {
        const patched = descriptor.apply(source);
        if (patched === source) return [];
        assert.equal(descriptor.apply(patched), patched, `${id} ${name} should be idempotent`);
        return [name];
      } catch (error) {
        assert.fail(`${id} ${name}: ${error.message}`);
      }
    });
    assert(changed.length > 0, `${id} should patch at least one current signed owner`);
  }
});
