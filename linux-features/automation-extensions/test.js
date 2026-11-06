"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const manifest = require("./feature.json");
const descriptors = require("./patch.js");
const {
  AUTOMATION_SCHEDULE_ASSET_NEEDLES,
  applyAutomationScheduleMultiTimePatch,
  matchesAutomationScheduleContract,
} = require("../../scripts/patches/impl/automation-schedule.js");
const {
  applyAutomationUpdateEagerToolPatch,
  applyAutomationPluginEnablePatch,
  matchesAutomationPluginEnableContract,
  matchesAutomationUpdateEagerToolContract,
} = require("./eager-update.js");
const { findWebviewAssetsContaining } = require("../../scripts/patches/lib/assets.js");

// Rspack/SWC chunk shape: module factories inside `__webpack_modules__`.
const {
  applyObservableAutomationViewPatch,
  matchesObservableAutomationViewContract,
} = require("./observable-view.js");

function automationViewFixture(hostClass = null) {
  const current = require("./fixtures/current-view.json");
  return [
    '"use strict";',
    "const store=new Map([[`existing`,{id:`existing`,kind:`heartbeat`,name:`Acceptance`,prompt:`Report marker`,rrule:`FREQ=WEEKLY;BYDAY=SU;BYHOUR=23;BYMINUTE=59`,status:`PAUSED`}]]);",
    "const eo={TF:class{}},em={$Cz:()=>({}),OeD:e=>store.get(e)??null},ar={n:`local`},Lp={safeParse:data=>({success:!0,data})};",
    current.output,
    current.handler,
    hostClass ?? current.host,
    "globalThis.run=async id=>(await new Lb().executeUpdateTool({hostId:`local`,threadId:`thread`,argumentsValue:{mode:`view`,id}})).response;",
    "globalThis.runViaHost=async(id,migrating)=>{let host=new Lb;host.habitatAutomationsService={isLocalMigrationActive:()=>migrating};return(await host.executeUpdateTool({hostId:`local`,threadId:`thread`,argumentsValue:{mode:`view`,id}})).response};",
  ].join("");
}

const chunk = (...modules) =>
  "export const __rspack_esm_id=24191;export const __rspack_esm_ids=[24191];" +
  `export const __webpack_modules__={${modules.join(",")}};`;

function loadChunkModules(source, globals) {
  const start = source.indexOf("__webpack_modules__=") + "__webpack_modules__=".length;
  const names = Object.keys(globals);
  return new Function(...names, `return ${source.slice(start, source.lastIndexOf(";"))}`)(
    ...names.map((name) => globals[name]),
  );
}

test("automation-extensions is disabled by default and owns both optional content-located patches", () => {
  assert.equal(manifest.defaultEnabled, false);
  assert.deepEqual(
    descriptors.map(({ id }) => id),
    ["multi-time-rrule", "eager-automation-update", "automation-plugin-pipe", "observable-automation-view", "automation-plugin-enable"],
  );
  assert.ok(descriptors.every(({ ciPolicy }) => ciPolicy === "optional"));
  assert.ok(descriptors.every(({ phase }) => ["webview-asset", "main-bundle"].includes(phase)));
  assert.ok(descriptors.slice(0, 2).every(({ assetNeedles, pattern, assetPattern }) =>
    assetNeedles.length > 0 && pattern == null && assetPattern == null));
});

const DYNAMIC_TOOLS =
  'mjAH(e,t,n){var r=n("x1"),i="codex_app";function a({tools:e,eagerToolNames:t,deferredToolNames:n,supportsDynamicToolNamespaces:s,additionalNamespaces:o}){let l=e.map(e=>({type:"function",...e,...s&&(!t.has(e.name)||n.includes(e.name))?{deferLoading:!0}:{}}));return s?[{type:"namespace",name:i,description:r.l2,tools:l},...o]:l}n.d(t,{Nz:()=>a})}';

test("automation_update remains eager in the current dynamic tool catalog", () => {
  const source = chunk(DYNAMIC_TOOLS);
  assert.equal(matchesAutomationUpdateEagerToolContract(source), true);
  const patched = applyAutomationUpdateEagerToolPatch(source);
  assert.notEqual(patched, source);
  assert.match(patched, /e\.name!=="automation_update"&&s&&\(!t\.has\(e\.name\)\|\|n\.includes\(e\.name\)\)/);
  assert.equal(matchesAutomationUpdateEagerToolContract(patched), true);
  assert.equal(applyAutomationUpdateEagerToolPatch(patched), patched);

  const exports = {};
  loadChunkModules(patched, {}).mjAH({}, exports, Object.assign(() => ({ l2: "tools" }), {
    d: (target, getters) => Object.entries(getters).forEach(([key, get]) => Object.defineProperty(target, key, { get })),
  }));
  const tools = exports.Nz({
    tools: [{ name: "automation_update" }, { name: "other" }],
    eagerToolNames: new Set(),
    deferredToolNames: [],
    supportsDynamicToolNamespaces: true,
    additionalNamespaces: [],
  })[0].tools;
  assert.deepEqual(tools.map((tool) => [tool.name, tool.deferLoading ?? false]), [
    ["automation_update", false],
    ["other", true],
  ]);
});

