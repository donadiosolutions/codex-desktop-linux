"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { registerRequestHandlers, hasRegisteredRequestHandlers } = require("./request-handlers.js");

// The signed 26.1021.22027 FetchHandler retains one handler and this router.
const fixture = 'var FetchHandler=class{handlers={"set-remote-wsl-connections-enabled":async({enabled:e,origin:t})=>this.windowManager.getPrimaryWindows().some(e=>e.webContents===t)?this.remoteConnectionsHandler.setRemoteWslConnectionsEnabled(e):{remoteWslConnections:this.remoteConnectionsHandler.catalog.read().wsl??[]}};handleVSCodeRequest(e,t,n,r,i){try{let a=t,o=this.handlers[a];if(typeof o!=`function`)throw Error(`${t} not implemented`);let c=()=>o({...n,origin:e,signal:i});return r==null?c():source({source:r,requestKind:t},c)}catch(e){throw e}}};';
const payload = '"linux-probe":async({value:e,origin:t,signal:n})=>({value:e,origin:t,signal:n})';

test("registers requests in the current live FetchHandler map and routes payload and context", async () => {
  const patched = registerRequestHandlers(fixture, payload);
  assert.notEqual(patched, fixture);
  assert.equal(hasRegisteredRequestHandlers(patched, payload), true);
  assert.equal(registerRequestHandlers(patched, payload), patched);
  const context = {}; vm.runInNewContext(patched + 'globalThis.handler=new FetchHandler', context);
  const result = await context.handler.handleVSCodeRequest("window", "linux-probe", {value:42}, null, "signal");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {value:42,origin:"window",signal:"signal"});
});

test("rejects absent, dead, duplicate, misplaced and partial registration contracts", () => {
  const patched = registerRequestHandlers(fixture, payload);
  for (const source of [fixture.replace("handleVSCodeRequest", "deadRequest"), fixture+fixture,
    'var dead={'+payload+'};'+fixture, patched.replace("handlers={", "handlers={"+payload+","),
    fixture.replace('this.handlers[a]', 'this.otherHandlers[a]')]) {
    assert.equal(hasRegisteredRequestHandlers(source, payload), false);
    assert.throws(() => registerRequestHandlers(source, payload));
  }
});
