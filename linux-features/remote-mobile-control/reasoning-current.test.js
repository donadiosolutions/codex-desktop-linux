"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { applyLinuxRemoteMobileReasoningSummaryPatch: patch } = require("./patch.js");

function inlineTurnStart() {
  return 'async function start(e,t,n,r,i,a){let b="aeon"===n.context?.threadStartKind;return await async function(e,t,n,r,i,a,o){let s=n.request,N=a.latestThreadSettings,S=a.initialParams,C=a.configRequirements,ye=N?.summary??"none";S?.summary!==void 0&&(ye=S.summary),null!=o.reasoningSummaryOverride&&(ye=o.reasoningSummaryOverride),ye=null==C?null:C.model_reasoning_summary??ye,void 0!==s.summary&&(ye=s.summary);let unrelated=async function(x){return x};logger.info("Reasoning summary turn-start config resolved",{safe:{summary:ye}});return{summary:ye}}(e,t,n,r,i,a,{canUseProjectlessWorkspace:!(0,gh.ZJ)(e.getHostId()),canMaterializeHostRoots:!(0,gh.ZJ)(e.getHostId())&&!0,preserveWorkspaceSandboxPolicyWithDefault:(0,gh.ZJ)(e.getHostId()),carryProjectlessRuntimeRoots:!(0,gh.ZJ)(e.getHostId()),latestUseAppServerPermissionDefault:!0,reasoningSummaryOverride:!0===e.getDefaultFeatureOverride("concurrent_reasoning_summaries")||b?"detailed":null})}';
}

test("inline summary resolver preserves explicit overrides and local durable scope", async () => {
  const source = inlineTurnStart();
  const patched = patch(source);
  assert.notEqual(patched, source);
  assert.equal(patch(patched), patched);
  const context = {gh:{ZJ:host=>host==="local"},logger:{info(){}},navigator:{userAgent:"Linux"}};
  vm.runInNewContext(patched+";globalThis.start=start",context);
  for (const userAgent of ["Linux","Macintosh"]) {
    context.navigator.userAgent=userAgent;
    for (const host of ["local","remote-ssh:dev"])
      for (const mode of ["durable","default"])
        for (const explicit of [undefined,"concise"]){
          const result=await context.start({getHostId:()=>host,getDefaultFeatureOverride:()=>true},null,{request:{summary:explicit},context:{}},null,null,{mode,configRequirements:{model_reasoning_summary:"model"}});
          const expected=explicit??(userAgent==="Linux"&&host==="local"&&mode==="durable"?"none":"model");
          assert.equal(result.summary,expected);
        }
  }
});

test("inline summary resolver rejects detached, duplicate and partial contracts", () => {
  const source=inlineTurnStart(),patched=patch(source);
  const broken=[
    source+source,
    source.replace('}(e,t,n,r,i,a,{canUseProjectlessWorkspace:', '}(e,t,n,r,i,a,{differentCaller:'),
    source.replace('reasoningSummaryOverride:!0===e.getDefaultFeatureOverride', 'anotherOverride:!0===e.getDefaultFeatureOverride'),
    patched.replace('codexLinuxRemoteMobileHost:', 'missingHost:'),
  ];
  for(const value of broken) assert.equal(patch(value),value);
});

test("latest signed inline summary resolver patches uniquely without modifying the input", {skip:!process.env.CODEX_SIGNED_EXTRACTED_APP},()=>{
  const dir=path.join(process.env.CODEX_SIGNED_EXTRACTED_APP,"webview/assets/async");
  const owners=fs.readdirSync(dir).filter(name=>name.endsWith(".js")).map(name=>({file:path.join(dir,name),source:fs.readFileSync(path.join(dir,name),"utf8")})).filter(({source})=>source.includes("Reasoning summary turn-start config resolved"));
  assert.equal(owners.length,1);
  const [{file,source}]=owners,patched=patch(source);
  assert.notEqual(patched,source);assert.equal(patch(patched),patched);
  assert.doesNotThrow(()=>new vm.Script(patched.replace(/export const /g,"const ")));
  assert.equal(fs.readFileSync(file,"utf8"),source);
});
