"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
test('signed 26.1021.22027 Plugins filter is discovered in its reorganized asset', () => {
  const descriptor = require('./patch.js').find(d => d.id === 'native-settings-visibility');
  const source = require('./fixtures/upstream-26.1021.22027.json').visibility;
  assert.equal(descriptor.pattern.test('app-primary-f72ae5046334.js'), true);
  assert.equal(descriptor.assetMatch(source), true);
  const patched = descriptor.apply(source);
  assert.doesNotThrow(() => new vm.Script(patched));
  assert.equal(descriptor.apply(patched), patched);
});
const {
  applyNativeSettingsAvailabilityPatch: availability,
  applyNativeSettingsVisibilityPatch: visibility,
  matchesNativeSettingsVisibilityContract,
} = require("./settings.js");
const fixture = 'function settings(){let i=availability(),{platform:o}=platform();let s=read();return {computerUseAvailability:i,available:i.available,plugins:s.availablePlugins}}';
const original = fixture.replace('platform();let s=', 'platform(),s=');
function render(source, platform, plugins) {
  return vm.runInNewContext(`${source};settings()`, { availability:()=>({available:false,isFetching:true,isLoading:true}), platform:()=>({platform}), read:()=>({availablePlugins:plugins}) });
}
test('Linux availability uses genuine disabled plugin state and never fabricates a missing plugin',()=>{
  const patched=availability(original);
  for(const plugins of [[],[{plugin:{name:'computer-use',installed:true,enabled:false}}]]) {
    const result=render(patched,'linux',plugins);
    assert.equal(result.available,true);
    assert.equal(result.computerUseAvailability.isLoading,false);
    assert.equal(result.plugins,plugins);
  }
  assert.equal(render(patched,'darwin',[]).available,false);
  assert.equal(availability(patched),patched);
});
test('current Rspack native settings hook exposes the enabled local Linux settings row',()=>{
  const current = require('./fixtures/current-rspack-settings.js');
  const patched = availability(current);
  assert.notEqual(patched, current);
  assert.equal(availability(patched), patched);
  const run = (platform, hostId = 'local') => vm.runInNewContext(`${patched};s({computerUseAvailability:{available:false,isLoading:true},hostId:${JSON.stringify(hostId)}})`, {
    r: { c: () => [] }, i: { V: () => ({ isLoading: false, platform }) }, a: { Zj: () => true },
  });
  assert.equal(run('Linux').available, true);
  assert.equal(run('Linux').isLoading, false);
  assert.equal(run('macOS').available, false);
  assert.equal(run('Linux', 'remote').available, false);
});
const filter='function Esc(e,t,n){if(t.length===0&&!n)return e;let r=new Set(t);return e.filter(e=>(!n||!pqn(e.plugin.id))&&!r.has(e.plugin.id))}';
test('Plugins presentation hides only the bundled native component',()=>{
  const plugins=[{marketplaceName:'openai-bundled',plugin:{id:'computer-use@openai-bundled',name:'computer-use',enabled:false}},{marketplaceName:'openai-bundled',plugin:{id:'browser@openai-bundled',name:'browser'}},{marketplaceName:'custom',plugin:{id:'computer-use@custom',name:'computer-use'}}];
  const patched=visibility(filter);
  const run=(hidden=[],restrictedMode=false)=>vm.runInNewContext(`${patched};Esc(plugins,hidden,mode)`,{plugins,hidden,mode:restrictedMode,pqn:id=>id.startsWith('browser')});
  assert.deepEqual(Array.from(run()),plugins.slice(1));
  assert.deepEqual(Array.from(run(['computer-use@custom'])),plugins.slice(1,2));
  assert.deepEqual(Array.from(run([],true)),plugins.slice(2));
  assert.equal(plugins.length,3);
  assert.equal(matchesNativeSettingsVisibilityContract(filter),true);
  assert.equal(matchesNativeSettingsVisibilityContract(patched),true);
  assert.equal(visibility(patched),patched);
});
test('current Rspack Plugins filter hides only the bundled native component',()=>{
  const source = require('./fixtures/current-rspack-settings-visibility.js');
  const patched = visibility(source);
  assert.notEqual(patched, source);
  assert.doesNotThrow(()=>new vm.Script(patched));
  assert.equal(visibility(patched), patched);
  const plugins=[
    {marketplaceName:'openai-bundled',plugin:{id:'computer-use@openai-bundled',name:'computer-use'}},
    {marketplaceName:'custom',plugin:{id:'computer-use@custom',name:'computer-use'}},
    {marketplaceName:'custom',plugin:{id:'restricted-tool@custom',name:'restricted-tool'}},
  ];
  const run=restrictedMode=>vm.runInNewContext(`${patched};_(plugins,[],restrictedMode)`,{
    plugins,restrictedMode,s:{zG:id=>id.startsWith('restricted-tool')},
  });
  assert.equal(Array.from(run(false)).length,2);
  assert.equal(Array.from(run(false)).some(e=>e.marketplaceName==='custom'&&e.plugin.name==='computer-use'),true);
  assert.equal(Array.from(run(true)).length,1);
});
test('unsupported and ambiguous contracts fail closed',()=>{
  assert.throws(()=>availability('function unrelated(){}'),/contract/);
  assert.throws(()=>availability(original+original),/contract/);
  assert.equal(matchesNativeSettingsVisibilityContract('function unrelated(){}'),false);
  assert.equal(matchesNativeSettingsVisibilityContract(filter+filter),false);
  assert.throws(()=>visibility('function unrelated(){}'),/contract/);
  assert.throws(()=>visibility(filter+filter),/contract/);
});
test('rejects the retired synthetic Settings contract instead of preserving fabricated enablement',()=>{
  assert.throws(()=>availability(availability(original)+'let EBundledMarketplaceDonor={plugin:{enabled:!0}};'),/contract/);
});

for (const [name, patch, pristine, damage] of [
  ['availability', availability, original, source => source.replace('computerUseAvailability:i', 'computerUseAvailability:other')],
  ['availability flags', availability, original, source => source.replace('available:!0', 'available:!1')],
  ['availability platform binding', availability, original, source => source.replace('o===`linux`', 'other===`linux`')],
  ['visibility', visibility, filter, source => source.replace('&&!r.has(e.plugin.id)', '')],
  ['visibility exclusion', visibility, filter, source => source.replace('openai-bundled', 'custom')],
]) {
  test(`${name} rejects mixed, duplicate, and damaged patched owners`, () => {
    const patched = patch(pristine);
    const damaged = damage(patched);
    assert.notEqual(damaged, patched);
    for (const source of [patched + ';' + pristine, pristine + ';' + patched,
      patched + ';' + patched, damaged, patched + ';' + damaged, pristine + ';' + damaged]) {
      assert.throws(() => patch(source), /contract/, source);
    }
  });
}
