"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { patchExtractedApp } = require("../../scripts/patches/runner.js");
const { createPatchReport, enabledFeatureFailuresFromReport } = require("../../scripts/lib/patch-report.js");
const { applySubagentModelMetadataPatch: applyPatch } = require("./patch.js");

const fixture = fs.readFileSync(path.join(__dirname, "fixture.js"), "utf8");
const ledger = { id: "ledger", model: "gpt-6-sol", reasoningEffort: "medium", createdAt: 1, updatedAt: 2 };

function evaluate(source) {
  const context = {
    r: { os: (id) => id, ha: () => ({}) },
    Dy: (thread) => thread,
    Oy: (input) => input.threadRecencyAt ?? input.updatedAt,
    Ey: (thread) => thread.name,
    Ay: () => ({}), cf: () => false, Ef: () => true,
    _t: { default: (items, predicate) => items.findLast(predicate) },
    wl: (conversation) => conversation.turns,
    ia: (conversation, predicate) => conversation.turns.findLast(predicate),
    ra: (conversation, predicate) => conversation.turns.find(predicate),
    a: { o: (conversation) => conversation.turns.at(-1) },
    oa: (conversation, fn) => conversation.turns.forEach(fn),
    Cu: (conversation, turn) => { conversation.turns.push(turn); return turn; },
  };
  vm.createContext(context);
  vm.runInContext(source, context, { timeout: 1000 });
  return context;
}

function store(context, thread = ledger, conversation) {
  const result = new context.FixtureStore();
  Object.assign(result, {
    params: { hostId: "local", isConversationArchiving: () => false,
      host: { workspace: { getThreadWorkspaceKind: () => "project" } },
      logger: { debug: () => {} } },
    threadsById: new Map(thread ? [[thread.id, thread]] : []),
    conversations: new Map(conversation ? [[conversation.id, conversation]] : []),
    pendingCollabThreadReads: new Set(), runtimeThreadStatusEvidenceByThreadId: new Map(),
    withThreadMetadata: (value) => value, getThreadSummary: () => null,
    getThreadHasUnreadTurn: () => false, reads: 0,
    captureThreadModelSettings(id) {
      const current = this.conversations.get(id);
      return current ? { model: current.latestModel, reasoningEffort: current.latestReasoningEffort } : null;
    },
    upsertHydratedCollabReceiverConversation(value, atReadStart) {
      const current = this.conversations.get(value.id);
      if (current) context.By(current, value, atReadStart);
      else this.conversations.set(value.id, { id: value.id,
        latestModel: value.model ?? "", latestReasoningEffort: value.reasoningEffort ?? null });
    },
    async readThread(id) {
      this.reads++;
      this.onRead?.();
      return { thread: { ...ledger, id } };
    },
  });
  return result;
}

test("summary activation retains the child model and effort", () => {
  const original = evaluate(fixture);
  assert.equal(original.tf(store(original).getThreadSummaryFromThread(ledger)).latestModel, "");
  const fixed = evaluate(applyPatch(fixture));
  for (const thread of [ledger, { ...ledger, model: "gpt-6.1-sol", reasoningEffort: "high" }]) {
    const conversation = fixed.tf(store(fixed).getThreadSummaryFromThread(thread));
    assert.equal(conversation.latestModel, thread.model);
    assert.equal(conversation.latestReasoningEffort, thread.reasoningEffort);
  }
});

test("repairs an existing blank placeholder from complete cached child metadata", async () => {
  const context = evaluate(applyPatch(fixture));
  const conversation = { id: "ledger", latestModel: "", latestReasoningEffort: null };
  const current = store(context, ledger, conversation);
  await current.hydrateCollabThreads(["ledger"]);
  assert.equal(conversation.latestModel, "gpt-6-sol");
  assert.equal(conversation.latestReasoningEffort, "medium");
  assert.equal(current.reads, 0);
});

test("incomplete metadata uses the existing read and preserves a concurrent settings change", async () => {
  const context = evaluate(applyPatch(fixture));
  for (const race of [false, true]) {
    const conversation = { id: "ledger", latestModel: "", latestReasoningEffort: null };
    const current = store(context, { id: "ledger" }, conversation);
    if (race) current.onRead = () => {
      conversation.latestModel = "gpt-6.1-sol";
      conversation.latestReasoningEffort = "high";
    };
    await current.hydrateCollabThreads(["ledger"]);
    assert.equal(current.reads, 1);
    assert.equal(conversation.latestModel, race ? "gpt-6.1-sol" : "gpt-6-sol");
    assert.equal(conversation.latestReasoningEffort, race ? "high" : "medium");
  }
});

