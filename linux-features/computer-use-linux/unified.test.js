"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { applyUnifiedComputerUsePatch: patch } = require("./unified.js");
const fixture = require("./fixtures/shared-plugin-runtime.js");

function select(source, platform, { ready = true, enabled = true, native = true, service = null } = {}) {
  const owner = source.slice(0, source.indexOf("async function writePlugin"));
  const selector = vm.runInNewContext(`(${owner})`);
  const result = selector(ready, { platform },
    { computerUse: enabled, browser: true, browserUseTinysky: true }, { enabled: native, paths: { serviceAppPath: service } });
  return { computerUse: result.computerUse, surfaces: Array.from(result.cuaReplSurfaces) };
}

test("the Linux selector keeps its readiness and native opt-out gates independent of browser access", () => {
  const patched = patch(fixture);
  assert.deepEqual(select(fixture, "linux").surfaces, ["browser"]);
  assert.deepEqual(select(patched, "linux"), { computerUse: true, surfaces: ["browser", "computer"] });
  assert.deepEqual(select(patched, "linux", { ready: false }), { computerUse: false, surfaces: [] });
  for (const settings of [{ enabled: false }, { native: false }]) {
    assert.deepEqual(select(patched, "linux", settings), { computerUse: false, surfaces: ["browser"] });
  }
  for (const platform of ["darwin", "win32"]) {
    for (const settings of [{}, { native: false }, { service: "/service" }]) {
      assert.deepEqual(select(patched, platform, settings), select(fixture, platform, settings));
    }
  }
});

test("unified relationships are scoped to the rspack module owning the selector", () => {
  const unrelated = 'let build=Symbol("jobs"),writePlugin=Symbol("done");class Q{#build;[writePlugin](){this[build]+=1,this.#build=writePlugin}}';
  const chunk = `exports.ids=[916],exports.modules={61071(e,t,r){"use strict";${fixture}},82751(e,t,r){"use strict";${unrelated}}};`;
  const patched = patch(chunk);
  assert.doesNotThrow(() => new vm.Script(patched));
  assert.ok(patched.endsWith(`},82751(e,t,r){"use strict";${unrelated}}};`));
  assert.equal(patch(patched), patched);
});

test("unified patch leaves other rspack chunks alone", t => {
  const warnings = [];
  t.mock.method(console, "warn", message => warnings.push(message));
  const unrelated = 'exports.ids=[87],exports.modules={1(e,t,r){"use strict";e.exports=1}};';
  assert.equal(patch(unrelated), unrelated);
  assert.match(warnings.join("\n"), /unified Computer Use surface selector/);
});

test("unified builder preserves upstream confirmation, audio, and backend settings", () => {
  const patched = patch(fixture);
  for (const field of [
    'CUA_REPL_CONFIRMATION_POLICY_CONFIG:c,[q]:JSON.stringify(p)',
    '[deleteKey]:[n?.env[deleteKey],q,"CUA_REPL_CONFIRMATION_POLICY_CONFIG"].filter(Boolean).join(",")',
    '...n?.env.SKY_ENABLE_AUDIO==="1"?{SKY_ENABLE_AUDIO:s.includes("computer")?"1":"0",NODE_REPL_ENABLE_AUDIO:s.includes("computer")?n.env.NODE_REPL_ENABLE_AUDIO:"0"}:{}',
    '[constants.backends]:b.join(",")',
  ]) {
    assert.ok(fixture.includes(field));
    assert.ok(patched.includes(field));
  }
});

