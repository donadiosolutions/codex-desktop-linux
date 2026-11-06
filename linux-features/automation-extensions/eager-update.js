"use strict";

// The dynamic Codex app tool catalog marks deferred tools with
// `deferLoading:!0`. Keep automation_update eager so the model can update an
// automation without first discovering the tool.
const { escapeRegExp, findMatchingBrace } = require("../../scripts/patches/lib/minified-js.js");

const IDENT = "[A-Za-z_$][\\w$]*";
const AUTOMATION_UPDATE_EAGER_TOOL_ASSET_NEEDLES = ["deferLoading:!0", "eagerToolNames:", "deferredToolNames:"];
const EAGER = new RegExp(
  `${IDENT}\\.name!=="automation_update"&&${IDENT}&&\\(!${IDENT}\\.has\\(${IDENT}\\.name\\)\\|\\|${IDENT}\\.includes\\(${IDENT}\\.name\\)\\)`,
  "gu",
);
const DYNAMIC = new RegExp(
  `\\.map\\((${IDENT})=>\\(\\{type:"function",\\.\\.\\.\\1,\\.\\.\\.(` +
    `${IDENT}&&\\(!${IDENT}\\.has\\(\\1\\.name\\)\\|\\|${IDENT}\\.includes\\(\\1\\.name\\)\\)` +
    `)\\?\\{deferLoading:!0\\}:\\{\\}\\}\\)\\)`,
  "gu",
);

const AUTOMATION_PLUGIN_ENABLE_MARKER = "codexLinuxEnableAutomationPluginTransport";
const AUTOMATION_PLUGIN_ENABLED_TOOL_KEYS = [
  "plugins.codex-app-tools@openai-bundled.mcp_servers.codex_app.enabled_tools",
  "mcp_servers.codex_app.enabled_tools",
];
const DESKTOP_MCP_CONFIG_PREFIX = new RegExp(
  `(${IDENT})\\.usesDesktopMcp&&\\((${IDENT})\\.config=\\{\\.\\.\\.\\2\\.config,\\[(${IDENT}\\((${IDENT})\\.getAppServerVersion\\(\\)\\))\\]:`,
  "gu",
);

function count(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function matchesAutomationUpdateEagerToolContract(source) {
  return count(source, EAGER) + count(source, DYNAMIC) === 1;
}

function applyAutomationUpdateEagerToolPatch(source) {
  const eager = count(source, EAGER);
  const dynamic = count(source, DYNAMIC);
  if (eager === 1 && dynamic === 0) return source;
  if (eager !== 0 || dynamic !== 1) {
    console.warn("WARN: Could not find unique dynamic tools construction point — skipping automation_update eager tool patch");
    return source;
  }
  return source.replace(
    DYNAMIC,
    (_match, tool, deferCondition) =>
      `.map(${tool}=>({type:"function",...${tool},...${tool}.name!=="automation_update"&&${deferCondition}?{deferLoading:!0}:{}}))`,
  );
}

function findAutomationPluginConfigAssignments(source) {
  return [...source.matchAll(new RegExp(DESKTOP_MCP_CONFIG_PREFIX.source, "gu"))];
}

function enclosingAsyncFunction(source, index) {
  const candidates = [
    ...source.slice(0, index + 1).matchAll(new RegExp(`async function ${IDENT}\\(`, "gu")),
  ];
  for (const candidate of candidates.reverse()) {
    const parametersOpen = source.indexOf("(", candidate.index);
    let depth = 0;
    let parametersClose = -1;
    for (let cursor = parametersOpen; cursor < source.length; cursor += 1) {
      if (source[cursor] === "(") depth += 1;
      if (source[cursor] === ")" && --depth === 0) {
        parametersClose = cursor;
        break;
      }
    }
    const open = parametersClose + 1;
    const close = findMatchingBrace(source, open);
    if (parametersOpen !== -1 && parametersClose !== -1 && source[open] === "{" && close >= index) {
      return { open, close };
    }
  }
  return null;
}

function hasDynamicToolFlatteningContract(source, match, configBody) {
  const owner = enclosingAsyncFunction(source, match.index);
  if (owner == null) return false;
  const prefix = source.slice(owner.open + 1, match.index);
  const direct = new RegExp(
    `:\\s*(${IDENT})\\.map\\(\\(\\{name:(${IDENT})\\}\\)=>\\2\\)`,
    "u",
  ).exec(configBody);
  const indirect = direct == null
    ? new RegExp(`:\\s*(${IDENT})(?=[,}])`, "u").exec(configBody)
    : null;
  if (direct == null && indirect == null) return false;

  const configValue = direct?.[1] ?? indirect[1];
  const escapedConfigValue = configValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mapping = direct == null
    ? [...prefix.matchAll(new RegExp(
      `(?:let |const |var |,)${escapedConfigValue}=(${IDENT})\\.map\\(\\(\\{name:(${IDENT})\\}\\)=>\\2\\)`,
      "gu",
    ))]
    : null;
  if (mapping != null && mapping.length !== 1) return false;
  const names = direct?.[1] ?? mapping?.[0]?.[1];
  if (names == null) return false;
  const escaped = names.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `(?:let |const |var |,)${escaped}=${IDENT}\\.flatMap\\((${IDENT})=>` +
      `\\1\\.type===\`namespace\`\\?\\1\\.tools:\\[\\1\\]\\)`,
    "u",
  ).test(prefix);
}

