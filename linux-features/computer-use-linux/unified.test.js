"use strict";
const assert = require("node:assert/strict");
const vm = require("node:vm");
const path = require("node:path");
const test = require("node:test");
const upstream = require("./fixtures/upstream-26.1021.22027.json");
const { applyUnifiedComputerUsePatch } = require("./unified.js");

test("signed 26.1021.22027 unified lifecycle emits valid, idempotent JavaScript", () => {
  const patched = applyUnifiedComputerUsePatch(upstream.main);
  assert.notEqual(patched, upstream.main);
  assert.doesNotThrow(() => new vm.Script(patched));
  assert.equal(applyUnifiedComputerUsePatch(patched), patched);
});

test("current upstream resume preserves verified roots through selection cloning and audio configuration", async () => {
  const resolutions = [];
  const metadata = { plugin: { installed: true, localVersion: "verified", name: "unified-computer-use" }, marketplace: { name: "openai-bundled" } };
  const { xre, Ic } = vm.runInNewContext(`${applyUnifiedComputerUsePatch(upstream.main)};({xre,Ic})`, {
    _o: () => metadata,
    i: { Yo: "unified-computer-use", rs: "cua_repl", us: "services", as: "node", is: "modules", qt: input => {
      resolutions.push(input);
      return path.join(input.codexHome, input.localVersion, input.pluginName);
    } },
    C: { default: path },
    A: { readFile: async () => '{"mcpServers":{"cua_repl":{}}}', writeFile: async () => {}, rename: async () => {} },
    bre: { parse: value => value }, v: { randomUUID: () => "test" },
    yi: "backends", Si: "tools", xi: "pipe", Ci: "identity",
    I: { default: { env: {} } }, process: { env: { CODEX_LINUX_CUA_HOST_SOCKET: "/host.sock" } },
    jc: async connection => connection.cached,
    va: () => ({ browserUseTinysky: true }),
    Ec: async e => ({ "mcp_servers.node_repl": e.nodeRepl }),
    Pc: () => "/tools", Nc: "/fallback", Oo: () => {}, Do: {},
  });
  const connections = [];
  for (const [home, surfaces] of [["/first", ["computer", "browser"]], ["/second", ["browser"]]]) {
    const selection = { codexHome: home, browserBackends: ["chrome"], cuaReplSurfaces: surfaces, desktopFeatureAvailability: { deferCuaTools: true } };
    const nodeRepl = { command: "/node", env_vars: ["KEEP"], env: { SKY_AUDIO_ATTACHMENTS: "1", node: "/node", modules: "/modules" } };
    const enabled = await xre({ ...selection, surfaces, deferTools: true, nodeRepl, codexLinuxCuaContext: selection });
    assert.equal(enabled, true);
    connections.push({ hostConfig: { kind: "local" }, cached: { selection, cuaReplEnabled: enabled }, getAuthenticatedPrincipal: async () => null, nodeRepl });
  }
  for (const connection of connections.reverse()) {
    const root = path.join(connection.cached.selection.codexHome, "verified/unified-computer-use");
    assert.equal(connection.cached.selection.codexLinuxCuaPluginRoot, root);
    const config = (await Ic({ appServerConnection: connection, nodeRepl: connection.nodeRepl }))["mcp_servers.cua_repl"];
    const computer = connection.cached.selection.cuaReplSurfaces.includes("computer");
    assert.equal(JSON.parse(config.env.services).sky, computer ? path.join(root, "scripts/native-service.mjs") : undefined);
    assert.ok(config.env.NODE_REPL_JS_BANNER.includes(path.join(root, "scripts/native-client.mjs")));
    assert.equal(config.env.CODEX_LINUX_CUA_HOST_SOCKET, "/host.sock");
    assert.equal(config.env.SKY_ENABLE_AUDIO, computer ? "1" : "0");
    assert.equal(config.env.SKY_AUDIO_ATTACHMENTS, computer ? "1" : "0");
    assert.equal(config.env.NODE_REPL_ENABLE_AUDIO, "0");
    assert.equal(config.env_vars[0], "KEEP");
  }
  assert.equal(resolutions.length, 2, "resume reuses verified metadata");
  assert.equal(resolutions[0].localVersion, "verified");
  delete connections[0].cached.selection.codexLinuxCuaPluginRoot;
  await assert.rejects(Ic({ appServerConnection: connections[0], nodeRepl: connections[0].nodeRepl }), /trusted plugin root is unavailable/);
});

