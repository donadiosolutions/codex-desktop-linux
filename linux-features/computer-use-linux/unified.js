"use strict";

const { escapeRegExp, findMatchingBrace } = require("../../scripts/patches/lib/minified-js.js");

const ID = "[A-Za-z_$][\\w$]*";
const ROOT_KEY = "codexLinuxCuaPluginRoot";
const CONTEXT_KEY = "codexLinuxCuaContext";
const ROOT_PLACEHOLDER = "\u0000ROOT\u0000";
// rspack chunk modules: `exports.modules={123(e,t,r){...},456(e){...}}`.
const MODULE_HEADER = /(?:modules=\{|\},)\d+\([\w$]+(?:,[\w$]+){0,2}\)\{/g;

function drift(description) {
  return new Error(`Linux unified Computer Use contract drift: ${description}`);
}

function uniqueMatch(source, pattern, description) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw drift(description);
  return matches[0];
}

function countUsages(source, name, ignoreCalls = false) {
  // Include bare references as well as calls so an added alias/export fails
  // closed. Property accesses such as constants.Aa and private class members
  // such as #Aa are different bindings.
  // Current rspack modules also embed large serialized tables. Scan JavaScript
  // tokens so identifier-shaped data in strings, comments, and regexes does
  // not look like a consumer of a short minified binding.
  let uses = 0;
  let previousToken = null;
  for (let index = 0; index < source.length;) {
    const char = source[index];
    if (/\s/u.test(char)) { index += 1; continue; }
    if (char === "/" && source[index + 1] === "/") {
      index = source.indexOf("\n", index + 2);
      if (index < 0) break;
      continue;
    }
    if (char === "/" && source[index + 1] === "*") {
      index = source.indexOf("*/", index + 2);
      if (index < 0) break;
      index += 2;
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      const quote = char;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") index += 2;
        else if (source[index++] === quote) break;
      }
      previousToken = "literal";
      continue;
    }
    const regexPrefix = previousToken == null || /^(?:return|throw|case|delete|void|typeof|instanceof|in)$/u.test(previousToken) ||
      /^[([{,:;=!?&|+*%^~<>-]$/u.test(previousToken);
    if (char === "/" && regexPrefix) {
      let inClass = false;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") index += 2;
        else if (source[index] === "[") { inClass = true; index += 1; }
        else if (source[index] === "]") { inClass = false; index += 1; }
        else if (source[index] === "/" && !inClass) { index += 1; break; }
        else index += 1;
      }
      while (/[a-z]/iu.test(source[index] ?? "")) index += 1;
      previousToken = "literal";
      continue;
    }
    if (/[A-Za-z_$]/u.test(char)) {
      const start = index++;
      while (/[\w$]/u.test(source[index] ?? "")) index += 1;
      const token = source.slice(start, index);
      let next = index;
      while (/\s/u.test(source[next] ?? "")) next += 1;
      const property = source[start - 1] === "." || source[start - 1] === "#" || source[next] === ":";
      if (token === name && !property && (!ignoreCalls || source[next] !== "(")) uses += 1;
      previousToken = token;
      continue;
    }
    previousToken = char;
    index += 1;
  }
  return uses;
}

function requireUsages(source, name, expected) {
  if (countUsages(source, name) !== expected) throw drift(`unexpected ${name} consumers`);
}

// Minified names are module scoped. Restrict every relationship check to the
// rspack module that owns the selector; plain fixtures are one module.
function moduleBounds(source, index) {
  let start = 0;
  let end = source.length;
  for (const header of source.matchAll(MODULE_HEADER)) {
    if (header.index < index) {
      start = header.index;
    } else {
      end = header.index;
      break;
    }
  }
  return { start, end };
}

function rootGuard(name) {
  return `if(typeof ${name}!==\`string\`||${name}.length===0)throw Error(\`Linux Computer Use trusted plugin root is unavailable\`);`;
}

// Chunk files are CommonJS modules, so injected code uses Node's require
// instead of a module-local rspack path alias.
function pluginFile(root, file) {
  return `require("node:path").join(${root},"scripts","${file}")`;
}

function bannerExpression(root) {
  return `'await import("@oai/cua/tinyskyAlt");await(await import('+JSON.stringify(${pluginFile(root, "native-client.mjs")})+")).installLinuxComputerUse(cua);"`;
}

function rootPattern(source) {
  return escapeRegExp(source).replace(escapeRegExp(ROOT_PLACEHOLDER), `(?<pluginRoot>${ID})`);
}

function daemonGuard(source, resume) {
  const resumeOwner = enclosingFunction(source, resume.index);
  if (resumeOwner == null) throw drift("expected a thread configuration owner");
  const resumeSource = source.slice(resumeOwner.start, resumeOwner.end);
  const selection = escapeRegExp(resume.groups.selection);
  const threadGuard = uniqueMatch(resumeSource, new RegExp(
    `null!=(?<node>${ID})&&null!=(?<identity>${ID})` +
    `(?<daemon>&&"1"===(?:${ID}\\(\\)|process)\\.env\\.CODEX_APP_SERVER_USE_LOCAL_DAEMON)?` +
    `&&\\(${ID}\\[\`mcp_servers\\.\\$\\{${ID}\\.${ID}\\}\`\\]=${ID}\\(\\{browserBackends:${selection}\\.browserBackends,`, "g"),
  "expected local identity guards on the thread configuration builder");
  const daemon = threadGuard.groups.daemon;
  return daemon == null ? null : {
    index: resumeOwner.start + threadGuard.index + threadGuard[0].indexOf(daemon), length: daemon.length,
  };
}

function enclosingFunction(source, targetIndex) {
  const functions = /(?:async )?function(?: [A-Za-z_$][\w$]*)?\([^)]*\)\{/gu;
  let owner = null;
  for (const candidate of source.matchAll(functions)) {
    if (candidate.index > targetIndex) break;
    const open = candidate.index + candidate[0].length - 1;
    const close = findMatchingBrace(source, open);
    if (close >= targetIndex) owner = { start: candidate.index, end: close + 1 };
  }
  return owner;
}

function freshBuilderRoot(source) {
  const identifiers = new Set(source.match(/[A-Za-z_$][\w$]*/g));
  const base = ROOT_KEY;
  let name = base;
  for (let suffix = 1; identifiers.has(name); suffix += 1) name = `${base}${suffix}`;
  return name;
}

function sharedPluginLifecycle(source, builder) {
  const builderName = escapeRegExp(builder);
  const writer = uniqueMatch(source, new RegExp(
    String.raw`async function (?<writer>${ID})\((?<fileRoot>${ID}),(?<options>${ID})(?<stable>,(?<stableRoot>${ID})=\k<fileRoot>)?\)\{let (?<file>${ID})=${ID}\(\)\.join\(\k<fileRoot>,"\.mcp\.json"\),(?<raw>${ID})=await \(0,${ID}\.readFile\)\(\k<file>,"utf8"\),(?<parsed>${ID})=${ID}\.parse\(JSON\.parse\(\k<raw>\)\);Object\.assign\(\k<parsed>\.mcpServers\.cua_repl,${builderName}\(\{\.\.\.\k<options>,sharedPlugin:!0\}(?<builderRoot>,${ID})?\)\)`,
    "g",
  ), "expected one shared plugin config writer");
  const writerName = escapeRegExp(writer.groups.writer);
  requireUsages(source, writer.groups.writer, 3);
  requireUsages(source, builder, 3);

  const installed = uniqueMatch(source, new RegExp(
    String.raw`await async function\((?<options>${ID})\)\{let (?<plugin>${ID})=${ID}\(\{marketplaceName:\k<options>\.marketplaceName,marketplaces:\k<options>\.marketplaces,pluginName:${ID}\.${ID}\}\);if\(!\k<plugin>\?\.plugin\.installed\)return!1;let (?<root>${ID})=\(0,${ID}\.${ID}\)\(\{codexHome:\k<options>\.codexHome,localVersion:\k<plugin>\.plugin\.localVersion,marketplaceName:\k<plugin>\.marketplace\.name,pluginName:\k<plugin>\.plugin\.name\}\);return await ${writerName}\(\k<root>,\k<options>\),(?<publish>\k<options>\.${CONTEXT_KEY}\.${ROOT_KEY}=\k<root>,)?null!=\k<options>\.nodeRepl&&\k<options>\.surfaces\.length>0\}`,
    "g",
  ), "expected verified installed plugin synchronization");
  const initialize = enclosingFunction(source, installed.index);
  if (initialize == null) throw drift("expected plugin initialization owner");
  const initializer = source.slice(initialize.start, initialize.end);
  const cached = uniqueMatch(initializer, new RegExp(
    String.raw`(?<executor>${ID})=\((?<enabled>${ID})=${escapeRegExp(installed[0])}\(\{\.\.\.(?<options>${ID}),codexHome:(?<home>${ID}),marketplaceName:(?<marketplace>${ID}),marketplaces:${ID}(?<context>,${CONTEXT_KEY}:(?<receiver>${ID}))?\}\)\)\?structuredClone\(\k<options>\):null`,
    "g",
  ), "expected cached shared plugin launch configuration");
  const localPluginSync = [...initializer.matchAll(new RegExp(String.raw`if\("local"===${ID}\.hostConfig\.kind\)\{`, "g"))]
    .filter(match => match.index < cached.index &&
      findMatchingBrace(initializer, match.index + match[0].length - 1) >= cached.index + cached[0].length);
  if (localPluginSync.length !== 1) throw drift("expected installed plugin synchronization to be local");
  const selection = uniqueMatch(initializer, new RegExp(
    String.raw`\{selection:(?<selection>${ID}),cuaReplEnabled:${escapeRegExp(cached.groups.enabled)},executorLaunch:${escapeRegExp(cached.groups.executor)},confirmationPolicyConfig:${ID}`,
    "g",
  ), "expected synchronized selection and executor state in the cache").groups.selection;
  uniqueMatch(initializer.slice(0, cached.index), new RegExp(
    String.raw`\{codexHome:${escapeRegExp(cached.groups.home)},marketplaceName:${escapeRegExp(cached.groups.marketplace)}(?:,${ID}:${ID})*\}=${escapeRegExp(selection)}(?=,|;)`,
    "g",
  ), "expected plugin synchronization to use the cached selection's marketplace");
  if (cached.groups.context != null && cached.groups.receiver !== selection) {
    throw drift("shared plugin root receiver is not the cached selection");
  }

  const executor = uniqueMatch(source, new RegExp(
    String.raw`let (?<temp>${ID})=await \(0,(?<fs>${ID})\.mkdtemp\)\(${ID}\(\)\.join\(${ID},"\.staging-"\)\);try\{await \(0,\k<fs>\.cp\)\(${ID}\.path,\k<temp>,\{recursive:!0\}\),await ${writerName}\(\k<temp>,(?<options>${ID})(?<stable>,(?<stableRoot>${ID}))?\);try\{await \(0,\k<fs>\.rename\)\(\k<temp>,(?<final>${ID})\)\}`,
    "g",
  ), "expected executor staging to rename the shared plugin");

  const resume = uniqueMatch(source, new RegExp(
    String.raw`(?<![\w$.#])${builderName}\(\{browserBackends:(?<selection>${ID})\.browserBackends,deferTools:\k<selection>\.desktopFeatureAvailability\.deferCuaTools,confirmationPolicyConfig:(?<cache>${ID})\.confirmationPolicyConfig,omitCuaConfirmationPolicyBySku:\k<selection>\.desktopFeatureAvailability\.omitCuaConfirmationPolicyBySku,surfaces:\k<selection>\.cuaReplSurfaces,nodeRepl:${ID}\}(?<root>,\k<selection>\.${ROOT_KEY})?\)`,
    "g",
  ), "expected one shared thread configuration builder call");
  const resumeOwner = enclosingFunction(source, resume.index);
  if (resumeOwner == null) throw drift("expected thread configuration owner");
  const resumeSource = source.slice(resumeOwner.start, resumeOwner.end);
  const resumeSelection = escapeRegExp(resume.groups.selection);
  const resumeCache = escapeRegExp(resume.groups.cache);
  uniqueMatch(resumeSource, new RegExp(
    String.raw`(?<local>${ID})="local"===${ID}\.hostConfig\.kind,[^;]*${ID}=\k<local>\?await ${ID}\.getAuthenticatedPrincipal\(\)\.catch\(\(\)=>null\):null,${resumeSelection}=${resumeCache}\?\.selection\?\?await ${ID}\(`,
    "g",
  ), "expected shared thread configuration to reuse a cached local selection");
  const reassignments = [...resumeSource.matchAll(new RegExp(`(?<![\\w$.#])${resumeSelection}=(?!=)`, "g"))];
  const copies = [...resumeSource.matchAll(new RegExp(`(?<![\\w$.#])${resumeSelection}=\\{\\.\\.\\.${resumeSelection},`, "g"))];
  if (reassignments.length !== 1 + copies.length) throw drift("thread configuration replaces the cached selection");
  const daemon = daemonGuard(source, resume);

  const current = writer.groups.stable == null && writer.groups.builderRoot == null &&
    installed.groups.publish == null && cached.groups.context == null && executor.groups.stable == null &&
    resume.groups.root == null && daemon != null;
  const patched = writer.groups.stable != null && writer.groups.builderRoot === "," + writer.groups.stableRoot &&
    installed.groups.publish != null && cached.groups.context != null && executor.groups.stableRoot === executor.groups.final &&
    resume.groups.root != null && daemon == null;
  if (!current && !patched) throw drift("incomplete shared plugin root propagation");
  const cachedSource = cached[0].replace(
    "return await " + writer.groups.writer + "(" + installed.groups.root + "," + installed.groups.options + "),",
    match => `${match}${installed.groups.options}.${CONTEXT_KEY}.${ROOT_KEY}=${installed.groups.root},`,
  ).replace(/\}\)\)\?structuredClone/, () => `,${CONTEXT_KEY}:${selection}}))?structuredClone`);
  const stableRoot = freshBuilderRoot(writer[0]);
  const edits = current ? [
    { ...daemon, replacement: "" },
    {
      index: writer.index, length: writer[0].length,
      replacement: writer[0].replace("){let ", () => `,${stableRoot}=${writer.groups.fileRoot}){let `)
        .replace(/\}\)\)$/, `},${stableRoot}))`),
    },
    {
      index: initialize.start + cached.index, length: cached[0].length,
      replacement: cachedSource,
    },
    {
      index: executor.index, length: executor[0].length,
      replacement: executor[0].replace(
        `await ${writer.groups.writer}(${executor.groups.temp},${executor.groups.options})`,
        call => call.slice(0, -1) + `,${executor.groups.final})`,
      ),
    },
    {
      index: resume.index, length: resume[0].length,
      replacement: resume[0].slice(0, -1) + `,${resume.groups.selection}.${ROOT_KEY})`,
    },
  ] : [];
  return { current, patched, edits };
}