test("duplicate or changed dynamic tool catalogs are left unchanged", () => {
  for (const source of [
    chunk(DYNAMIC_TOOLS, DYNAMIC_TOOLS.replace("mjAH", "mjAI")),
    chunk(DYNAMIC_TOOLS.replace('type:"function"', "type:`function`")),
  ]) {
    assert.equal(matchesAutomationUpdateEagerToolContract(source), false);
    assert.equal(applyAutomationUpdateEagerToolPatch(source), source);
  }
});

function scheduleModule({ id = "qKlE", parser = "W", summary = "Q", combine = "es", number = "ee" } = {}) {
  return `${id}(e,t,n){var o=n("rr"),u=n("ut");` +
    `function ${number}(e){return Array.isArray(e)?"number"==typeof e[0]?e[0]:null:"number"==typeof e?e:null}` +
    `function ${combine}(e,t){return String(e).padStart(2,"0")+":"+String(t).padStart(2,"0")}` +
    `function ${parser}(e){if(!e)return null;try{var t,n,r;let i,a,l=(0,o.YI)(e),c=l.rrules()[0];if(!c)return null;let p=c.options,f=days(p),m=${number}(p.byminute);` +
    "return{freq:p.freq,isSingleRecurrence:1===l.rrules().length,hasMultipleTimeValues:Array.isArray(p.byhour)&&p.byhour.length>1||Array.isArray(p.byminute)&&p.byminute.length>1,interval:Math.max(1,Math.round(p.interval??1)),minute:m,origOptions:c.origOptions,rruleText:e," +
    `time:(t=p.byhour,n=p.byminute,r=p,i=${number}(t),a=${number}(n),null!=i&&null!=a?${combine}(i,a):r.dtstart?${combine}(r.dtstart.getHours(),r.dtstart.getMinutes()):h),weekdays:f}}catch{return null}}` +
    `function ${summary}(e,t){if(!e||e.hasMultipleTimeValues)return null;let n=L(e.weekdays),r=7===n.length;if(e.freq!==o.p3.DAILY&&e.freq!==o.p3.WEEKLY)return null;let i=(0,u.mm)(e.time,t);return i?function({intl:e,timeLabel:n}){return e.formatMessage({id:"settings.automations.scheduleSummary.daily",defaultMessage:"Daily at {time}"},{time:n})}({intl:t,isEveryDay:r,timeLabel:i,weekdays:n}):null}` +
    `function render(e,t){return ${summary}(${parser}(N(e)),t)??null}n.d(t,{render:()=>render})` +
    "}";
}

function renderSchedule(source, options) {
  const modules = loadChunkModules(source, { days: () => [], L: (value) => value, N: (value) => value, h: "00:00" });
  const exports = {};
  const rrule = { p3: { DAILY: 3, WEEKLY: 2 }, YI: () => ({ rrules: () => [{ options, origOptions: options }] }) };
  const labels = { mm: (time) => `[${time}]` };
  const require = Object.assign((id) => (id === "rr" ? rrule : labels), {
    d: (target, getters) => Object.entries(getters).forEach(([key, get]) => Object.defineProperty(target, key, { get })),
  });
  modules.qKlE({}, exports, require);
  const intl = {
    formatMessage: (_message, { time }) => `Daily at ${time}`,
    formatList: (items) => items.join(" and "),
  };
  return exports.render("RRULE:FREQ=DAILY", intl);
}

test("current schedule owner gains multi-time parsing and summary labels inside its module", () => {
  // Another module reuses the same minified names; only the owner changes.
  const unrelated = "odKs(e,t,n){function W(e){return e}function Q(e,t){return t}}";
  const source = chunk(unrelated, scheduleModule());
  assert.equal(matchesAutomationScheduleContract(source), true);
  const patched = applyAutomationScheduleMultiTimePatch(source);
  assert.notEqual(patched, source);
  assert.ok(patched.includes(unrelated));
  assert.match(patched, /hasMultipleTimeValues:codexLinuxRruleTimes\(p\.byhour,p\.byminute,p,es\)\.length>1,/u);
  assert.match(patched, /timeValues:codexLinuxRruleTimes\(p\.byhour,p\.byminute,p,es\),weekdays:f\}/u);
  assert.match(patched, /function Q\(e,t\)\{if\(!e\)return null;/u);
  assert.match(patched, /let i=codexLinuxAutomationTimeLabel\(e,t,\(e,t\)=>\(0,u\.mm\)\(e,t\)\);return i\?/u);
  assert.equal(matchesAutomationScheduleContract(patched), true);
  assert.equal(applyAutomationScheduleMultiTimePatch(patched), patched);

  const multi = { freq: 3, byhour: [17, 9], byminute: [0] };
  assert.equal(renderSchedule(source, multi), null);
  assert.equal(renderSchedule(patched, multi), "Daily at [09:00] and [17:00]");
  assert.equal(renderSchedule(patched, { freq: 3, byhour: [8], byminute: [30] }), "Daily at [08:30]");
});