test("current upstream rejects partial, ambiguous, and altered lifecycle contracts", () => {
  const patched = applyUnifiedComputerUsePatch(upstream.main);
  for (const source of [
    upstream.main + upstream.main,
    upstream.main + patched,
    patched.replace("||u.platform===`linux`", ""),
    patched.replace("u.platform===`linux`?h:", ""),
    patched.replace("codexLinuxCuaContext:_", "codexLinuxCuaContext:other"),
    patched.replace("e.codexLinuxCuaContext.codexLinuxCuaPluginRoot=r;", ""),
    patched.replace(",c.codexLinuxCuaPluginRoot)", ")"),
    patched.replace("NODE_REPL_ENABLE_AUDIO:`0`", "NODE_REPL_ENABLE_AUDIO:`1`"),
    upstream.main.replace("c=o?.selection", "c=other?.selection"),
  ]) {
    assert.notEqual(source, patched);
    assert.throws(() => applyUnifiedComputerUsePatch(source), /unified.*contract/i);
  }
});

// The current selector keeps shared prerequisites, Windows support, and the
// macOS service-path gate, followed by independent browser selection.
const selector = [
  'function select(f,l,t,u){let p=f&&t.computerUse&&u.enabled&&(l.platform===`win32`||l.platform===`darwin`&&u.paths.serviceAppPath!=null),m=t.computerUse&&(!t.browserUseTinysky||l.platform!==`darwin`||u.enabled),h=[];return f&&t.browser&&h.push(`browser`),p&&h.push(`computer`),{computerUse:m,cuaReplSurfaces:h}}',
  'async function configure(e){let t=lookup(),i=constants.Kt({codexHome:e.codexHome,localVersion:t.plugin.localVersion,marketplaceName:t.marketplace.name,pluginName:t.plugin.name}),a=path.default.join(i,`.mcp.json`),c={};Object.assign(c,build(e));return e.nodeRepl!=null&&e.surfaces.length>0}',
  'function build({browserBackends:b,deferTools:d,surfaces:s,nodeRepl:n}){let l={};return s.includes(`browser`)&&(l.browser=`@oai/browser-desktop/service`),s.includes(`computer`)&&(l.sky=`@oai/sky/service`),{env:{...n?.env,CUA_REPL_ENABLED_SURFACES:s.join(`,`),...n?.env.SKY_AUDIO_ATTACHMENTS===`1`?{SKY_ENABLE_AUDIO:s.includes(`computer`)?`1`:`0`,SKY_AUDIO_ATTACHMENTS:s.includes(`computer`)?`1`:`0`,NODE_REPL_ENABLE_AUDIO:`0`}:{},[constants.Il]:JSON.stringify(l)}}}',
  'async function initialize(e){let selection=e.selection,features=selection.desktopFeatureAvailability,backends=selection.browserBackends,surfaces=selection.cuaReplSurfaces,home=selection.codexHome,marketplace=selection.marketplaceName,marketplaces=e.marketplaces,skip=false,node=selection.nodeRepl,enabled=false;enabled=await configure({browserBackends:backends,deferTools:features.deferCuaTools,surfaces:surfaces,codexHome:home,marketplaceName:marketplace,marketplaces:marketplaces,nodeRepl:skip?void 0:node});return {selection:selection,cuaReplEnabled:enabled}}',
  'async function threadConfig(e){let cached=e.cached,features=e.features,posture=features.browserUseTinysky?cached:null,principal=false?await e.getAuthenticatedPrincipal().catch(()=>null):null,selection=posture?.selection??await selectForThread(e),node=e.nodeRepl??selection.nodeRepl;return !posture?.cuaReplEnabled?{enabled:false}:build({browserBackends:selection.browserBackends,deferTools:selection.desktopFeatureAvailability.deferCuaTools,surfaces:selection.cuaReplSurfaces,nodeRepl:node})}',
].join("");
function patch(source) {
  return applyUnifiedComputerUsePatch(source);
}
function surfaces(source, platform, { ready = true, enabled = true, legacy = false, nativeEnabled = true } = {}) {
  const select = vm.runInNewContext(`(${source.slice(0, source.indexOf("async function configure"))})`);
  return Array.from(select(ready, { platform }, { computerUse: enabled, browser: true },
    { enabled: platform === "linux" ? nativeEnabled : legacy, paths: { serviceAppPath: legacy ? "/service" : null } }).cuaReplSurfaces);
}
test("unified Linux native selection uses the native setting and retains browser control", () => {
  assert.deepEqual(surfaces(selector, "linux"), ["browser"]);
  assert.deepEqual(surfaces(patch(selector), "linux"), ["browser", "computer"]);
  assert.match(patch(selector), /build\(e,i\)/);
  assert.match(patch(selector), /function build\(\{browserBackends:b,deferTools:d,surfaces:s,nodeRepl:n\},codexLinuxCuaPluginRoot\)/);
  assert.match(patch(selector), /\.sky=path\.default\.join\(codexLinuxCuaPluginRoot,`scripts`,`native-service\.mjs`\)/);
  assert.match(patch(selector), /NODE_REPL_JS_BANNER:.*native-client\.mjs/);
  assert.match(patch(selector), /CODEX_LINUX_CUA_HOST_SOCKET:process\.env\.CODEX_LINUX_CUA_HOST_SOCKET/);
});
test("unified prerequisites, native feature flag, and other platforms retain their gates", () => {
  const result = patch(selector);
  assert.deepEqual(surfaces(result, "linux", { ready: false }), []);
  assert.deepEqual(surfaces(result, "linux", { enabled: false }), ["browser"]);
  assert.deepEqual(surfaces(result, "linux", { nativeEnabled: false }), ["browser"]);
  assert.deepEqual(surfaces(result, "darwin"), ["browser"]);
  assert.deepEqual(surfaces(result, "darwin", { legacy: true }), ["browser", "computer"]);
  assert.deepEqual(surfaces(result, "win32", { legacy: true }), ["browser", "computer"]);
  assert.equal(patch(result), result);
});
test("unified selector drift and ambiguous owners fail the build", () => {
  assert.throws(() => patch(selector.replace(
    "f&&t.computerUse&&u.enabled&&(l.platform===`win32`||l.platform===`darwin`&&u.paths.serviceAppPath!=null)",
    "f&&l.platform===`darwin`&&t.computerUse&&u.enabled&&u.paths.serviceAppPath!=null")), /unified.*contract/i);
  assert.throws(() => patch(selector.replace("serviceAppPath!=null", "serviceAppPath")), /unified.*contract/i);
  assert.throws(() => patch(selector + selector), /unified.*contract/i);
  assert.throws(() => patch(selector.replace("@oai/sky/service", "@oai/sky/changed")), /unified.*contract/i);
  assert.throws(() => patch(selector.replace("CUA_REPL_ENABLED_SURFACES:s", "CUA_REPL_ENABLED_SURFACES:other")), /unified.*contract/i);
});

