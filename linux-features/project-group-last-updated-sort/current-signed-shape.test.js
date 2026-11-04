"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { applyProjectGroupLastUpdatedSortPatch, descriptors } = require("./patch.js");
// Signed 26.1029.61003: both sort helpers are inlined into the sidebar selector.
const current='let{chatSortMode:X,projectSortMode:Q}=t(f.by),Z=new Map,J=e=>0;let ec=function({groups:e,projectOrder:t}){return(0,a.n)(e,t)}({groups:q({groups:eu,items:V}),projectOrder:(0,o.F6)(t,i.Q2Y.PROJECT_ORDER)}),ep=function({explicitChatThreadKeys:e,getRecencyAt:t,items:n,projectGroups:r,projectlessThreadIds:i}){return n}({explicitChatThreadKeys:es,getRecencyAt:J,items:V,projectGroups:ea,projectlessThreadIds:new Set(en??[])});';
test("signed current inline group sorter adds same-scope mode and recency resolver",()=>{
  assert.equal(descriptors[0].assetMatch(current),true);
  const patched=applyProjectGroupLastUpdatedSortPatch(current);
  assert.notEqual(patched,current);
  assert.match(patched,/getRecencyAt:J,sortMode:Q/);
  assert.match(patched,/return \(0,a.n\)\(e,n\)/);
  assert.equal(applyProjectGroupLastUpdatedSortPatch(patched),patched);
  assert.equal(descriptors[0].assetMatch(patched),true);
  assert.equal(descriptors[0].assetMatch(current+current),false);
});