test("schedule matcher rejects duplicate, partial, and incoherent owners", () => {
  const owner = scheduleModule();
  const cases = [
    chunk(owner, scheduleModule({ id: "aaaa", parser: "P", summary: "S" })),
    chunk(owner.replace("time:(t=p.byhour", "time:(t=p.byhours")),
    chunk(owner.replace("function render(e,t){return Q(W(N(e)),t)??null}", "")),
    chunk(owner.replace("if(!e||e.hasMultipleTimeValues)return null;", "if(!e)return null;")),
    chunk(owner.replace("let i=(0,u.mm)(e.time,t);", "let i=(0,u.mm)(e.dtstart,t);")),
    chunk(owner.replace("function render(", "function Q(e,t){if(!e||e.hasMultipleTimeValues)return null;return t}function render(")),
  ];
  for (const source of cases) {
    assert.equal(matchesAutomationScheduleContract(source), false);
    assert.equal(applyAutomationScheduleMultiTimePatch(source), source);
  }
  const patched = applyAutomationScheduleMultiTimePatch(chunk(owner));
  const partial = patched.replace("timeValues:codexLinuxRruleTimes(", "timeValues:changed(");
  assert.equal(applyAutomationScheduleMultiTimePatch(partial), partial);
});

test("signed official webview has one schedule owner and one dynamic tool catalog", {
  skip: process.env.CODEX_SIGNED_EXTRACTED_APP ? false : "CODEX_SIGNED_EXTRACTED_APP is not set",
}, () => {
  const appDir = process.env.CODEX_SIGNED_EXTRACTED_APP;
  const read = (assetName) => fs.readFileSync(path.join(appDir, "webview", "assets", assetName), "utf8");
  const [schedule, eager] = descriptors;
  const scheduleOwners = findWebviewAssetsContaining(appDir, AUTOMATION_SCHEDULE_ASSET_NEEDLES)
    .filter((assetName) => schedule.assetMatch(read(assetName)));
  assert.equal(scheduleOwners.length, 1);
  const source = read(scheduleOwners[0]);
  const patched = schedule.apply(source);
  assert.notEqual(patched, source);
  assert.equal(schedule.apply(patched), patched);

  const catalogs = findWebviewAssetsContaining(appDir, eager.assetNeedles)
    .filter((assetName) => eager.assetMatch(read(assetName)));
  assert.equal(catalogs.length, 1);
  assert.match(eager.apply(read(catalogs[0])), /\.name!=="automation_update"&&/u);
});

test("local Desktop threads enable the plugin transport that owns automation_update", async () => {
  const source = [
    "const automation={name:`automation_update`},E=!0,YBl=new Set,BBl=[];",
    "const pluginKey=`plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled_tools`,legacyKey=`mcp_servers.codex_app.enabled_tools`;",
    "function key(version){return version?pluginKey:legacyKey}",
    "function catalog(){return[automation].map(e=>({type:`function`,...e,...E&&(!YBl.has(e.name)||BBl.includes(e.name))?{deferLoading:!0}:{}}))}",
    "async function build(local,usePlugin){let result={config:{unrelated:7}},n=catalog(),tools=n.flatMap(e=>e.type===`namespace`?e.tools:[e]),client={getAppServerVersion:()=>usePlugin},inputs={usesDesktopMcp:local};inputs.usesDesktopMcp&&(result.config={...result.config,[key(client.getAppServerVersion())]:tools.map(({name:e})=>e)});return result.config}",
    "globalThis.build=build;",
  ].join(";");

  const patched = descriptors
    .filter(({ phase }) => phase === "webview-asset")
    .reduce((current, descriptor) => descriptor.apply(current), source);
  const context = vm.createContext({});
  vm.runInContext(patched, context);

  const localConfig = await context.build(true, true);
  assert.equal(localConfig.unrelated, 7);
  assert.deepEqual(
    Array.from(localConfig["plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled_tools"]),
    ["automation_update"],
  );
  assert.equal(
    localConfig["plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled"],
    true,
  );
  const legacyConfig = await context.build(true, false);
  assert.deepEqual(Array.from(legacyConfig["mcp_servers.codex_app.enabled_tools"]), ["automation_update"]);
  assert.equal(legacyConfig["mcp_servers.codex_app.enabled"], true);
  assert.deepEqual(Object.keys(await context.build(false, true)), ["unrelated"]);
  assert.equal(applyAutomationPluginEnablePatch(patched), patched);
});