function selectorPattern() {
  return /(?<native>[\w$]+)=(?<ready>[\w$]+)&&(?<features>[\w$]+)\.computerUse&&(?<legacy>[\w$]+)\.enabled&&\("win32"===(?<runtime>[\w$]+)\.platform\|\|"darwin"===\k<runtime>\.platform&&null!=\k<legacy>\.paths\.serviceAppPath\)(?<linux>\|\|\k<ready>&&"linux"===\k<runtime>\.platform&&\k<features>\.computerUse&&\k<legacy>\.enabled)?,(?<mode>[\w$]+)=(?<modeLinux>"linux"===\k<runtime>\.platform\?\k<native>:)?(?<modeValue>\k<features>\.computerUse&&\(!\k<features>\.browserUseTinysky\|\|"darwin"!==\k<runtime>\.platform\|\|\k<legacy>\.enabled\))(?=,)/g;
}

function applyUnifiedComputerUsePatch(chunk) {
  if (!chunk.includes("cuaReplSurfaces")) {
    // The rspack main process spans several chunks; only one owns CUA setup.
    console.warn("WARN: Could not find the unified Computer Use surface selector - skipping Linux unified Computer Use patch");
    return chunk;
  }
  // Match the current selector, including variable relationships. Both pristine
  // and patched forms must have exactly one owner; drift must abort the build.
  const ownersPattern = /[\w$]+=[\w$]+&&[\w$]+\.computerUse&&[\w$]+\.enabled&&\("win32"===[\w$]+\.platform\|\|"darwin"===[\w$]+\.platform&&null!=[\w$]+\.paths\.serviceAppPath/g;
  const chunkSelectors = [...chunk.matchAll(selectorPattern())];
  if (chunkSelectors.length !== 1 || [...chunk.matchAll(ownersPattern)].length !== 1 || !chunk.includes("cuaReplSurfaces:")) {
    throw drift("expected one native surface selector");
  }
  const bounds = moduleBounds(chunk, chunkSelectors[0].index);
  const source = chunk.slice(bounds.start, bounds.end);
  const patchedModule = applyUnifiedComputerUseModulePatch(source);
  return patchedModule === source ? chunk : chunk.slice(0, bounds.start) + patchedModule + chunk.slice(bounds.end);
}

function applyUnifiedComputerUseModulePatch(source) {
  const match = uniqueMatch(source, selectorPattern(), "expected one native surface selector");
  const { native, ready, runtime, features, legacy, mode, modeValue, linux, modeLinux } = match.groups;
  if (Boolean(linux) !== Boolean(modeLinux)) throw drift("partial native selector patch");
  // The signed package shares a config builder between plugin synchronization
  // and per-thread configuration. Publish synchronization's verified root in
  // its cached selection, then pass that context through both builder calls.
  const builder = uniqueMatch(source, new RegExp(
    `function (?<builder>[\\w$]+)\\(\\{browserBackends:(?<backends>[\\w$]+),deferTools:(?<defer>[\\w$]+),` +
      `confirmationPolicyConfig:${ID}="\\{\\}",` +
      `omitCuaConfirmationPolicyBySku:[\\w$]+,surfaces:(?<surfaces>[\\w$]+),nodeRepl:(?<nodeRepl>[\\w$]+),` +
      `sharedPlugin:${ID}=!1\\}(?<rootParam>,(?<pluginRoot>[\\w$]+))?\\)\\{`,
    "g",
  ), "expected one native config builder");
  const builderOwner = enclosingFunction(source, builder.index);
  if (builderOwner == null || builderOwner.start !== builder.index) throw drift("expected one native config builder");
  const builderSource = source.slice(builderOwner.start, builderOwner.end);
  const { surfaces, nodeRepl } = builder.groups;
  const currentServices = [...builderSource.matchAll(new RegExp(
    `${surfaces}\\.includes\\("computer"\\)&&\\((?<services>[\\w$]+)\\.sky="@oai/sky/service"\\)`, "g"))];
  const patchedServices = [...builderSource.matchAll(new RegExp(
    `${surfaces}\\.includes\\("computer"\\)&&\\((?<services>[\\w$]+)\\.sky=` +
      `${rootPattern(pluginFile(ROOT_PLACEHOLDER, "native-service.mjs"))}\\)`, "g"))];
  // Optional audio environment block; carried through unchanged.
  const audioEnvironmentPattern =
    `(?<audio>\\.\\.\\.${nodeRepl}\\?\\.env\\.SKY_[A-Z_]+==="1"\\?\\{` +
    `SKY_ENABLE_AUDIO:${surfaces}\\.includes\\("computer"\\)\\?"1":"0",` +
    `[^{}]*\\}:\\{\\},)`;
  const environmentPrefix =
    `\\{(?<prefix>\\.\\.\\.${nodeRepl}\\?\\.env,(?:[^{}]|\\{[^{}]*\\}){0,500}?)` +
    `CUA_REPL_ENABLED_SURFACES:${surfaces}\\.join\\(","\\),`;
  const servicesEnvironment = `\\[(?<constants>[\\w$]+)\\.(?<constant>[\\w$]+)\\]:JSON\\.stringify\\((?<services>[\\w$]+)\\)`;
  const currentBanners = [...builderSource.matchAll(new RegExp(
    environmentPrefix + audioEnvironmentPattern + servicesEnvironment, "g"))];
  const patchedBanners = [...builderSource.matchAll(new RegExp(
    environmentPrefix + "CODEX_LINUX_CUA_HOST_SOCKET:process\\.env\\.CODEX_LINUX_CUA_HOST_SOCKET," +
      `NODE_REPL_JS_BANNER:${rootPattern(bannerExpression(ROOT_PLACEHOLDER))},` +
      audioEnvironmentPattern + servicesEnvironment, "g"))];
  // The packaged cua-repl instructions path rebuilds the environment but keeps
  // caller-provided trusted services and banner; anything else drops the bridge.
  const bannerKeys = builderSource.split("NODE_REPL_JS_BANNER:").length - 1;
  const serviceKeys = builderSource.split("NODE_REPL_TRUSTED_SERVICES:").length - 1;
  const bannerFallback = [...builderSource.matchAll(new RegExp(
    `NODE_REPL_JS_BANNER:(${ID})\\.NODE_REPL_JS_BANNER\\?\\?`, "g"))];
  const serviceFallback = [...builderSource.matchAll(new RegExp(
    `NODE_REPL_TRUSTED_SERVICES:(${ID})\\.NODE_REPL_TRUSTED_SERVICES\\?\\?`, "g"))];
  if (bannerFallback.length !== 1 || serviceFallback.length !== 1 || serviceKeys !== 1 ||
      bannerKeys !== 1 + patchedBanners.length) {
    throw drift("packaged cua-repl environment no longer preserves the native bridge");
  }
  if (countUsages(builderSource, "require", true) !== 0) {
    throw drift("native config builder shadows require");
  }
  const lifecycle = sharedPluginLifecycle(source, builder.groups.builder);
  const current = !linux && builder.groups.rootParam == null && lifecycle.current &&
    currentServices.length === 1 && patchedServices.length === 0 &&
    currentBanners.length === 1 && patchedBanners.length === 0;
  const patched = Boolean(linux) && builder.groups.rootParam != null && lifecycle.patched &&
    currentServices.length === 0 && patchedServices.length === 1 &&
    currentBanners.length === 0 && patchedBanners.length === 1;
  if (!current && !patched) throw drift("expected one native trusted service selector");

  const service = current ? currentServices[0] : patchedServices[0];
  const banner = current ? currentBanners[0] : patchedBanners[0];
  if (banner.groups.services !== service.groups.services) throw drift("changed native banner relationship");
  if (patched && (service.groups.pluginRoot !== builder.groups.pluginRoot ||
      banner.groups.pluginRoot !== builder.groups.pluginRoot ||
      !builderSource.startsWith(builder[0] + rootGuard(builder.groups.pluginRoot)))) {
    throw drift("incomplete trusted root propagation");
  }
  // Shared local app-server connections do not inherit the GUI's daemon launch
  // marker. Preserve local identity/configuration guards and carry their
  // per-thread browser access environment into CUA for either local transport.
  if (patched) return source;
  // Caller and helper have independent minified scopes. A caller alias can be
  // an existing destructured parameter or local in the helper. Use a fresh
  // helper binding, including nested scopes that capture the injected value.
  const builderRoot = freshBuilderRoot(builderSource);
  const edits = [
    ...lifecycle.edits,
    {
      index: match.index,
      length: match[0].length,
      replacement:
        `${native}=${ready}&&${features}.computerUse&&${legacy}.enabled&&("win32"===${runtime}.platform||"darwin"===${runtime}.platform&&null!=${legacy}.paths.serviceAppPath)` +
        `||${ready}&&"linux"===${runtime}.platform&&${features}.computerUse&&${legacy}.enabled,` +
        `${mode}="linux"===${runtime}.platform?${native}:${modeValue}`,
    },
    {
      index: builderOwner.start + service.index,
      length: service[0].length,
      replacement: `${surfaces}.includes("computer")&&(${service.groups.services}.sky=${pluginFile(builderRoot, "native-service.mjs")})`,
    },
    {
      index: builderOwner.start + banner.index,
      length: banner[0].length,
      replacement:
        `{${banner.groups.prefix}CUA_REPL_ENABLED_SURFACES:${surfaces}.join(","),` +
        "CODEX_LINUX_CUA_HOST_SOCKET:process.env.CODEX_LINUX_CUA_HOST_SOCKET," +
        `NODE_REPL_JS_BANNER:${bannerExpression(builderRoot)},` +
        banner.groups.audio +
        `[${banner.groups.constants}.${banner.groups.constant}]:JSON.stringify(${banner.groups.services})`,
    },
    {
      index: builder.index + builder[0].length - 2,
      length: 1,
      replacement: `,${builderRoot})`,
    },
    {
      index: builder.index + builder[0].length,
      length: 0,
      replacement: rootGuard(builderRoot),
    },
  ];
  let patchedSource = source;
  for (const edit of edits.sort((left, right) => right.index - left.index)) {
    patchedSource = patchedSource.slice(0, edit.index) + edit.replacement +
      patchedSource.slice(edit.index + edit.length);
  }
  return patchedSource;
}

module.exports = { applyUnifiedComputerUsePatch };
