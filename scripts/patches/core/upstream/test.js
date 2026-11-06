"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { corePatchDescriptors } = require("../../runner.js");
const { findMatchingBrace } = require("../../lib/minified-js.js");

const IDENT = "[A-Za-z_$][\\w$]*";

test("resolved upstream blockers leave the core registry empty", () => {
  assert.deepEqual(corePatchDescriptors(), []);
});

test("signed upstream quits on Linux without a dialog and loads the shell after app readiness", {
  skip: !process.env.CODEX_SIGNED_EXTRACTED_APP,
  timeout: 10_000,
}, () => {
  const buildDir = path.join(process.env.CODEX_SIGNED_EXTRACTED_APP, ".vite/build");
  const sources = fs.readdirSync(buildDir).filter(name => name.endsWith(".js"))
    .map(name => fs.readFileSync(path.join(buildDir, name), "utf8"));
  const mains = sources.filter(source => source.includes("main app.whenReady resolved"));
  assert.equal(mains.length, 1);
  const main = mains[0];
  const coordinators = [...main.matchAll(new RegExp(
    `function\\(\\{isWindows:${IDENT},quitState:${IDENT},windows:(${IDENT}),applicationMenuManager:${IDENT},ensureWindow:${IDENT},hotkeyWindowLifecycleManager:`, "g"))];
  assert.equal(coordinators.length, 1);
  const coordinator = coordinators[0];
  const parametersEnd = main.indexOf("}){", coordinator.index);
  const bodyOpen = parametersEnd + 2;
  const bodyClose = findMatchingBrace(main, bodyOpen);
  assert.ok(bodyClose > bodyOpen);
  const body = main.slice(bodyOpen, bodyClose + 1);
  assert.doesNotMatch(body, /showMessageBox|quitConfirmation|disableQuitConfirmationPrompt/);
  const before = [...body.matchAll(new RegExp(
    `(${IDENT})\\.app\\.on\\("before-quit",(${IDENT})=>\\{`, "g"))];
  assert.equal(before.length, 1);
  const handlerOpen = before[0].index + before[0][0].length - 1;
  const handler = body.slice(handlerOpen, findMatchingBrace(body, handlerOpen) + 1);
  assert.match(handler, /isPrivacySettingsTerminationRequest\(\)/);
  assert.match(handler, /"darwin"!==/);
  let marked = 0;
  let prevented = 0;
  const context = {
    process: { platform: "linux", resourcesPath: "/official/resources" },
    [before[0][1]]: { app: { getAppPath: () => "/official/app.asar" } },
    [coordinator[1]]: { markAppQuitting() { marked++; } },
    event: { preventDefault() { prevented++; } },
  };
  vm.runInNewContext(`(${before[0][2]}=>${handler})(event)`, context);
  assert.equal(marked, 1);
  assert.equal(prevented, 0);

  const shellModules = sources.filter(source => source.includes("Failed to load shell env") && source.includes('resultSource:"load"'));
  assert.equal(shellModules.length, 1);
  const shell = shellModules[0];
  const startup = [...shell.matchAll(new RegExp(`function (${IDENT})\\(\\)\\{return ${IDENT}\\(\\{caller:"startup",retryFailed:!1\\}\\)\\}`, "g"))];
  assert.equal(startup.length, 1);
  const modules = [...shell.matchAll(/(\d+)\(e,t,r\)\{"use strict";r\.d\(t,\{([^}]+)\}\);/g)]
    .filter(match => match.index < startup[0].index);
  const module = modules.at(-1);
  assert.ok(module);
  const exported = module[2].match(new RegExp(`(${IDENT}):\\(\\)=>${startup[0][1]}(?:,|$)`));
  assert.ok(exported);
  const imported = [...main.matchAll(new RegExp(`(${IDENT})=r\\(${module[1]}\\)`, "g"))];
  assert.equal(imported.length, 1);
  const calls = [...main.matchAll(new RegExp(`\\(0,${imported[0][1]}\\.${exported[1]}\\)\\(\\)`, "g"))];
  assert.equal(calls.length, 1);
  const ready = main.indexOf("main app.whenReady resolved");
  assert.ok(ready > 0 && ready < calls[0].index, "shell startup follows the awaited app.whenReady checkpoint");
  assert.match(main.slice(ready - 80, ready), /await [\w$]+\.app\.whenReady\(\)/);
});