test("current shared bundle selects the local Desktop MCP plugin config owner", async () => {
  const source = [
    "const pluginKey=`plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled_tools`,legacyKey=`mcp_servers.codex_app.enabled_tools`;",
    "function Kut(version){return version?pluginKey:legacyKey}",
    "async function build(local,usePlugin){let config={config:{unrelated:7}},n=[{type:`namespace`,tools:[{name:`automation_update`}]}],i=n.flatMap(e=>e.type===`namespace`?e.tools:[e]),client={getAppServerVersion:()=>usePlugin},inputs={usesDesktopMcp:local};inputs.usesDesktopMcp&&(config.config={...config.config,[Kut(client.getAppServerVersion())]:i.map(({name:e})=>e)});return config.config}",
    "globalThis.build=build;",
  ].join(";");
  const descriptor = descriptors.find(({ id }) => id === "automation-plugin-enable");
  assert.equal(descriptor.pattern.test("app-shared-current.js"), true);
  assert.equal(descriptor.pattern.test("app-initial-current.js"), true);
  assert.equal(descriptor.assetMatch(source), true);
  const patched = descriptor.apply(source);
  const context = vm.createContext({});
  vm.runInContext(patched, context);
  assert.deepEqual(Array.from((await context.build(true, true))["plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled_tools"]), ["automation_update"]);
  assert.equal((await context.build(true, true))["plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled"], true);
  assert.equal((await context.build(true, false))["mcp_servers.codex_app.enabled"], true);
  assert.deepEqual(Object.keys(await context.build(false, true)), ["unrelated"]);
  assert.equal(descriptor.apply(patched), patched);
});

test("current initial bundle enables its precomputed local Desktop MCP tools", async () => {
  const source = [
    "const pluginKey=`plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled_tools`,legacyKey=`mcp_servers.codex_app.enabled_tools`;",
    "function Qe(version){return version?pluginKey:legacyKey}",
    "async function build(e,r,t){let o={config:{unrelated:7}};if(t.readDynamicTools!=null&&(e.registerDynamicTools!==!1||e.usesDesktopMcp)){let n=await t.readDynamicTools();let i=n.flatMap(e=>e.type===`namespace`?e.tools:[e]),a=i.map(({name:e})=>e);e.usesDesktopMcp&&(o.config={...o.config,[Qe(r.getAppServerVersion())]:a})}return o.config}",
    "globalThis.build=build;",
  ].join("");
  const descriptor = descriptors.find(({ id }) => id === "automation-plugin-enable");
  assert.equal(descriptor.pattern.test("app-initial-current.js"), true);
  assert.equal(descriptor.assetMatch(source), true);
  const patched = descriptor.apply(source);
  const context = vm.createContext({});
  vm.runInContext(patched, context);

  const pluginConfig = await context.build(
    { usesDesktopMcp: true, registerDynamicTools: false },
    { getAppServerVersion: () => true },
    { readDynamicTools: async () => [{ name: "automation_update" }] },
  );
  assert.deepEqual(Array.from(pluginConfig["plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled_tools"]), ["automation_update"]);
  assert.equal(pluginConfig["plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled"], true);
  assert.equal(pluginConfig.unrelated, 7);

  const nonDesktopConfig = await context.build(
    { usesDesktopMcp: false, registerDynamicTools: false },
    { getAppServerVersion: () => true },
    { readDynamicTools: async () => [{ name: "automation_update" }] },
  );
  assert.deepEqual(Object.keys(nonDesktopConfig), ["unrelated"]);
  assert.equal(descriptor.apply(patched), patched);
});

test("automation plugin enablement rejects an unexpected enabled-tools key contract", () => {
  const source = [
    "const pluginKey=`plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.tools`,legacyKey=`mcp_servers.codex_app.tools`;",
    "function key(version){return version?pluginKey:legacyKey}",
    "async function build(local){let result={config:{}},n=[],tools=n.flatMap(e=>e.type===`namespace`?e.tools:[e]),client={getAppServerVersion:()=>!0},inputs={usesDesktopMcp:local};inputs.usesDesktopMcp&&(result.config={...result.config,[key(client.getAppServerVersion())]:tools.map(({name:e})=>e)});return result.config}",
  ].join(";");

  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(applyAutomationPluginEnablePatch(source), source);
  } finally {
    console.warn = originalWarn;
  }
});

