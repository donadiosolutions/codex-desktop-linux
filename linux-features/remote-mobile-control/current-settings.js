"use strict";
const { findMatchingBrace } = require("../../scripts/patches/lib/minified-js.js");
const MARKER = "codexLinuxRemoteControlResetMobileSetupAfterRevoke";
function revokeContract(source) {
  const handler = /onRevoked:(?<id>[\w$]+)=>\{(?<query>[\w$]+)\.setData\((?<data>[\w$]+)=>\k<data>\?\.filter\(\k<data>=>\k<data>\.clientId!==\k<id>\)\),\k<query>\.invalidate\(\)\},onRevokeResult:(?<result>[\w$]+)=>\{\(0,[\w$]+\.[\w$]+\)\((?<scope>[\w$]+),[\w$]+\.CodexRemoteControlClientRevokeResult,\{result:\k<result>\}\)\}/gu;
  const matches = [...source.matchAll(handler)];
  if (matches.length !== 1) return null;
  const match = matches[0], start = source.lastIndexOf("function ", match.index);
  if (start < 0) return null;
  const end = findMatchingBrace(source, source.indexOf("{", start));
  if (end < match.index) return null;
  const owner = source.slice(start,end+1);
  const state = /\[(?<state>[\w$]+),(?<setter>[\w$]+)\]=\(0,[\w$]+\.useState\)\(null\)/u.exec(owner);
  const local = /localRemoteControlClientId:(?<local>[\w$]+),waiting:/u.exec(owner);
  if (!state || !local || !new RegExp(`(?:,|let )${local.groups.local}=\\(0,[\\w$]+\\.[\\w$]+\\)\\(`, "u").test(owner) || !owner.includes(`${state.groups.state}?.step==="waiting"`) || !owner.includes(`${state.groups.setter}(null)`)) return null;
  return { match, state:state.groups, local:local.groups.local };
}
function applyCurrentRevokeSetupReset(source) {
  // The current setup state is component-local; the old persisted completion key
  // has no consumers. Clear the live pairing step after the final peer is revoked.
  if (source.includes(MARKER)) {
    const callbacks = [...source.matchAll(/onRevoked:(?<id>[\w$]+)=>\{(?<query>[\w$]+)\.setData\((?<data>[\w$]+)=>\{let codexLinuxRemainingClients=[^;]+;\/\*codexLinuxRemoteControlResetMobileSetupAfterRevoke\*\/[^;]+;return codexLinuxRemainingClients\}\),\k<query>\.invalidate\(\)\}/gu)];
    if (callbacks.length !== 1 || source.split(MARKER).length !== 2) return null;
    const callback = callbacks[0], {id, query, data} = callback.groups;
    const original = `onRevoked:${id}=>{${query}.setData(${data}=>${data}?.filter(${data}=>${data}.clientId!==${id})),${query}.invalidate()}`;
    const pristine = source.slice(0,callback.index)+original+source.slice(callback.index+callback[0].length);
    return applyCurrentRevokeSetupReset(pristine) === source ? source : null;
  }
  const contract = revokeContract(source);
  if (!contract) return null;
  const {match,state,local}=contract, {id,query,data}=match.groups;
  const original = `onRevoked:${id}=>{${query}.setData(${data}=>${data}?.filter(${data}=>${data}.clientId!==${id})),${query}.invalidate()}`;
  const replacement = `onRevoked:${id}=>{${query}.setData(${data}=>{let codexLinuxRemainingClients=${data}?.filter(${data}=>(${data}.clientId??${data}.client_id)!==${id});/*${MARKER}*/codexLinuxRemainingClients?.filter(${data}=>(${data}.clientId??${data}.client_id)!==${local}).length===0&&${state.setter}(null);return codexLinuxRemainingClients}),${query}.invalidate()}`;
  return source.slice(0,match.index)+match[0].replace(original,replacement)+source.slice(match.index+match[0].length);
}
module.exports = { applyCurrentRevokeSetupReset, matchesCurrentRevokeSetupReset:source=>applyCurrentRevokeSetupReset(source)!==null };
