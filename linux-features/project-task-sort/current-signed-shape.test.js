"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const { applyProjectTaskSortPatch, matchesProjectTaskSortContract } = require("./patch.js");
// Signed 26.1029.61003: Rspack inlines this timestamp helper into the map.
const current = 'function(e,t){switch(e.kind){case"local":if(null==e.summary)return e.at;return"updated_at"===t?e.summary.recencyAt??e.summary.updatedAt:e.summary.createdAt;case"remote":return(("updated_at"===t?e.task.updated_at??e.task.created_at:e.task.created_at??e.task.updated_at)??0)*1e3}}';
test("signed current inline comparator preserves modes and UUID creation fallback", () => {
  assert.equal(matchesProjectTaskSortContract(current), true);
  const patched = applyProjectTaskSortPatch(current);
  assert.notEqual(patched, current);
  assert.equal(applyProjectTaskSortPatch(patched), patched);
  const timestamp = vm.runInNewContext(`(${patched})`);
  const task={kind:"local",key:"local:019ad25f-1234-7123-8123-123456789abc",summary:{updatedAt:9,recencyAt:10}};
  assert.equal(timestamp(task,"created_at"),Number.parseInt("019ad25f1234",16));
  assert.equal(timestamp(task,"updated_at"),10);
  assert.equal(timestamp({kind:"remote",task:{created_at:2}},"created_at"),2000);
  assert.equal(timestamp({kind:"local",at:7},"created_at"),7);
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
