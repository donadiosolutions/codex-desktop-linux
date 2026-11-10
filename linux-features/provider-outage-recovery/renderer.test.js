"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fixture = require("./renderer-fixture.js");
const { applyRenderer, applyFollowUpGuard } = require("./patch.js");
const { patchBreaksJavaScriptSyntax } = require("../../scripts/patches/lib/javascript-syntax.js");
function harness(canStart = true) {
  const patched = applyRenderer(fixture);
  const start = patched.indexOf("/*provider-outage-recovery:renderer*/"), end = patched.indexOf('function ei(e)', start);
  const effects = [], timers = new Map(), listeners = new Map(), sends = [];
  const history = [{ id: "old", status: "failed", error: { httpConnectionFailed: { httpStatusCode: 503 } } }];
  const role = { role: "owner" };
  const store = { get(selector, key) {
    if(typeof selector === "function") return selector(key, { get: store.get.bind(store), scope: {} });
    return ({ M: () => history, RN: () => key?.id, OM: () => key?.status, ag: () => ({ codexErrorInfo: key?.error }), fl: () => "ready", hf: () => role })[selector]?.();
  } };
  const refs = [];
  const react = { useState: init => [typeof init === "function" ? init() : init, () => {}], useRef: () => {const ref = {current:null};refs.push(ref);return ref;}, useEffect: callback => effects.push(callback) };
  const jsx = (type, props) => ({type,props});
  const context = { n: { i1: (_, fn) => fn, gh: () => store }, M: {u:"scope"}, _: {M:"M",RN:"RN",OM:"OM",ag:"ag",fl:"fl"}, d:react, I:{c:()=>({activeMode:{mode:"default"}})},g:{hf:"hf"},o:{jsx,jsxs:jsx},H:()=>{},v:{R9:async(...args)=>{sends.push(args);}},document:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},window:{addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:name=>listeners.delete(name)},setInterval:fn=>{timers.set(1,fn);return 1;},clearInterval:id=>timers.delete(id),Date, crypto:require("node:crypto").webcrypto, console };
  vm.runInNewContext(patched.slice(start,end)+";this.component=CommunityProviderRecovery;",context);
  context.component({conversationId:"thread",hostId:"host",turnId:"old",canStart,content:"Service unavailable"});
  const cleanup=effects[0]()??(()=>{});
  return { context, refs, timers, listeners, sends, cleanup, role, history };
}
test("renderer routes outage separately and leaves capacity predicate and schedule unchanged", () => {
  const patched=applyRenderer(fixture);
  assert.match(patched,/function ei\(e\)\{return"serverOverloaded"===e\|\|"policyCapacityUnavailable"===e\}/);
  assert.match(patched,/\$=\[10,30,120,300\]/);
  assert.equal(patchBreaksJavaScriptSyntax(fixture,patched),false);
  assert.equal(applyRenderer(patched),patched);
  const renamed=fixture.replaceAll('conversationId:C','conversationId:conversation').replaceAll('hostId:I','hostId:host');
  assert.match(applyRenderer(renamed),/conversationId:conversation,hostId:host,turnId:O/);
  for(const broken of ["",fixture+fixture,fixture.replace('"capacityErrorRetries"','"changed"'),fixture.replace('"2899820207"','"changed"')]) assert.throws(()=>applyRenderer(broken));
});
test("mounted countdown uses the same host, thread and native continuation options", async () => {
  const h=harness();await h.refs[0].current.retryNow();
  assert.equal(h.sends.length,1);
  const [,host,thread,opts]=h.sends[0];assert.equal(host,"host");assert.equal(thread,"thread");
  assert.equal(opts.communityRecovery.expectedTurnId,"old");assert.equal(opts.communityRecovery.hostId,"host");
  assert.equal(Object.hasOwn(opts,"continuationInput"),false);
  h.cleanup();assert.equal(h.timers.size,0);assert.equal(h.listeners.size,0);
});
test("user activity and window teardown cancel mounted countdown", async () => {
  for(const event of ["input","keydown","pointerdown","pagehide"]){const h=harness();h.listeners.get(event)({target:{closest:()=>null}});await h.refs[0].current.retryNow();assert.equal(h.sends.filter(call=>call[3]?.communityRecovery?.action!=="cancel").length,0);h.cleanup();}
});
test("follow-up checks cancellation after context resolution and strips callback before RPC", async () => {
  const source='const exports={R9:async function(e,t,n,o){let l={stack:[],error:void 0,hasError:!1};try{let i=(0,a.V)(e,t),d=(0,r.mS)(l,await i.getFollowUpContext(n,!0),!1);await i.startEmptyTurn(n,{...o,writingBlockContextPrepared:null!=d,additionalContext:d})}finally{}}};';
  const patched=applyFollowUpGuard(source);let resolve, sent=0, cancelled=false;
  const context={r:{mS:(_stack,value)=>value},a:{V:()=>context.manager},manager:{getFollowUpContext:()=>new Promise(r=>{resolve=r}),startEmptyTurn:async(_thread,opts)=>{sent++;assert.equal("communityRecoveryCheck" in opts,false);}}};
  vm.runInNewContext(patched+";this.retry=exports.R9;",context);
  const task=context.retry(null,"host","thread",{communityRecoveryCheck:()=>{if(cancelled)throw Error("cancelled")}});cancelled=true;resolve({});await assert.rejects(task,/cancelled/);assert.equal(sent,0);
  context.manager.getFollowUpContext=async()=>({});cancelled=false;await context.retry(null,"host","thread",{communityRecoveryCheck:()=>{}});assert.equal(sent,1);
  assert.throws(()=>applyFollowUpGuard(source+source));
});
test("cancellation uses exactly the registered token and expiry", async () => {
  const h=harness();await h.refs[0].current.retryNow();
  const begin=h.sends[0][3].communityRecovery;
  h.listeners.get("input")({target:{closest:()=>null}});
  const cancel=h.sends.at(-1)[3].communityRecovery;
  assert.equal(cancel.action,"cancel");assert.equal(cancel.token,begin.token);assert.equal(cancel.expiresAt,begin.expiresAt);
  h.cleanup();
});
test("initial read-only or ineligible error rows never arm recovery", async () => {
  const h=harness(false);assert.equal(h.refs[0].current,null);assert.equal(h.timers.size,0);assert.equal(h.sends.length,0);h.cleanup();
  assert.match(applyRenderer(fixture), /turnId:O\?\?T.turnId,canStart:null!=O/);
});
