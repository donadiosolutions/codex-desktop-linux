"use strict";

const ALIAS = "gpt-daybreak-blue-latest";
const RED_ALIAS = "gpt-daybreak-red-latest";
const CATALOG_MARKER = "codexLinuxDaybreakCatalogVisibleAlias";
const PICKER_MARKER = "codexLinuxDaybreakPickerVisibleAlias";
const IDENT = "[A-Za-z_$][\\w$]*";

function replaceUnique(source, pattern, replacement, description) {
  if (typeof source !== "string") {
    return source;
  }
  const matches = [...source.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))];
  if (matches.length !== 1) {
    console.warn(`WARN: Expected one ${description}, found ${matches.length}`);
    return source;
  }
  return source.replace(pattern, replacement);
}

function applyDaybreakCatalogVisibilityPatch(source) {
  if (typeof source !== "string" || source.includes(CATALOG_MARKER)) {
    return source;
  }
  const pattern = new RegExp(
    `(?<prefix>function ${IDENT}\\(\\{additionalAvailableModels:(?<additional>${IDENT}),` +
      `apiKeyDaybreakSupported:(?<supported>${IDENT}),authMethod:(?<auth>${IDENT}),` +
      `availableModels:(?<available>${IDENT}),hasConfiguredModelCatalog:(?<configured>${IDENT}),` +
      `isCustomModelProvider:(?<custom>${IDENT}),model:(?<model>${IDENT}),useHiddenModels:(?<hidden>${IDENT})\\}\\)` +
      `\\{let (?<cyber>${IDENT})=\\k<model>\\.availableAccessPrograms\\?\\.cyber;return ` +
      "\\k<auth>===`apikey`&&!\\k<supported>&&\\k<cyber>!=null&&\\k<cyber>\\.length>0&&" +
      "!\\k<cyber>\\.includes\\(`standard`\\)\\?!1:)" +
      "(?<suffix>\\k<additional>\\?\\.has\\(\\k<model>\\.model\\)===!0\\|\\|" +
      "\\k<model>\\.model!==`codex-auto-review`&&\\(\\k<configured>&&!\\k<model>\\.hidden\\|\\|" +
      "\\(\\k<hidden>&&!\\k<custom>&&\\k<auth>!==`amazonBedrock`\\?\\k<available>\\.has\\(\\k<model>\\.model\\)" +
      "\\|\\|\\k<auth>===`apikey`&&\\k<supported>&&!\\k<model>\\.hidden&&\\k<cyber>\\?\\.some\\(" +
      `(?<program>${IDENT})=>\\k<program>!==\`standard\`\\)===!0:!\\k<model>\\.hidden\\)\\)\\})`,
  );
  return replaceUnique(
    source,
    pattern,
    (...args) => {
      const { prefix, auth, model, suffix } = args.at(-1);
      return `${prefix}(${auth}===\`chatgpt\`||${auth}===\`chatgptAuthTokens\`)&&` +
        `${model}.model===\`${ALIAS}\`&&${model}.hidden===!1` +
        `/*${CATALOG_MARKER}*/||${suffix}`;
    },
    "Daybreak catalog visibility helper",
  );
}

function applyDaybreakPickerVisibilityPatch(source) {
  if (typeof source !== "string" || source.includes(PICKER_MARKER)) {
    return source;
  }
  const pattern = new RegExp(
    `(function ${IDENT}\\((${IDENT}),(${IDENT}),${IDENT}=!1,${IDENT}\\)\\{return \\2\\?\\.filter\\()` +
      `\\(\\{model:(${IDENT})\\}\\)=>\\3==null\\|\\|\\4!==\`${ALIAS}\`` +
      `(&&\\4!==\`${RED_ALIAS}\`)` +
      `(\\)\\.map\\()`,
  );
  return replaceUnique(
    source,
    pattern,
    (_match, prefix, _models, _access, model, redAliasExclusion, suffix) =>
      `${prefix}({model:${model},hidden:codexLinuxDaybreakHidden})=>` +
      `(${model}!==\`${ALIAS}\`||` +
      `codexLinuxDaybreakHidden===!1/*${PICKER_MARKER}*/)${redAliasExclusion}${suffix}`,
    "Daybreak picker visibility filter",
  );
}

function matchesCatalogContract(source) {
  return typeof source === "string" &&
    source.includes("additionalAvailableModels:") &&
    source.includes("apiKeyDaybreakSupported:") &&
    source.includes("hasConfiguredModelCatalog:") &&
    source.includes("`codex-auto-review`") &&
    source.includes("useHiddenModels:");
}

function matchesPickerContract(source) {
  return typeof source === "string" &&
    source.includes("composer.modelPicker.daybreak.modelDisabled") &&
    source.includes("composer.modelPicker.daybreak.modelUnavailable") &&
    source.includes("`gpt-daybreak-blue-latest`");
}

const descriptors = [
  {
    id: "daybreak-catalog-visible-alias",
    phase: "webview-asset",
    order: 20_551,
    ciPolicy: "optional",
    enforceWhenEnabled: true,
    pattern: /^app-initial-[^.]+\.js$/,
    assetMatch: matchesCatalogContract,
    missingDescription: "Daybreak model catalog visibility helper",
    skipDescription: "Daybreak catalog visible alias patch",
    apply: applyDaybreakCatalogVisibilityPatch,
  },
  {
    id: "daybreak-picker-visible-alias",
    phase: "webview-asset",
    order: 20_552,
    ciPolicy: "optional",
    enforceWhenEnabled: true,
    pattern: /^app-primary-[^.]+\.js$/,
    assetMatch: matchesPickerContract,
    missingDescription: "Daybreak model picker access filter",
    skipDescription: "Daybreak picker visible alias patch",
    apply: applyDaybreakPickerVisibilityPatch,
  },
];

module.exports = {
  applyDaybreakCatalogVisibilityPatch,
  applyDaybreakPickerVisibilityPatch,
  descriptors,
};
