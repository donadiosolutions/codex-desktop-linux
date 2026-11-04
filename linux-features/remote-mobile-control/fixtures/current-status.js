"use strict";

// Verbatim renderer functions from signed 26.1029.61003 assets:
// async/24191.7b05d5cf83.js and async/86296.cc31aba811.js.
module.exports = {
  terminal: 'function m({hasInProgressOwnedWork:e,isResponseInProgress:t,latestTurnHasSystemError:n,resumeState:r,threadRuntimeStatus:i}){return e?"loading":i?.type==="systemError"?"error":i?.type==="active"?"loading":"needs_resume"===r?"idle":n?"error":!0===t?"loading":"idle"}let h=(e,{get:t})=>m({hasInProgressOwnedWork:t(u.Oz,e),isResponseInProgress:i?.isResponseInProgress??null,resumeState:a??(null==r?null:"needs_resume"),threadRuntimeStatus:s??r?.threadRuntimeStatus??null,latestTurnHasSystemError:i?.latestTurnError!=null,summary:i?.summary})',
};
