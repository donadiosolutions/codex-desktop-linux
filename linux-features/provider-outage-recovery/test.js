"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createRecovery, isOutage, newEpisode } = require("./recovery.js");
function harness(overrides = {}) {
  let now = 0, calls = 0;
  let state = { hostId: "host-a", threadId: "thread-a", turnId: "failed-1", ready: true, failed: true, owner: true, error: { httpConnectionFailed: { httpStatusCode: 503 } }, ...overrides };
  const episode = newEpisode(now);
  const recovery = createRecovery({ episode, expected: state, read: () => state, now: () => now, send: async () => { calls++; } });
  return { recovery, episode, get calls() { return calls; }, advance: ms => { now += ms; }, state: patch => { state = { ...state, ...patch }; } };
}
test("only structured HTTP 503 is eligible", () => {
  assert.equal(isOutage({ httpConnectionFailed: { httpStatusCode: 503 } }), true);
  for (const error of [null, "unexpected status 503", "serverOverloaded", "policyCapacityUnavailable", "unauthorized", "badRequest", "bioPolicy", { httpConnectionFailed: { httpStatusCode: 401 } }, { responseStreamDisconnected: { httpStatusCode: 503 } }, { httpConnectionFailed: { httpStatusCode: "503" } }]) assert.equal(isOutage(error), false);
});
test("fake time produces exactly one continuation after outage", async () => {
  const h = harness(); h.advance(9000); await h.recovery.tick(); assert.equal(h.calls, 0);
  h.advance(1000); await Promise.all([h.recovery.tick(), h.recovery.tick()]); assert.equal(h.calls, 1);
  h.advance(300000); await h.recovery.tick(); assert.equal(h.calls, 1);
});
test("finite count and elapsed budgets survive component replacement", async () => {
  const h = harness();
  for (let i = 0; i < 7; i++) {
    const state = { hostId: "h", threadId: "t", turnId: String(i), ready: true, failed: true, owner: true, error: { httpConnectionFailed: { httpStatusCode: 503 } } };
    const r = createRecovery({ episode: h.episode, expected: state, read: () => state, now: () => 0, send: async () => {} }); await r.retryNow();
  }
  assert.equal(h.episode.attempts, 7); assert.equal(h.recovery.seconds(), null);
  const elapsed = harness(); elapsed.advance(900001); await elapsed.recovery.tick(); assert.equal(elapsed.calls, 0);
});
test("activity, cancellation, lifecycle, ownership, active and changed thread stop recovery", async () => {
  for (const patch of [{ owner: false }, { ready: false }, { failed: false }, { turnId: "new" }, { threadId: "other" }, { hostId: "other" }, { error: "unauthorized" }, { pending: true }]) {
    const h = harness(); h.state(patch); h.advance(10000); await h.recovery.tick(); assert.equal(h.calls, 0, JSON.stringify(patch));
  }
  for (const method of ["cancel", "dispose"]) { const h = harness(); h.recovery[method](); h.advance(10000); await h.recovery.tick(); assert.equal(h.calls, 0); }
});
test("unknown send outcomes never cause another submission", async () => {
  let count = 0; const h = harness();
  const state = { hostId: "h", threadId: "t", turnId: "a", ready: true, failed: true, owner: true, error: { httpConnectionFailed: { httpStatusCode: 503 } } };
  const r = createRecovery({ episode: h.episode, expected: state, read: () => state, now: () => 0, send: async () => { count++; throw Error("unknown"); } });
  await r.retryNow(); await r.retryNow(); assert.equal(count, 1); assert.equal(h.episode.cancelled, true);
});
test("unmount cancels unsettled continuation even after optimistic insertion", async () => {
  let release, cancelled=0;
  const state={hostId:"h",threadId:"t",turnId:"a",ready:true,failed:true,owner:true,error:{httpConnectionFailed:{httpStatusCode:503}}};
  const r=createRecovery({episode:newEpisode(0),expected:{...state},read:()=>state,now:()=>0,cancelSend:()=>{cancelled++;},send:()=>new Promise(resolve=>{release=resolve;})});
  const pending=r.retryNow();state.turnId=null;r.dispose();assert.equal(cancelled,1);release();await pending;
});