test("disabled native access does not leave a second native Node REPL service enabled", () => {
  const patched = patch(selector);
  const select = vm.runInNewContext(`(${patched.slice(0, patched.indexOf("async function configure"))})`);
  assert.equal(select(true, { platform: "linux" }, { computerUse: true },
    { enabled: false, paths: {} }).computerUse, false);
});

test("unified mode rejects appended gates and changed companion selectors", () => {
  for (const source of [selector, patch(selector)]) {
    const changed = source.replace(",h=[]", "&&t.newRequiredGate,h=[]");
    assert.throws(() => patch(changed), /unified.*contract/i);
    assert.throws(() => patch(selector + changed), /unified.*contract/i);
  }
});

test("unified service patch scopes the plugin root and current env-key alias to its owner", () => {
  const current =
    "function unrelated(){let other=path.default.join(otherRoot,`.mcp.json`);return other}" +
    selector.replace("[constants.Il]", "[constants.Gl]");
  const patched = patch(current);

  assert.match(patched, /path\.default\.join\(codexLinuxCuaPluginRoot,`scripts`,`native-service\.mjs`\)/u);
  assert.match(patched, /\[constants\.Gl\]:JSON\.stringify\(l\)/u);
  assert.doesNotMatch(patched, /path\.default\.join\(otherRoot,`scripts`,`native-service\.mjs`\)/u);
  assert.equal(patch(patched), patched);
});

test("unified banner patch edits only the validated service owner", () => {
  const unrelatedBanner =
    "function unrelated(e){let constants={},l={};return{env:{CUA_REPL_ENABLED_SURFACES:e.surfaces.join(`,`),[constants.Il]:JSON.stringify(l)}}}";
  const current = unrelatedBanner + selector;
  const patched = patch(current);

  assert.equal(patched.slice(0, unrelatedBanner.length), unrelatedBanner);
  assert.equal((patched.match(/NODE_REPL_JS_BANNER:/gu) ?? []).length, 1);
});

