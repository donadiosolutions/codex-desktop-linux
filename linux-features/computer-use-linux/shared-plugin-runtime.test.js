"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { applyUnifiedComputerUsePatch } = require("./unified.js");
const source = require("./fixtures/shared-plugin-runtime.js");

test("shared Computer Use configuration follows verified installed and final executor plugin roots", async () => {
  const patched = applyUnifiedComputerUsePatch(source);
  assert.notEqual(patched, source);
  assert.equal(applyUnifiedComputerUsePatch(patched), patched);
  const writes = [];
  const { select, initialize, threadConfig, stage } = vm.runInNewContext(
    `${patched};({select,initialize,threadConfig,stage})`, {
      process: { platform: "linux", env: { CODEX_LINUX_CUA_HOST_SOCKET: "/run/cua.sock" } },
      require: name => {
        assert.equal(name, "node:path");
        return path;
      },
      pathIo: () => path,
      files: {
        readFile: async () => '{"mcpServers":{"cua_repl":{}}}',
        mkdtemp: async name => name + "41243",
        cp: async () => {},
        rename: async () => {},
        rm: async () => {},
      },
      record: (file, parsed) => writes.push({ file, env: parsed.mcpServers.cua_repl.env }),
      codec: { parse: data => data },
      lookup: () => ({ path: "/bundled", plugin: { installed: true, name: "unified-computer-use", localVersion: "signed" }, marketplace: { name: "verified" } }),
      constants: { path: metadata => path.join(metadata.codexHome, metadata.localVersion), services: "NODE_REPL_TRUSTED_SERVICES", backends: "CUA_REPL_BROWSER_BACKENDS", cua: "cua_repl" },
      deleteKey: "NODE_REPL_UNTRUSTED_ENV_DENYLIST",
      structuredClone,
    },
  );
  const { cuaReplSurfaces } = select(true, { platform: "linux" }, { computerUse: true, browser: true }, { enabled: true });
  assert.deepEqual(Array.from(cuaReplSurfaces), ["browser", "computer"]);
  const settings = { browserUseTinysky: true };
  const selection = {
    codexHome: "/codex", marketplaceName: "verified", browserBackends: ["iab"], cuaReplSurfaces,
    nodeRepl: { env: {} }, desktopFeatureAvailability: settings,
  };
  const cached = await initialize({ selection, marketplaces: [], hostConfig: { kind: "local" } });
  const connection = { hostConfig: { kind: "local" }, getAuthenticatedPrincipal: async () => ({}) };
  const config = await threadConfig({ connection, features: settings, cached });
  const executorDestination = await stage("/resources", "/executor", cached.executorLaunch);
  assert.equal(executorDestination, "/executor/stable");
  assert.equal(writes[0].file, "/codex/signed/.mcp.json");
  assert.equal(writes[1].file, "/executor/.staging-41243/.mcp.json");
  for (const [env, root] of [
    [writes[0].env, "/codex/signed"],
    [config["mcp_servers.cua_repl"].env, "/codex/signed"],
    [writes[1].env, executorDestination],
  ]) {
    assert.equal(JSON.parse(env.NODE_REPL_TRUSTED_SERVICES).sky, root + "/scripts/native-service.mjs");
    assert.ok(env.NODE_REPL_JS_BANNER.includes(root + "/scripts/native-client.mjs"));
    assert.equal(env.CODEX_LINUX_CUA_HOST_SOCKET, "/run/cua.sock");
  }
  assert.equal(Object.keys(await threadConfig({ cached, features: settings, connection: { ...connection, getAuthenticatedPrincipal: async () => null } })).length, 0);
});