function hasAutomationPluginEnabledToolsKeyContract(source) {
  return AUTOMATION_PLUGIN_ENABLED_TOOL_KEYS.every((key) => source.includes(key));
}

function matchesAutomationPluginEnableContract(source) {
  return source.includes(AUTOMATION_PLUGIN_ENABLE_MARKER) ||
    hasAutomationPluginEnabledToolsKeyContract(source) &&
      findAutomationPluginConfigAssignments(source).length === 1 ||
    matchesCurrentAutomationToolOwner(source);
}

function matchesCurrentAutomationToolOwner(source) {
  if (!source.includes("__webpack_modules__") || !source.includes("automation_update") || count(source, EAGER) !== 1) return false;
  const factories = rspackFactories(source);
  const owners = factories.flatMap(factory => {
    if (factory.require == null) return [];
    const namedDefinitions = [...factory.body.matchAll(new RegExp(
      `(${IDENT})="automation_update";function (${IDENT})\\(\\)\\{return null==(${IDENT})&&\\(\\3=\\{name:\\1,`, "gu"))];
    const exportMatches = [...factory.body.matchAll(new RegExp(
      `${escapeRegExp(factory.require)}\\.d\\(${escapeRegExp(factory.exports)},\\{([^}]*)\\}`, "gu"))];
    const named = namedDefinitions.flatMap(([, nameVariable, toolFunction]) => {
      const exported = exportMatches.flatMap(([, entries]) => [...entries.matchAll(new RegExp(
        `(${IDENT}):\\(\\)=>${escapeRegExp(toolFunction)}(?:,|$)`, "gu"))]);
      return exported.length === 1 ? [{ ...factory, nameVariable, toolFunction, exportName: exported[0][1] }] : [];
    });
    // Current SWC emits the cached tool factory directly into the value export
    // map. Follow that export, its cache return, and the declared tool name.
    const inlinePattern = new RegExp(
      `${escapeRegExp(factory.require)}\\.d\\(${escapeRegExp(factory.exports)},\\{\\},\\{` +
      `(?:${IDENT}:${IDENT},)*(${IDENT}):function\\(\\)\\{return null==(${IDENT})&&\\(\\2=\\{name:(${IDENT}),`, "gu");
    const inline = [...factory.body.matchAll(inlinePattern)].flatMap(match => {
      const [, exportName, cache, nameVariable] = match;
      const names = [...factory.body.matchAll(new RegExp(
        `(?:let |var |const |,)${escapeRegExp(nameVariable)}="automation_update"(?=[,;])`, "gu"))];
      const open = match.index + match[0].lastIndexOf("function(){") + "function()".length;
      const close = findMatchingBrace(factory.body, open);
      const functionBody = factory.body.slice(open, close + 1);
      if (names.length !== 1 || close < open ||
          !functionBody.endsWith(`}),${cache}}`) || !functionBody.includes("description:") ||
          !functionBody.includes("inputSchema:")) return [];
      return [{ ...factory, nameVariable, exportName }];
    });
    return [...named, ...inline];
  });
  if (owners.length !== 1) return false;
  const owner = owners[0];
  const mapperFactories = factories.filter(({ body }) =>
    body.includes("eagerToolNames") && body.includes('.name!=="automation_update"&&') &&
      body.includes("deferLoading:!0") && /\.map\([^)]*=>\(\{type:["']function["'],/u.test(body));
  if (mapperFactories.length !== 1) return false;
  const ownerId = owner.moduleId;
  const mapperId = mapperFactories[0].moduleId;
  return factories.some(({ body, require: aggregateRequire }) => {
    if (aggregateRequire == null) return false;
    const importPattern = new RegExp(`(?:let |var |const |,)(${IDENT})=${escapeRegExp(aggregateRequire)}\\(["']([^"']+)["']\\)`, "gu");
    const imports = [...body.matchAll(importPattern)];
    const ownerImport = imports.find(([, , id]) => id === ownerId);
    const mapperImport = [...body.matchAll(importPattern)].find(([, , id]) => id === mapperId);
    if (ownerImport == null || mapperImport == null) return false;
    const toolAlias = ownerImport[1], mapperAlias = mapperImport[1];
    const escapedToolAlias = escapeRegExp(toolAlias);
    const escapedMapperAlias = escapeRegExp(mapperAlias);
    const escapedExport = escapeRegExp(owner.exportName);
    const hasToolReference = new RegExp(`\\(0,${escapedToolAlias}\\.${escapedExport}\\)\\(\\)`).test(body);
    const hasMappedCatalog = new RegExp(`\\(0,${escapedMapperAlias}\\.[A-Za-z_$][\\w$]*\\)\\(\\{tools:[^}]*eagerToolNames:[^}]*\\}\\)`).test(body);
    const toolPosition = body.indexOf(`(0,${toolAlias}.${owner.exportName})()`);
    const mapperPosition = body.indexOf(`(0,${mapperAlias}.`);
    const mapperCall = new RegExp(`\\(0,${escapedMapperAlias}\\.([A-Za-z_$][\\w$]*)\\)\\(\\{tools:(${IDENT}),`).exec(body.slice(mapperPosition));
    const toolListBinding = mapperCall?.[2] ?? null;
    const listStart = toolListBinding == null ? -1 : body.lastIndexOf(`${toolListBinding}=`, mapperPosition);
    const listPassed = mapperCall != null && listStart >= 0 && toolPosition > listStart &&
      mapperPosition - listStart < 30_000 && body.slice(listStart, mapperPosition).includes(`(0,${toolAlias}.${owner.exportName})()`);
    return hasToolReference && hasMappedCatalog && listPassed && count(mapperFactories[0].body, EAGER) === 1;
  });
}

function rspackFactories(source) {
  const starts = [...source.matchAll(new RegExp(`(?:^|,)((?:${IDENT})|function)\\(([^)]*)\\)\\{`, "gu"))];
  return starts.flatMap(match => {
    const open = match.index + match[0].lastIndexOf("{");
    const close = findMatchingBrace(source, open);
    if (close <= open) return [];
    const params = match[2].split(",");
    if (params.length < 2 || params.length > 3 || params.some(param => !new RegExp(`^${IDENT}$`).test(param))) return [];
    const body = source.slice(open, close + 1);
    const moduleId = match[1] === "function" ? null : match[1];
    const exports = params[1];
    const require = params[2] ?? null;
    const exportsMap = [...body.matchAll(new RegExp(`(${IDENT})\\.d\\(${exports},\\{([^}]*)\\}`, "gu"))];
    return [{ name: match[1], exports, require, moduleId, body, exportsMap }];
  });
}

function applyAutomationPluginEnablePatch(source) {
  if (source.includes(AUTOMATION_PLUGIN_ENABLE_MARKER)) return source;
  if (matchesCurrentAutomationToolOwner(source)) return source;

  if (!hasAutomationPluginEnabledToolsKeyContract(source)) {
    if (source.includes("codex_app.enabled_tools") || source.includes("codex_app.tools")) {
      console.warn(
        "WARN: Codex app enabled-tools config keys changed — skipping automation plugin enable patch",
      );
    }
    return source;
  }

  const matches = findAutomationPluginConfigAssignments(source);
  if (matches.length !== 1) {
    if (source.includes("mcp_servers.codex_app.enabled_tools")) {
      console.warn(
        "WARN: Could not uniquely identify Desktop MCP enabled-tools config — skipping automation plugin enable patch",
      );
    }
    return source;
  }

  const match = matches[0];
  const objectOpen = source.indexOf("{", match.index + match[0].indexOf(".config="));
  const objectClose = findMatchingBrace(source, objectOpen);
  if (objectOpen === -1 || objectClose === -1 || source[objectClose + 1] !== ")") {
    console.warn(
      "WARN: Could not identify complete Desktop MCP config assignment — skipping automation plugin enable patch",
    );
    return source;
  }

  const configBody = source.slice(objectOpen, objectClose + 1);
  if (!hasDynamicToolFlatteningContract(source, match, configBody)) {
    console.warn(
      "WARN: Desktop MCP config assignment lacks the dynamic tool flattening contract — skipping automation plugin enable patch",
    );
    return source;
  }

  const keyExpression = match[3];
  const enableEntry =
    `,...(e=>{if(typeof e!==\`string\`||!e.endsWith(\`.enabled_tools\`))throw Error(\`Unexpected Codex app enabled-tools config key\`);return{[e.slice(0,-\`.enabled_tools\`.length)+\`.enabled\`]:!0}})(${keyExpression})/*${AUTOMATION_PLUGIN_ENABLE_MARKER}*/`;
  return source.slice(0, objectClose) + enableEntry + source.slice(objectClose);
}

module.exports = {
  AUTOMATION_UPDATE_EAGER_TOOL_ASSET_NEEDLES,
  applyAutomationPluginEnablePatch,
  matchesAutomationPluginEnableContract,
  applyAutomationUpdateEagerToolPatch,
  matchesAutomationUpdateEagerToolContract,
};
