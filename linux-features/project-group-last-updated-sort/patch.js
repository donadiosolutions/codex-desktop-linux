"use strict";

const identifier = String.raw`[A-Za-z_$][\w$]*`;
const { escapeRegExp } = require("../../scripts/patches/lib/minified-js.js");
const currentGroupSorterPattern = new RegExp(
  String.raw`function (${identifier})\(\{groups:e,projectOrder:t\}\)\{return (${identifier})\(e,t\)\}`,
  "g",
);
const patchedGroupSorterPattern = new RegExp(
  String.raw`function (${identifier})\(\{groups:e,getRecencyAt:t,projectOrder:n,sortMode:codexLinuxProjectSortMode\}\)\{if\(codexLinuxProjectSortMode!==\`updated_at\`\)return (${identifier})\(e,n\);`,
  "g",
);

function allMatches(source, pattern) {
  return [...source.matchAll(new RegExp(pattern.source, pattern.flags))];
}

// Bind the unpinned group filter and adjacent projectless sorter to the same
// normalized sidebar items. Recency now comes from the upstream key resolver.
function sorterCallPattern(sorterName, patched = false) {
  const added = patched ? String.raw`,getRecencyAt:(${identifier}),sortMode:(${identifier})` : "";
  return new RegExp(
    String.raw`${escapeRegExp(sorterName)}\(\{groups:${identifier}\(\{groups:${identifier},items:(${identifier})\}\),projectOrder:${identifier}\(${identifier},${identifier}\.PROJECT_ORDER\)${added}\}\)`,
    "g",
  );
}

function callContext(source, call) {
  const prefix = source.slice(Math.max(0, call.index - 1500), call.index);
  const modes = [...prefix.matchAll(new RegExp(String.raw`\{chatSortMode:${identifier},projectSortMode:(${identifier})\}=${identifier}\(${identifier}\)`, "g"))];
  const tail = source.slice(call.index + call[0].length);
  const resolver = tail.match(new RegExp(
    String.raw`^,${identifier}=${identifier}\(\{explicitChatThreadKeys:${identifier},getRecencyAt:(${identifier}),items:${escapeRegExp(call[1])},projectGroups:${identifier},projectlessThreadIds:new Set\(${identifier}\?\?\[\]\)\}\)`,
  ));
  return modes.length === 1 && resolver ? { mode: modes[0][1], recency: resolver[1] } : null;
}

function patchedGroupSorter(sorterName, orderFunction) {
  return `function ${sorterName}({groups:e,getRecencyAt:t,projectOrder:n,sortMode:codexLinuxProjectSortMode}){if(codexLinuxProjectSortMode!==\`updated_at\`)return ${orderFunction}(e,n);return e.map((e,n)=>({group:e,index:n,recencyAt:e.threadKeys.reduce((e,n)=>Math.max(e,t(n)??0),e.projectUpdatedAt??0)})).sort((e,t)=>t.recencyAt-e.recencyAt||e.index-t.index).map(({group:e})=>e)}`;
}

function contract(source) {
  const current = allMatches(source, currentGroupSorterPattern);
  const patched = allMatches(source, patchedGroupSorterPattern);
  if (current.length + patched.length !== 1) return null;
  const isPatched = patched.length === 1;
  const match = (isPatched ? patched : current)[0];
  const [, name, order] = match;
  const calls = allMatches(source, sorterCallPattern(name, isPatched));
  if (calls.length !== 1 || allMatches(source, sorterCallPattern(name, !isPatched)).length !== 0) return null;
  const call = calls[0];
  const context = callContext(source, call);
  if (!context || (isPatched && (call[2] !== context.recency || call[3] !== context.mode))) return null;
  if (isPatched && !source.includes(patchedGroupSorter(name, order))) return null;
  return { isPatched, match, call, context, name, order };
}

