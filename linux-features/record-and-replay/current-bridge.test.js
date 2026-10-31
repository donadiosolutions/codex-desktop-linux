"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { applyRecordReplayMainBridgePatch } = require("./patch.js");

// Current signed 26.1027 map shape; handler bodies reduced to isolated stubs.
const fixture = 'const codexLinuxRecordReplayRun=globalThis.run;class Bridge{handlers={"set-remote-wsl-connections-enabled":async()=>null}}var bridge=new Bridge().handlers;';

function quietPatch(source) {
  const warn = console.warn;
  console.warn = () => {};
  try { return applyRecordReplayMainBridgePatch(source); }
  finally { console.warn = warn; }
}

test("current exported bridge map registers Record & Replay handlers without changing dispatch", async () => {
  const patched = quietPatch(fixture);
  assert.notEqual(patched, fixture);
  assert.equal(quietPatch(patched), patched);
  const calls = [];
  const context = vm.createContext({ codexLinuxRecordReplayString: value => String(value ?? "").trim(), run: async (...args) => { calls.push(args); return { ok: true }; } });
  vm.runInContext(patched, context, { timeout: 1000 });
  await vm.runInContext('bridge["linux-record-replay-start"]({sessionDir:"/private/session",appId:"app",includeAudio:false})', context, { timeout: 1000 });
  assert.deepEqual(calls.map(([args, timeout]) => [Array.from(args), timeout]), [
    [["record", "start", "--session-dir", "/private/session", "--app-id", "app", "--no-audio"], 60000],
  ]);
  assert.equal(await vm.runInContext('bridge["set-remote-wsl-connections-enabled"]()', context), null);
});

test("ambiguous and unexported bridge maps remain unchanged", () => {
  for (const source of [
    fixture + fixture.replaceAll("Bridge", "SecondBridge").replaceAll("bridge", "secondBridge").replaceAll("const codexLinuxRecordReplayRun=globalThis.run;", ""),
    fixture.replace("var bridge=new Bridge().handlers;", ""),
    fixture.replace('"set-remote-wsl-connections-enabled"', '"unrelated"'),
  ]) assert.equal(quietPatch(source), source);
});
