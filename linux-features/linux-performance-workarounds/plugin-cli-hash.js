"use strict";
const fs = require("node:fs");
const path = require("node:path");
const MARKER = "/*codexLinuxStreamingPluginCliHash*/";
const OWNER = /["`]chrome_plugin_app_server_processes_stopped["`]/gu;
const ID = "[A-Za-z_$][\\w$]*";
const original = new RegExp(`async function (${ID})\\((${ID})\\)\\{return\\(0,(${ID})\\.createHash\\)\\(["\x60]sha256["\x60]\\)\\.update\\(await (?:${ID}\\.default|${ID}\\(\\))\\.readFile\\(\\2\\)\\)\\.digest\\(["\x60]hex["\x60]\\)\\}`, "g");
function replacement(name, argument, crypto) {
  return `async function ${name}(${argument}){${MARKER}let codexLinuxHash=(0,${crypto}.createHash)(\`sha256\`);for await(let codexLinuxChunk of require(\`node:fs\`).createReadStream(${argument}))codexLinuxHash.update(codexLinuxChunk);return codexLinuxHash.digest(\`hex\`)}`;
}
function applyPluginCliHashPatch(source) {
  if ([...source.matchAll(OWNER)].length !== 1) throw new Error("Expected one Chrome plugin CLI provisioning owner");
  const matches = [...source.matchAll(original)];
  if (source.includes(MARKER)) {
    const patched = [...source.matchAll(new RegExp(`async function (${ID})\\((${ID})\\)\\{\\/\\*codexLinuxStreamingPluginCliHash\\*\\/let codexLinuxHash=\\(0,(${ID})\\.createHash`, "g"))];
    if (matches.length === 0 && patched.length === 1 && source.split(MARKER).length === 2 && source.includes(replacement(...patched[0].slice(1)))) return source;
    throw new Error("Incomplete Chrome plugin CLI streaming hash patch");
  }
  if (matches.length !== 1) throw new Error("Expected one Chrome plugin CLI SHA-256 helper");
  const [match] = matches;
  return source.replace(match[0], replacement(...match.slice(1, 4)));
}
function patchPluginCliHash(extractedDir) {
  const buildDir = path.join(extractedDir, ".vite", "build");
  const candidates = fs.readdirSync(buildDir).filter(name => name.endsWith(".js")).map(name => {
    const file = path.join(buildDir, name);
    return {file, source: fs.readFileSync(file, "utf8")};
  }).filter(({source}) => [...source.matchAll(OWNER)].length > 0);
  if (candidates.length !== 1) throw new Error("Expected one Chrome plugin CLI module");
  const [{file, source}] = candidates;
  const patched = applyPluginCliHashPatch(source);
  if (patched !== source) fs.writeFileSync(file, patched, "utf8");
  return {changed: patched !== source};
}
module.exports = { applyPluginCliHashPatch, patchPluginCliHash };