test("automation plugin enablement rejects flattened tools from another function", () => {
  const source = [
    "const pluginKey=`plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled_tools`,legacyKey=`mcp_servers.codex_app.enabled_tools`;",
    "function key(version){return version?pluginKey:legacyKey}",
    "async function unrelated(){let tools=raw.flatMap(e=>e.type===`namespace`?e.tools:[e]);return tools}",
    "async function build(local){let result={config:{}},tools=[{name:`automation_update`}],client={getAppServerVersion:()=>!0},inputs={usesDesktopMcp:local};inputs.usesDesktopMcp&&(result.config={...result.config,[key(client.getAppServerVersion())]:tools.map(({name:e})=>e)});return result.config}",
  ].join(";");
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(applyAutomationPluginEnablePatch(source), source);
  } finally {
    console.warn = originalWarn;
  }
});

// Keep runtime assertions compact while expressing the current minifier's
// string literals, computed pipe constant, and local-host comparison order.
function currentPipeFixture(source) {
  return 'let rP="CODEX_APP_TOOLS_PIPE_PATH",fixtureDeferred=false;' + source
    .replace(/`([^`]*?)`/gu, (literal, value) => value.includes("${") ? literal : JSON.stringify(value))
    .replaceAll("process.env.CODEX_APP_TOOLS_PIPE_PATH", "process.env[rP]")
    .replace(/,([A-Za-z_$][\w$]*)=\{\.\.\.([A-Za-z_$][\w$]*)\.env\},/gu,
      ';let $1={...$2.env,CODEX_APP_TOOLS_DEFERRED:fixtureDeferred?"1":"0"},')
    .replace(/([A-Za-z_$][\w$]*)\.hostConfig\.kind!=="local"/gu, '"local"!==$1.hostConfig.kind')
    .replaceAll('i.bi(e.appServerVersion,"pluginMcpConfigOverrides")', '(0,i.bi)(e.appServerVersion,"pluginMcpConfigOverrides")');
}

test("adopted app servers receive the Desktop automation pipe explicitly", async () => {
  const source = currentPipeFixture([
    "const process={env:{CODEX_APP_TOOLS_PIPE_PATH:`/tmp/codex-app-tools.sock`},resourcesPath:`/resources`};",
    "const base={mcpServers:{codex_app:{command:`launch`,env:{BASE:`preserved`}}}};",
    "function unavailable(reason){return null}",
    "async function nl({useWsl:e,resourcesPath:t=process.resourcesPath}){if(!process.env.CODEX_APP_TOOLS_PIPE_PATH)return unavailable(`missing-pipe`);let{mcpServers:{codex_app:s}}=base,c={...s.env},l=null;return{...s,command:s.command,cwd:`/plugin`,enabled:!1,env:c}}",
    "globalThis.read=nl;globalThis.removePipe=()=>delete process.env.CODEX_APP_TOOLS_PIPE_PATH;",
  ].join(""));
  const descriptor = descriptors.find(({ id }) => id === "automation-plugin-pipe");

  assert.ok(descriptor);
  const patched = descriptor.apply(source);
  const context = vm.createContext({});
  vm.runInContext(patched, context);

  const config = await context.read({ useWsl: false });
  assert.equal(config.env.BASE, "preserved");
  assert.equal(config.env.CODEX_APP_TOOLS_PIPE_PATH, "/tmp/codex-app-tools.sock");
  assert.equal((await context.read({ useWsl: true })).env.CODEX_APP_TOOLS_PIPE_PATH, "/tmp/codex-app-tools.sock");
  context.removePipe();
  assert.equal(await context.read({ useWsl: false }), null);
  assert.equal(descriptor.apply(patched), patched);
  assert.throws(
    () => descriptor.apply(patched + "const decoy=`codexLinuxForwardAutomationPipe`;"),
    /did not match the current bundle exactly once/,
  );
});

test("current plugin pipe preserves deferred-tool configuration", async () => {
  const source = currentPipeFixture([
    "const process={env:{CODEX_APP_TOOLS_PIPE_PATH:`/pipe`},resourcesPath:`/resources`};",
    "const base={mcpServers:{codex_app:{env:{BASE:`preserved`},omit_tools_from:[`deferred`,`other`]}}};",
    "let defer=true;function el(){return null}function K(){return{deferCodexAppTools:defer}}",
    "async function $c({useWsl:e,resourcesPath:t=process.resourcesPath}){if(!process.env.CODEX_APP_TOOLS_PIPE_PATH)return el(`missing-pipe`);let{mcpServers:{codex_app:a}}=base,{deferCodexAppTools:o}=K();o&&(a.omit_tools_from=a.omit_tools_from?.filter(e=>e!==`deferred`));let s={...a.env,CODEX_APP_TOOLS_DEFERRED:o?`1`:`0`},u=null;return{...a,enabled:!1,env:s}}",
    "globalThis.read=$c;globalThis.disableDefer=()=>defer=false;",
  ].join(""));
  const descriptor = descriptors.find(({ id }) => id === "automation-plugin-pipe");
  const patched = descriptor.apply(source);
  const context = vm.createContext({});
  vm.runInContext(patched, context);
  const config = await context.read({useWsl:false});
  assert.equal(config.env.BASE, "preserved");
  assert.equal(config.env.CODEX_APP_TOOLS_PIPE_PATH, "/pipe");
  assert.equal(config.env.CODEX_APP_TOOLS_DEFERRED, "1");
  assert.deepEqual(Array.from(config.omit_tools_from), ["other"]);
  context.disableDefer();
  const eagerConfig = await context.read({useWsl:false});
  assert.equal(eagerConfig.env.CODEX_APP_TOOLS_DEFERRED, "0");
  assert.equal(eagerConfig.env.CODEX_APP_TOOLS_PIPE_PATH, "/pipe");
  assert.equal(descriptor.apply(patched), patched);
});

test("automation pipe forwarding fails closed on drift and incomplete markers", () => {
  const descriptor = descriptors.find(({ id }) => id === "automation-plugin-pipe");

  assert.ok(descriptor);
  assert.throws(
    () => descriptor.apply("const changed=`native app tools transport removed`;"),
    /did not match the current bundle exactly once/,
  );
  assert.throws(
    () => descriptor.apply("const marker=`codexLinuxForwardAutomationPipe`;"),
    /did not match the current bundle exactly once/,
  );
});

function desktopPluginSyncContext() {
  const upstream = require("./fixtures/upstream-26.1021.22027.json");
  const source = currentPipeFixture([
    "const process={env:{CODEX_APP_TOOLS_PIPE_PATH:`/pipe/first`},resourcesPath:`/resources`,platform:`linux`};",
    "const base={mcpServers:{codex_app:{command:`scripts/launch`,args:[`./server.mjs`],env:{BASE:`preserved`,CODEX_MCP_NODE_PATH:`/node`},default_tools_approval_mode:`approve`,tools:{automation_update:{approval_mode:`prompt`}}}}};",
    "let version=`first`,installed=true,disk=`upstream manifest`,pending=null,reloads=0,fail=false;",
    "const mo={marketplaceKinds:[`local`]},C={default:pathApi},l={zt:()=>false,At:x=>x},i={bi:version=>version,Zo:`bundled`,Ho:`app-tools`,qt:({localVersion})=>`/cache/app-tools/`+localVersion};",
    "const A={default:{readFile:async()=>disk,writeFile:async(path,value)=>{pending=value},rename:async()=>{disk=pending}}},v={randomUUID:()=>`fixture`};",
    "function _o(){return{marketplace:{name:`bundled`},plugin:{name:`app-tools`,installed,localVersion:version}}}function Wc(){return null}",
    "async function Uc({useWsl:e,resourcesPath:t=process.resourcesPath}){if(!process.env.CODEX_APP_TOOLS_PIPE_PATH)return Wc(`missing-pipe`);let{mcpServers:{codex_app:a}}=base,s={...a.env},c=null;return{...a,command:C.default.join(`/bundle`,a.command),cwd:`/bundle`,enabled:!1,env:s}}",
    upstream.sync,
    upstream.prepare,
    "const connection={hostConfig:{kind:`local`},listPlugins:async()=>({marketplaces:[]}),codexHome:async()=>`/home`,sendAppServerRequest:async()=>{if(fail)throw Error(`reload rejected`);reloads++}};",
    "globalThis.prepare=async(local=true,modern=true)=>{let r={...connection,hostConfig:{kind:local?`local`:`ssh`},appServerVersion:modern};return await Hc({hostConfig:r.hostConfig,appServerVersion:r.appServerVersion})};",
    "globalThis.prepareAutomation=async()=>{let a={...connection,appServerVersion:true},n=a.hostConfig;return await Hc({hostConfig:n,appServerVersion:a.appServerVersion})};",
    "globalThis.snapshot=()=>({reloads,disk});globalThis.restart=()=>{version=`second`;process.env.CODEX_APP_TOOLS_PIPE_PATH=`/pipe/second`};",
    "globalThis.reinstall=()=>{disk=`upstream manifest`};globalThis.removePipe=()=>delete process.env.CODEX_APP_TOOLS_PIPE_PATH;",
    "globalThis.failReload=()=>{fail=true};globalThis.uninstall=()=>{installed=false};",
  ].join(""));
  const descriptor = descriptors.find(({ id }) => id === "automation-plugin-pipe");
  const patched = descriptor.apply(source);
  const context = vm.createContext({ pathApi: require("node:path").posix });
  vm.runInContext(patched, context);
  return { context, source, patched, descriptor };
}

test("plugin-capable Desktop threads refresh the installed transport before resuming", async () => {
  const { context, patched, descriptor } = desktopPluginSyncContext();
  assert.deepEqual(Object.keys(await context.prepare()), []);
  assert.equal(context.snapshot().reloads, 1);
  const first = JSON.parse(context.snapshot().disk).mcpServers.codex_app;
  assert.equal(first.env.CODEX_APP_TOOLS_PIPE_PATH, "/pipe/first");
  assert.equal(first.env.BASE, "preserved");
  assert.equal(first.command, "/cache/app-tools/first/scripts/launch");
  assert.equal(first.default_tools_approval_mode, "approve");
  assert.equal(first.tools.automation_update.approval_mode, "prompt");
  await context.prepareAutomation();
  assert.equal(context.snapshot().reloads, 1, "unchanged transport must not reload recursively");
  context.restart();
  await context.prepare();
  const next = JSON.parse(context.snapshot().disk).mcpServers.codex_app;
  assert.equal(context.snapshot().reloads, 2);
  assert.equal(next.env.CODEX_APP_TOOLS_PIPE_PATH, "/pipe/second");
  assert.equal(next.command, "/cache/app-tools/second/scripts/launch");
  assert.equal(next.cwd, "/cache/app-tools/second");
  context.reinstall();
  await context.prepare();
  assert.equal(context.snapshot().reloads, 3);
  assert.equal(JSON.parse(context.snapshot().disk).mcpServers.codex_app.env.CODEX_APP_TOOLS_PIPE_PATH, "/pipe/second");
  assert.equal(descriptor.apply(patched), patched);
});

test("transport refresh keeps remote, unavailable, legacy and failed-reload behavior", async () => {
  const { context } = desktopPluginSyncContext();
  assert.deepEqual(Object.keys(await context.prepare(false)), []);
  assert.equal(context.snapshot().reloads, 0);
  const legacy = await context.prepare(true, false);
  assert.equal(legacy["mcp_servers.codex_app.env"].CODEX_APP_TOOLS_PIPE_PATH, "/pipe/first");
  assert.equal(context.snapshot().reloads, 1);
  context.reinstall();
  context.failReload();
  await assert.rejects(context.prepare(), /reload rejected/);
  const missing = desktopPluginSyncContext().context;
  missing.removePipe();
  await missing.prepare();
  assert.equal(missing.snapshot().reloads, 0);
  const uninstalled = desktopPluginSyncContext().context;
  uninstalled.uninstall();
  await uninstalled.prepare();
  assert.equal(uninstalled.snapshot().reloads, 0);
});

test("transport synchronization fails closed on ambiguous owners and damaged markers", () => {
  const { descriptor, source, patched } = desktopPluginSyncContext();
  const { sync } = require("./fixtures/upstream-26.1021.22027.json");
  assert.throws(() => descriptor.apply(source + currentPipeFixture(sync.replace("uoe(", "anotherSync(")).replace('let rP="CODEX_APP_TOOLS_PIPE_PATH",fixtureDeferred=false;', "")), /synchronization patch did not match/);
  assert.throws(() => descriptor.apply(source.replace('(0,i.bi)(e.appServerVersion,"pluginMcpConfigOverrides")', 'changed(e.appServerVersion,"pluginMcpConfigOverrides")')), /synchronization patch did not match/);
  assert.throws(() => descriptor.apply(patched.replace("await uoe(e);", "await wrongOwner(e);")), /synchronization patch did not match/);
  assert.throws(() => descriptor.apply(patched + "/*codexLinuxSyncAutomationPluginBeforeResume*/"), /synchronization patch did not match/);
});

test("transport synchronization supports dollar-prefixed minified owners", () => {
  const { descriptor, source } = desktopPluginSyncContext();
  const renamed = source.replaceAll("Hc", "$prepare").replaceAll("uoe", "$sync").replaceAll("Uc", "$builder");
  const patched = descriptor.apply(renamed);
  assert.equal(descriptor.apply(patched), patched);
  const context = vm.createContext({ pathApi: require("node:path").posix });
  vm.runInContext(patched, context);
  return context.prepare().then(() => assert.equal(context.snapshot().reloads, 1));
});

test("automation view returns machine-readable status and absence", async () => {
  const source = automationViewFixture();

  const patched = descriptors
    .filter(({ id }) => id === "observable-automation-view")
    .reduce((current, descriptor) => descriptor.apply(current), source);
  assert.equal(matchesObservableAutomationViewContract(patched), true);
  assert.equal(applyObservableAutomationViewPatch(patched), patched);
  const context = vm.createContext({});
  vm.runInContext(patched, context);

  const foundResponse = await context.run("existing");
  assert.equal(foundResponse.contentItems[0].text, "Read automation from the app.");
  assert.deepEqual(JSON.parse(foundResponse.contentItems[1].text), {
    automationId: "existing",
    mode: "view",
    viewStatus: "found",
    status: "PAUSED",
    snapshot: {
      kind: "heartbeat",
      name: "Acceptance",
      prompt: "Report marker",
      rrule: "FREQ=WEEKLY;BYDAY=SU;BYHOUR=23;BYMINUTE=59",
      status: "PAUSED",
    },
  });

  const missingResponse = await context.run("missing");
  assert.equal(missingResponse.contentItems[0].text, "Automation does not exist in the app.");
  assert.deepEqual(JSON.parse(missingResponse.contentItems[1].text), {
    automationId: "missing",
    mode: "view",
    viewStatus: "not_found",
    status: null,
    snapshot: null,
  });
});

test("automation view patch fails closed on drift and incomplete markers", () => {
  assert.throws(
    () => applyObservableAutomationViewPatch("const changed=`Automation card copy changed`;"),
    /did not match the current or patched bundle/,
  );
  assert.throws(
    () => applyObservableAutomationViewPatch("const marker=`codexLinuxObservableAutomationView`;"),
    /did not match the current or patched bundle/,
  );
  const partial = automationViewFixture().replace(
    "return{response:Lm()}",
    "return{response:Lm()}/*codexLinuxObservableAutomationView*/",
  );
  assert.throws(
    () => applyObservableAutomationViewPatch(partial),
    /Observable automation view/,
  );

  const patched = applyObservableAutomationViewPatch(automationViewFixture());
  const corruptions = [
    ["automationId:codexLinuxAutomationViewId,", ""],
    ["mode:`view`,viewStatus:", "viewStatus:"],
    ["prompt:codexLinuxAutomationViewItem.prompt,", ""],
    [
      "[{type:`inputText`,text:`Failed to view automation.`}],success:!1",
      "[{type:`inputText`,text:`Failed to view automation.`}],success:!0",
    ],
  ];
  for (const [needle, replacement] of corruptions) {
    assert.equal(patched.includes(needle), true);
    const corrupted = patched.replace(needle, replacement);
    assert.equal(matchesObservableAutomationViewContract(corrupted), false);
    assert.throws(
      () => applyObservableAutomationViewPatch(corrupted),
      /did not match the current or patched bundle/,
    );
  }
});

test("current habitat automation host retains its migration consent guard", async () => {
  const patched = applyObservableAutomationViewPatch(automationViewFixture());
  const context = vm.createContext({});
  vm.runInContext(patched, context);
  const response = await context.runViaHost("existing", false);
  assert.equal(JSON.parse(response.contentItems[1].text).status, "PAUSED");
  const blocked = await context.runViaHost("existing", true);
  assert.equal(blocked.success, false);
  assert.equal(blocked.contentItems.length, 1);
  assert.equal(blocked.contentItems[0].text,
    "Local automation changes must use the Automations app after migration consent.");
  const changedGuard = automationViewFixture().replace("isLocalMigrationActive", "unknownMigrationState");
  assert.throws(() => applyObservableAutomationViewPatch(changedGuard),
    /did not match the current or patched bundle/);
});

test("automation view patch rejects an unrelated matching store class", () => {
  const mismatchedHost = automationViewFixture(
    "var ActualHost=class{executeUpdateTool(e){return this.#r(e,this)}#r(e,t){return e.hostId===`local`?jz(t,e,e=>null):null}};" +
      "var Decoy=class{async delete({id:e}){return this.#n(e,null)}async#n(e,t){let r=api.kr(e),i=api.Or(e),a=i===`deleted`||i===`not_found`;return{item:r,success:a,status:i}}};" +
      "var Fz=ActualHost;",
  );
  assert.throws(
    () => applyObservableAutomationViewPatch(mismatchedHost),
    /did not match the current or patched bundle/,
  );
});

test("automation view patch rejects a private store routed to a different handler", () => {
  const mismatchedHost = automationViewFixture().replace(
    ":Lw(t,e,e=>e instanceof LS?e.message:null)",
    ":unrelated(t,e,e=>e instanceof LS?e.message:null)",
  );
  assert.throws(
    () => applyObservableAutomationViewPatch(mismatchedHost),
    /did not match the current or patched bundle/,
  );
});
