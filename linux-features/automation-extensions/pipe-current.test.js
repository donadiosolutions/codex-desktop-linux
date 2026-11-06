"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const fixture = require("./fixtures/current-pipe.json");
const descriptors = require("./patch.js");

function currentSource() {
  return [fixture.pipeDeclaration, fixture.prepare, fixture.pipe, fixture.sync, ...fixture.callers].join(";");
}

test("current signed bundle forwards the Desktop pipe and synchronizes the installed plugin", () => {
  const descriptor = descriptors.find(({ id }) => id === "automation-plugin-pipe");
  assert.ok(descriptor);

  const source = currentSource();
  const patched = descriptor.apply(source);
  assert.notEqual(patched, source);
  assert.match(patched, /CODEX_APP_TOOLS_PIPE_PATH:process\.env\[rP\]\/\*codexLinuxForwardAutomationPipe\*\//);
  assert.match(patched, /CODEX_APP_TOOLS_DEFERRED:s\?"1":"0"/);
  assert.match(patched, /codexLinuxSyncAutomationPluginBeforeResume/);
  assert.match(patched, /appServerConnection:s\}\)/);
  assert.match(patched, /appServerConnection:n\}\)/);
  assert.equal(descriptor.apply(patched), patched);
});

test("current signed bundle fixture retains the computed pipe guard and WSL forwarding", () => {
  assert.match(fixture.pipe, /process\.env\[rP\]/);
  assert.match(fixture.pipe, /env_vars=\["WSL_INTEROP",rP\]/);
  assert.match(fixture.pipe, /name:rP,type:"windows-only"/);
  assert.match(fixture.sync, /config\/batchWrite/);
  assert.match(fixture.sync, /JSON\.stringify\(\{mcpServers:\{codex_app:/);
});

test("current pristine main chunk accepts the pipe patch without changing trusted input", {
  skip: !process.env.CODEX_SIGNED_EXTRACTED_APP,
}, () => {
  const dir = path.join(process.env.CODEX_SIGNED_EXTRACTED_APP, ".vite/build");
  const owners = fs.readdirSync(dir).filter(name => name.startsWith("early-bootstrap"))
    .map(name => ({ file: path.join(dir, name), source: fs.readFileSync(path.join(dir, name), "utf8") }))
    .filter(({ source }) => source.includes("pluginMcpConfigOverrides") && source.includes("CODEX_APP_TOOLS_DEFERRED"));
  assert.equal(owners.length, 1);
  const [{ file, source }] = owners;
  const patch = descriptors.find(({ id }) => id === "automation-plugin-pipe").apply;
  const patched = patch(source);
  assert.notEqual(patched, source);
  assert.equal(patch(patched), patched);
  assert.doesNotThrow(() => new vm.Script(patched));
  assert.equal(fs.readFileSync(file, "utf8"), source);
});


test("inline plugin synchronization is named without changing the original call", () => {
  const inline = fixture.sync.replace("async function s9(", "async function(");
  const source = [fixture.pipeDeclaration, fixture.prepare, fixture.pipe,
    `async function reconcile(options){await ${inline}(options)}`, ...fixture.callers].join(";");
  const patch = descriptors.find(({id}) => id === "automation-plugin-pipe").apply;
  const patched = patch(source);
  assert.notEqual(patched, source);
  assert.equal(patch(patched), patched);
  assert.match(patched, /await codexLinuxSyncInstalledAutomationPlugin\(options\)/);
  assert.match(patched, /codexLinuxSyncAutomationPluginBeforeResume/);
  assert.match(patched, /CODEX_APP_TOOLS_PIPE_PATH:process\.env\[rP\]/);
  assert.doesNotThrow(() => new vm.Script(patched));
  assert.throws(() => patch(source + `;async function another(options){await ${inline}(options)}`), /did not match/);
});
