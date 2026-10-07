#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { loadLinuxFeaturePatchDescriptors } = require("../../scripts/lib/linux-features.js");

const {
  applyDaybreakCatalogVisibilityPatch,
  applyDaybreakPickerVisibilityPatch,
  descriptors,
} = require("./patch.js");

function catalogFixture() {
  return "function Mci({additionalAvailableModels:e,apiKeyDaybreakSupported:t,authMethod:n,availableModels:r,hasConfiguredModelCatalog:i,isCustomModelProvider:a,model:o,useHiddenModels:s}){let c=o.availableAccessPrograms?.cyber;return n===`apikey`&&!t&&c!=null&&c.length>0&&!c.includes(`standard`)?!1:e?.has(o.model)===!0||o.model!==`codex-auto-review`&&(i&&!o.hidden||(s&&!a&&n!==`amazonBedrock`?r.has(o.model)||n===`apikey`&&t&&!o.hidden&&c?.some(e=>e!==`standard`)===!0:!o.hidden))}";
}

function pickerFixture() {
  return "function aW(e,t,n=!1,r){return e?.filter(({model:e})=>t==null||e!==`gpt-daybreak-blue-latest`&&e!==`gpt-daybreak-red-latest`).map(e=>{let i=null,a=r==null?typeof t==`boolean`&&!_re(e,t):!r.includes(e.model);return(t===!1?a:t===`standard`&&Hi(e.model))?i=Nl({id:`composer.modelPicker.daybreak.modelDisabled`,defaultMessage:`Turn on Daybreak to use this model`}):(typeof t==`boolean`?t&&a:t!=null&&wd(e.model,t,n))&&(i=Nl({id:`composer.modelPicker.daybreak.modelUnavailable`,defaultMessage:`Turn off Daybreak to use this model`})),{model:e,disabledReason:i}})}";
}

function evaluateCatalog(source, authMethod, model, availableModels = new Set(), options = {}) {
  const visible = Function(`${source};return Mci;`)();
  return visible({
    additionalAvailableModels: null,
    apiKeyDaybreakSupported: false,
    authMethod,
    availableModels,
    hasConfiguredModelCatalog: false,
    isCustomModelProvider: false,
    model,
    useHiddenModels: true,
    ...options,
  });
}

function evaluatePicker(source, models, access, { modelIds } = {}) {
  const picker = Function(
    "_re",
    "Hi",
    "wd",
    "Nl",
    `${source};return aW;`,
  )(
    (model, enabled) => {
      const programs = model.availableAccessPrograms?.cyber;
      return (!enabled && !programs?.length) || (enabled
        ? programs?.includes("daybreakBlue") || programs?.includes("daybreakRed")
        : programs?.includes("standard")) === true;
    },
    (model) => model.toLowerCase().includes("cyber") || model.toLowerCase().includes("daybreak-red"),
    (model, program) => program !== "standard" && (model === "gpt-6-astra" || model === "gpt-6-astra-wm"),
    (message) => message,
  );
  return picker(models, access, false, modelIds).map(({ model, disabledReason }) => ({
    disabledReason,
    model: model.model,
  }));
}

test("descriptors target the two current official bundle roles", () => {
  assert.deepEqual(
    descriptors.map(({ id, phase, ciPolicy, enforceWhenEnabled, pattern }) => [
      id,
      phase,
      ciPolicy,
      enforceWhenEnabled,
      pattern.test("app-initial-current.js"),
      pattern.test("app-primary-current.js"),
      typeof descriptors.find((candidate) => candidate.id === id)?.assetMatch,
    ]),
    [
      ["daybreak-catalog-visible-alias", "webview-asset", "optional", true, true, false, "function"],
      ["daybreak-picker-visible-alias", "webview-asset", "optional", true, false, true, "function"],
    ],
  );
});

