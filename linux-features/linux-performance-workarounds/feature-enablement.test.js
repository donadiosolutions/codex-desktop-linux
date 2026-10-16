"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { applyFeatureEnablementDedupPatch } = require("./feature-enablement.js");

// Feature-sync owner from signed official Linux 26.1013.31256.
const fixture = "var pue=r.O({features:r.O({local_thread_store_compression:r._().optional()}).nullish()}),mue=class{evaluations;onChanged;logger=p.i(`app-server-feature-enablement`);connections=new Map;stopWatchingPolicy;stopWatchingConnections;disposed=!1;constructor(e,t,n){this.evaluations=t,this.onChanged=n,this.stopWatchingPolicy=t.onDidChange(()=>{for(let e of this.connections.values())this.sync(e)}),this.stopWatchingConnections=e.subscribe(e=>{if(e.hostId===`durable`)return;if(e.type===`removed`){let t=this.connections.get(e.hostId);t!=null&&(t.generation++,t.stopWatching(),this.connections.delete(e.hostId));return}let t={connection:e.connection,generation:0,rolloutCompressionRequested:!1,stopWatching:e.connection.registerInternalConnectionStateHandler(()=>this.sync(t))};this.connections.set(e.hostId,t),this.sync(t)})}dispose(){this.disposed=!0,this.stopWatchingPolicy(),this.stopWatchingConnections();for(let e of this.connections.values())e.generation++,e.stopWatching();this.connections.clear()}sync(e){let t=++e.generation;if(e.connection.getConnectionState()!==`connected`){e.rolloutCompressionRequested=!1;return}this.sendEnablement(e,t).catch(n=>{this.disposed||e.generation!==t||n instanceof a.wr||this.logger.warning(`Failed to sync experimental feature enablement`,{safe:{},sensitive:{error:n}})})}async sendEnablement(e,t){let n=await this.evaluations.readExecutionAssignments();if(this.disposed||e.generation!==t||n?.defaultEnableFeatures==null)return;let r=n.values.experimentalFeatureGates,o=fue(n.defaultEnableFeatures,r.curatedRemoteMarketplace,r.mcp20260728,r.backgroundPaginatedRolloutMigration,r.apiKeyModelDiscovery,r.apiKeyDaybreak);o.codex_apps_mcp_2026_07_28=!0,o.windows_sandbox_service=!0;let s=()=>{if(this.disposed||e.generation!==t||!(0,Fe.default)(this.evaluations.readReadyExecutionAssignments(),n))throw new a.wr({status:`not-ready`,reason:`execution-config-loading`})};!e.rolloutCompressionRequested&&i.Ei(e.connection.appServerVersion,`rolloutCompression`)&&e.connection.sendAppServerRequest(`config/read`,{includeLayers:!1},s).then(({config:t})=>{if(pue.parse(t).features?.local_thread_store_compression??r.localThreadStoreCompression)return e.connection.sendAppServerRequest(`rollout/compress`,void 0,()=>{s(),e.rolloutCompressionRequested=!0})}).catch(n=>{!this.disposed&&e.generation===t&&!(n instanceof a.wr)&&this.logger.warning(`Failed to trigger rollout compression`,{safe:{},sensitive:{error:n}})}),await e.connection.sendAppServerRequest(`experimentalFeature/enablement/set`,{enablement:o},s),!this.disposed&&e.generation===t&&this.onChanged(e.connection.hostId)}};";

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function setup(source = fixture) {
  let policyChanged, connected, gates = { example: true };
  const calls = [], changed = [], errors = [];
  const connection = {
    hostId: "local", state: "connected",
    getConnectionState() { return this.state; },
    registerInternalConnectionStateHandler(fn) { connected = fn; return () => {}; },
    sendAppServerRequest(method, params, ready) {
      ready();
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
  return { owner, calls, changed, errors, connection, sync: () => policyChanged(), reconnect() { connection.state = "disconnected"; connected(); connection.state = "connected"; connected(); }, setFlags(flags) { gates = flags; } };
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
