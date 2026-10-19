"use strict";

const { findMatchingBrace } = require("../../scripts/patches/lib/minified-js.js");
const HELPER = "codexLinuxSyncFeatureEnablement";
const STATE = "codexLinuxFeatureEnablementSync";
const ID = "[A-Za-z_$][\\w$]*";

// Serialize writes per connection. A newer generation can retry a rejected
// queued request, while a completed write remains reusable on that connection.
async function codexLinuxSyncFeatureEnablement(connectionState, enablement, ready, send) {
  const state = connectionState.codexLinuxFeatureEnablementSync ??=
    { tail: Promise.resolve(), applied: null };
  const key = JSON.stringify(Object.keys(enablement).sort().map(name => [name, enablement[name]]));
  const task = state.tail.then(async () => {
    ready();
    if (state.applied === key) return;
    let unchanged = false;
    try {
      const response = await connectionState.connection.sendAppServerRequest(
        `experimentalFeature/list`, {}, ready,
      );
      if (Array.isArray(response?.data) && response.nextCursor == null) {
        const features = new Map(response.data.map(feature => [feature.name, feature.enabled]));
        unchanged = features.size === response.data.length &&
          Object.entries(enablement).every(([name, enabled]) =>
            typeof enabled === "boolean" && features.has(name) && features.get(name) === enabled);
      }
    } catch {
      // Older servers and failed discovery retain the original write path.
    }
    ready();
    if (!unchanged) await send();
    state.applied = key;
  });
  state.tail = task.catch(() => {});
  return task;
}

function applyFeatureEnablementDedupPatch(source) {
  const markers = [...source.matchAll(/`app-server-feature-enablement`/gu)];
  const marker = markers.length === 1 ? markers[0].index : -1;
  const start = marker < 0 ? -1 : source.lastIndexOf("=class{", marker);
  const open = start < 0 ? -1 : start + "=class".length;
  const end = open < 0 ? -1 : findMatchingBrace(source, open);
  const owner = end < 0 ? "" : source.slice(open, end + 1);
  const calls = [...owner.matchAll(new RegExp(
    `await (${ID})\\.connection\\.sendAppServerRequest\\(\x60experimentalFeature/enablement/set\x60,\\{enablement:(${ID})\\},(${ID})\\)`, "gu",
  ))];
  const resets = [...owner.matchAll(new RegExp(
    `if\\((${ID})\\.connection\\.getConnectionState\\(\\)!==\x60connected\x60\\)\\{\\1\\.rolloutCompressionRequested=!1;return\\}`, "gu",
  ))];
  const helper = codexLinuxSyncFeatureEnablement.toString();
  if (source.includes(HELPER)) {
    if (source.includes(helper) && owner.includes(`await ${HELPER}(`) &&
        owner.includes(`.${STATE}=null,`) && calls.length === 0) return source;
  } else if (calls.length === 1 && resets.length === 1 &&
             calls[0][1] === resets[0][1] &&
             owner.includes(`async sendEnablement(${calls[0][1]},`)) {
    const [, state, enablement, ready] = calls[0];
    const patched = owner
      .replace(calls[0][0], `await ${HELPER}(${state},${enablement},${ready},()=>${calls[0][0].slice(6)})`)
      .replace(resets[0][0], resets[0][0].replace(`${state}.rolloutCompressionRequested`, `${state}.${STATE}=null,${state}.rolloutCompressionRequested`));
    return source.slice(0, open) + patched + source.slice(end + 1) + "\n" + helper;
  }
  console.warn("WARN: Could not uniquely identify feature-enablement synchronization — skipping Linux feature-enablement deduplication");
  return source;
}

module.exports = { applyFeatureEnablementDedupPatch };
