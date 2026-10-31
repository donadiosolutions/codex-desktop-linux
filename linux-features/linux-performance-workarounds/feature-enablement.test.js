"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { applyFeatureEnablementDedupPatch } = require("./feature-enablement.js");

// Feature-sync owner from signed official Linux 26.1013.31256.
const fixture = "var pue=r.O({features:r.O({local_thread_store_compression:r._().optional()}).nullish()}),mue=class{evaluations;onChanged;logger=p.i(`app-server-feature-enablement`);connections=new Map;stopWatchingPolicy;stopWatchingConnections;disposed=!1;constructor(e,t,n){this.evaluations=t,this.onChanged=n,this.stopWatchingPolicy=t.onDidChange(()=>{for(let e of this.connections.values())this.sync(e)}),this.stopWatchingConnections=e.subscribe(e=>{if(e.hostId===`durable`)return;if(e.type===`removed`){let t=this.connections.get(e.hostId);t!=null&&(t.generation++,t.stopWatching(),this.connections.delete(e.hostId));return}let t={connection:e.connection,generation:0,rolloutCompressionRequested:!1,stopWatching:e.connection.registerInternalConnectionStateHandler(()=>this.sync(t))};this.connections.set(e.hostId,t),this.sync(t)})}dispose(){this.disposed=!0,this.stopWatchingPolicy(),this.stopWatchingConnections();for(let e of this.connections.values())e.generation++,e.stopWatching();this.connections.clear()}sync(e){let t=++e.generation;if(e.connection.getConnectionState()!==`connected`){e.rolloutCompressionRequested=!1;return}this.sendEnablement(e,t).catch(n=>{this.disposed||e.generation!==t||n instanceof a.wr||this.logger.warning(`Failed to sync experimental feature enablement`,{safe:{},sensitive:{error:n}})})}async sendEnablement(e,t){let n=await this.evaluations.readExecutionAssignments();if(this.disposed||e.generation!==t||n?.defaultEnableFeatures==null)return;let r=n.values.experimentalFeatureGates,o=fue(n.defaultEnableFeatures,r.curatedRemoteMarketplace,r.mcp20260728,r.backgroundPaginatedRolloutMigration,r.apiKeyModelDiscovery,r.apiKeyDaybreak);o.codex_apps_mcp_2026_07_28=!0,o.windows_sandbox_service=!0;let s=()=>{if(this.disposed||e.generation!==t||!(0,Fe.default)(this.evaluations.readReadyExecutionAssignments(),n))throw new a.wr({status:`not-ready`,reason:`execution-config-loading`})};!e.rolloutCompressionRequested&&i.Ei(e.connection.appServerVersion,`rolloutCompression`)&&e.connection.sendAppServerRequest(`config/read`,{includeLayers:!1},s).then(({config:t})=>{if(pue.parse(t).features?.local_thread_store_compression??r.localThreadStoreCompression)return e.connection.sendAppServerRequest(`rollout/compress`,void 0,()=>{s(),e.rolloutCompressionRequested=!0})}).catch(n=>{!this.disposed&&e.generation===t&&!(n instanceof a.wr)&&this.logger.warning(`Failed to trigger rollout compression`,{safe:{},sensitive:{error:n}})}),await e.connection.sendAppServerRequest(`experimentalFeature/enablement/set`,{enablement:o},s),!this.disposed&&e.generation===t&&this.onChanged(e.connection.hostId)}};";

