"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const { findMatchingBrace } = require("../../scripts/patches/lib/minified-js.js");
const { findRequestHandlerMap } = require("../../scripts/patches/lib/request-handlers.js");
const { applyLinuxNativeDesktopAppsHandlerPatch } = require("../../scripts/patches/impl/computer-use.js");
const { applyChronicleSkysightMainBridgePatch } = require("./patch.js");
const { applyRecordReplayMainBridgePatch } = require("../record-and-replay/patch.js");
const { applyMainBundlePatch } = require("../read-aloud/patch.js");
const { applyPetOverlayPatch } = require("../pet-overlay/patch.js");

// Opt in with the main bundle from the already verified, extracted signed package.
const signedMain = process.env.CODEX_TEST_SIGNED_MAIN_BUNDLE;
test("signed current main emits valid idempotent patches and routes the real Electron requests", { skip: !signedMain, timeout: 20_000 }, async () => {
  const raw = fs.readFileSync(signedMain, "utf8");
  let patched = raw;
  for (const patch of [applyLinuxNativeDesktopAppsHandlerPatch, applyChronicleSkysightMainBridgePatch,
    applyRecordReplayMainBridgePatch, applyMainBundlePatch, applyPetOverlayPatch]) {
    const next = patch(patched, {});
    assert.notEqual(next, patched, patch.name);
    assert.equal(patch(next, {}), next, `${patch.name} idempotence`);
    new vm.Script(next, { filename: patch.name });
    patched = next;
  }

  const map = findRequestHandlerMap(patched);
  const owner = patched.slice(map.ownerStart, map.ownerEnd + 1);
  const factoryName = owner.match(/nativeApplications=([A-Za-z_$][\w$]*)\(\);/)[1];
  const factoryStart = patched.indexOf(`function ${factoryName}(){`);
  const factoryOpen = factoryStart + `function ${factoryName}()`.length;
  const factory = patched.slice(factoryStart, findMatchingBrace(patched, factoryOpen) + 1);
  const routerStart = owner.indexOf("handleVSCodeRequest(");
  const routerOpen = owner.indexOf("{", routerStart);
  const router = owner.slice(routerStart, findMatchingBrace(owner, routerOpen) + 1);
  const prefixEnd = patched.indexOf(raw.slice(0, 100));
  assert.ok(prefixEnd > 0, "extract emitted helpers without booting Electron");
  const commands = [];
  let recorderState = "running";
  const context = { Buffer, URL, console,
    process: {platform:"linux",env:{CODEX_LINUX_COMPUTER_USE_BACKEND_SOURCE:"/backend",XDG_DATA_DIRS:"/empty"}},
    s: {ct:(_metadata,fn)=>fn()}, rYe:class extends Error {},
    require(name) {
      if (name === "node:child_process") return {
        execFile(bin,args,options,callback) {
          commands.push({bin,args,options});
          if (args[0] === "skysight") {
            recorderState = {start:"running",pause:"paused",resume:"running",stop:"stopped"}[args[1]] ?? recorderState;
          }
          callback(null,JSON.stringify({state:recorderState,is_running:recorderState!=="stopped",ocr_available:true}),"");
        },
        spawnSync(bin,args,options) {
          if (bin !== "/backend") return {status:1};
          commands.push({bin,args,options});
          return {status:0,stdout:JSON.stringify({windows:[{app_id:"org.example.Editor",focused:true}]})};
        },
      };
      if (name === "node:fs") return {existsSync:path=>path==="/backend",accessSync(){},constants:{X_OK:1}};
      if (name === "node:os") return {homedir:()=>""};
      return require(name);
    },
  };
  // Reuse the emitted factory, handlers, and full upstream router verbatim.
  vm.runInNewContext(patched.slice(0,prefixEnd)+factory+
    `;class Probe{nativeApplications=${factoryName}();handlers={${map.text}};${router}}globalThis.probe=new Probe`, context);
  const call = (method,body) => context.probe.handleVSCodeRequest("renderer",method,body,"integration",null);
  const permissions = await call("chronicle-permissions",{});
  assert.equal(permissions.chronicleSidecarPresent,true);
  assert.equal(permissions.chronicleOcrAvailable,true);
  const recording = await call("linux-record-replay-status",{});
  assert.equal(recording.ok,true);
  const speech = await call("linux-read-aloud",{action:"config"});
  assert.equal(typeof speech,"object");
  const apps = await call("native-desktop-apps",{});
  assert.equal(apps.apps[0].bundleId,"org.example.Editor");
  const icon = await call("computer-use-native-desktop-app-icon",{appPath:"linux:org.example.Editor"});
  assert.equal(icon.iconSmall,"");
  const controllerMatch = patched.match(/([A-Za-z_$][\w$]*)=class\{dependencies;cachedStatus=([A-Za-z_$][\w$]*);desiredState=`stopped`/);
  assert.ok(controllerMatch, "current Chronicle recorder controller");
  const controllerStart = controllerMatch.index;
  const controllerOpen = patched.indexOf("{",controllerStart);
  const controllerClass = patched.slice(controllerOpen,findMatchingBrace(patched,controllerOpen)+1);
  context[controllerMatch[2]] = {state:"stopped",currentSegmentEventsPath:null,currentSegmentMetadataPath:null};
  vm.runInNewContext(`globalThis.controller=new(class${controllerClass})({request:codexLinuxChronicleRequest,archiveLegacyChronicleSkill:async()=>{},reconcileComputerHistoryPluginInstallation(){}})`,context);
  assert.equal((await context.controller.status()).state,"running");
  assert.equal((await context.controller.enable()).state,"running");
  assert.equal((await context.controller.pause()).state,"paused");
  assert.equal((await context.controller.resume()).state,"running");
  assert.equal((await context.controller.stop()).state,"stopped");
  assert.ok(commands.every(command=>command.options.timeout<=15_000));
});