test("unified banner patch rejects duplicate banners inside the service owner", () => {
  const duplicate = selector.replace(
    "[constants.Il]:JSON.stringify(l)",
    "CUA_REPL_ENABLED_SURFACES:s.join(`,`),...n?.env.SKY_AUDIO_ATTACHMENTS===`1`?{SKY_ENABLE_AUDIO:s.includes(`computer`)?`1`:`0`,SKY_AUDIO_ATTACHMENTS:s.includes(`computer`)?`1`:`0`,NODE_REPL_ENABLE_AUDIO:`0`}:{},[constants.Il]:JSON.stringify(l),duplicate:{CUA_REPL_ENABLED_SURFACES:s.join(`,`),...n?.env.SKY_AUDIO_ATTACHMENTS===`1`?{SKY_ENABLE_AUDIO:s.includes(`computer`)?`1`:`0`,SKY_AUDIO_ATTACHMENTS:s.includes(`computer`)?`1`:`0`,NODE_REPL_ENABLE_AUDIO:`0`}:{},[constants.Il]:JSON.stringify(l)}",
  );

  assert.throws(() => patch(duplicate), /unified.*contract/i);
});

test("unified helper uses a fresh binding across minified parameter and local collisions", async () => {
  // The 26.1013 helper destructures parameters in a separate minified scope.
  // Copying its caller's root alias into that formal list can duplicate any
  // binding, while a local collision can shadow or redeclare the injected root.
  for (const root of ["b", "d", "s", "n", "l"]) {
    const current = selector.replace("i=constants.Kt", `${root}=constants.Kt`)
      .replace("join(i,`.mcp.json`)", `join(${root},\`.mcp.json\`)`);
    assert.doesNotThrow(() => new vm.Script(current));
    const patched = patch(current);
    assert.doesNotThrow(() => new vm.Script(patched));
    assert.equal(patch(patched), patched);
    const { initialize, threadConfig } = vm.runInNewContext(`${patched};({initialize,threadConfig})`, {
      lookup: () => ({ plugin: { localVersion: "latest", name: "cua" }, marketplace: { name: "bundled" } }),
      path: { default: path },
      constants: { Il: "services", Kt: () => "/trusted-plugin" },
      process: { env: { CODEX_LINUX_CUA_HOST_SOCKET: "/runtime/cua.sock" } },
    });
    const selection = {
      browserBackends: ["native"], cuaReplSurfaces: ["computer"], nodeRepl: { env: {} },
      desktopFeatureAvailability: { deferCuaTools: true },
    };
    const cached = await initialize({ selection });
    assert.equal(cached.cuaReplEnabled, true);
    assert.equal(cached.selection, selection);
    assert.equal(selection.codexLinuxCuaPluginRoot, "/trusted-plugin");
    const result = await threadConfig({ cached, features: { browserUseTinysky: true } });
    assert.equal(result.env.CUA_REPL_ENABLED_SURFACES, "computer");
    assert.equal(JSON.parse(result.env.services).sky, "/trusted-plugin/scripts/native-service.mjs");
    assert.equal(result.env.CODEX_LINUX_CUA_HOST_SOCKET, "/runtime/cua.sock");
    assert.equal(result.env.NODE_REPL_JS_BANNER,
      'await import("@oai/cua/tinyskyAlt");await(await import("/trusted-plugin/scripts/native-client.mjs")).installLinuxComputerUse(cua);');
  }
});

test("unified helper avoids existing generated names in locals and nested scopes", () => {
  const current = selector.replace("let l={};return s.includes",
    "let codexLinuxCuaPluginRoot=1;function nested(codexLinuxCuaPluginRoot1){return codexLinuxCuaPluginRoot1}let l={};return s.includes");
  const patched = patch(current);
  assert.match(patched, /nodeRepl:n\},codexLinuxCuaPluginRoot2\)/);
  assert.doesNotThrow(() => new vm.Script(patched));
  assert.equal(patch(patched), patched);
});

test("unified helper validates caller and helper root relationships separately", () => {
  const patched = patch(selector);
  assert.throws(() => patch(patched.replace("build(e,i)", "build(e,other)")), /unified.*contract/i);
  assert.throws(() => patch(patched.replace(
    "join(codexLinuxCuaPluginRoot,`scripts`,`native-service.mjs`)",
    "join(other,`scripts`,`native-service.mjs`)")), /unified.*contract/i);
  assert.throws(() => patch(patched.replace(
    "join(codexLinuxCuaPluginRoot,`scripts`,`native-client.mjs`)",
    "join(other,`scripts`,`native-client.mjs`)")), /unified.*contract/i);
});

