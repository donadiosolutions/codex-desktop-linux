"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const {
  createPatchReport,
  enabledFeatureFailuresFromReport,
} = require("../lib/patch-report.js");
const {
  allPatchPolicies,
  corePatchDescriptors,
  createMainBundleContext,
  patchExtractedApp,
  requiredPatchNamesForProfile,
} = require("./runner.js");
const { findMainProcessChunks } = require("./lib/assets.js");
const { findMatchingBrace } = require("./lib/minified-js.js");

const emptyConfig = path.join(__dirname, "..", "..", "tests", "fixtures", "linux-features", "disabled.json");

test("the official Linux baseline needs no core compatibility patch", () => {
  assert.deepEqual(corePatchDescriptors(), []);
  assert.deepEqual(allPatchPolicies({ featuresConfigPath: emptyConfig }), []);
  assert.deepEqual(requiredPatchNamesForProfile("upstream-build", {
    featuresConfigPath: emptyConfig,
  }), []);
});

test("the signed baseline owns quit approval and shell startup", {
  skip: process.env.CODEX_SIGNED_EXTRACTED_APP == null,
}, () => {
  const mainProcess = findMainProcessChunks(process.env.CODEX_SIGNED_EXTRACTED_APP);
  assert.ok(mainProcess, "Expected the verified main-process chunks");
  const chunks = mainProcess.chunks.map((name) => ({
    name,
    source: fs.readFileSync(path.join(mainProcess.buildDir, name), "utf8"),
  }));
  const uniqueOwner = (markers, description) => {
    const owners = chunks.filter(({ source }) =>
      markers.every((marker) => source.includes(marker)));
    assert.equal(
      owners.length,
      1,
      `Expected one ${description}; found ${owners.map(({ name }) => name).join(", ") || "none"}`,
    );
    return owners[0].source;
  };

  const owner = uniqueOwner([
    "canQuitWithoutPrompt(){return this.allowQuitWithoutPrompt}",
    "markQuitApproved(){this.allowQuitWithoutPrompt=!0}",
    "hasPendingLocalGitReviewComments:",
  ], "upstream quit coordinator");
  const id = "[A-Za-z_$][\\w$]*";
  const headers = [...owner.matchAll(new RegExp(
    `function\\(\\{isWindows:${id},quitState:(?<state>${id}),windows:(?<windows>${id}),` +
    `[^{}]+hasPendingLocalGitReviewComments:(?<pending>${id}),[^{}]+\\}\\)\\{`, "gu"))];
  assert.equal(headers.length, 1, "Expected one current quit lifecycle owner");
  const header = headers[0];
  const open = header.index + header[0].length - 1;
  const body = owner.slice(open, findMatchingBrace(owner, open) + 1);
  const handlers = [...body.matchAll(new RegExp(`(?<electron>${id})\\.app\\.on\\("before-quit",(?<event>${id})=>\\{`, "gu"))];
  assert.equal(handlers.length, 1);
  const handler = handlers[0];
  const handlerOpen = handler.index + handler[0].length - 1;
  const handlerBody = body.slice(handlerOpen, findMatchingBrace(body, handlerOpen) + 1);
  const { state, windows, pending } = header.groups;
  const { electron, event } = handler.groups;
  const quitting = handlerBody.match(new RegExp(`(${id})=!0,${windows}\\.markAppQuitting\\(\\)\\}$`, "u"))?.[1];
  assert.ok(quitting, "Expected final accepted quit transition");
  assert.ok(handlerBody.includes(`!${quitting}&&!${state}.canQuitWithoutPrompt()`));
  assert.ok(handlerBody.includes(`${pending}()`));
  assert.ok(handlerBody.includes(`${state}.markQuitApproved()`));
  const formatter = handlerBody.match(new RegExp(`\\(0,(${id})\\.F\\$\\)`, "u"))?.[1];
  const logger = handlerBody.match(new RegExp(`\\(0,(${id})\\.tZQ\\)`, "u"))?.[1];
  const privacy = handlerBody.match(new RegExp(`${id}\\?\\?(${id})\\(\\{electronAppPath`, "u"))?.[1];
  assert.ok(formatter && logger && privacy);

  // Run the signed handler itself with Electron and application services stubbed.
  const run = ({ approved = false, pendingComments = false, answer = 0,
    alreadyQuitting = false, privacyRequest = false } = {}) => {
    let prevented = 0, marked = 0, prompted = 0, approvals = 0;
    const sandbox = {
      process: { platform: privacyRequest ? "darwin" : "linux", env: {} },
      [state]: { canQuitWithoutPrompt: () => approved, markQuitApproved: () => { approvals++; } },
      [windows]: { markAppQuitting: () => { marked++; } },
      [pending]: () => pendingComments,
      [quitting]: alreadyQuitting,
      [electron]: { app: { isPackaged: true, getAppPath: () => "/app", getName: () => "ChatGPT" },
        dialog: { showMessageBoxSync: () => { prompted++; return answer; } } },
      [formatter]: { F$: () => ({ formatMessage: () => "message" }) },
      [logger]: { tZQ: () => ({ warning() {} }) },
      [privacy]: () => ({ isPrivacySettingsTerminationRequest: () => privacyRequest }),
    };
    for (const match of handlerBody.matchAll(new RegExp(`formatMessage\\(\\{\\.\\.\\.(${id})|formatMessage\\((${id})\\)`, "gu"))) {
      sandbox[match[1] ?? match[2]] = {};
    }
    vm.runInNewContext(`(${event}=>${handlerBody})`, sandbox)({ preventDefault() { prevented++; } });
    return { prevented, marked, prompted, approvals };
  };
  assert.deepEqual(run(), { prevented: 0, marked: 1, prompted: 0, approvals: 0 });
  assert.deepEqual(run({ approved: true, pendingComments: true }), { prevented: 0, marked: 1, prompted: 0, approvals: 0 });
  assert.deepEqual(run({ pendingComments: true }), { prevented: 1, marked: 0, prompted: 1, approvals: 0 });
  assert.deepEqual(run({ pendingComments: true, answer: 1 }), { prevented: 0, marked: 1, prompted: 1, approvals: 1 });
  assert.deepEqual(run({ pendingComments: true, alreadyQuitting: true }), { prevented: 0, marked: 1, prompted: 0, approvals: 0 });
  assert.deepEqual(run({ approved: true, privacyRequest: true }), { prevented: 1, marked: 0, prompted: 0, approvals: 0 });

  const shellOwner = uniqueOwner([
    "main app.whenReady resolved",
    "shell environment hydrated",
  ], "upstream shell-startup owner");
  const identifier = "[A-Za-z_$][\\w$]*";
  const readyPattern = new RegExp(
    `await ${identifier}\\.app\\.whenReady\\(\\),${identifier}\\(` +
      `"main app\\.whenReady resolved"`,
    "gu",
  );
  const shellStartPattern = new RegExp(
    `(?:let|const) ${identifier}=Date\\.now\\(\\),${identifier}=\\(0,` +
      `${identifier}\\.${identifier}\\)\\(\\),${identifier}=${identifier}=>\\{` +
      `${identifier}\\("shell environment hydrated"`,
    "gu",
  );
  const readyMatches = [...shellOwner.matchAll(readyPattern)];
  const shellStartMatches = [...shellOwner.matchAll(shellStartPattern)];
  assert.equal(readyMatches.length, 1, "Expected one awaited main app readiness boundary");
  assert.equal(shellStartMatches.length, 1, "Expected one shell-environment startup call");
  assert.ok(
    shellStartMatches[0].index > readyMatches[0].index,
    "Shell-environment startup must follow awaited app readiness",
  );
});

