"use strict";

const { escapeRegExp, findMatchingBrace } = require("../../scripts/patches/lib/minified-js.js");
const { applyAutomationPluginSyncPatch } = require("./plugin-sync.js");

const IDENT = "[A-Za-z_$][\\w$]*";
const MARKER = "codexLinuxForwardAutomationPipe";
const PIPE_NAME = "CODEX_APP_TOOLS_PIPE_PATH";
const CONFIG_FUNCTION = new RegExp(
  `async function ${IDENT}\\(\\{useWsl:${IDENT},resourcesPath:${IDENT}=process\\.resourcesPath\\}\\)\\{` +
    `if\\(!process\\.env\\[(${IDENT})\\]\\)return ${IDENT}\\("missing-pipe"\\);`, "gu",
);

function findPipeContracts(source, patched) {
  const targets = [];
  for (const match of source.matchAll(CONFIG_FUNCTION)) {
    const pipe = match[1];
    const definitions = [...source.matchAll(new RegExp(`(?:let |var |const |,)${escapeRegExp(pipe)}="${PIPE_NAME}"(?=[,;])`, "gu"))];
    if (definitions.length !== 1) continue;
    const open = match.index + match[0].lastIndexOf("{");
    const close = findMatchingBrace(source, open);
    if (close === -1) continue;
    const body = source.slice(open, close + 1);
    const servers = [...body.matchAll(new RegExp(`mcpServers:\\{codex_app:(${IDENT})\\}\\}=`, "gu"))];
    if (servers.length !== 1) continue;
    const server = servers[0][1];
    const insertion = patched ? `,${PIPE_NAME}:process.env[${pipe}]/*${MARKER}*/` : "";
    const escaped = insertion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const environments = [...body.matchAll(new RegExp(
      `let (${IDENT})=\\{\\.\\.\\.${escapeRegExp(server)}\\.env${escaped},CODEX_APP_TOOLS_DEFERRED:${IDENT}\\?"1":"0"\\},`, "gu",
    ))];
    if (environments.length !== 1 || !body.includes(`env:${environments[0][1]}`)) continue;
    targets.push({ start: open + environments[0].index, original: environments[0][0], server, pipe });
  }
  return targets;
}

function applyAutomationPluginPipeForwardPatch(source) {
  const markerCount = source.split(MARKER).length - 1;
  if (markerCount !== 0) {
    if (markerCount === 1 && findPipeContracts(source, true).length === 1 && findPipeContracts(source, false).length === 0) return source;
    throw new Error("Automation plugin pipe patch did not match the current bundle exactly once");
  }
  const targets = findPipeContracts(source, false);
  if (targets.length !== 1) throw new Error("Automation plugin pipe patch did not match the current bundle exactly once");
  const { start, original, server, pipe } = targets[0];
  const replacement = original.replace(`...${server}.env`,
    `...${server}.env,${PIPE_NAME}:process.env[${pipe}]/*${MARKER}*/`);
  return source.slice(0, start) + replacement + source.slice(start + original.length);
}

function applyAutomationPluginPipePatch(source) {
  return applyAutomationPluginSyncPatch(applyAutomationPluginPipeForwardPatch(source));
}

module.exports = { applyAutomationPluginPipePatch };