test("unified owner, selector, and service configuration drift fail closed", () => {
  assert.throws(() => patch(fixture + fixture), /unified.*contract/i);
  for (const [from, to] of [
    ["null!=u.paths.serviceAppPath", "u.paths.serviceAppPath"],
    [",h=[]", "&&t.extraGate,h=[]"],
    ['(l.sky="@oai/sky/service")', '(l.sky="@oai/sky/changed")'],
    ["CUA_REPL_ENABLED_SURFACES:s", "CUA_REPL_ENABLED_SURFACES:other"],
    ["NODE_REPL_JS_BANNER:e.NODE_REPL_JS_BANNER??", "NODE_REPL_JS_BANNER:"],
    ["NODE_REPL_TRUSTED_SERVICES:e.NODE_REPL_TRUSTED_SERVICES??", "NODE_REPL_TRUSTED_SERVICES:"],
    ["NODE_REPL_JS_BANNER:e.", "NODE_REPL_JS_BANNER:`x`,NODE_REPL_JS_BANNER:e."],
    ['[constants.services]:JSON.stringify(l)', '[constants.services]:JSON.stringify(other)'],
  ]) {
    assert.ok(fixture.includes(from), from);
    assert.throws(() => patch(fixture.replace(from, to)), /unified.*contract/i, from);
  }
});

test("unified patch rejects untrusted roots and ambiguous config consumers", () => {
  for (const [from, to] of [
    ["build({...opts,sharedPlugin:!0})", "build({...opts,sharedPlugin:!0}),build(other)"],
    ["record(file,parsed)", "const alias=writePlugin"],
    ["if(!t?.plugin.installed)", "if(!t)"],
    ['if("local"===e.hostConfig.kind)', 'if("remote"===e.hostConfig.kind)'],
    ["{selection:selection", "{selection:other"],
    ["selection=posture?.selection", "selection=cached?.selection"],
    ["selection={...selection,", "selection={"],
    ["principal=local?await connection.getAuthenticatedPrincipal().catch(()=>null):null,", ""],
    ["null!=node&&null!=identity&&", "null!=node&&"],
    ['"1"===process.env.CODEX_APP_SERVER_USE_LOCAL_DAEMON', '"true"===process.env.CODEX_APP_SERVER_USE_LOCAL_DAEMON'],
    ['(0,files.rename)(temp,final)', '(0,files.rename)(other,final)'],
  ]) {
    assert.ok(fixture.includes(from), from);
    assert.throws(() => patch(fixture.replace(from, to)), /unified.*contract/i, from);
  }
  assert.doesNotThrow(() => patch(fixture +
    'function unrelated(){return constants.build(extra)}const serialized="build writePlugin require";'));
});

test("unified patch validates every installed, executor, and resume path after patching", () => {
  const patched = patch(fixture);
  for (const [from, to] of [
    ["codexLinuxCuaContext:selection", "codexLinuxCuaContext:other"],
    ["e.codexLinuxCuaContext.codexLinuxCuaPluginRoot=r,", ""],
    ["writePlugin(temp,opts,final)", "writePlugin(temp,opts,temp)"],
    [",selection.codexLinuxCuaPluginRoot)", ")"],
    ['join(codexLinuxCuaPluginRoot,"scripts","native-service.mjs")', 'join(externalRoot,"scripts","native-service.mjs")'],
    ['join(codexLinuxCuaPluginRoot,"scripts","native-client.mjs")', 'join(externalRoot,"scripts","native-client.mjs")'],
  ]) {
    assert.ok(patched.includes(from), from);
    assert.throws(() => patch(patched.replace(from, to)), /unified.*contract/i, from);
  }
});

test("unified builder root cannot collide with existing locals or shadowed require", () => {
  const rootCollision = fixture.replace('let l={};', 'let codexLinuxCuaPluginRoot=1;let l={};');
  const patched = patch(rootCollision);
  assert.match(patched, /sharedPlugin:a=!1\},codexLinuxCuaPluginRoot1\)/);
  assert.doesNotThrow(() => new vm.Script(patched));
  assert.equal(patch(patched), patched);
  const shadowed = fixture.replace("browserBackends:b", "browserBackends:require");
  assert.throws(() => patch(shadowed), /native config builder shadows require/);
});