test("unified thread configuration retains the trusted root per cached connection", async () => {
  const resolutions = [];
  const { initialize, threadConfig } = vm.runInNewContext(`${patch(selector)};({initialize,threadConfig})`, {
    lookup: () => ({ plugin: { localVersion: "verified-version", name: "cua" }, marketplace: { name: "bundled" } }),
    path: { default: path },
    constants: { Il: "services", Kt: metadata => {
      resolutions.push(metadata);
      return path.join(metadata.codexHome, "trusted-plugin");
    } },
    process: { env: { CODEX_LINUX_CUA_HOST_SOCKET: "/runtime/cua.sock" } },
  });
  const cache = [];
  for (const home of ["/first", "/second"]) {
    const selection = {
      codexHome: home, marketplaceName: "bundled", browserBackends: ["native"],
      cuaReplSurfaces: ["browser", "computer"], nodeRepl: { env: { existing: "kept" } },
      desktopFeatureAvailability: { deferCuaTools: true },
    };
    cache.push(await initialize({ selection }));
  }
  assert.equal(resolutions.length, 2);
  assert.equal(resolutions[0].localVersion, "verified-version");
  for (const cached of cache.reverse()) {
    const config = await threadConfig({ cached, features: { browserUseTinysky: true }, nodeRepl: { env: { perThread: "private-env" } } });
    const expectedRoot = path.join(cached.selection.codexHome, "trusted-plugin");
    assert.equal(JSON.parse(config.env.services).sky, path.join(expectedRoot, "scripts/native-service.mjs"));
    assert.equal(JSON.parse(config.env.services).browser, "@oai/browser-desktop/service");
    assert.equal(config.env.perThread, "private-env");
    assert.equal(config.env.CODEX_LINUX_CUA_HOST_SOCKET, "/runtime/cua.sock");
    assert.ok(config.env.NODE_REPL_JS_BANNER.includes(path.join(expectedRoot, "scripts/native-client.mjs")));
  }
  assert.equal(resolutions.length, 2, "thread resumes reuse verified metadata without another lookup");
  delete cache[0].selection.codexLinuxCuaPluginRoot;
  await assert.rejects(threadConfig({ cached: cache[0], features: { browserUseTinysky: true } }),
    /Linux Computer Use trusted plugin root is unavailable/);
});

test("unified browser-only thread configuration receives its banner root", async () => {
  const { initialize, threadConfig } = vm.runInNewContext(`${patch(selector)};({initialize,threadConfig})`, {
    lookup: () => ({ plugin: { localVersion: "verified-version", name: "cua" }, marketplace: { name: "bundled" } }),
    path: { default: path }, constants: { Il: "services", Kt: () => "/trusted-plugin" }, process: { env: {} },
  });
  const selection = {
    browserBackends: ["native"], cuaReplSurfaces: ["browser"], nodeRepl: { env: {} },
    desktopFeatureAvailability: { deferCuaTools: true },
  };
  const cached = await initialize({ selection });
  const config = await threadConfig({ cached, features: { browserUseTinysky: true } });
  assert.equal(JSON.parse(config.env.services).sky, undefined);
  assert.ok(config.env.NODE_REPL_JS_BANNER.includes("/trusted-plugin/scripts/native-client.mjs"));
  cached.cuaReplEnabled = false;
  delete selection.codexLinuxCuaPluginRoot;
  assert.equal((await threadConfig({ cached, features: { browserUseTinysky: true } })).enabled, false);
});

test("unified propagation rejects missing, ambiguous, or changed builder consumers", () => {
  for (const changed of [
    selector + "build(extra)",
    selector + "const alias=build;",
    selector + "configure(extra)",
    selector.replace("return {selection:selection", "return {selection:other"),
    selector.replace("selection=posture?.selection", "selection=other?.selection"),
  ]) {
    assert.throws(() => patch(changed), /unified.*contract/i);
  }
  assert.doesNotThrow(() => patch(selector + "function unrelated(){return constants.build(extra)}"));
  const patched = patch(selector);
  for (const changed of [
    patched.replace("codexLinuxCuaContext:selection", "codexLinuxCuaContext:other"),
    patched.replace(",selection.codexLinuxCuaPluginRoot)", ")"),
    patched.replace("e.codexLinuxCuaContext.codexLinuxCuaPluginRoot=i;", ""),
  ]) {
    assert.throws(() => patch(changed), /unified.*contract/i);
  }
});


test("unified builder patch fails closed when its bindings shadow the path module", () => {
  for (const binding of ["b", "d", "s", "n"]) {
    const start = selector.indexOf("function build(");
    const end = selector.indexOf("async function initialize(");
    const builder = selector.slice(start, end).replace(new RegExp(`\\b${binding}\\b`, "g"), "path");
    const shadowed = selector.slice(0, start) + builder + selector.slice(end);
    assert.throws(() => patch(shadowed), /native config builder shadows the path module/);
  }
});
