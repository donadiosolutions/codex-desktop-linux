"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { applyPetOverlayPatch } = require("./patch.js");
const { findMatchingBrace } = require("../../scripts/patches/lib/minified-js.js");
const fixture = fs.readFileSync(path.join(__dirname, "fixtures/current-signed-shape.js"), "utf8");

test("signed 26.1027 proximity tracker preserves every KWin coordinate hook", () => {
  const patched = applyPetOverlayPatch(fixture);
  assert.notEqual(patched, fixture);
  assert.equal(applyPetOverlayPatch(patched), patched);
  assert.doesNotThrow(() => new vm.Script(patched));
  for (const name of ["sendCursorPointToAvatarOverlay", "sendComputerUseCursorLocationToRenderer",
    "isOverlayWindowPointerDragActive", "publishRemoteHostedPIPContentHost", "snapQuickChatToPosition"]) {
    const signature = new RegExp(`(?<![\\w$.])${name}\\([^{}]*\\)\\{`).exec(patched);
    assert.ok(signature, name);
    const open = signature.index + signature[0].length - 1;
    const body = patched.slice(open, findMatchingBrace(patched, open) + 1);
    assert.ok(body.includes("this.codexPetOverlayKWinGeometry("), name);
  }
  assert.ok(patched.includes("this.codexPetOverlayKWinGeometry("));
  assert.ok(patched.includes("this.codexPetOverlayKWinProximity()"));
  assert.ok(patched.includes("this.codexPetOverlayLayoutForDisplay("));
  assert.ok(patched.includes("this.codexPetOverlayMoveLocalMascotDrag("));
});


test("unknown proximity tracker shape leaves the entire current bundle unchanged", () => {
  const drifted = fixture.replace("null==this.stopPetControlsProximity&&(", "null==this.changedProximity&&(");
  assert.notEqual(drifted, fixture);
  const warn = console.warn;
  console.warn = () => {};
  try { assert.equal(applyPetOverlayPatch(drifted), drifted); }
  finally { console.warn = warn; }
});
