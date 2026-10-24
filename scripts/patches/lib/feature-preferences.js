"use strict";
const { registerRequestHandlers, hasRegisteredRequestHandlers } = require("./request-handlers.js");

const MARKER = "codexLinuxFeaturePreferenceKeys";
const HANDLERS = `"get-global-state":async({key:e})=>{if(!${MARKER}.has(e))throw Error(\`Unsupported feature preference\`);return{value:this.globalState.get(e)}},"set-global-state":async({key:e,value:t})=>{if(!${MARKER}.has(e))throw Error(\`Unsupported feature preference\`);this.globalState.set(e,t);return{success:!0}}`;

function registerFeaturePreferences(source, keys) {
  if (!Array.isArray(keys) || keys.some(key => typeof key !== "string" || !/^[a-z][a-z0-9-]*$/.test(key))) {
    throw Error("Invalid feature preference keys");
  }
  const initializers = [...source.matchAll(/var codexLinuxFeaturePreferenceKeys=new Set\((\[[^;]*?\])\);/g)];
  if (initializers.length > 1) throw Error("Ambiguous feature preference registry");
  const existing = initializers[0];
  if (existing) {
    if (!hasRegisteredRequestHandlers(source, HANDLERS)) throw Error("Incomplete feature preference bridge");
    const merged = [...new Set([...JSON.parse(existing[1]), ...keys])].sort();
    return source.slice(0, existing.index) + `var ${MARKER}=new Set(${JSON.stringify(merged)});` +
      source.slice(existing.index + existing[0].length);
  }
  if (source.includes(MARKER)) throw Error("Detached feature preference bridge");
  const patched = registerRequestHandlers(source, HANDLERS);
  const header = `var ${MARKER}=new Set(${JSON.stringify([...new Set(keys)].sort())});`;
  const directive = patched.match(/^(?:"use strict";|'use strict';)/)?.[0] ?? "";
  return directive + header + patched.slice(directive.length);
}

module.exports = { registerFeaturePreferences };
