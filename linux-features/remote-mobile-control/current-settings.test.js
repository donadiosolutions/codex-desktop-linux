"use strict";
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createHash}=require('node:crypto');
const test=require('node:test');
const fixture=require('./fixtures/upstream-26.1029.61003-settings.json');
const descriptors=require('./patch.js');
const descriptor=id=>descriptors.find(d=>d.id===id);
test('current settings outbound gate survives copy stage and exposes Linux tab',()=>{
 const d=descriptor('linux-remote-control-settings-ux');
 assert.equal(d.assetMatch(fixture.gate),true);
 const p=d.apply(fixture.gate);assert.notEqual(p,fixture.gate);assert.equal(d.apply(p),p);
 for(const [platform,hide,want]of [['Linux',true,true],['Mac',true,false],['Mac',false,true]]){
  const ctx={navigator:{userAgent:platform},G:{Zj:()=>hide},tD:null};vm.runInNewContext(p,ctx);assert.equal(ctx.nV,want);
 }
});
test('current native service refresh selects and patches 5-second effect',()=>{
 const d=descriptor('linux-remote-connections-refresh'),source=fixture.refreshContract+';'+fixture.effect;
 assert.equal(d.assetMatch(source),true);const p=d.apply(source);assert.notEqual(p,source);assert.equal(d.apply(p),p);assert.match(p,/,5e3\)/);
});
test('current revoke resets active setup and retains cache/telemetry wiring',()=>{
 const d=descriptor('linux-remote-control-client-revoke-setup-reset');
 assert.equal(d.assetMatch(fixture.revoke),true);const p=d.apply(fixture.revoke);assert.notEqual(p,fixture.revoke);assert.equal(d.apply(p),p);
 assert.match(p,/ei\(null\)/);assert.match(p,/ej\.invalidate\(\)/);assert.match(p,/onRevokeResult:/);
});
test('signed current settings passes ordered descriptor stack and remains ESM', {skip:!process.env.CODEX_SIGNED_APP},()=>{
 let source=fs.readFileSync(path.join(process.env.CODEX_SIGNED_APP,'webview/assets',fixture.asset),'utf8');assert.equal(createHash('sha256').update(source).digest('hex'),fixture.sha256);
 for(const id of ['linux-remote-control-copy','linux-remote-control-settings-ux','linux-remote-control-client-revoke-setup-reset','linux-remote-connections-refresh']){
  const d=descriptor(id);assert.ok(d.pattern.test(fixture.asset),id);assert.ok(d.assetMatch(source),id);const p=d.apply(source);assert.notEqual(p,source,id);assert.equal(d.apply(p),p,id);source=p;
 }
 new vm.Script(source.replace(/export const /g,'const '));
});

test('current revoke clears only the last known peer and never discards local cache',()=>{
 const p=descriptor('linux-remote-control-client-revoke-setup-reset').apply(fixture.revoke);
 const {findMatchingBrace}=require('../../scripts/patches/lib/minified-js.js');
 const start=p.indexOf('onRevoked:')+'onRevoked:'.length;
 const end=findMatchingBrace(p,p.indexOf('{',start))+1;
 for(const [data,reset,remaining]of [
  [[{clientId:'desktop'},{clientId:'phone'}],true,[{clientId:'desktop'}]],
  [[{clientId:'phone'}],true,[]],
  [[{client_id:'desktop'},{client_id:'phone'}],true,[{client_id:'desktop'}]],
  [[{clientId:'desktop'},{clientId:'phone'},{clientId:'tablet'}],false,[{clientId:'desktop'},{clientId:'tablet'}]],
  [undefined,false,undefined],
 ]){
  let value=data, resets=0,invalidations=0;
  const handler=vm.runInNewContext('('+p.slice(start,end)+')',{
   ec:'desktop',ei:v=>{assert.equal(v,null);resets++},
   ej:{setData:fn=>{value=fn(value)},invalidate:()=>invalidations++}
  });
  handler('phone');assert.equal(resets,reset?1:0);assert.deepEqual(value,remaining);assert.equal(invalidations,1);
 }
});

test('native refresh triggers on resume/focus/online/visible and disposes all listeners',async()=>{
 const d=descriptor('linux-remote-connections-refresh');
 const p=d.apply(fixture.refreshContract+';'+fixture.effect);
 const effect=p.slice(p.indexOf('eF=()=>'));
 const listeners=new Map(),timeouts=new Map();let interval,intervalMs,now=2000,calls=0,signal;
 const window={
  setInterval(fn,ms){interval=fn;intervalMs=ms;return 3},clearInterval(id){assert.equal(id,3);interval=null},
  setTimeout(fn){timeouts.set(1,fn);return 1},clearTimeout(id){timeouts.delete(id)},
  addEventListener(n,fn){listeners.set(n,fn)},removeEventListener(n,fn){assert.equal(listeners.get(n),fn);listeners.delete(n)}
 };
 const document={visibilityState:'visible',addEventListener:window.addEventListener,removeEventListener:window.removeEventListener};
 const ctx={window,document,Date:{now:()=>now},AbortController,ow:async s=>{calls++;signal=s}};
 vm.runInNewContext(effect,ctx);const dispose=ctx.eF();assert.equal(intervalMs,5000);
 const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve()};
 for(const event of ['focus','online','resume','visibilitychange']){now+=2000;listeners.get(event)();await tick()}
 assert.equal(calls,4);document.visibilityState='hidden';listeners.get('visibilitychange')();await tick();assert.equal(calls,4);
 document.visibilityState='visible';now+=2000;interval();await tick();assert.equal(calls,5);
 listeners.get('focus')();await tick();listeners.get('online')();assert.equal(timeouts.size,1);
 dispose();assert.equal(listeners.size,0);assert.equal(timeouts.size,0);assert.equal(interval,null);
});

test('current revoke refuses ambiguous, detached, and partial contracts',()=>{
 const {applyCurrentRevokeSetupReset}=require('./current-settings.js');
 for(const source of [fixture.revoke+fixture.revoke,fixture.revoke.replace('localRemoteControlClientId:ec','localRemoteControlClientId:null'),fixture.revoke.replace('onRevokeResult:','detached:'),fixture.revoke+'/*codexLinuxRemoteControlResetMobileSetupAfterRevoke*/'])assert.equal(applyCurrentRevokeSetupReset(source),null);
 const p=applyCurrentRevokeSetupReset(fixture.revoke);
 assert.equal(applyCurrentRevokeSetupReset(p.replace('&&ei(null);return','&&wrong(null);return')),null);
});

test('current revoke follows renamed hook exports and requires local identity linkage',()=>{
 const {applyCurrentRevokeSetupReset}=require('./current-settings.js');
 const renamed=fixture.revoke.replace('ec=(0,u.Ul)(D.dZ)','ec=(0,u.renamedExport)(D.dZ)');
 assert.notEqual(renamed,fixture.revoke);
 const patched=applyCurrentRevokeSetupReset(renamed);
 assert.notEqual(patched,null);assert.notEqual(patched,renamed);
 assert.equal(applyCurrentRevokeSetupReset(patched),patched);
 assert.equal(applyCurrentRevokeSetupReset(renamed.replace('localRemoteControlClientId:ec','unrelatedClientId:ec')),null);
});
