"use strict";

// The native component owns the existing plugin toggle; unified-computer-use
// owns transport. Never invent an installed/enabled Settings row.
function applyNativeSettingsAvailabilityPatch(source) {
  if (source.includes("BundledMarketplaceDonor")) throw new Error("Retired synthetic Linux Settings contract");
  const currentMarker = "/* linux-native-settings-availability */";
  if (source.includes(currentMarker)) {
    const alreadyPatched = /\w+="local"===\w+,\w+=\w+&&\(\w+\|\|"macOS"===\w+&&\w+\.isLoading\),\w+=\w+&&!\w+&&\("Linux"===\w+\|\|"macOS"===\w+&&\w+\.available\)&&\w+\/\* linux-native-settings-availability \*\//.test(source);
    if (source.split(currentMarker).length - 1 === 1 && alreadyPatched) return source;
    throw new Error("Linux native Settings availability contract missing or ambiguous");
  }
  const currentPattern = /(?<local>[\w$]+)="local"===(?<host>[\w$]+),(?<pending>[\w$]+)=\k<local>&&\((?<loading>[\w$]+)\|\|"macOS"===(?<platform>[\w$]+)&&(?<availability>[\w$]+)\.isLoading\),(?<available>[\w$]+)=\k<local>&&!\k<pending>&&"macOS"===\k<platform>&&\k<availability>\.available&&(?<setting>[\w$]+);/g;
  const currentMatches = [...source.matchAll(currentPattern)];
  if (currentMatches.length > 0 || source.includes(currentMarker)) {
    const currentCount = currentMatches.filter(match => match.groups.marker == null).length;
    if (currentMatches.length !== 1 || currentCount !== 1) {
      throw new Error("Linux native Settings availability contract missing or ambiguous");
    }
    const match = currentMatches[0];
    const { local, host, pending, loading, platform, availability, available, platformGate, setting } = match.groups;
    const replacement = `${local}="local"===${host},${pending}=${local}&&(${loading}||"macOS"===${platform}&&${availability}.isLoading),${available}=${local}&&!${pending}&&("Linux"===${platform}||"macOS"===${platform}&&${availability}.available)&&${setting}${currentMarker};`;
    return source.slice(0, match.index) + replacement + source.slice(match.index + match[0].length);
  }
  const marker = /[\w$]+===`linux`&&\([\w$]+=\{\.\.\.[\w$]+,available:/g;
  const pattern = /let (?<availability>[\w$]+)=(?<hook>[\w$]+)\((?<args>[^)]*)\),\{platform:(?<platform>[\w$]+)\}=(?<platformHook>[\w$]+)\(\)(?:,|(?<patched>;\k<platform>===`linux`&&\(\k<availability>=\{\.\.\.\k<availability>,available:!0,isFetching:!1,isLoading:!1\}\);let ))(?<next>[\w$]+)=/g;
  const matches = [...source.matchAll(pattern)].filter(match => {
    // A following owner must not supply the consumer missing from this one.
    const tail = source.slice(match.index + match[0].length, match.index + match[0].length + 3000).split(/function [\w$]+\(/)[0];
    return tail.includes(`computerUseAvailability:${match.groups.availability}`) && tail.includes(`${match.groups.availability}.available`);
  });
  const patchedCount = matches.filter(match => match.groups.patched != null).length;
  if (matches.length !== 1 || [...source.matchAll(marker)].length !== patchedCount) {
    throw new Error("Linux native Settings availability contract missing or ambiguous");
  }
  if (patchedCount === 1) return source;
  const match = matches[0];
  const { availability, hook, args, platform, platformHook, next } = match.groups;
  const replacement = `let ${availability}=${hook}(${args}),{platform:${platform}}=${platformHook}();${platform}===\`linux\`&&(${availability}={...${availability},available:!0,isFetching:!1,isLoading:!1});let ${next}=`;
  return source.slice(0, match.index) + replacement + source.slice(match.index + match[0].length);
}

// Apply at the Plugins presentation filter, not the bundled registry's hidden
// flag: that flag drops the component from the shared Settings query too.
function nativeSettingsVisibilityState(source) {
  const marker = "/* linux-native-settings-component */";
  const pattern = /function (?<fn>[\w$]+)\((?<plugins>[\w$]+),(?<hidden>[\w$]+),(?<restrictedMode>[\w$]+)\)\{(?:if\((?:\k<hidden>\.length===0|0===\k<hidden>\.length)&&!\k<restrictedMode>\)return \k<plugins>;|(?<patched>\/\* linux-native-settings-component \*\/))let (?<set>[\w$]+)=new Set\(\k<hidden>\);return \k<plugins>\.filter\((?<entry>[\w$]+)=>(?<exclusion>!\(\k<entry>\.marketplaceName===`openai-bundled`&&\k<entry>\.plugin\.name===`computer-use`\)&&)?\(!\k<restrictedMode>\|\|!(?<restricted>(?:[\w$]+|\(0,[\w$]+\.[\w$]+\)))\(\k<entry>\.plugin\.id\)\)&&!\k<set>\.has\(\k<entry>\.plugin\.id\)\)\}/g;
  const matches = [...source.matchAll(pattern)];
  const markerCount = source.split(marker).length - 1;
  const patchedCount = matches.filter((match) => match.groups.patched != null).length;
  if (matches.length !== 1 || markerCount !== patchedCount ||
      matches.some((match) => (match.groups.patched != null) !== (match.groups.exclusion != null))) {
    return { kind: "invalid" };
  }
  return {
    kind: patchedCount === 1 ? "patched" : "current",
    match: matches[0],
    marker,
  };
}

function matchesNativeSettingsVisibilityContract(source) {
  return nativeSettingsVisibilityState(source).kind !== "invalid";
}

function applyNativeSettingsVisibilityPatch(source) {
  const state = nativeSettingsVisibilityState(source);
  if (state.kind === "invalid") {
    throw new Error("Linux native Settings visibility contract missing or ambiguous");
  }
  if (state.kind === "patched") return source;
  const { match, marker } = state;
  const { fn, plugins, hidden, restrictedMode, set, entry, restricted } = match.groups;
  const replacement = `function ${fn}(${plugins},${hidden},${restrictedMode}){${marker}let ${set}=new Set(${hidden});return ${plugins}.filter(${entry}=>!(${entry}.marketplaceName===\`openai-bundled\`&&${entry}.plugin.name===\`computer-use\`)&&(!${restrictedMode}||!${restricted}(${entry}.plugin.id))&&!${set}.has(${entry}.plugin.id))}`;
  const patched = source.slice(0, match.index) + replacement +
    source.slice(match.index + match[0].length);
  if (nativeSettingsVisibilityState(patched).kind !== "patched") {
    throw new Error("Linux native Settings visibility contract missing or ambiguous");
  }
  return patched;
}

module.exports = {
  applyNativeSettingsAvailabilityPatch,
  applyNativeSettingsVisibilityPatch,
  matchesNativeSettingsVisibilityContract,
};
