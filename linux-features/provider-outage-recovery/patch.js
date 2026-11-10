"use strict";
const { recoveryRuntime } = require("./recovery.js");
const { findMatchingBrace } = require("../../scripts/patches/lib/minified-js.js");
const marker = "/*provider-outage-recovery:renderer*/";
const id = "[$\\w]+";
function one(source, pattern) {
  const matches = [...source.matchAll(new RegExp(pattern, "g"))];
  if (matches.length !== 1) throw Error("Provider recovery renderer contract changed or is ambiguous");
  return matches[0];
}
function applyRenderer(source) {
  if (source.includes(marker)) {
    if (!["const communityOutageRuntime=", "function CommunityProviderRecovery", "communityRecovery:recoveryOptions"].every(value => source.includes(value))) throw Error("Incomplete provider recovery renderer patch");
    return source;
  }
  const predicate = one(source, `function (${id})\\((${id})\\)\\{return"serverOverloaded"===\\2\\|\\|"policyCapacityUnavailable"===\\2\\}`);
  const branch = one(source, `if\\(${predicate[1]}\\((${id})\\.errorInfo\\)&&null!=(${id})\\)\\{`);
  const props = one(source, `conversationId:(${id}),hostId:(${id}),icon:${id},item:${branch[1]},retryTurnId:${branch[2]},turnKey:${id}`);
  const selector = one(source, `(${id})=\\(0,(${id})\\.i1\\)\\((${id})\\.u,\\((${id}),\\{get:(${id}),scope:(${id})\\}\\)=>\\{if\\(\\(0,${id}\\.JF\\)\\(\\5\\(${id}\\.B,\\4\\.hostId\\),"capacityErrorRetries"\\)\\)return null;let (${id})=\\5\\((${id})\\.M,\\4\\);`);
  const atom = selector[2], storeModule = selector[3], turns = selector[8];
  const auto = one(source, `function (${id})\\((${id})\\)\\{let [^{};]+,\\{conversationId:(${id}),hostId:(${id}),retryDelaySeconds:(${id})\\}=\\2,(${id})=\\(0,${atom}\\.gh\\)\\(${storeModule}\\.u\\),(${id})=\\(0,${atom}\\._U\\)\\((${id})\\.JW,"2899820207"\\),(${id})=\\(0,${atom}\\._U\\)\\((${id})\\.hf,\\3\\),\\{activeMode:(${id})\\}=\\(0,(${id})\\.c\\)\\(\\3\\);`);
  const start = source.indexOf("{", auto.index), end = findMatchingBrace(source, start);
  const autoSource = source.slice(auto.index, end + 1);
  const react = one(autoSource, `let\\[${id}\\]=\\(0,(${id})\\.useState\\)\\(${id}\\),\\[${id},${id}\\]`)[1];
  const dispatch = one(autoSource, `\\(0,(${id})\\.(${id})\\)\\(${auto[6]},${auto[4]},${auto[3]},\\{turnTrigger:`);
  const send = dispatch[1], sendMethod = dispatch[2];
  const jsx = one(autoSource, `\\(0,(${id})\\.jsx\\)\\((${id}),\\{disabled:`);
  const owner = auto[10], mode = auto[12], jsxAlias = jsx[1], button = jsx[2];
  const injected = `${marker}
const communityOutageRuntime=(${recoveryRuntime.toString()})();
const communityOutageEpisodes=new WeakMap();
const communityOutageHistory=(0,${atom}.i1)(${storeModule}.u,(key,{get,scope})=>{
 const list=get(${turns}.M,key);if(!list?.length)return null;
 let root=get(${turns}.RN,list.at(-1)),count=0;
 for(let i=list.length-1;i>0&&count<7;i--){const turn=list[i],prev=list[i-1];
 if(get(${turns}.OM,turn)!=="failed"||!communityOutageRuntime.isOutage(get(${turns}.ag,turn)?.codexErrorInfo))break;
 get(${turns}.hm,turn);const data=(0,${turns}.od)(scope,turn);
 if(!data||data.params.input.length!==0||get(${turns}.OM,prev)!=="failed"||!communityOutageRuntime.isOutage(get(${turns}.ag,prev)?.codexErrorInfo))break;
 root=get(${turns}.RN,prev);count++;
 }return {root,count};},{owner:key=>key.threadId});
function CommunityProviderRecovery({conversationId,hostId,turnId,content,canStart}){
 const store=(0,${atom}.gh)(${storeModule}.u),{activeMode}=(0,${mode}.c)(conversationId);
 const [,render]=(0,${react}.useState)(0),ref=(0,${react}.useRef)(null);
 const key={hostId,threadId:conversationId};
 const read=()=>{const list=store.get(${turns}.M,key),last=list?.at(-1);return {hostId,threadId:conversationId,turnId:store.get(${turns}.RN,last),ready:store.get(${turns}.fl,key)==="ready",failed:store.get(${turns}.OM,last)==="failed",owner:store.get(${owner}.hf,conversationId)?.role==="owner",error:store.get(${turns}.ag,last)?.codexErrorInfo};};
 (0,${react}.useEffect)(()=>{
  const state=read(),history=store.get(communityOutageHistory,key);if(!canStart||state.turnId!==turnId||!history)return;
  let episodes=communityOutageEpisodes.get(store);if(!episodes){episodes=new Map();communityOutageEpisodes.set(store,episodes);}
  const episodeKey=JSON.stringify([hostId,conversationId]);
  let episode=episodes.get(episodeKey);if(!episode||episode.root!==history.root){if(episode)episode.cancelled=true;episode=communityOutageRuntime.newEpisode(Date.now());episode.root=history.root;episodes.set(episodeKey,episode);}
  const recoveryOptions={token:crypto.randomUUID(),hostId,expectedTurnId:turnId,expiresAt:Math.min(episode.started+900000,Date.now()+30000)};
  const controller=communityOutageRuntime.createRecovery({episode,expected:state,read,priorAttempts:history.count,cancelSend:()=> (0,${send}.${sendMethod})(store,hostId,conversationId,{communityRecovery:{...recoveryOptions,action:"cancel"}}),send:async check=>{
   check();recoveryOptions.expiresAt=Math.min(episode.started+900000,Date.now()+30000);await (0,${send}.${sendMethod})(store,hostId,conversationId,{turnTrigger:"capacity_retry_automatic",collaborationMode:activeMode,communityRecoveryCheck:check,communityRecovery:recoveryOptions});
  }});ref.current=controller;
  const refresh=()=>render(value=>value+1),cancel=()=>{controller.cancel();refresh();};
  const activity=event=>{if(!event.target?.closest?.("[data-community-provider-recovery]"))cancel();};
  document.addEventListener("input",activity,true);document.addEventListener("keydown",activity,true);document.addEventListener("pointerdown",activity,true);
  window.addEventListener("pagehide",cancel);
  const timer=setInterval(()=>{void controller.tick().finally(()=>{refresh();if(controller.seconds()===null)clearInterval(timer);});},1000);refresh();
  return()=>{clearInterval(timer);controller.dispose();ref.current=null;document.removeEventListener("input",activity,true);document.removeEventListener("keydown",activity,true);document.removeEventListener("pointerdown",activity,true);window.removeEventListener("pagehide",cancel);};
 },[store,hostId,conversationId,turnId]);
 const controller=ref.current,seconds=controller?.seconds()??null;
 return (0,${jsxAlias}.jsxs)("div",{"data-community-provider-recovery":true,children:[(0,${jsxAlias}.jsx)("span",{className:"wrap-anywhere",children:content}),seconds===null?null:(0,${jsxAlias}.jsx)(${button},{disabled:false,secondsRemaining:seconds,totalSeconds:seconds,onClick:()=>{void controller.retryNow().finally(()=>render(value=>value+1));}}),seconds===null?null:(0,${jsxAlias}.jsx)("button",{type:"button",onClick:()=>{controller.cancel();render(value=>value+1);},children:"Cancel automatic retry"})]});
}
`;
  const replacement = `if(communityOutageRuntime.isOutage(${branch[1]}.errorInfo)&&null!=(${branch[2]}??${branch[1]}.turnId))return (0,${jsxAlias}.jsx)(CommunityProviderRecovery,{conversationId:${props[1]},hostId:${props[2]},turnId:${branch[2]}??${branch[1]}.turnId,canStart:null!=${branch[2]},content:${branch[1]}.content});`;
  const patched = source.slice(0, branch.index) + replacement + source.slice(branch.index);
  const offset = predicate.index + replacement.length;
  return patched.slice(0, offset) + injected + patched.slice(offset);
}