// Reduced feature-sync owner from signed official Linux 26.1023.51421.
const currentShapeFixture = "var mue=class{logger=p.i(`app-server-feature-enablement`);disposed=!1;nextGeneration=0;connections=new Map;sync(e){let t=++this.nextGeneration;if(e.generation=t,e.connection.getConnectionState()!==`connected`){e.rolloutCompressionRequested=!1,e.supportsPropagation=null,e.acknowledgedGeneration=null;return}this.sendEnablement(e,t)}async sendEnablement(e,t){let a={example:!0},o=()=>{};let c=!1;try{c=(await e.connection.sendAppServerRequest(`experimentalFeature/enablement/set`,{enablement:a},o)).enablement.daybreak_program_propagation!=null}catch(e){throw e}return c}};";

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function setup(source = fixture, readFeatures = async () => ({ data: [], nextCursor: null }), readConfig = async () => ({config:{},origins:{}})) {
  let policyChanged, connected, gates = { example: true };
  const calls = [], reads = [], configReads = [], changed = [], errors = [];
  const connection = {
    hostId: "local", state: "connected",
    getConnectionState() { return this.state; },
    registerInternalConnectionStateHandler(fn) { connected = fn; return () => {}; },
    sendAppServerRequest(method, params, ready) {
      ready();
      if (method === "experimentalFeature/list") {
        reads.push({ method, params, ready });
        return readFeatures();
      }
      if (method === "config/read") {
        configReads.push({method, params, ready});
        return readConfig();
      }
      const done = deferred();
      calls.push({ method, params, ready, ...done });
      return done.promise;
    },
  };
  const assignments = () => ({ defaultEnableFeatures: { ...gates }, values: { experimentalFeatureGates: {} } });
  const Owner = new Function("r", "p", "a", "i", "Fe", "fue", applyFeatureEnablementDedupPatch(source) + ";return mue;")(
    { O: x => ({ parse: x => x, nullish() { return this; } }), _: () => ({ optional() { return this; } }) },
    { i: () => ({ warning: (...args) => errors.push(args) }) },
    { wr: class NotReady extends Error {} },
    { Ei: () => false },
    { default: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
    features => ({ ...features }),
  );
  const owner = new Owner(
    { subscribe(fn) { fn({ hostId: "local", connection }); return () => {}; } },
    { onDidChange(fn) { policyChanged = fn; return () => {}; }, async readExecutionAssignments() { return assignments(); }, readReadyExecutionAssignments: assignments },
    host => changed.push(host),
  );
  return { owner, calls, reads, configReads, changed, errors, connection, sync: () => policyChanged(), reconnect() { connection.state = "disconnected"; connected(); connection.state = "connected"; connected(); }, setFlags(flags) { gates = flags; } };
}
const flush = () => new Promise(resolve => setImmediate(resolve));

test("unchanged flags do not trigger another server configuration reload", async () => {
  const h = setup(); await flush();
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve({}); await flush();
  h.sync(); await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.errors.length, 0);
});

test("identical in-flight syncs share a send and keep the current completion notification", async () => {
  const h = setup(); await flush();
  h.sync(); await flush();
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve({}); await flush();
  assert.deepEqual(h.changed, ["local"]);
  assert.equal(h.errors.length, 0);
});

test("failed sends remain retryable for the same map", async () => {
  const h = setup(); await flush();
  h.calls[0].reject(new Error("offline")); await flush();
  h.sync(); await flush();
  assert.equal(h.calls.length, 2);
  h.calls[1].resolve({}); await flush();
  assert.deepEqual(h.changed, ["local"]);
});

test("a newer sync retries when the older generation is rejected before dispatch", async () => {
  const h = setup(); await flush();
  h.sync(); await flush();
  assert.throws(h.calls[0].ready);
  h.calls[0].reject(new Error("stale generation")); await flush();
  assert.equal(h.calls.length, 2);
  assert.doesNotThrow(h.calls[1].ready);
  h.calls[1].resolve({}); await flush();
  assert.deepEqual(h.changed, ["local"]);
});

test("changed flags wait for the prior send then apply the newest map", async () => {
  const h = setup(); await flush();
  h.setFlags({ example: false }); h.sync(); await flush();
  assert.equal(h.calls.length, 1);
  h.calls[0].resolve({}); await flush();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].params.enablement.example, false);
  h.calls[1].resolve({}); await flush();
  h.sync(); await flush();
  assert.equal(h.calls.length, 2);
});

