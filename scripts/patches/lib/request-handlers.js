"use strict";

const { findMatchingBrace } = require("./minified-js.js");

function findRequestHandlerMap(source) {
  const maps = [...source.matchAll(/(?<![\w$.])handlers=\{/g)];
  const classes = [...source.matchAll(/\bclass(?:\s+[A-Za-z_$][\w$]*)?(?:\s+extends\s+[A-Za-z_$][\w$.]*)?\{/g)];
  const candidates = [];
  for (const map of maps) {
    const start = map.index + map[0].length - 1;
    const end = findMatchingBrace(source, start);
    if (end < 0) continue;
    const owner = classes.findLast(entry => entry.index < map.index &&
      findMatchingBrace(source, entry.index + entry[0].length - 1) > end);
    if (!owner) continue;
    const ownerEnd = findMatchingBrace(source, owner.index + owner[0].length - 1);
    const body = source.slice(owner.index, ownerEnd + 1);
    // Register only in the map actually read by the surviving Electron router.
    const router = body.match(/handleVSCodeRequest\([^{}]*\)\{/);
    if (!router) continue;
    const routerStart = router.index + router[0].length - 1;
    const routerText = body.slice(routerStart, findMatchingBrace(body, routerStart) + 1);
    if (!routerText.includes("this.handlers[") || source.slice(start, end).split('"set-remote-wsl-connections-enabled":').length !== 2) continue;
    candidates.push({ start, end, text: source.slice(start + 1, end), ownerStart: owner.index, ownerEnd });
  }
  if (candidates.length !== 1) throw Error("Expected one live FetchHandler request map");
  return candidates[0];
}

function handlerKeys(payload) {
  const keys = [...payload.matchAll(/"([^"\\]+)":async/g)].map(match => match[1]);
  if (!keys.length || new Set(keys).size !== keys.length) throw Error("Invalid request handler payload");
  return keys;
}

function hasRegisteredRequestHandlers(source, payload) {
  try {
    const map = findRequestHandlerMap(source);
    return source.split(payload).length === 2 && map.text.includes(payload) &&
      handlerKeys(payload).every(key => map.text.split(`${JSON.stringify(key)}:`).length === 2);
  } catch { return false; }
}

function registerRequestHandlers(source, payload) {
  if (hasRegisteredRequestHandlers(source, payload)) return source;
  const map = findRequestHandlerMap(source);
  if (handlerKeys(payload).some(key => source.includes(`${JSON.stringify(key)}:`))) {
    throw Error("Found incomplete or misplaced request handlers");
  }
  return source.slice(0, map.start + 1) + payload + (map.text ? "," : "") + source.slice(map.start + 1);
}

module.exports = { findRequestHandlerMap, registerRequestHandlers, hasRegisteredRequestHandlers };
