"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  applyAutomationUpdateEagerToolPatch,
  applyAutomationPluginEnablePatch,
  matchesAutomationPluginEnableContract,
} = require("./eager-update.js");

const owner = 'OGL(e,t,n){let r,x={},M="automation_update";n.d(t,{},{B2:x,Fy:M,VV:function(){return null==r&&(r={name:M,description:"Manage automations",inputSchema:{type:"object"}}),r}})}';
const mapper = 'map(e,t,n){function catalog({tools:e,eagerToolNames:t,deferredToolNames:n,supportsDynamicToolNamespaces:s}){return e.map(e=>({type:"function",...e,...s&&(!t.has(e.name)||n.includes(e.name))?{deferLoading:!0}:{}}))}n.d(t,{build:()=>catalog})}';
const aggregate = 'aggregate(e,t,n){var automation=n("OGL"),mapper=n("map");let tools=[(0,automation.VV)()];return(0,mapper.build)({tools:tools,eagerToolNames:new Set,deferredToolNames:[],supportsDynamicToolNamespaces:!0})}';
const chunk = (toolOwner = owner, catalog = mapper, aggregator = aggregate) =>
  `export const __rspack_esm_id=1;export const __webpack_modules__={noop(e,t,n){},${toolOwner},${catalog},${aggregator}};`;

function eager(source) {
  const patched=applyAutomationUpdateEagerToolPatch(source);
  assert.notEqual(patched,source);
  return patched;
}

test("inline exported automation factory stays linked to the eager tool catalog",()=>{
  const source=eager(chunk());
  assert.equal(matchesAutomationPluginEnableContract(source),true);
  assert.equal(applyAutomationPluginEnablePatch(source),source);
  assert.equal(matchesAutomationPluginEnableContract(source),true);
});

test("inline factory rejects detached exports, cache mismatches and duplicate owners",()=>{
  const cases=[
    chunk(owner.replace('VV:function','XX:function')),
    chunk(owner.replace('}),r}}','}),other}}')),
    chunk(owner.replace('M="automation_update"','M="different_tool"')),
    chunk(owner.replace('inputSchema:','differentSchema:')),
    chunk(owner+','+owner.replace('OGL(e','OTHER(e')),
    chunk(owner,mapper,aggregate.replace('mapper=n("map")','mapper=n("other")')),
    chunk(owner,mapper,aggregate.replace('tools=[(0,automation.VV)()]','tools=[]')),
  ];
  for(const value of cases) assert.equal(matchesAutomationPluginEnableContract(eager(value)),false,value);
});

test("latest signed exported automation factory validates after eager-tool patch",{skip:!process.env.CODEX_SIGNED_EXTRACTED_APP},()=>{
  const root=path.join(process.env.CODEX_SIGNED_EXTRACTED_APP,'webview/assets/async');
  const sources=fs.readdirSync(root).filter(name=>name.endsWith('.js')).map(name=>({file:path.join(root,name),source:fs.readFileSync(path.join(root,name),'utf8')})).filter(({source})=>source.includes('="automation_update"')&&source.includes('eagerToolNames:'));
  assert.equal(sources.length,1);
  const [{file,source}]=sources,patched=eager(source);
  assert.equal(matchesAutomationPluginEnableContract(patched),true);
  assert.equal(applyAutomationPluginEnablePatch(patched),patched);
  assert.equal(fs.readFileSync(file,'utf8'),source);
});
