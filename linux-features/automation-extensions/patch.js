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

// Both owners live in rspack webview chunks with content-hashed names, so
// they are located by stable content needles plus a unique semantic contract.
module.exports = [
  webviewAssetPatch({
    id: "multi-time-rrule",
    phase: "webview-asset",
    order: 20_100,
    ciPolicy: "optional",
    assetNeedles: AUTOMATION_SCHEDULE_ASSET_NEEDLES,
    assetMatch: matchesAutomationScheduleContract,
    missingDescription: "automation schedule bundle",
    skipDescription: "RRULE multi-time patch",
    apply: applyAutomationScheduleMultiTimePatch,
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