function applyProjectGroupLastUpdatedSortPatch(source) {
  const signedPatched = [...source.matchAll(/function\(\{groups:([\w$]+),getRecencyAt:([\w$]+),projectOrder:n,sortMode:([\w$]+)\}\)\{if\(\3!==`updated_at`\)return \(0,([\w$]+)\.([\w$]+)\)\(\1,n\);return \1\.map\(\(e,n\)=>\(\{group:e,index:n,recencyAt:e\.threadKeys\.reduce\(\(e,n\)=>Math\.max\(e,\2\(n\)\?\?0\),e\.projectUpdatedAt\?\?0\)\}\)\)\.sort\(\(e,t\)=>t\.recencyAt-e\.recencyAt\|\|e\.index-t\.index\)\.map\(\(\{group:e\}\)=>e\)\}/g)];
  const signedPatchedCall = signedPatched.length === 1
    ? `getRecencyAt:${signedPatched[0][2]},sortMode:${signedPatched[0][3]}`
    : null;
  if (signedPatchedCall && (source.match(new RegExp(escapeRegExp(signedPatchedCall), "g")) ?? []).length === 1) return source;
  const inlineGroup = /function\(\{groups:([\w$]+),projectOrder:([\w$]+)\}\)\{return\(0,([\w$]+)\.([\w$]+)\)\(([\w$]+),([\w$]+)\)\}/g;
  const helperMatches = [...source.matchAll(inlineGroup)];
  const invocation = /\{groups:([\w$]+)\(\{groups:([\w$]+),items:([\w$]+)\}\),projectOrder:\(0,([\w$]+)\.([\w$]+)\)\(([\w$]+),[\w$]+(?:\.[\w$]+)*\.PROJECT_ORDER\)\}/g;
  const callMatches = [...source.matchAll(invocation)];
  if (helperMatches.length === 1 && callMatches.length === 1) {
    const helper = helperMatches[0];
    const call = callMatches[0];
    const prefix = source.slice(0, helper.index);
    const modeMatches = [...prefix.matchAll(/\{chatSortMode:[\w$]+,projectSortMode:([\w$]+)\}=[\w$.]+\([\w$.]+\)/g)];
    const mode = modeMatches.at(-1)?.[1];
    const selectorTail = modeMatches.length ? prefix.slice(modeMatches.at(-1).index + modeMatches.at(-1)[0].length) : "";
    const recency = selectorTail.match(/,([\w$]+)=e=>/)?.[1];
    const [, groupAlias, orderAlias, moduleAlias, orderFn, helperGroups, helperOrder] = helper;
    if (!mode || !recency || !source.includes(`getRecencyAt:${recency}`)) {
      console.warn("WARN: Could not find current project group sorting insertion points - skipping project group Last updated sort feature patch");
      return source;
    }
    const replacement = `function({groups:${groupAlias},getRecencyAt:${recency},projectOrder:n,sortMode:${mode}}){if(${mode}!==\`updated_at\`)return (0,${moduleAlias}.${orderFn})(${helperGroups},n);return ${groupAlias}.map((e,n)=>({group:e,index:n,recencyAt:e.threadKeys.reduce((e,n)=>Math.max(e,${recency}(n)??0),e.projectUpdatedAt??0)})).sort((e,t)=>t.recencyAt-e.recencyAt||e.index-t.index).map(({group:e})=>e)}`;
    const updatedCall = `${call[0].slice(0, -1)},getRecencyAt:${recency},sortMode:${mode}}`;
    return source.slice(0, helper.index) + replacement + source.slice(helper.index + helper[0].length).replace(call[0], updatedCall);
  }
  const found = contract(source);
  if (!found) {
    console.warn("WARN: Could not find current project group sorting insertion points - skipping project group Last updated sort feature patch");
    return source;
  }
  if (found.isPatched) return source;
  const { match, call, context, name, order } = found;
  return source.replace(match[0], patchedGroupSorter(name, order))
    .replace(call[0], `${call[0].slice(0, -2)},getRecencyAt:${context.recency},sortMode:${context.mode}})`);
}

const descriptors = [{
  id: "last-updated-project-groups",
  phase: "webview-asset",
  order: 20_900,
  ciPolicy: "optional",
  pattern: /^[A-Za-z0-9_-]+\.js$/,
  assetMatch: (source) => {
    if (contract(source) != null) return true;
    const helpers = [...source.matchAll(/function\(\{groups:([\w$]+),projectOrder:([\w$]+)\}\)\{return\(0,[\w$]+\.[\w$]+\)\([\w$]+,[\w$]+\)\}/g)];
    const patched = [...source.matchAll(/function\(\{groups:[\w$]+,getRecencyAt:[\w$]+,projectOrder:[\w$]+,sortMode:[\w$]+\}\)\{if\([\w$]+!==`updated_at`\)return \(0,[\w$]+\.[\w$]+\)\([\w$]+,[\w$]+\);/g)];
    const modes = [...source.matchAll(/\{chatSortMode:[\w$]+,projectSortMode:([\w$]+)\}=[\w$.]+\([\w$.]+\)/g)];
    return modes.length === 1 && ((helpers.length === 1 && /getRecencyAt:[\w$]+,items:[\w$]+,projectGroups:/.test(source)) || (patched.length === 1 && source.includes("sortMode:")));
  },
  missingDescription: "unique project group sort webview bundle",
  skipDescription: "project group Last updated sorting feature patch",
  apply: applyProjectGroupLastUpdatedSortPatch,
}];

module.exports = { applyProjectGroupLastUpdatedSortPatch, descriptors };
