"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const descriptors = require("./patch.js");

const fixtures = {
  "codex-app-thread-tools":
    'class Inputs{constructor(params){this.params=params}async readInputs(e,t,r,n,a){let{scope:u,hostId:d,requestClient:v,dynamicTools:f}=this.params,g=u?.settings,w=!!u,y=null,T=(0,m.desktopMcp)(d),M=(0,C.instructions)(g,e,{disableExposureLog:n});return{hasDesktopRuntime:!0,hasDeveloperInstructions:!0,isBrowserRuntime:!1,instructionOverrides:M,readDynamicTools:async e=>{let t=await f.request(e);return T?(0,l.wrap)(t):{kind:"dynamic",tools:t}},traceRequest:e=>e}}}' +
    'globalThis.make=async host=>new Inputs({hostId:host,dynamicTools:{request:async e=>e}}).readInputs();',
  "codex-app-resume-thread-tools":
    'function resume(e,t){let{hostId:n}=t,r=n!==P.executor,i=(0,m.desktopMcp)(n),s=r?runtime.appServices?.managedWorktrees:void 0,o=r?new x.Dynamic(n,t.dispatchMessageToView):null;return{isBrowserRuntime:!1,usesDesktopMcp:i,readDynamicTools:null==o?void 0:e=>o.request({...e,requestedHistoryMode:"legacy"}),readCodexConfig:async()=>null}}' +
    'globalThis.make=hostId=>resume(null,{hostId,dispatchMessageToView:()=>{}});',
};

for (const [id, source] of Object.entries(fixtures)) {
  test(`${id} requests sibling tools only for local Desktop MCP`, async () => {
    const descriptor = descriptors.find(candidate => candidate.id === id);
    assert.ok(descriptor);
    assert.equal(descriptor.assetMatch(source), true);
    const patched = descriptor.apply(source);
    assert.notEqual(patched, source);
    assert.equal(descriptor.assetMatch(patched), true);
    assert.equal(descriptor.apply(patched), patched);
    assert.equal(descriptor.assetMatch(source + source), false);
    assert.equal(descriptor.apply(source + source), source + source);
    const context = vm.createContext({
      m: { desktopMcp: host => host === "local" },
      C: { instructions: () => ({}) },
      l: { wrap: tools => ({ tools }) },
      P: { executor: "executor" },
      runtime: {},
      x: { Dynamic: class { async request(input) { return { tools: input }; } } },
    });
    vm.runInContext(patched, context);
    for (const host of ["local", "remote"]) {
      const inputs = await context.make(host);
      const result = await inputs.readDynamicTools({ featureOverrides: { apps: true }, mode: "default" });
      const request = result.tools ?? result;
      assert.equal(request.featureOverrides.apps, true);
      assert.equal(request.featureOverrides.thread_tools, host === "local" ? true : undefined);
      assert.equal(request.mode, "default");
      if (id === "codex-app-resume-thread-tools") assert.equal(request.requestedHistoryMode, "legacy");
    }
  });
}
