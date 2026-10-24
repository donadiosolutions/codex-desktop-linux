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
    const context = { require: name => name === "electron" ? {} : require(name), process, console };
    vm.runInNewContext(patched, context);
    for (const key of order.includes(readAloud) ? ["codex-linux-read-aloud-enabled", "codex-linux-read-aloud-kokoro-speed"] : []) {
      await context.host.handleVSCodeRequest("window", "set-global-state", { key, value: 1.05 });
      assert.equal((await context.host.handleVSCodeRequest("window", "get-global-state", { key })).value, 1.05);
    }
    for (const key of order.includes(workspace) ? ["codex-linux-agent-workspace-command", "codex-linux-agent-workspace-permissions"] : []) {
      await context.host.handleVSCodeRequest("window", "set-global-state", { key, value: "configured" });
      assert.equal((await context.host.handleVSCodeRequest("window", "get-global-state", { key })).value, "configured");
    }
    await assert.rejects(context.host.handleVSCodeRequest("window", "set-global-state", { key: "unregistered", value: true }));
  }
});