test("A to B to A does not leave B as the applied state", async () => {
  const h = setup(); await flush();
  h.calls[0].resolve({}); await flush();
  h.setFlags({ example: false }); h.sync(); await flush();
  h.setFlags({ example: true }); h.sync(); await flush();
  assert.equal(h.calls.length, 2);
  h.calls[1].resolve({}); await flush();
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls[2].params.enablement.example, true);
  h.calls[2].resolve({}); await flush();
});

test("reconnect resends flags and an old completion cannot overwrite the new connection", async () => {
  const h = setup(); await flush();
  h.setFlags({ example: false }); h.reconnect(); await flush();
  assert.equal(h.calls.length, 2);
  h.calls[1].resolve({}); await flush();
  h.calls[0].resolve({}); await flush();
  h.sync(); await flush();
  assert.equal(h.calls.length, 2);
});

test("flag key order does not cause a redundant send", async () => {
  const h = setup(); await flush(); h.calls[0].resolve({}); await flush();
  h.setFlags({ example: true, second: false }); h.sync(); await flush();
  h.calls[1].resolve({}); await flush();
  h.setFlags({ second: false, example: true }); h.sync(); await flush();
  assert.equal(h.calls.length, 2);
});

test("a completed map is resent after reconnect", async () => {
  const h = setup(); await flush(); h.calls[0].resolve({}); await flush();
  h.reconnect(); await flush();
  assert.equal(h.calls.length, 2);
  h.calls[1].resolve({}); await flush();
});

test("separate host connections do not share applied flags", async () => {
  const a = setup(), b = setup(); await flush();
  assert.equal(a.calls.length, 1);
  assert.equal(b.calls.length, 1);
  a.calls[0].resolve({}); b.calls[0].resolve({}); await flush();
  a.sync(); b.sync(); await flush();
  assert.equal(a.calls.length, 1);
  assert.equal(b.calls.length, 1);
});

test("stale queued flag changes are rejected and the newest flags still apply", async () => {
  const h = setup(); await flush();
  h.setFlags({ example: false }); h.sync(); await flush();
  h.setFlags({ example: true, newest: true }); h.sync(); await flush();
  h.calls[0].resolve({}); await flush();
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].params.enablement.newest, true);
  assert.doesNotThrow(h.calls[1].ready);
  h.calls[1].resolve({}); await flush();
  assert.equal(h.errors.length, 0);
});

test("patching is idempotent and fails closed for missing, duplicated, and partial owners", () => {
  const patched = applyFeatureEnablementDedupPatch(fixture);
  assert.notEqual(patched, fixture);
  assert.equal(applyFeatureEnablementDedupPatch(patched), patched);
  const warn = console.warn, warnings = [];
  console.warn = message => warnings.push(message);
  try {
    for (const source of [
      fixture.replace("experimentalFeature/enablement/set", "changed/method"),
      fixture + fixture,
      fixture.replace("rolloutCompressionRequested=!1;return", "return"),
      patched.replace("codexLinuxFeatureEnablementSync=null,", ""),
    ]) assert.equal(applyFeatureEnablementDedupPatch(source), source);
    assert.equal(warnings.length, 4);
  } finally { console.warn = warn; }
});

test("current upstream feature-sync shape remains patchable", () => {
  const patched = applyFeatureEnablementDedupPatch(currentShapeFixture);
  assert.notEqual(patched, currentShapeFixture);
  assert.match(patched, /await codexLinuxSyncFeatureEnablement\(e,a,o,\(\)=>e\.connection\.sendAppServerRequest\(`experimentalFeature\/enablement\/set`,\{enablement:a\},o\),!0\)/);
  assert.match(patched, /e\.codexLinuxFeatureEnablementSync=null,e\.rolloutCompressionRequested=!1/);
  assert.equal(applyFeatureEnablementDedupPatch(patched), patched);
  const Owner = new Function(`${patched};return mue;`)();
  const owner = Object.create(Owner.prototype);
  let sends = 0;
  const state = { generation: 1, connection: { sendAppServerRequest() {
    sends++;
    return Promise.resolve({ enablement: { daybreak_program_propagation: true } });
  } } };
  return Promise.all([
    owner.sendEnablement(state, 1), owner.sendEnablement(state, 1),
  ]).then(results => {
    assert.deepEqual(results, [true, true]);
    assert.equal(sends, 1);
  });
});

