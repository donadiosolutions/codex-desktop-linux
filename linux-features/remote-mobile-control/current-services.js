"use strict";

const MARKER = "codexLinuxRemoteControlEnableForHostParams";
const ID = "[A-Za-z_$][\\w$]*";

// The selected host now reaches the client directly through the scope. Keep
// the status race/cancellation guards intact and change only the empty params.
function hostTogglePattern(params) {
  return new RegExp(
    `async function (?<fn>${ID})\\((?<scope>${ID}),(?<host>${ID}),(?<enabled>${ID}),` +
    `\\{shouldApplyStatus:(?<apply>${ID})=\\(\\)=>!0\\}=\\{\\}\\)\\{` +
    `let (?<before>${ID})=\\k<scope>\\.get\\((?<status>${ID}\\.${ID}),\\k<host>\\),` +
    `(?<response>${ID})=await \\(0,${ID}\\.${ID}\\)\\(\\k<scope>,\\k<host>\\)` +
    `\\.sendRequest\\(\\k<enabled>\\?"remoteControl/enable":"remoteControl/disable",${params}\\),` +
    `(?<after>${ID})=\\k<scope>\\.get\\(\\k<status>,\\k<host>\\),` +
    `(?<newer>${ID})=\\k<after>!==\\k<before>&&\\(\\k<after>\\?\\.status==="connected"\\|\\|\\k<after>\\?\\.status==="errored"\\);` +
    `return!\\k<apply>\\(\\)\\|\\|\\k<enabled>&&\\k<newer>\\|\\|\\(0,${ID}\\.${ID}\\)` +
    `\\(\\k<scope>,\\k<host>,\\k<response>\\),\\k<response>\\}`,
    "gu",
  );
}

function hostToggleState(source) {
  const current = [...source.matchAll(hostTogglePattern("null"))];
  const patched = [...source.matchAll(hostTogglePattern(`void 0/\\*${MARKER}\\*/`))];
  const markers = source.split(MARKER).length - 1;
  if (current.length === 1 && patched.length === 0 && markers === 0) return current[0];
  if (current.length === 0 && patched.length === 1 && markers === 1) return true;
  return null;
}

function matchesCurrentRemoteControlHostParamsContract(source) {
  return hostToggleState(source) !== null;
}

function applyCurrentRemoteControlHostParamsPatch(source) {
  const state = hostToggleState(source);
  if (state === null) return null;
  if (state === true) return source;
  const patched = state[0].replace(
    '"remoteControl/disable",null)',
    `"remoteControl/disable",void 0/*${MARKER}*/)`,
  );
  return source.slice(0, state.index) + patched + source.slice(state.index + state[0].length);
}

module.exports = { applyCurrentRemoteControlHostParamsPatch, matchesCurrentRemoteControlHostParamsContract };