test("runner context exposes enabled feature IDs", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "runner-context-"));
  try {
    const config = path.join(temp, "features.json");
    fs.writeFileSync(config, '{"enabled":["frameless-titlebar"]}\n');
    const context = createMainBundleContext(null, { featuresConfigPath: config });
    assert.deepEqual(context.enabledFeatureIds, ["frameless-titlebar"]);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test("empty core registry preserves unmatched application assets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runner-baseline-"));
  try {
    const mainDir = path.join(root, ".vite", "build");
    const webviewDir = path.join(root, "webview", "assets");
    fs.mkdirSync(mainDir, { recursive: true });
    fs.mkdirSync(webviewDir, { recursive: true });
    const webview = path.join(webviewDir, "app-initial-A.js");
    const main = path.join(mainDir, "early-bootstrap.js");
    fs.writeFileSync(main, "const officialMain=true;\n");
    fs.writeFileSync(webview, "official-webview\n");
    const mainBefore = fs.readFileSync(main);
    const webviewBefore = fs.readFileSync(webview);
    const report = createPatchReport();
    patchExtractedApp(root, {
      report,
      featuresConfigPath: emptyConfig,
    });
    assert.deepEqual(fs.readFileSync(main), mainBefore);
    assert.deepEqual(fs.readFileSync(webview), webviewBefore);
    assert.deepEqual(report.patches, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("missing main bundle records enabled feature drift", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runner-missing-main-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const config = path.join(root, "features.json");
  fs.writeFileSync(config, '{"enabled":["frameless-titlebar"]}\n');
  const report = createPatchReport();

  patchExtractedApp(root, { report, featuresConfigPath: config });

  const entry = report.patches.find((patch) =>
    patch.name === "feature:frameless-titlebar:main-process");
  assert.ok(entry);
  assert.equal(entry.status, "skipped-optional");
  assert.equal(entry.enforceWhenEnabled, true);
  assert.equal(entry.unavailable, true);
  assert.equal(
    enabledFeatureFailuresFromReport(report).some((failure) => failure.name === entry.name),
    true,
  );
});

test("main-process chunks are the rspack early-bootstrap entry and its numbered chunks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "runner-rspack-chunks-"));
  try {
    const buildDir = path.join(root, ".vite", "build");
    fs.mkdirSync(buildDir, { recursive: true });
    for (const name of [
      "early-bootstrap.js",
      "early-bootstrap-916-2f6483d5bfd826f1.js",
      "early-bootstrap-87-929aa7e5d829f2a8.js",
      "worker.js",
      "worker-904-f6f849be9d0ea1f7.js",
      "preload.js",
      "main-legacy.js",
    ]) {
      fs.writeFileSync(path.join(buildDir, name), "");
    }
    assert.deepEqual(findMainProcessChunks(root), {
      buildDir,
      chunks: [
        "early-bootstrap-87-929aa7e5d829f2a8.js",
        "early-bootstrap-916-2f6483d5bfd826f1.js",
        "early-bootstrap.js",
      ],
    });
    assert.equal(findMainProcessChunks(path.join(root, "missing")), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