// R9 obtains disposable follow-up context before startEmptyTurn. Recheck the
// renderer lease after that await, then remove its callback before any RPC.
function applyFollowUpGuard(source) {
  const marker = "/*provider-outage-recovery:follow-up*/";
  if(source.includes(marker)) {
    if (!["communityDiscardCheck", "communityRecoveryOptions", ".communityRecovery?.action===\"cancel\""].every(value => source.includes(value))) throw Error("Incomplete provider recovery follow-up patch");
    return source;
  }
  const re = /await ([$\w]+)\.startEmptyTurn\(([$\w]+),\{\.\.\.([$\w]+),writingBlockContextPrepared:null!=([$\w]+),additionalContext:/g;
  const matches = [...source.matchAll(re)];
  if(matches.length!==1) throw Error("Provider recovery follow-up contract changed or is ambiguous");
  const m=matches[0];
  const withCheck = source.replace(re, `${marker}${m[3]}.communityRecoveryCheck?.();const {communityRecoveryCheck:communityDiscardCheck,...communityRecoveryOptions}=${m[3]};await ${m[1]}.startEmptyTurn(${m[2]},{...communityRecoveryOptions,writingBlockContextPrepared:null!=${m[4]},additionalContext:`);
  const entry = one(withCheck, `async function\\((${id}),(${id}),(${id}),(${id})\\)\\{let ${id}=\\{stack:\\[\\],error:void 0,hasError:!1\\};try\\{let ${m[1]}=\\(0,${id}\\.V\\)\\(\\1,\\2\\),${m[4]}=\\(0,${id}\\.mS\\)\\(${id},await ${m[1]}\\.getFollowUpContext\\(\\3,!0\\),!1\\);`);
  const entryOpen = withCheck.indexOf("{", entry.index);
  const entryEnd = findMatchingBrace(withCheck, entryOpen);
  const resolver = one(withCheck.slice(entry.index, entryEnd + 1), `let (${id})=\\(0,(${id})\\.V\\)\\(${entry[1]},${entry[2]}\\)`);
  const shortcut = `if(${entry[4]}.communityRecovery?.action==="cancel")return (0,${resolver[2]}.V)(${entry[1]},${entry[2]}).startEmptyTurn(${entry[3]},${entry[4]});`;
  return withCheck.slice(0,entryOpen+1)+shortcut+withCheck.slice(entryOpen+1);
}
module.exports = {applyRenderer,applyFollowUpGuard,descriptors:[
 {id:"provider-outage-renderer",phase:"webview-asset",matchPolicy:"all",ciPolicy:"optional",assetNeedles:['"capacityErrorRetries"','"2899820207"','"policyCapacityUnavailable"'],apply:applyRenderer},
 {id:"provider-outage-follow-up",phase:"webview-asset",matchPolicy:"all",ciPolicy:"optional",assetNeedles:["startEmptyTurn","writingBlockContextPrepared:null!=","getFollowUpContext"],assetMatch:source=>/await [$\w]+\.startEmptyTurn\([^;]{0,120}writingBlockContextPrepared:null!=/.test(source),apply:applyFollowUpGuard},
]};
