"use strict";

const { findMatchingBrace } = require("../../scripts/patches/lib/minified-js.js");
const CURRENT_TERMINAL_MARKER = "codexLinuxRemoteTerminalStatusCurrent";

function applyCurrentRemoteTerminalStatusPatch(source) {
  if (source.includes(CURRENT_TERMINAL_MARKER)) return source;
  const pattern = /function ([A-Za-z_$][\w$]*)\(\{hasInProgressOwnedWork:([A-Za-z_$][\w$]*),isResponseInProgress:([A-Za-z_$][\w$]*),latestTurnHasSystemError:([A-Za-z_$][\w$]*),resumeState:([A-Za-z_$][\w$]*),threadRuntimeStatus:([A-Za-z_$][\w$]*)\}\)\{return \2\?"loading":\6\?\.type==="systemError"\?"error":\6\?\.type==="active"\?"loading":"needs_resume"===\5\?"idle":\4\?"error":!0===\3\?"loading":"idle"\}/u;
  if ([...source.matchAll(new RegExp(pattern.source, "gu"))].length !== 1) return source;
  const match = source.match(pattern);
  if (!match) return source;
  const [, fn, owned, response, error, resume, runtime] = match;

  const callerPattern = new RegExp(`(?<call>${fn}\\(\\{(?<object>[^{}]{1,2000})\\}\\))`, "gu");
  const callMatches = [...source.matchAll(callerPattern)]
    .filter(({ index }) => !source.slice(Math.max(0, index - 9), index).endsWith("function "))
    .flatMap((candidate) => {
      const callText = candidate.groups.call;
      if (!callText.includes("hasInProgressOwnedWork:")) return [];
      const stateMatch = callText.match(/isResponseInProgress:([A-Za-z_$][\w$]*)\?\.isResponseInProgress\?\?null/u);
      if (!stateMatch) return [];
      const state = stateMatch[1];
      if (!callText.includes(`latestTurnHasSystemError:${state}?.latestTurnError!=null`)) return [];
      if (callText.includes("hasUserInputRequest:")) return [];
      return [candidate];
    });
  if (callMatches.length !== 1) return source;
  const callStart = callMatches[0].index;
  const callText = callMatches[0].groups.call;
  const objectEnd = callStart + callText.length - 2;
  const state = callText.match(/isResponseInProgress:([A-Za-z_$][\w$]*)\?\.isResponseInProgress\?\?null/u)[1];

  const replacement = `function ${fn}({hasInProgressOwnedWork:${owned},isResponseInProgress:${response},latestTurnHasSystemError:${error},resumeState:${resume},threadRuntimeStatus:${runtime},hasUserInputRequest:codexLinuxRemoteStatusHasUserInputRequest}){/*${CURRENT_TERMINAL_MARKER}*/let codexLinuxRemoteStatusFlags=Array.isArray(${runtime}?.activeFlags)?${runtime}.activeFlags:null,codexLinuxRemoteStatusWaitingForInput=codexLinuxRemoteStatusFlags?.includes("waitingOnUserInput")===!0,codexLinuxRemoteStatusLoading=${runtime}?.type==="active"&&(${response}===!0||codexLinuxRemoteStatusFlags==null||codexLinuxRemoteStatusFlags.length>0&&(!codexLinuxRemoteStatusWaitingForInput||codexLinuxRemoteStatusHasUserInputRequest===!0));return ${owned}||codexLinuxRemoteStatusLoading?"loading":${runtime}?.type==="systemError"?"error":"needs_resume"===${resume}?"idle":${error}?"error":!0===${response}?"loading":"idle"}`;
  const insertion = `,hasUserInputRequest:["userInput","optionPicker","setupCodexStep"].includes(${state}?.summary.pendingRequest?.kind)`;
  const withRequest = source.slice(0, objectEnd) + insertion + source.slice(objectEnd);
  return withRequest.replace(pattern, replacement);
}

function matchesCurrentRemoteTerminalStatusContract(source) {
  if (source.includes(CURRENT_TERMINAL_MARKER)) return true;
  if (source.includes("hasInProgressOwnedWork:") && applyCurrentRemoteTerminalStatusPatch(source) !== source) return true;
  const fn = /function ([A-Za-z_$][\w$]*)\(\{hasInProgressOwnedWork:([A-Za-z_$][\w$]*),isResponseInProgress:([A-Za-z_$][\w$]*),latestTurnHasSystemError:([A-Za-z_$][\w$]*),resumeState:([A-Za-z_$][\w$]*),threadRuntimeStatus:([A-Za-z_$][\w$]*)\}\)\{return \2\?"loading":\6\?\.type==="systemError"\?"error":\6\?\.type==="active"\?"loading":"needs_resume"===\5\?"idle":\4\?"error":!0===\3\?"loading":"idle"\}/u;
  const match = source.match(fn);
  if (!match) return false;
  const name = match[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const calls = [...source.matchAll(new RegExp(`${name}\\(\\{[^{}]{0,1800}\\}\\)`, "gu"))]
    .filter(({ index }) => !source.slice(Math.max(0, index - 9), index).endsWith("function "));
  return calls.length === 1 &&
    calls[0][0].includes("isResponseInProgress:") &&
    calls[0][0].includes("latestTurnHasSystemError:") &&
    calls[0][0].includes("latestTurnError!=null");
}

module.exports = {
  applyCurrentRemoteTerminalStatusPatch,
  matchesCurrentRemoteTerminalStatusContract,
  CURRENT_TERMINAL_MARKER,
};