test("retains current settings, null effort, pending reads, and archive guards", async () => {
  const context = evaluate(applyPatch(fixture));
  const current = store(context, ledger, { id: "ledger", latestModel: "gpt-6-luna", latestReasoningEffort: null });
  await current.hydrateCollabThreads(["ledger"]);
  assert.equal(current.conversations.get("ledger").latestModel, "gpt-6-luna");
  assert.equal(current.conversations.get("ledger").latestReasoningEffort, null);
  assert.equal(current.reads, 0);
  const unset = store(context, { ...ledger, reasoningEffort: null });
  await unset.hydrateCollabThreads(["ledger"]);
  assert.equal(unset.conversations.get("ledger").latestReasoningEffort, null);
  assert.equal(unset.reads, 0);
  const pending = store(context, null);
  pending.pendingCollabThreadReads.add("ledger");
  await pending.hydrateCollabThreads(["ledger"]);
  assert.equal(pending.reads, 0);
  const archived = store(context, null);
  archived.params.isConversationArchiving = () => true;
  await archived.hydrateCollabThreads(["ledger"]);
  assert.equal(archived.reads, 0);
});

test("retains authoritative thread settings while repairing a placeholder", async () => {
  const context = evaluate(applyPatch(fixture));
  const conversation = { id: "ledger", latestModel: "", latestReasoningEffort: null,
    latestThreadSettings: { model: "gpt-6.1-sol", effort: "high" } };
  await store(context, ledger, conversation).hydrateCollabThreads(["ledger"]);
  assert.equal(conversation.latestModel, "");
  assert.equal(conversation.latestThreadSettings.model, "gpt-6.1-sol");
  assert.equal(conversation.latestThreadSettings.effort, "high");
});

for (const fresh of [false, true]) {
  test(`turn start preserves an empty inferred model (${fresh ? "new" : "matching"} turn)`, () => {
    for (const [model, effort, expectedModel, expectedEffort] of [
      ["", null, "gpt-6-sol", "medium"],
      [undefined, null, "gpt-6-sol", "medium"],
      ["gpt-6.1-sol", "high", "gpt-6.1-sol", "high"],
    ]) {
      const context = evaluate(applyPatch(fixture));
      const conversation = { id: "ledger", latestModel: "gpt-6-sol", latestReasoningEffort: "medium", requests: [],
        turns: [{ turnId: "old", status: fresh ? "completed" : "inProgress", items: [], params: { model, effort } }] };
      context.ZS({ manager: { logger: { error: () => {} }, updateConversationState: (_id, fn) => fn(conversation),
        broadcastConversationSnapshot: () => {} }, notificationContext: { threadStore: {
        conversations: new Map([["ledger", conversation]]) } }, createId: () => "" },
      { method: "turn/started", params: { threadId: "ledger", turn: { id: fresh ? "new" : "old", status: "inProgress" } } }, null, 1);
      assert.equal(conversation.latestModel, expectedModel);
      assert.equal(conversation.latestReasoningEffort, expectedEffort);
    }
  });
}

test("matches renamed minified symbols and is idempotent", () => {
  const renamed = fixture.replace(/\b(?:e|t|n|r|i|a|o|s|c|l|u|d|f|p|m|h|g|v|y|b|x|S|C|w)\b/g, (name) => `${name}$`);
  for (const source of [fixture, renamed]) {
    const patched = applyPatch(source);
    assert.notEqual(patched, source);
    assert.equal(applyPatch(patched), patched);
    assert.doesNotThrow(() => new vm.Script(patched));
  }
});

test("drift, ambiguous contracts, and partial patches leave the entire source unchanged", () => {
  const patched = applyPatch(fixture);
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    for (const source of [fixture + fixture, fixture.replace("e.latestModel=t.params.model??e.latestModel", "e.latestModel=t.params.model"),
      fixture.replace("latestReasoningEffort:null", "latestReasoningEffort:`medium`"),
      patched.replace("codexLinuxSubagentSummary", "removedMarker"), "const unrelated=true;"]) {
      assert.equal(applyPatch(source), source);
    }
  } finally { console.warn = originalWarn; }
});

test("runner leaves the disabled bundle intact and rejects enabled ambiguous bundles", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-model-metadata-"));
  try {
    const build = path.join(dir, ".vite/build");
    fs.mkdirSync(build, { recursive: true });
    const target = path.join(build, "bootstrap-current.js");
    fs.writeFileSync(target, fixture);
    const config = path.join(dir, "features.json");
    const options = { featuresRoot: path.resolve(__dirname, ".."), featuresConfigPath: config, corePatchRoot: path.join(dir, "empty-core") };
    fs.writeFileSync(config, JSON.stringify({ enabled: [] }));
    patchExtractedApp(dir, options);
    assert.equal(fs.readFileSync(target, "utf8"), fixture);
    fs.writeFileSync(config, JSON.stringify({ enabled: ["subagent-model-metadata"] }));
    const report = createPatchReport();
    patchExtractedApp(dir, { ...options, report });
    assert.deepEqual(enabledFeatureFailuresFromReport(report), []);
    assert.notEqual(fs.readFileSync(target, "utf8"), fixture);
    fs.writeFileSync(target, fixture);
    fs.writeFileSync(path.join(build, "bootstrap-other.js"), fixture);
    const ambiguous = createPatchReport();
    const warn = console.warn;
    console.warn = () => {};
    try { patchExtractedApp(dir, { ...options, report: ambiguous }); } finally { console.warn = warn; }
    assert.equal(enabledFeatureFailuresFromReport(ambiguous).length, 1);
    assert.equal(fs.readFileSync(target, "utf8"), fixture);
  } finally { fs.rmSync(dir, { recursive: true }); }
});
