"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const vm = require("node:vm");
const { applyProjectTaskSortPatch, matchesProjectTaskSortContract } = require("./patch.js");
// Signed 26.1111.21308: the project sorter now inlines a local-only selector.
const current = 'function(e,t){if("local"===e.kind)return null==e.summary?e.at:"updated_at"===t?e.summary.recencyAt??e.summary.updatedAt:e.summary.createdAt}(task,mode)';
test("signed current local timestamp selector matches its semantic shape", () => {
  assert.equal(matchesProjectTaskSortContract(current), true);
  const patched = applyProjectTaskSortPatch(current);
  assert.notEqual(patched, current);
  assert.equal(applyProjectTaskSortPatch(patched), patched);
  const context = { task: { kind: "local", key: "local:019ad25f-1234-7123-8123-123456789abc", summary: { updatedAt: 9, recencyAt: 10 } }, mode: "created_at" };
  assert.equal(vm.runInNewContext(`(${patched})`, context), Number.parseInt("019ad25f1234",16));
  context.mode = "updated_at";
  assert.equal(vm.runInNewContext(`(${patched})`, context),10);
  context.task = { kind: "local", at: 7 };
  context.mode = "created_at";
  assert.equal(vm.runInNewContext(`(${patched})`, context),7);
  assert.equal(matchesProjectTaskSortContract(current+current),false);
  const damaged = patched.replace("Number.parseInt(", "Number.parseFloat(");
  assert.equal(matchesProjectTaskSortContract(damaged),false);
  const warnings=[];
  const originalWarn=console.warn;
  console.warn=message=>warnings.push(message);
  try { assert.equal(applyProjectTaskSortPatch(damaged),damaged); }
  finally { console.warn=originalWarn; }
  assert.equal(warnings.length,1);
});

test("signed original project sorter asset matches and patches once", { skip: !process.env.CODEX_SIGNED_EXTRACTED_APP }, () => {
  const assets = path.join(process.env.CODEX_SIGNED_EXTRACTED_APP, "webview", "assets", "async");
  const owners = [];
  for (const name of fs.readdirSync(assets)) {
    const file = path.join(assets, name);
    if (!fs.statSync(file).isFile() || !name.endsWith(".js")) continue;
    const source = fs.readFileSync(file, "utf8");
    if (source.includes('if("local"===') && source.includes("summary.recencyAt") && matchesProjectTaskSortContract(source)) {
      owners.push({ name, source });
    }
  }
  assert.equal(owners.length, 1, `expected one signed project sorter owner, found ${owners.map(({ name }) => name).join(", ")}`);
  const { name, source } = owners[0];
  const patched = applyProjectTaskSortPatch(source);
  assert.notEqual(patched, source, `expected ${name} to receive the project task sort patch`);
  assert.equal(applyProjectTaskSortPatch(patched), patched);
  const checked = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: patched, encoding: "utf8" });
  assert.equal(checked.status, 0, checked.stderr);
});
