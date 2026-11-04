"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { listWebviewAssetNames } = require("../../scripts/patches/lib/assets.js");
const { applyCurrentRemoteTerminalStatusPatch, CURRENT_TERMINAL_MARKER } = require("./current-status.js");
const { terminal } = require("./fixtures/current-status.js");

test("signed current terminal status uses current request summary for waiting-on-input recovery", () => {
  const patched = applyCurrentRemoteTerminalStatusPatch(terminal);
  assert.notEqual(patched, terminal);
  assert.equal(applyCurrentRemoteTerminalStatusPatch(patched), patched);
  assert.match(patched, /hasUserInputRequest:\["userInput","optionPicker","setupCodexStep"\]\.includes\([A-Za-z_$][\w$]*\?\.summary\.pendingRequest\?\.kind\)/u);
  const status = vm.runInNewContext(`(${patched.slice(0, patched.indexOf("let h="))})`);
  const state = {hasInProgressOwnedWork:false,isResponseInProgress:false,latestTurnHasSystemError:false,resumeState:"needs_resume",threadRuntimeStatus:{type:"active",activeFlags:["waitingOnUserInput"]}};
  assert.equal(status({...state,hasUserInputRequest:true}), "loading");
  assert.equal(status({...state,hasUserInputRequest:false}), "idle");
  assert.equal(status({...state,threadRuntimeStatus:{type:"active",activeFlags:["waitingOnApproval"]},hasUserInputRequest:false}), "loading");
  assert.equal(status({...state,hasInProgressOwnedWork:true,hasUserInputRequest:false}), "loading");
  assert.equal(status({...state,threadRuntimeStatus:{type:"systemError"},hasUserInputRequest:false}), "error");
  assert.equal(applyCurrentRemoteTerminalStatusPatch(terminal + terminal), terminal + terminal);
});

test("current terminal patch fails closed for missing, duplicate, or mismatched callers", () => {
  const call = terminal.slice(terminal.indexOf("let h="));
  assert.equal(applyCurrentRemoteTerminalStatusPatch(terminal.replace(call, "")), terminal.replace(call, ""));
  assert.equal(applyCurrentRemoteTerminalStatusPatch(terminal + call), terminal + call);
  const mismatched = terminal.replace("latestTurnHasSystemError:i?.latestTurnError", "latestTurnHasSystemError:x?.latestTurnError");
  assert.equal(applyCurrentRemoteTerminalStatusPatch(mismatched), mismatched);
});

const SIGNED_APP = process.env.CODEX_SIGNED_EXTRACTED_APP;
test("raw signed terminal asset matches the current fixture and patches exactly once", { skip: SIGNED_APP == null }, () => {
  const assetsDir = path.join(SIGNED_APP, "webview", "assets");
  const matches = listWebviewAssetNames(assetsDir, /\.js$/u)
    .map((name) => ({ name, source: fs.readFileSync(path.join(assetsDir, name), "utf8") }))
    .filter(({ source }) => source.includes("hasInProgressOwnedWork:") && source.includes("latestTurnHasSystemError:") && source.includes("isResponseInProgress:"));
  assert.equal(matches.length, 1);
  const { source: signed } = matches[0];
  const fixtureFn = terminal.slice(0, terminal.indexOf("let h="));
  assert.ok(signed.includes(fixtureFn));
  assert.match(signed, /latestTurnHasSystemError:([A-Za-z_$][\w$]*)\?\.latestTurnError!=null/u);
  const patched = applyCurrentRemoteTerminalStatusPatch(signed);
  assert.equal(patched.split(CURRENT_TERMINAL_MARKER).length - 1, 1);
  assert.match(patched, /hasUserInputRequest:\["userInput","optionPicker","setupCodexStep"\]\.includes\(([A-Za-z_$][\w$]*)\?\.summary\.pendingRequest\?\.kind\)/u);
  assert.equal(applyCurrentRemoteTerminalStatusPatch(patched), patched);
});
