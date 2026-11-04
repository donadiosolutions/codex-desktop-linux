"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const fixture = require("./fixtures/upstream-26.1029.61003-services.json");
const {
  applyCurrentRemoteControlHostParamsPatch,
  matchesCurrentRemoteControlHostParamsContract,
} = require("./current-services.js");

function loadToggle(source, { sendRequest, get, set }) {
  const exports = {};
  const requireModule = (id) => ({
    Dgwo: { V: (scope, host) => ({ sendRequest: (...args) => sendRequest(scope, host, ...args) }) },
    ihPm: { AP: "status", Lt: set },
  })[id];
  requireModule.d = (target, getters) => {
    for (const [key, getter] of Object.entries(getters)) Object.defineProperty(target, key, { get: getter });
  };
  vm.runInNewContext(`({${source}}).WbV5({},exports,requireModule)`, { exports, requireModule });
  return { toggle: exports.p, scope: { get } };
}

test("current host toggles omit params and retain the selected host and status", async () => {
  const source = fixture.hostToggleModule;
  const patched = applyCurrentRemoteControlHostParamsPatch(source);
  assert.notEqual(patched, source);
  assert.equal(matchesCurrentRemoteControlHostParamsContract(source), true);
  assert.equal(matchesCurrentRemoteControlHostParamsContract(patched), true);
  assert.equal(applyCurrentRemoteControlHostParamsPatch(patched), patched);
  const calls = [];
  const updates = [];
  const status = { status: "enabled" };
  const { toggle, scope } = loadToggle(patched, {
    sendRequest: async (...args) => { calls.push(args); return status; },
    get: () => null,
    set: (...args) => updates.push(args),
  });
  for (const host of ["local", "remote-ssh:example", "remote-control:example"])
    for (const enabled of [true, false]) {
      assert.equal(await toggle(scope, host, enabled), status);
      assert.deepEqual(calls.at(-1), [scope, host, enabled ? "remoteControl/enable" : "remoteControl/disable", undefined]);
      assert.deepEqual(updates.at(-1), [scope, host, status]);
    }
});

test("current host toggle keeps in-flight status and caller cancellation guards", async () => {
  const patched = applyCurrentRemoteControlHostParamsPatch(fixture.hostToggleModule);
  for (const newerStatus of ["connected", "errored"])
    for (const enabled of [true, false]) {
      const before = { status: "disabled" };
      let current = before;
      const updates = [];
      const response = { status: "connecting" };
      const { toggle, scope } = loadToggle(patched, {
        sendRequest: async () => { current = { status: newerStatus }; return response; },
        get: () => current,
        set: (...args) => updates.push(args),
      });
      assert.equal(await toggle(scope, "local", enabled), response);
      assert.equal(updates.length, enabled ? 0 : 1);
      await toggle(scope, "local", enabled, { shouldApplyStatus: () => false });
      assert.equal(updates.length, enabled ? 0 : 1);
    }
});

test("current host params transform refuses ambiguity, partial markers and drift", () => {
  const source = fixture.hostToggleModule;
  for (const drifted of [
    source + source,
    source.replace("null),c=", "{}),c="),
    source.replace("(e,t).sendRequest", "(e,other).sendRequest"),
    source.replace("c!==o", "c===o"),
    source + "/*codexLinuxRemoteControlEnableForHostParams*/",
    "function unrelated(){}",
  ]) {
    assert.equal(matchesCurrentRemoteControlHostParamsContract(drifted), false);
    assert.equal(applyCurrentRemoteControlHostParamsPatch(drifted), null);
  }
});

test("current host params contract follows renamed bindings", () => {
  const renamed = fixture.hostToggleModule.replace(/\be\b/g, "scope").replace(/\bt\b/g, "host");
  assert.equal(matchesCurrentRemoteControlHostParamsContract(renamed), true);
  assert.notEqual(applyCurrentRemoteControlHostParamsPatch(renamed), renamed);
});

test("current host toggle preserves request rejection without publishing a status", async () => {
  const error = new Error("host unavailable");
  const { toggle, scope } = loadToggle(applyCurrentRemoteControlHostParamsPatch(fixture.hostToggleModule), {
    sendRequest: async () => { throw error; },
    get: () => null,
    set: () => assert.fail("failed requests must not publish status"),
  });
  await assert.rejects(toggle(scope, "remote-ssh:example", true), (actual) => actual === error);
});

test("signed current service bundles match fixtures and change only RPC params", {
  skip: !process.env.CODEX_SIGNED_APP,
}, () => {
  const descriptors = require("./patch.js");
  const descriptor = descriptors.find((entry) => entry.id === "linux-remote-control-enable-for-host-params");
  assert.equal(descriptor.matchPolicy, "all");
  for (const owner of [fixture, ...fixture.additionalOwners]) {
    const source = fs.readFileSync(path.join(process.env.CODEX_SIGNED_APP, "webview/assets", owner.asset), "utf8");
    assert.equal(createHash("sha256").update(source).digest("hex"), owner.sha256);
    assert.ok(source.includes(owner.hostToggleModule));
    assert.equal(descriptor.pattern.test(owner.asset), true);
    assert.equal(descriptor.assetMatch(source), true);
    const patched = applyCurrentRemoteControlHostParamsPatch(source);
    assert.notEqual(patched, null);
    assert.equal(patched, source.replace(
      '"remoteControl/disable",null)',
      '"remoteControl/disable",void 0/*codexLinuxRemoteControlEnableForHostParams*/)',
    ));
    assert.equal(applyCurrentRemoteControlHostParamsPatch(patched), patched);
    assert.equal(descriptor.apply(source), patched);
  }
});
