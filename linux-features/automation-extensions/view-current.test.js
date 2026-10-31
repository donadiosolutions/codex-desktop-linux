"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { applyObservableAutomationViewPatch, matchesObservableAutomationViewContract } = require("./observable-view.js");
const fixture = require("./fixtures/current-view.json");
const source = fixture.output + fixture.handler + fixture.host;

test("current automation host supports observable view and retains migration guard", async () => {
  const patched = applyObservableAutomationViewPatch(source);
  assert.equal(applyObservableAutomationViewPatch(patched), patched);
  const item = { kind: "heartbeat", name: "A", prompt: "P", rrule: "FREQ=DAILY", status: "PAUSED" };
  const context = vm.createContext({
    eo: { TF: class {} }, em: { $Cz: () => ({}), OeD: id => id === "existing" ? item : null },
    ar: { n: "local" }, Lp: { safeParse: data => ({ success: true, data }) },
  });
  vm.runInContext(patched + ";globalThis.Host=Lb", context);
  const host = new context.Host();
  for (const native of [false, true]) {
    const call = id => native
      ? host.executeNativeUpdateTool({ hostId: "local", argumentsValue: { mode: "view", id } }, { assertCurrent() {} })
      : host.executeUpdateTool({ hostId: "local", argumentsValue: { mode: "view", id } });
    const found = (await call("existing")).response;
    assert.equal(found.success, true);
    assert.deepEqual(JSON.parse(found.contentItems[1].text), {
      automationId: "existing", mode: "view", viewStatus: "found", status: "PAUSED", snapshot: item,
    });
    const missing = (await call("missing")).response;
    assert.equal(JSON.parse(missing.contentItems[1].text).viewStatus, "not_found");
    host.habitatAutomationsService = { isLocalMigrationActive: () => true };
    assert.equal((await call("existing")).response.success, false);
    host.habitatAutomationsService = undefined;
  }
});

test("current signed observable view patch stays idempotent and parses", {
  skip: !process.env.CODEX_SIGNED_EXTRACTED_APP,
}, () => {
  const dir = path.join(process.env.CODEX_SIGNED_EXTRACTED_APP, ".vite/build");
  const owners = fs.readdirSync(dir).filter(name => name.startsWith("early-bootstrap")).map(name => fs.readFileSync(path.join(dir, name), "utf8")).filter(text => text.includes(fixture.output));
  assert.equal(owners.length, 1);
  const patched = applyObservableAutomationViewPatch(owners[0]);
  assert.notEqual(patched, owners[0]);
  assert.equal(applyObservableAutomationViewPatch(patched), patched);
  assert.doesNotThrow(() => new vm.Script(patched));
});

test("current view rejects broken migration guards and incomplete native delegation", () => {
  assert.throws(() => applyObservableAutomationViewPatch(source.replace("isLocalMigrationActive", "unknownMigrationState")), /did not match/);
  const patched = applyObservableAutomationViewPatch(source);
  const incomplete = patched.replace(/,view:\(\{id:e\}\)=>\(t\.assertCurrent\(\),this\.view\(\{id:e\}\)\)/u, "");
  assert.notEqual(incomplete, patched);
  assert.equal(matchesObservableAutomationViewContract(incomplete), false);
  assert.throws(() => applyObservableAutomationViewPatch(incomplete), /did not match/);
});
