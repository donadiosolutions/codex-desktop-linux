"use strict";

const { findMatchingBrace } = require("../../scripts/patches/lib/minified-js.js");

const ID = "[A-Za-z_$][\\w$]*";
const MARKER = "codexLinuxCodexAppThreadTools";

function creationRequest(source) {
  const matches = [...source.matchAll(new RegExp(
    String.raw`(?<before>readDynamicTools:async (?<input>${ID})=>\{let (?<result>${ID})=await (?<client>${ID})\.request\()(?<argument>\k<input>|(?<patched>(?<guard>${ID})\?\{\.\.\.\k<input>,featureOverrides:\{\.\.\.\k<input>\.featureOverrides,thread_tools:!0\}\}:\k<input>/\*${MARKER}\*/))(?<after>\);return (?<local>${ID})\?\(0,${ID}\.${ID}\)\(\k<result>\):\{kind:"dynamic",tools:\k<result>\}\},traceRequest:)`,
    "g",
  ))];
  if (matches.length !== 1) return null;
  const [request] = matches;
  // The second local assignment prepares instructions before returning the
  // runtime inputs. Keep it intact and tie the request to this same owner.
  const owners = [...source.matchAll(new RegExp(
    String.raw`async readInputs\([^()]*\)\{let\{scope:${ID},hostId:(?<host>${ID}),requestClient:${ID},dynamicTools:(?<client>${ID})\}=this\.params,[^;]*,(?<local>${ID})=\(0,${ID}\.${ID}\)\(\k<host>\),(?<instructions>${ID})=\(0,${ID}\.${ID}\)\(${ID},${ID},\{disableExposureLog:${ID}\}\);return\{hasDesktopRuntime:!0,hasDeveloperInstructions:!0,isBrowserRuntime:!1,`,
    "g",
  ))].filter(owner => owner.groups.client === request.groups.client && owner.groups.local === request.groups.local &&
    ownsRequest(source, owner, request));
  return owners.length === 1 ? request : null;
}

function resumeRequest(source) {
  const matches = [...source.matchAll(new RegExp(
    String.raw`(?<before>readDynamicTools:null==(?<client>${ID})\?void 0:(?<input>${ID})=>\k<client>\.request\()(?<argument>\{\.\.\.\k<input>,requestedHistoryMode:"legacy"(?<patched>,\.\.\.(?<guard>${ID})\?\{featureOverrides:\{\.\.\.\k<input>\.featureOverrides,thread_tools:!0\}\}:\{\}/\*${MARKER}\*/)?\})(?<after>\),readCodexConfig:)`,
    "g",
  ))];
  if (matches.length !== 1) return null;
  const [request] = matches;
  const owners = [...source.matchAll(new RegExp(
    String.raw`function ${ID}\(${ID},(?<options>${ID})\)\{let\{hostId:(?<host>${ID})\}=\k<options>,(?<nonExecutor>${ID})=\k<host>!==${ID}\.${ID},(?<local>${ID})=\(0,${ID}\.${ID}\)\(\k<host>\),${ID}=\k<nonExecutor>\?${ID}\.appServices\?\.managedWorktrees:void 0,(?<client>${ID})=\k<nonExecutor>\?new ${ID}\.${ID}\(\k<host>,\k<options>\.dispatchMessageToView\):null;return\{`,
    "g",
  ))].filter(owner => owner.groups.client === request.groups.client && ownsRequest(source, owner, request) &&
    source.slice(owner.index + owner[0].length, request.index).includes(`isBrowserRuntime:!1,usesDesktopMcp:${owner.groups.local},`));
  if (owners.length !== 1) return null;
  request.groups.local = owners[0].groups.local;
  return request;
}

function ownsRequest(source, owner, request) {
  const open = owner.index + owner[0].lastIndexOf("return{") + "return".length;
  return open < request.index && findMatchingBrace(source, open) >= request.index + request[0].length;
}

function threadToolsPatch(findRequest, buildArgument) {
  function contract(source) {
    const request = findRequest(source);
    if (request?.groups.patched && request.groups.guard !== request.groups.local) return null;
    return request;
  }
  return {
    assetMatch: source => contract(source) != null,
    apply(source) {
      const request = contract(source);
      if (request == null || request.groups.patched) return source;
      const { before, input, local, after } = request.groups;
      const override = `featureOverrides:{...${input}.featureOverrides,thread_tools:!0}`;
      const argument = buildArgument(input, local, override);
      return source.slice(0, request.index) + before + argument + after + source.slice(request.index + request[0].length);
    },
  };
}

const creationThreadTools = threadToolsPatch(creationRequest, (input, local, override) =>
  `${local}?{...${input},${override}}:${input}/*${MARKER}*/`);
const resumeThreadTools = threadToolsPatch(resumeRequest, (input, local, override) =>
  `{...${input},requestedHistoryMode:"legacy",...${local}?{${override}}:{}/*${MARKER}*/}`);

module.exports = { creationThreadTools, resumeThreadTools };
