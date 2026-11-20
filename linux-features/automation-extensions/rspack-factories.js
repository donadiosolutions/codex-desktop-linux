"use strict";

const { findMatchingBrace } = require("../../scripts/patches/lib/minified-js.js");

function rspackFactories(source) {
  const marker = "__webpack_modules__={";
  const table = source.indexOf(marker);
  if (table === -1 || source.indexOf(marker, table + marker.length) !== -1) return [];

  // SWC emits both method syntax and parenthesized function expressions.
  // Read only top-level factory keys to keep module imports unambiguous.
  const header = /([\w$]+|"[^"\\]+")(?::(\()?function)?\(([\w$]*(?:,[\w$]+){0,2})\)\{/y;
  const factories = [];
  let cursor = table + marker.length;
  while (cursor < source.length && source[cursor] !== "}") {
    header.lastIndex = cursor;
    const match = header.exec(source);
    if (match == null) return [];
    const open = header.lastIndex - 1;
    const close = findMatchingBrace(source, open);
    if (close === -1) return [];
    const moduleId = match[1].replace(/^"|"$/gu, "");
    const [, exports, require] = match[3].split(",");
    factories.push({ moduleId, exports, require, open, close });
    cursor = close + 1;
    if (match[2] != null && source[cursor++] !== ")") return [];
    if (source[cursor] === ",") cursor += 1;
    else if (source[cursor] !== "}") return [];
  }
  return factories;
}

module.exports = { rspackFactories };
