"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path");
const {applyRenderer,applyFollowUpGuard,descriptors}=require("./patch.js");
const {applyManagerGuard}=require("./manager-patch.js");
const {patchBreaksJavaScriptSyntax}=require("../../scripts/patches/lib/javascript-syntax.js");
const root=process.env.CODEX_RECOVERY_OFFICIAL_EXTRACTED;
test("current verified official bundle covers every GUI recovery variant",{skip:!root},()=>{
 const assets=path.join(root,"webview/assets"),counts={renderer:0,followup:0,manager:0};
 for(const dir of [assets,path.join(assets,"async"),path.join(root,".vite/build")])for(const name of fs.readdirSync(dir)){
  if(!name.endsWith(".js"))continue;
  const source=fs.readFileSync(path.join(dir,name),"utf8");
  for(const [kind,match,apply]of [
   ["renderer",()=>descriptors[0].assetNeedles.every(n=>source.includes(n)),applyRenderer],
   ["followup",()=>descriptors[1].assetNeedles.every(n=>source.includes(n))&&descriptors[1].assetMatch(source),applyFollowUpGuard],
   ["manager",()=>source.includes("startEmptyTurn")&&source.includes("streamRecovery.cancelTurnContinuation"),applyManagerGuard]]){
   if(!match())continue;counts[kind]++;
   const patched=apply(source);assert.notEqual(patched,source,name);assert.equal(apply(patched),patched,name);
   assert.equal(patchBreaksJavaScriptSyntax(source,patched),false,name);
   assert.throws(()=>apply(source+source),undefined,name);
  }
 }
 assert.deepEqual(counts,{renderer:2,followup:11,manager:2});
});
