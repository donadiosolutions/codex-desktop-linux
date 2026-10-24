"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { registerFeaturePreferences } = require("./feature-preferences.js");
const source = 'var Host=class{globalState={get:key=>this.values.get(key),set:(key,value)=>this.values.set(key,value)};values=new Map;handlers={"set-remote-wsl-connections-enabled":async()=>({})};handleVSCodeRequest(origin,key,params){return this.handlers[key]({...params,origin})}};globalThis.host=new Host;';

test("enabled feature preference keys share one reachable state bridge", async () => {
  const first = registerFeaturePreferences(source, ["workspace-command"]);
  const combined = registerFeaturePreferences(first, ["read-aloud", "read-aloud-speed"]);
  assert.equal(registerFeaturePreferences(combined, ["workspace-command"]), combined);
  const context = {};
  vm.runInNewContext(combined, context);
  for (const [key, value] of [["workspace-command", "helper"], ["read-aloud", true], ["read-aloud-speed", 1.1]]) {
    const written = await context.host.handleVSCodeRequest("window", "set-global-state", { key, value });
    assert.equal(written.success, true);
    const result = await context.host.handleVSCodeRequest("window", "get-global-state", { key });
    assert.equal(result.value, value);
  }
  await assert.rejects(context.host.handleVSCodeRequest("window", "get-global-state", { key: "unregistered" }));
  await assert.rejects(context.host.handleVSCodeRequest("window", "set-global-state", { key: "unregistered", value: true }));
});

test("preference registration rejects incomplete, detached, and ambiguous bridges", () => {
  const patched = registerFeaturePreferences(source, ["read-aloud"]);
  for (const broken of [
    patched.replace('"get-global-state":', '"unused-state":'),
    patched.replace('codexLinuxFeaturePreferenceKeys=new Set', 'otherPreferenceKeys=new Set'),
    patched + source,
  ]) assert.throws(() => registerFeaturePreferences(broken, ["read-aloud"]));
});

test("Read Aloud and Agent Workspace preferences coexist in either feature order", async () => {
  const readAloud = require("../../../linux-features/read-aloud/patch.js").applyMainBundlePatch;
  const workspace = require("../../../linux-features/agent-workspace/patch.js").applyAgentWorkspaceMainBridgePatch;
  for (const order of [[readAloud, workspace], [workspace, readAloud], [readAloud], [workspace]]) {
    const input = 'let electron=require(`electron`);' + source;
    const patched = order.reduce((value, apply) => apply(value), input);
    const files = new Map([["/feature-test/settings.json", JSON.stringify({"codex-linux-read-aloud-enabled":true,"codex-linux-read-aloud-kokoro-speed":1.2})]]);
    const fs = {existsSync:path=>files.has(path),readFileSync:path=>files.get(path),mkdirSync(){},writeFileSync:(path,text)=>files.set(path,text)};
    const context = { require: name => name === "electron" ? {} : name === "node:fs" ? fs : name === "node:child_process" ? {spawnSync:()=>({status:1})} : require(name), process:{platform:"linux",env:{CODEX_LINUX_SETTINGS_FILE:"/feature-test/settings.json"}}, console };
    vm.runInNewContext(patched, context);
    for (const key of order.includes(readAloud) ? ["codex-linux-read-aloud-enabled", "codex-linux-read-aloud-kokoro-speed"] : []) {
      const expected = key.endsWith("enabled") ? true : 1.2;
      assert.equal((await context.host.handleVSCodeRequest("window", "linux-read-aloud", {action:"get-preference",key})).value, expected);
      const value = key.endsWith("enabled") ? false : 1.05;
      await context.host.handleVSCodeRequest("window", "linux-read-aloud", { action:"set-preference", key, value });
      assert.equal((await context.host.handleVSCodeRequest("window", "linux-read-aloud", {action:"get-preference",key})).value, value);
      assert.equal(JSON.parse(files.get("/feature-test/settings.json"))[key],value);
    }
    for (const key of order.includes(workspace) ? ["codex-linux-agent-workspace-command", "codex-linux-agent-workspace-permissions"] : []) {
      await context.host.handleVSCodeRequest("window", "set-global-state", { key, value: "configured" });
      assert.equal((await context.host.handleVSCodeRequest("window", "get-global-state", { key })).value, "configured");
    }
    if (order.includes(workspace)) await assert.rejects(context.host.handleVSCodeRequest("window", "set-global-state", { key: "unregistered", value: true }));
    if (order.includes(readAloud)) {
      await assert.rejects(context.host.handleVSCodeRequest("window", "linux-read-aloud", {action:"set-preference",key:"unregistered",value:true}));
      const config = await context.host.handleVSCodeRequest("window", "linux-read-aloud", {action:"config"});
      assert.equal(config.enabled,false);
      assert.equal(config.kokoro.speed,1.05);
    }
  }
});
