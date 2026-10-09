"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { findMatchingBrace } = require("../../scripts/patches/lib/minified-js.js");
const IDENT = "[A-Za-z_$][\\w$]*";
const markers = ["codexLinuxSubagentSummary", "codexLinuxSubagentActivation",
  "codexLinuxSubagentHydration", "codexLinuxSubagentTurnModel"];

function one(source, pattern) {
  const matches = [...source.matchAll(new RegExp(pattern, "g"))];
  return matches.length === 1 ? matches[0] : null;
}

function block(source, pattern) {
  const match = one(source, pattern);
  if (!match) return null;
  const end = findMatchingBrace(source, match.index + match[0].length - 1);
  if (end < 0) return null;
  return { match, index: match.index, text: source.slice(match.index, end + 1) };
}

function prepare(source) {
  const summary = block(source, `getThreadSummaryFromThread\\((${IDENT})\\)\\{`);
  const activation = block(source, `function ${IDENT}\\((${IDENT})\\)\\{(?=return\\{id:\\1\\.conversationId,)`);
  const hydration = block(source, `async hydrateCollabThreads\\((${IDENT})\\)\\{`);
  const turn = one(source,
    `(${IDENT})===${IDENT}(?:\\.${IDENT})?\\((${IDENT})\\)&&\\((?:/\\*${markers[3]}\\*/)?` +
    `\\2\\.latestModel=\\1\\.params\\.model(?<operator>\\?\\?|\\|\\|)\\2\\.latestModel,` +
    `\\2\\.latestReasoningEffort=\\1\\.params\\.effort\\?\\?\\2\\.latestReasoningEffort,` +
    `\\2\\.latestCollaborationMode=\\1\\.params\\.collaborationMode\\?\\?\\2\\.latestCollaborationMode\\)`);
  if (!summary || !activation || !hydration || !turn) return null;

  const summaryField = one(summary.text, `(?:/\\*${markers[0]}\\*/model:(${IDENT})\\.model,reasoningEffort:\\1\\.reasoningEffort,)?modelProvider:(${IDENT})\\.modelProvider,`);
  const activationField = one(activation.text,
    `(?:/\\*${markers[1]}\\*/)?latestModel:(?:\x60\x60|(${IDENT})\\.model\\?\\?\x60\x60),` +
    `latestReasoningEffort:(?:null|(${IDENT})\\.reasoningEffort\\?\\?null),previousTurnModel:null`);
  const branch = one(hydration.text,
    `let (${IDENT})=this\\.threadsById\\.get\\((${IDENT})\\);` +
    `(?<body>if\\(\\1\\)\\{if\\(this\\.conversations\\.has\\((${IDENT})\\)\\)continue;` +
    `this\\.upsertHydratedCollabReceiverConversation\\(\\1\\);continue\\}|` +
    `/\\*${markers[2]}\\*/if\\(this\\.conversations\\.get\\((${IDENT})\\)\\?\\.latestModel\\)continue;` +
    `if\\(\\1&&typeof \\1\\.model===\x60string\x60&&\\1\\.model.length>0&&\\1\\.reasoningEffort!==void 0\\)\\{` +
    `this\\.upsertHydratedCollabReceiverConversation\\(\\1\\);continue\\})` +
    `(?=this\\.pendingCollabThreadReads\\.has\\(\\2\\)\\|\\|)`);
  if (!summaryField || !activationField || !branch) return null;

  // All four contracts must be pristine or complete together. Never install
  // a subset when an upstream change or duplicate target invalidates one.
  const counts = markers.map((marker) => source.split(marker).length - 1);
  if (counts.some((count) => count > 1) || !counts.every((count) => count === counts[0])) return null;
  const complete = counts[0] === 1;
  const input = activation.match[1];
  const thread = summaryField[2];
  const child = branch[1];
  const id = branch[4] ?? branch[5];
  const replacements = [
    { ...summary, output: summary.text.replace(summaryField[0], () =>
      `/*${markers[0]}*/model:${thread}.model,reasoningEffort:${thread}.reasoningEffort,modelProvider:${thread}.modelProvider,`) },
    { ...activation, output: activation.text.replace(activationField[0], () =>
      `/*${markers[1]}*/latestModel:${input}.model??\`\`,latestReasoningEffort:${input}.reasoningEffort??null,previousTurnModel:null`) },
    { ...hydration, output: hydration.text.replace(branch[0], () =>
      `let ${child}=this.threadsById.get(${branch[2]});/*${markers[2]}*/` +
      `if(this.conversations.get(${id})?.latestModel)continue;` +
      `if(${child}&&typeof ${child}.model===\`string\`&&${child}.model.length>0&&${child}.reasoningEffort!==void 0){` +
      `this.upsertHydratedCollabReceiverConversation(${child});continue}`) },
    { index: turn.index, text: turn[0], output: turn[0]
      .replace(`&&(${complete ? `/*${markers[3]}*/` : ""}`, `&&(/*${markers[3]}*/`)
      .replace(`${turn[1]}.params.model${turn.groups.operator}`, `${turn[1]}.params.model||`) },
  ];
  if (complete && replacements.some(({ text, output }) => text !== output)) return null;
  if (!complete && (activationField[1] || activationField[2] || summaryField[1] || turn.groups.operator !== "??")) return null;
  return { complete, replacements };
}

function applySubagentModelMetadataPatch(source) {
  const prepared = prepare(source);
  if (!prepared) {
    console.warn("WARN: Could not uniquely match the complete subagent model metadata contract");
    return source;
  }
  if (prepared.complete) return source;
  let result = source;
  for (const { index, text, output } of prepared.replacements.sort((a, b) => b.index - a.index)) {
    result = result.slice(0, index) + output + result.slice(index + text.length);
  }
  if (!prepare(result)?.complete) {
    console.warn("WARN: Subagent model metadata patch did not satisfy its complete contract");
    return source;
  }
  return result;
}

function patchApp(extractedDir) {
  const build = path.join(extractedDir, ".vite/build");
  const targets = fs.existsSync(build) ? fs.readdirSync(build)
    .filter((name) => name.endsWith(".js"))
    .map((name) => ({ name, source: fs.readFileSync(path.join(build, name), "utf8") }))
    .filter(({ source }) => source.includes("async hydrateCollabThreads(")) : [];
  if (targets.length !== 1) {
    const reason = `Expected one subagent conversation-store bundle, found ${targets.length}`;
    console.warn(`WARN: ${reason}`);
    return { matched: 0, changed: 0, reason };
  }
  const [{ name, source }] = targets;
  if (!prepare(source)) {
    const reason = "Subagent conversation-store contract is incomplete or ambiguous";
    console.warn(`WARN: ${reason}`);
    return { matched: 0, changed: 0, reason };
  }
  const patched = applySubagentModelMetadataPatch(source);
  if (!prepare(patched)?.complete) {
    return { matched: 0, changed: 0, reason: "Subagent metadata patch validation failed" };
  }
  if (patched !== source) fs.writeFileSync(path.join(build, name), patched);
  return { matched: 1, changed: Number(patched !== source), targets: [`.vite/build/${name}`] };
}

const descriptors = [{
  id: "conversation-store", phase: "extracted-app:pre-webview", order: 20_960,
  ciPolicy: "optional", enforceWhenEnabled: true, apply: patchApp,
  status: (result) => result.matched !== 1
    ? { status: "skipped-optional", reason: result.reason }
    : result.changed ? "applied" : "already-applied",
}];

module.exports = { applySubagentModelMetadataPatch, descriptors };
