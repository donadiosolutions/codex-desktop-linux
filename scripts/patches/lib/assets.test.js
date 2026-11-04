"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { listWebviewAssetNames, patchAssetFiles, patchUniqueAssetFile } = require("./assets.js");
const { javascriptSourceParses } = require("./javascript-syntax.js");

function withAssets(files, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-assets-test-"));
  const assets = path.join(root, "webview", "assets");
  fs.mkdirSync(assets, { recursive: true });
  for (const [name, source] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(assets, name)), { recursive: true });
    fs.writeFileSync(path.join(assets, name), source);
  }
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (message) => warnings.push(String(message));
  try {
    return callback({
      root,
      read: (name) => fs.readFileSync(path.join(assets, name), "utf8"),
      warnings,
    });
  } finally {
    console.warn = originalWarn;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const MODULE = "function Pan(){return 1}export{Pan};";
const BREAK = (source) => source.replace("return 1}", "return 1}return 2}");

test("javascriptSourceParses accepts modules and classic scripts only", () => {
  assert.equal(javascriptSourceParses(MODULE), true);
  assert.equal(javascriptSourceParses("with(self){postMessage(1)}"), true);
  assert.equal(javascriptSourceParses(BREAK(MODULE)), false);
  assert.equal(javascriptSourceParses("return 1"), false);
});

test("current Rspack assets retain semantic selection across async chunk names", () => {
  const chunk = 'export const __rspack_esm_id=123;export const __rspack_esm_ids=[123];export const __webpack_modules__={a(e,t,n){let marker="target";}};';
  withAssets({ "async/123.abcdef0123.js": chunk, "async/456.abcdef0123.js": chunk.replace('"target"', '"other"'), "async/789.abcdef0123.js": MODULE }, ({ root, read }) => {
    assert.deepEqual(listWebviewAssetNames(path.join(root, "webview", "assets"), /^app-initial-.*\.js$/), ["async/123.abcdef0123.js", "async/456.abcdef0123.js"]);
    const result = patchUniqueAssetFile(root, /^app-initial-.*\.js$/, s => s.includes('"target"'), s => s.replace('"target"', '"patched"'), "missing", "ambiguous");
    assert.equal(result.assetName, "async/123.abcdef0123.js");
    assert.equal(result.changed, 1);
    assert.match(read(result.assetName), /"patched"/);
  });
});

test("current Rspack async CSS chunks are discoverable by semantic selectors", () => {
  withAssets({ "async/d605868d242a.css": ".MarkdownRoot-a[data-markdown-animated]{}", "async/other.css": ".unrelated{}" }, ({ root }) => {
    assert.deepEqual(
      listWebviewAssetNames(path.join(root, "webview", "assets"), /^app-.*\.css$/),
      ["async/d605868d242a.css"],
    );
  });
});

test("explicit all-match policy patches every matching module copy atomically", () => {
  withAssets({ "a.js": MODULE, "b.js": MODULE }, ({ root, read }) => {
    const result = patchUniqueAssetFile(root, /\.js$/, () => true, s => s.replace("return 1", "return 2"), "missing", "ambiguous", "all");
    assert.equal(result.changed, 2);
    assert.match(read("a.js"), /return 2/);
    assert.match(read("b.js"), /return 2/);
  });
  withAssets({ "a.js": MODULE, "b.js": MODULE.replaceAll("Pan", "Bar") }, ({ root, read }) => {
    const result = patchUniqueAssetFile(root, /\.js$/, () => true, s => s.includes("Bar") ? BREAK(s) : s.replace("return 1", "return 2"), "missing", "ambiguous", "all");
    assert.equal(result.changed, 0);
    assert.equal(read("a.js"), MODULE);
  });
});

test("patchUniqueAssetFile keeps a classic script whose patch moves code to the top level", () => {
  const script = "function f(){return 1}var y=2;";
  withAssets({ "worker.js": script }, ({ root, read, warnings }) => {
    const patch = (source) => source.replace("{return 1}", "{}return 1;");
    const result = patchUniqueAssetFile(root, /\.js$/, () => true, patch, "missing", "ambiguous");
    assert.equal(result.changed, 0);
    assert.equal(read("worker.js"), script);
    assert.equal(warnings.length, 1);
  });
});

test("patchUniqueAssetFile keeps an asset whose patch breaks its syntax", () => {
  withAssets({ "app-a.js": MODULE }, ({ root, read, warnings }) => {
    const result = patchUniqueAssetFile(root, /\.js$/, () => true, BREAK, "missing", "ambiguous");
    assert.deepEqual(result, { matched: 1, changed: 0, assetName: "app-a.js" });
    assert.equal(read("app-a.js"), MODULE);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /app-a\.js no longer parses as JavaScript/u);
  });
});

test("patchAssetFiles writes nothing when any patched asset breaks syntax", () => {
  withAssets({ "a.js": MODULE, "b.js": MODULE.replaceAll("Pan", "Bar") }, ({ root, read }) => {
    const patch = (source) => (source.includes("Bar") ? BREAK(source) : `${source}//ok`);
    assert.deepEqual(patchAssetFiles(root, /\.js$/, patch, "missing"), { matched: 2, changed: 0 });
    assert.equal(read("a.js"), MODULE);
  });
});

test("asset patches still apply valid edits, non-JS assets, and unparseable originals", () => {
  withAssets({ "a.js": MODULE, "a.css": ".a{}", "fixture.js": "not js {" }, ({ root, read, warnings }) => {
    assert.equal(patchAssetFiles(root, /^a\.js$/, (s) => s.replace("1", "2"), "missing").changed, 1);
    assert.equal(read("a.js"), MODULE.replace("1", "2"));
    assert.equal(patchAssetFiles(root, /\.css$/, (s) => `${s}}`, "missing").changed, 1);
    assert.equal(patchAssetFiles(root, /^fixture\.js$/, (s) => `${s}}`, "missing").changed, 1);
    assert.deepEqual(warnings, []);
  });
});
