"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { applyPetOverlayPatch } = require("./patch.js");
const { findMatchingBrace } = require("../../scripts/patches/lib/minified-js.js");
const fixture = fs.readFileSync(path.join(__dirname, "fixtures/current-signed-shape.js"), "utf8");

test("signed 26.1103 layout and proximity tracker preserves every KWin coordinate hook", () => {
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

for (const [platform, ozone, nativeKWin, constrained] of [
  ["linux", "wayland", true, false],
  ["linux", "wayland", false, true],
  ["linux", "x11", false, false],
  ["win32", "", false, true],
  ["darwin", "", false, false],
]) test(`signed layout retains manager context: ${platform} ${ozone} KWin=${nativeKWin}`, () => {
  const patched = applyPetOverlayPatch(fixture);
  const signature = /getLayoutForDisplay\([^{}]*\)\{/.exec(patched);
  const open = signature.index + signature[0].length - 1;
  const method = patched.slice(signature.index, findMatchingBrace(patched, open) + 1);
  const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  display.workArea = display.bounds;
  const context = {
    process: { platform },
    require: name => { assert.equal(name, "electron"); return { app: { commandLine: { getSwitchValue: () => ozone } } }; },
    er: { screen: { getAllDisplays: () => [display] } },
    ei: { Zkw: 16, bZi: 356, VuE: 8 },
    dE: { width: 356, height: 320 }, dk: { width: 356, height: 320 },
    dm: { width: 112, height: 87 }, dJ: null, dU: null, dx: 0,
    dT: value => value.workArea, dO: () => null,
    dD: (value, min, max) => Math.max(min, Math.min(value, max)),
    dB: () => "top-end",
    dN: (rect, bounds) => ({ left: rect.x - bounds.x, top: rect.y - bounds.y, width: rect.width, height: rect.height }),
    dW: (rect, bounds) => ({ left: Math.max(0, bounds.x - rect.x), top: Math.max(0, bounds.y - rect.y),
      width: Math.min(rect.x + rect.width, bounds.x + bounds.width) - Math.max(rect.x, bounds.x),
      height: Math.min(rect.y + rect.height, bounds.y + bounds.height) - Math.max(rect.y, bounds.y) }),
  };
  const controller = vm.runInNewContext(`new class{${method}}`, context);
  Object.assign(controller, {
    anchor: { x: 100, y: 200, width: 112, height: 87 },
    mascotSize: { width: 112, height: 87 }, layoutMode: "native", placement: "top-end",
    realtimeCaptionAboveMascotPx: 0,
    codexPetOverlayIsNativeKWin() { return nativeKWin; },
    codexPetOverlayIsNativeHyprland() { return false; },
    codexPetOverlayKWinDrawBounds(value) { assert.equal(this, controller); assert.equal(value, display);
      return { x: 10, y: 20, width: 640, height: 480 }; },
    codexPetOverlayKWinLayoutOptions(options) { assert.equal(this, controller);
      assert.equal(options.constrainNativeDrawWindowToDisplay, constrained); return options; },
    codexPetOverlayKWinLayout(value, layout) { assert.equal(this, controller); assert.equal(value, display);
      return { ...layout, completed: true }; },
  });
  const layout = controller.getLayoutForDisplay(display);
  assert.equal(layout.completed, true);
  if (nativeKWin) assert.deepEqual(JSON.parse(JSON.stringify(layout.windowBounds)), { x: 10, y: 20, width: 640, height: 480 });
});

test("unknown signed layout platform binding leaves the entire bundle unchanged", () => {
  const drifted = fixture.replace("platform:r,requestedAnchor:", "changedPlatform:r,requestedAnchor:");
  assert.notEqual(drifted, fixture);
  const warn = console.warn;
  console.warn = () => {};
  try { assert.equal(applyPetOverlayPatch(drifted), drifted); }
  finally { console.warn = warn; }
});