const matchingFeatures = () => ({ data: [
  { name: "example", enabled: true },
  { name: "codex_apps_mcp_2026_07_28", enabled: true },
  { name: "windows_sandbox_service", enabled: true },
], nextCursor: null });
test("fresh connections skip writes when the server already has all requested effective flags", async () => {
  const first = setup(fixture, async () => matchingFeatures());
  const second = setup(fixture, async () => matchingFeatures());
  await flush();
  for (const h of [first, second]) {
    assert.equal(h.calls.length, 0);
    assert.equal(h.reads.length, 1);
    assert.deepEqual(h.changed, ["local"]);
    h.sync(); await flush();
    assert.equal(h.reads.length, 1);
  }
  first.reconnect(); await flush();
  assert.equal(first.calls.length, 0);
  assert.equal(first.reads.length, 2);
});
test("a different effective value still sends the original complete map", async () => {
  const h = setup(fixture, async () => ({...matchingFeatures(), data: matchingFeatures().data.map(e=>({...e, enabled:false}))}));
  await flush();
  assert.equal(h.reads.length, 1);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].params.enablement, {example:true,codex_apps_mcp_2026_07_28:true,windows_sandbox_service:true});
  h.calls[0].reject(new Error("write failed")); await flush();
  h.sync(); await flush();
  assert.equal(h.reads.length, 2);
  assert.equal(h.calls.length, 2);
  h.calls[1].resolve({}); await flush();
});
test("missing unknown malformed or paginated flags and failed reads preserve the write", async () => {
  for (const response of [
    {data: matchingFeatures().data.slice(1), nextCursor:null},
    {data: matchingFeatures().data.map(e=>({...e, name:"unknown"})), nextCursor:null},
    {...matchingFeatures(), nextCursor:"3"},
    {data: matchingFeatures().data.map(e=>({...e,enabled:"true"})), nextCursor:null},
    {data: [...matchingFeatures().data, matchingFeatures().data[0]], nextCursor:null},
    null,
    new Error("unavailable"),
  ]) {
    const h = setup(fixture, async () => {if(response instanceof Error)throw response;return response;});
    await flush();
    assert.equal(h.reads.length, 1);
    assert.equal(h.calls.length, 1);
    h.calls[0].resolve({}); await flush();
  }
});
test("a stale generation after the effective-state read never dispatches a write", async () => {
  const first = deferred(); let reads = 0;
  const h = setup(fixture, () => ++reads===1?first.promise:Promise.resolve(matchingFeatures()));
  await flush(); h.sync(); await flush();
  first.resolve({data:[],nextCursor:null}); await flush();
  assert.equal(h.calls.length,0);
  assert.equal(h.reads.length,2);
  assert.deepEqual(h.changed,["local"]);
});