test("feature stays disabled until explicitly listed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "daybreak-model-visibility-"));
  const config = path.join(directory, "features.json");
  const previous = process.env.CODEX_LINUX_FEATURES_CONFIG;
  try {
    fs.writeFileSync(config, '{"enabled":[]}\n');
    process.env.CODEX_LINUX_FEATURES_CONFIG = config;
    assert.deepEqual(loadLinuxFeaturePatchDescriptors({ featuresRoot: path.resolve(__dirname, "..") }), []);
    fs.writeFileSync(config, '{"enabled":["daybreak-model-visibility"]}\n');
    assert.deepEqual(
      loadLinuxFeaturePatchDescriptors({ featuresRoot: path.resolve(__dirname, "..") }).map(({ id }) => id),
      [
        "feature:daybreak-model-visibility:daybreak-catalog-visible-alias",
        "feature:daybreak-model-visibility:daybreak-picker-visible-alias",
      ],
    );
  } finally {
    previous == null ? delete process.env.CODEX_LINUX_FEATURES_CONFIG : process.env.CODEX_LINUX_FEATURES_CONFIG = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("catalog admits only a visible Daybreak alias for ChatGPT authentication", () => {
  const patched = applyDaybreakCatalogVisibilityPatch(catalogFixture());
  const visibleAlias = { model: "gpt-daybreak-blue-latest", hidden: false };
  const hiddenAlias = { model: "gpt-daybreak-blue-latest", hidden: true };
  const missingVisibility = { model: "gpt-daybreak-blue-latest" };
  const ordinary = { model: "gpt-6-astra", hidden: false };

  assert.equal(evaluateCatalog(patched, "chatgpt", visibleAlias), true);
  assert.equal(evaluateCatalog(patched, "chatgptAuthTokens", visibleAlias), true);
  assert.equal(evaluateCatalog(patched, "apikey", visibleAlias), false);
  assert.equal(evaluateCatalog(patched, "copilot", visibleAlias), false);
  assert.equal(evaluateCatalog(patched, "chatgpt", hiddenAlias), false);
  assert.equal(evaluateCatalog(patched, "chatgpt", missingVisibility), false);
  assert.equal(evaluateCatalog(patched, "chatgpt", ordinary), false);
  assert.equal(evaluateCatalog(patched, "chatgpt", ordinary, new Set([ordinary.model])), true);
});

test("picker retains only a visible Daybreak alias and preserves access metadata checks", () => {
  const patched = applyDaybreakPickerVisibilityPatch(pickerFixture());
  const models = [
    { model: "gpt-daybreak-blue-latest", hidden: false, availableAccessPrograms: { cyber: ["daybreakBlue"] } },
    { model: "gpt-daybreak-blue-latest", hidden: true, availableAccessPrograms: { cyber: ["daybreakBlue"] } },
    { model: "gpt-daybreak-blue-latest" },
    { model: "gpt-daybreak-red-latest", hidden: false },
    { model: "gpt-6-astra", hidden: false, availableAccessPrograms: { cyber: ["standard"] } },
  ];

  assert.deepEqual(evaluatePicker(patched, models, "daybreakBlue"), [
    { model: "gpt-daybreak-blue-latest", disabledReason: null },
    { model: "gpt-6-astra", disabledReason: {
      id: "composer.modelPicker.daybreak.modelUnavailable",
      defaultMessage: "Turn off Daybreak to use this model",
    } },
  ]);
  assert.deepEqual(evaluatePicker(patched, models, null).map(({ model }) => model), [
    "gpt-daybreak-blue-latest",
    "gpt-6-astra",
  ]);
});

test("catalog preserves upstream API-key Daybreak support and metadata guards", () => {
  const patched = applyDaybreakCatalogVisibilityPatch(catalogFixture());
  const model = { model: "gpt-6-astra", hidden: false, availableAccessPrograms: { cyber: ["daybreakBlue"] } };
  assert.equal(evaluateCatalog(patched, "apikey", model, new Set([model.model])), false);
  assert.equal(evaluateCatalog(patched, "apikey", model, new Set(), {
    additionalAvailableModels: new Set([model.model]),
  }), false);
  assert.equal(evaluateCatalog(patched, "chatgpt", model, new Set(), {
    additionalAvailableModels: new Set([model.model]),
  }), true);
  assert.equal(evaluateCatalog(patched, "apikey", model, new Set(), { apiKeyDaybreakSupported: true }), true);
  assert.equal(evaluateCatalog(patched, "apikey", { ...model, hidden: true }, new Set(), { apiKeyDaybreakSupported: true }), false);
  assert.equal(evaluateCatalog(patched, "apikey", { ...model, availableAccessPrograms: { cyber: ["standard"] } }, new Set([model.model])), true);
});

test("picker preserves explicit model-ID availability checks", () => {
  const patched = applyDaybreakPickerVisibilityPatch(pickerFixture());
  const models = [{ model: "gpt-daybreak-blue-latest", hidden: false }];
  assert.equal(evaluatePicker(patched, models, false, { modelIds: [] }).length, 1);
  assert.equal(evaluatePicker(patched, models, false, { modelIds: [] })[0].disabledReason.id,
    "composer.modelPicker.daybreak.modelDisabled");
  assert.equal(evaluatePicker(patched, models, false, { modelIds: [models[0].model] })[0].disabledReason, null);
  assert.equal(evaluatePicker(patched, models, true, { modelIds: [] })[0].disabledReason.id,
    "composer.modelPicker.daybreak.modelUnavailable");
  assert.equal(evaluatePicker(patched, models, true, { modelIds: [models[0].model] })[0].disabledReason, null);
});

test("patches are idempotent and fail closed on missing or ambiguous contracts", () => {
  for (const [apply, fixture] of [
    [applyDaybreakCatalogVisibilityPatch, catalogFixture],
    [applyDaybreakPickerVisibilityPatch, pickerFixture],
  ]) {
    const source = fixture();
    const patched = apply(source);
    assert.notEqual(patched, source);
    assert.equal(apply(patched), patched);
    assert.equal(apply("function unrelated(){return!0}"), "function unrelated(){return!0}");
    assert.equal(apply(source + source), source + source);
  }
});

test("patches match an optionally supplied extracted official bundle", (t) => {
  const assets = process.env.DAYBREAK_MODEL_VISIBILITY_OFFICIAL_ASSETS;
  if (assets == null) {
    t.skip("DAYBREAK_MODEL_VISIBILITY_OFFICIAL_ASSETS is not set");
    return;
  }
  const names = fs.readdirSync(assets);
  const initialNames = names.filter((name) => /^app-initial-[^.]+\.js$/.test(name));
  const primaryNames = names.filter((name) => /^app-primary-[^.]+\.js$/.test(name));
  assert.equal(initialNames.length, 1);
  assert.equal(primaryNames.length, 1);
  const initial = fs.readFileSync(path.join(assets, initialNames[0]), "utf8");
  const primary = fs.readFileSync(path.join(assets, primaryNames[0]), "utf8");

  assert.ok(applyDaybreakCatalogVisibilityPatch(initial) !== initial, "official catalog contract must patch");
  assert.ok(applyDaybreakPickerVisibilityPatch(primary) !== primary, "official picker contract must patch");
});

// Reproduce the live model/list response: visible alias, no cyber metadata.
test("live legacy catalog survives both filters with Daybreak off", () => {
  const models = [{ model: "gpt-daybreak-blue-latest", hidden: false }];
  const catalog = applyDaybreakCatalogVisibilityPatch(catalogFixture());
  const picker = applyDaybreakPickerVisibilityPatch(pickerFixture());
  const visible = models.filter(model => evaluateCatalog(catalog, "chatgpt", model));
  assert.deepEqual(evaluatePicker(picker, visible, false), [
    { model: "gpt-daybreak-blue-latest", disabledReason: null },
  ]);
  assert.deepEqual(evaluatePicker(picker, [], false), []);
  assert.equal(evaluatePicker(picker, models, true)[0].disabledReason.id, "composer.modelPicker.daybreak.modelUnavailable");
  assert.equal(evaluatePicker(picker, [{...models[0], availableAccessPrograms: {cyber: ["daybreakBlue"]}}], false)[0].disabledReason.id, "composer.modelPicker.daybreak.modelDisabled");
});
