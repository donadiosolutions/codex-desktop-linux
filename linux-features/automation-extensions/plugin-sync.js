"use strict";

const { findMatchingBrace } = require("../../scripts/patches/lib/minified-js.js");

const IDENT = "[A-Za-z_$][\\w$]*";
const MARKER = "codexLinuxSyncAutomationPluginBeforeResume";
const PREPARE = new RegExp(
  `async function (${IDENT})\\((${IDENT})\\)\\{if\\(\\2\\.hostConfig\\.kind!==\`local\`\\|\\|` +
    `(${IDENT}\\.${IDENT}\\(\\2\\.appServerVersion,\`pluginMcpConfigOverrides\`\\))\\)return\\{\\};` +
    `let (${IDENT})=await (${IDENT})\\(`,
  "gu",
);
const PATCHED_PREPARE = new RegExp(
  `async function (${IDENT})\\((${IDENT})\\)\\{if\\(\\2\\.hostConfig\\.kind!==\`local\`\\)return\\{\\};` +
    `await (${IDENT})\\(\\2\\);/\\*${MARKER}\\*/if\\(` +
    `(${IDENT}\\.${IDENT}\\(\\2\\.appServerVersion,\`pluginMcpConfigOverrides\`\\))\\)return\\{\\};` +
    `let (${IDENT})=await (${IDENT})\\(`,
  "gu",
);

function synchronizationOwner(source, builder) {
  const prefix = new RegExp(
    `async function (${IDENT})\\((${IDENT})\\)\\{let\\{appServerConnection:(${IDENT})\\}=\\2;` +
      `if\\(\\3\\.hostConfig\\.kind!==\`local\`\\)return;`,
    "gu",
  );
  const owners = [...source.matchAll(prefix)].filter((match) => {
    const open = source.indexOf("{", match.index);
    const close = findMatchingBrace(source, open);
    if (close === -1) return false;
    const body = source.slice(open, close + 1);
    return body.includes(`${builder}({useWsl:`) &&
      body.includes("JSON.stringify({mcpServers:{codex_app:") &&
      body.includes("`.mcp.json`") &&
      body.includes(`${match[3]}.sendAppServerRequest(\`config/batchWrite\`,{edits:[]`);
  });
  return owners.length === 1 ? owners[0][1] : null;
}

function prepareCallers(source, name, patched) {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const calls = new RegExp(
    `await ${escapedName}\\(\\{hostConfig:(${IDENT}(?:\\.hostConfig)?),` +
      `appServerVersion:(${IDENT})\\.appServerVersion${patched ? ",appServerConnection:\\2" : ""}\\}\\)`,
    "gu",
  );
  const matches = [...source.matchAll(calls)];
  if (matches.length !== 2) {
    throw new Error("Automation plugin synchronization patch did not match both Desktop callers");
  }
  if (patched) return source;
  return source.replace(calls, (_match, host, client) =>
    `await ${name}({hostConfig:${host},appServerVersion:${client}.appServerVersion,appServerConnection:${client}})`);
}

function applyAutomationPluginSyncPatch(source) {
  if (!source.includes("pluginMcpConfigOverrides") && !source.includes(MARKER)) return source;
  const fail = () => { throw new Error("Automation plugin synchronization patch did not match the current bundle exactly once"); };
  if (source.includes(MARKER)) {
    const matches = [...source.matchAll(new RegExp(PATCHED_PREPARE.source, "gu"))];
    if (source.split(MARKER).length !== 2 || matches.length !== 1 ||
        synchronizationOwner(source, matches[0][6]) !== matches[0][3]) fail();
    return prepareCallers(source, matches[0][1], true);
  }
  const matches = [...source.matchAll(new RegExp(PREPARE.source, "gu"))];
  if (matches.length !== 1) fail();
  const [match] = matches;
  const [, name, argument, versionCheck, config, builder] = match;
  const sync = synchronizationOwner(source, builder);
  if (sync == null) fail();
  const replacement = `async function ${name}(${argument}){if(${argument}.hostConfig.kind!==\`local\`)return{};` +
    `await ${sync}(${argument});/*${MARKER}*/if(${versionCheck})return{};let ${config}=await ${builder}(`;
  const patched = source.slice(0, match.index) + replacement + source.slice(match.index + match[0].length);
  return prepareCallers(patched, name, false);
}

module.exports = { applyAutomationPluginSyncPatch };