const protectedFeatures = () => ({data:[...matchingFeatures().data,{name:"memories",enabled:true}],nextCursor:null});
const userMemoryConfig = () => ({config:{features:{memories:true}},origins:{"features.memories":{name:{type:"user",file:"/config.toml"},version:"sha256:fixture"}}});
test("an explicit user memories preference outranks the GUI false assignment without a reload", async () => {
  const h = setup(fixture, async()=>protectedFeatures(), async()=>userMemoryConfig());
  h.setFlags({example:true,memories:false});h.sync();
  await flush();
  assert.equal(h.calls.length,0);
  assert.equal(h.configReads.length,1);
  assert.deepEqual(h.configReads[0].params,{includeLayers:false});
  assert.deepEqual(h.changed,["local"]);
});
test("only consistent authoritative config origins protect mismatched effective values", async () => {
  const valid=userMemoryConfig();
  for (const config of [
    {config:valid.config, origins:{}},
    {...valid, origins:{"features.memories":{name:{type:"unexpected"},version:"v"}}},
    {...valid, origins:{"features.memories":{name:null,version:"v"}}},
    {...valid, config:{features:{memories:false}}},
    {...valid, config:{features:{memories:"true"}}},
    {...valid, origins:{"features.memoriesExtra":{name:{type:"user"},version:"v"}}},
    null,
    new Error("config unavailable"),
  ]) {
    const h=setup(fixture,async()=>protectedFeatures(),async()=>{if(config instanceof Error)throw config;return config;});
    h.setFlags({example:true,memories:false});h.sync();await flush();
    assert.equal(h.calls.length,1);
    h.calls[0].resolve({});await flush();
  }
});
test("a descendant origin protects only its named feature and stale config reads cannot write", async()=>{
  const config=userMemoryConfig();config.origins={"features.memories.enabled":{name:{type:"project",path:"/project"},version:"v"}};
  const h=setup(fixture,async()=>protectedFeatures(),async()=>config);
  h.setFlags({example:true,memories:false});h.sync();await flush();
  assert.equal(h.calls.length,0);
  const pending=deferred();let count=0;
  const stale=setup(fixture,async()=>protectedFeatures(),()=>++count===1?pending.promise:Promise.resolve(config));
  stale.setFlags({example:true,memories:false});stale.sync();await flush();
  stale.sync();await flush();pending.resolve({config:{},origins:{}});await flush();
  assert.equal(stale.calls.length,0);
  assert.equal(stale.configReads.length,2);
});

test("malformed effective booleans cannot be protected by matching malformed config", async()=>{
  for(const bad of [undefined,"true",null]) {
    const response=protectedFeatures();response.data.find(e=>e.name==="memories").enabled=bad;
    const config=userMemoryConfig();config.config.features.memories=bad;
    const h=setup(fixture,async()=>response,async()=>config);
    h.setFlags({example:true,memories:false});h.sync();await flush();
    assert.equal(h.calls.length,1);
    assert.equal(h.configReads.length,0);
    h.calls[0].resolve({});await flush();
  }
});

// Reduced owner from signed official Linux 26.1027.30824.
const rspackShape = 'class CurrentSync{logger=(0,em.log)("app-server-feature-enablement");sync(e){let t=1;if(e.generation=t,"connected"!==e.connection.getConnectionState()){e.rolloutCompressionRequested=!1,e.supportsPropagation=null,e.acknowledgedGeneration=null;return}}async sendEnablement(e,t){let i={example:!0},s=()=>{};let a=!1;try{let t=await e.connection.sendAppServerRequest("experimentalFeature/enablement/set",{enablement:i},s);a=null!=t.enablement.daybreak_program_propagation}catch(e){throw e}return a}}';
test("signed 26.1027 named owner preserves propagation response and reconnect reset", async () => {
  const patched = applyFeatureEnablementDedupPatch(rspackShape);
  assert.notEqual(patched, rspackShape);
  assert.equal(applyFeatureEnablementDedupPatch(patched), patched);
  assert.match(patched, /codexLinuxFeatureEnablementSync=null/);
  const Owner = new Function("em", `${patched};return CurrentSync;`)({log:()=>({})});
  const owner = new Owner(); let sends=0;
  const state={connection:{getConnectionState:()=>"connected",sendAppServerRequest:async()=>{sends++;return {enablement:{daybreak_program_propagation:true}}}}};
  assert.deepEqual(await Promise.all([owner.sendEnablement(state,1),owner.sendEnablement(state,1)]),[true,true]);
  assert.equal(sends,1);
  state.connection.getConnectionState=()=>"disconnected";owner.sync(state);
  assert.equal(state.codexLinuxFeatureEnablementSync,null);
});
