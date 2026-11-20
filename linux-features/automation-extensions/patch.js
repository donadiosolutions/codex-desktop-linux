"use strict";

const { mainBundlePatch, webviewAssetPatch } = require("../../scripts/patches/descriptor.js");
const {
  AUTOMATION_SCHEDULE_ASSET_NEEDLES,
  applyAutomationScheduleMultiTimePatch,
  matchesAutomationScheduleContract,
} = require("../../scripts/patches/impl/automation-schedule.js");
const {
  AUTOMATION_UPDATE_EAGER_TOOL_ASSET_NEEDLES,
  applyAutomationUpdateEagerToolPatch,
  applyAutomationPluginEnablePatch,
  matchesAutomationPluginEnableContract,
  matchesAutomationUpdateEagerToolContract,
} = require("./eager-update.js");

const { applyObservableAutomationViewPatch } = require("./observable-view.js");
const { applyAutomationPluginPipePatch } = require("./plugin-pipe.js");
const { rspackFactories } = require("./rspack-factories.js");

const SCHEDULE_ANCHOR = "hasMultipleTimeValues:Array.isArray(";
const SCHEDULE_MARKER = "function codexLinuxNormalizeRruleNumbers(";
const WRAPPED_FACTORY_PREFIX = "export const __webpack_modules__={X(e,t,n){";
const WRAPPED_FACTORY_SUFFIX = "}};";

function wrappedSchedule(source, anchor) {
  const position = source.indexOf(anchor);
  if (position === -1 || source.indexOf(anchor, position + anchor.length) !== -1) return null;
  const owner = rspackFactories(source).find(({ open, close }) => open < position && position < close);
  if (owner == null) return null;
  const { open, close } = owner;
  // Present the existing schedule matcher with its expected factory spelling.
  const wrapped = WRAPPED_FACTORY_PREFIX + source.slice(open + 1, close) + WRAPPED_FACTORY_SUFFIX;
  return { wrapped, open, close };
}

function matchesSchedule(source) {
  if (matchesAutomationScheduleContract(source)) return true;
  const contract = wrappedSchedule(source, source.includes(SCHEDULE_MARKER) ? SCHEDULE_MARKER : SCHEDULE_ANCHOR);
  return contract != null && matchesAutomationScheduleContract(contract.wrapped);
}

function applySchedule(source) {
  if (matchesAutomationScheduleContract(source)) return applyAutomationScheduleMultiTimePatch(source);
  const contract = wrappedSchedule(source, SCHEDULE_ANCHOR);
  if (contract == null) return source;
  const { wrapped, open, close } = contract;
  const patched = applyAutomationScheduleMultiTimePatch(wrapped);
  if (patched === wrapped) return source;
  const body = patched.slice(WRAPPED_FACTORY_PREFIX.length, -WRAPPED_FACTORY_SUFFIX.length);
  return source.slice(0, open + 1) + body + source.slice(close);
}

// Both owners live in rspack webview chunks with content-hashed names, so
// they are located by stable content needles plus a unique semantic contract.
module.exports = [
  webviewAssetPatch({
    id: "multi-time-rrule",
    phase: "webview-asset",
    order: 20_100,
    ciPolicy: "optional",
    assetNeedles: AUTOMATION_SCHEDULE_ASSET_NEEDLES,
    assetMatch: matchesSchedule,
    missingDescription: "automation schedule bundle",
    skipDescription: "RRULE multi-time patch",
    apply: applySchedule,
  }),
  webviewAssetPatch({
    id: "eager-automation-update",
    phase: "webview-asset",
    order: 20_110,
    ciPolicy: "optional",
    assetNeedles: AUTOMATION_UPDATE_EAGER_TOOL_ASSET_NEEDLES,
    assetMatch: matchesAutomationUpdateEagerToolContract,
    missingDescription: "dynamic Codex app tools bundle",
    skipDescription: "automation_update eager dynamic tool patch",
    apply: applyAutomationUpdateEagerToolPatch,
  }),
  mainBundlePatch({
    id: "automation-plugin-pipe",
    phase: "main-bundle",
    order: 20_112,
    ciPolicy: "optional",
    apply: applyAutomationPluginPipePatch,
  }),
  mainBundlePatch({
    id: "observable-automation-view",
    phase: "main-bundle",
    order: 20_115,
    ciPolicy: "optional",
    apply: applyObservableAutomationViewPatch,
  }),
  webviewAssetPatch({
    id: "automation-plugin-enable",
    phase: "webview-asset",
    order: 20_120,
    ciPolicy: "optional",
    pattern: /\.js$/u,
    assetMatch: matchesAutomationPluginEnableContract,
    missingDescription: "Desktop MCP dynamic-tool config",
    skipDescription: "automation plugin enable patch",
    apply: applyAutomationPluginEnablePatch,
  }),
];
