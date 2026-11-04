"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { extractedAppPatch } = require("../../scripts/patches/descriptor.js");
const { javascriptSourceParses } = require("../../scripts/patches/lib/javascript-syntax.js");

const RUNTIME_VERSION = "omarchy-theme-v1";
const STYLE_LINK_ID = "codex-linux-omarchy-theme-link";
const THEME_CSS_ENV = "CODEX_LINUX_OMARCHY_STYLESHEET_URI";

function omarchyThemeRuntimeSource() {
  return [
    ";(()=>{",
    `const VERSION=${JSON.stringify(RUNTIME_VERSION)};`,
    "if(globalThis.codexLinuxOmarchyThemeVersion===VERSION)return;",
    "try{globalThis.codexLinuxOmarchyThemeCleanup?.()}catch{}",
    "globalThis.codexLinuxOmarchyThemeVersion=VERSION;",
    `const STYLE_LINK_ID=${JSON.stringify(STYLE_LINK_ID)};`,
    `const THEME_CSS_ENV=${JSON.stringify(THEME_CSS_ENV)};`,
    "let interval=null,installed=false;",
    "function refresh(){if(typeof document===`undefined`)return;const uri=globalThis.process?.env?.[THEME_CSS_ENV];if(!uri)return;const target=document.head||document.documentElement;if(!target)return;let link=document.getElementById(STYLE_LINK_ID);if(!link){link=document.createElement(`link`);link.id=STYLE_LINK_ID;link.rel=`stylesheet`;link.type=`text/css`;target.appendChild(link)}link.href=uri+`?t=`+Date.now()}",
    "function onVisibilityChange(){document.hidden||refresh()}",
    "function install(){if(installed)return;installed=true;refresh();interval=setInterval(refresh,5000);window.addEventListener(`focus`,refresh);document.addEventListener(`visibilitychange`,onVisibilityChange)}",
    "function cleanup(){document.removeEventListener(`DOMContentLoaded`,install);document.removeEventListener(`visibilitychange`,onVisibilityChange);window.removeEventListener(`focus`,refresh);interval!=null&&clearInterval(interval);interval=null;installed=false}",
    "globalThis.codexLinuxOmarchyThemeCleanup=cleanup;",
    "document.readyState===`loading`?document.addEventListener(`DOMContentLoaded`,install,{once:true}):install();",
    "})();",
  ].join("");
}

function applyOmarchyThemeLoader(source) {
  if (typeof source !== "string") {
    return source;
  }
  if (source.includes("codexLinuxOmarchyThemeVersion=")) {
    return source;
  }
  return `${source}\n${omarchyThemeRuntimeSource()}`;
}

function patchOmarchyThemeEntry(extractedDir) {
  const htmlPath = path.join(extractedDir, "webview", "index.html");
  if (!fs.existsSync(htmlPath)) {
    console.warn("WARN: Could not find webview index.html — skipping Omarchy theme CSS loader");
    return { changed: false };
  }
  const html = fs.readFileSync(htmlPath, "utf8");
  const entries = [...html.matchAll(/<script\b([^>]*)><\/script>/gu)]
    .map((match) => match[1])
    .filter((attributes) => /\btype="module"/u.test(attributes))
    .map((attributes) => attributes.match(/\bsrc="\/assets\/([^"]+)"/u)?.[1])
    .filter((name) => name != null);
  const entryName = entries.at(-1);
  if (entryName == null || entries.length === 0 || new Set(entries).size !== entries.length || !/^(?:index-[A-Za-z0-9._-]+|\d+\.[a-f0-9]+)\.js$/u.test(entryName)) {
    console.warn("WARN: Could not resolve webview index entry script — skipping Omarchy theme CSS loader");
    return { changed: false };
  }
  const assetsDir = path.join(extractedDir, "webview", "assets");
  const entryPath = path.resolve(assetsDir, entryName);
  const stat = fs.existsSync(entryPath) ? fs.lstatSync(entryPath) : null;
  if (path.dirname(entryPath) !== path.resolve(assetsDir) || stat == null || !stat.isFile() || stat.isSymbolicLink() || path.dirname(fs.realpathSync(entryPath)) !== fs.realpathSync(assetsDir)) {
    console.warn(`WARN: Webview index entry ${entryName} is missing — skipping Omarchy theme CSS loader`);
    return { changed: false };
  }
  const original = fs.readFileSync(entryPath, "utf8");
  const patched = applyOmarchyThemeLoader(original);
  if (!javascriptSourceParses(patched)) {
    console.warn(`WARN: Webview index entry ${entryName} failed JavaScript syntax validation — skipping Omarchy theme CSS loader`);
    return { changed: false };
  }
  if (patched !== original) fs.writeFileSync(entryPath, patched, "utf8");
  return { changed: patched !== original, assetName: entryName };
}

module.exports = {
  RUNTIME_VERSION,
  STYLE_LINK_ID,
  THEME_CSS_ENV,
  descriptors: [
    extractedAppPatch({
      id: "omarchy-theme-css-loader",
      phase: "extracted-app:post-webview",
      order: 20_780,
      ciPolicy: "optional",
      apply: patchOmarchyThemeEntry,
    }),
  ],
  applyOmarchyThemeLoader,
  patchOmarchyThemeEntry,
  omarchyThemeRuntimeSource,
};
