'use strict';

const MARKER = 'codexCommunityRecoveryManagerGuardV1';
const ID = '[$A-Z_a-z][$\\w]*';

function one(source, pattern, label) {
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1) throw new Error(`Provider recovery: expected one ${label}, found ${matches.length}`);
  return matches[0];
}

// Injected inside startEmptyTurn, so lease state belongs to the actual RPC
// owner. Cancellation never calls the native continuation or turn machinery.
function initializeRecoveryLease(manager, threadId, options) {
  const recovery = options?.communityRecovery;
  if (recovery == null) return null;
  const fail = () => { throw Error("Provider outage recovery lease is invalid or cancelled"); };
  manager.assertActive();
  const now = Date.now();
  if (typeof recovery.token !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(recovery.token) ||
      typeof threadId !== 'string' || recovery.hostId !== manager.getHostId() ||
      typeof recovery.expectedTurnId !== 'string' || recovery.expectedTurnId.length === 0 ||
      !Number.isFinite(recovery.expiresAt) || recovery.expiresAt <= now || recovery.expiresAt > now + 900000 ||
      recovery.action != null && recovery.action !== 'cancel') fail();
  const leases = manager.codexCommunityRecoveryLeases ??= new Map();
  for (const [token, lease] of leases) if (lease.expiresAt <= now) leases.delete(token);
  let lease = leases.get(recovery.token);
  if (lease != null && (lease.threadId !== threadId || lease.hostId !== recovery.hostId ||
      lease.expectedTurnId !== recovery.expectedTurnId || lease.expiresAt !== recovery.expiresAt)) fail();
  if (recovery.action === 'cancel') {
    if (lease != null) lease.cancelled = true;
    else if (leases.size < 128) leases.set(recovery.token, {
      threadId, hostId: recovery.hostId, expectedTurnId: recovery.expectedTurnId,
      expiresAt: recovery.expiresAt, cancelled: true,
    });
    // A full tombstone table must never make a preemptive cancellation vanish.
    // A bounded global barrier safely rejects new recovery until this expires.
    else manager.codexCommunityRecoveryBlockedUntil = Math.max(manager.codexCommunityRecoveryBlockedUntil ?? 0, recovery.expiresAt);
    return { cancelAction: true };
  }
  if ((manager.codexCommunityRecoveryBlockedUntil ?? 0) > now || lease != null || leases.size >= 128) fail();
  lease = { threadId, hostId: recovery.hostId, expectedTurnId: recovery.expectedTurnId,
    expiresAt: recovery.expiresAt, cancelled: false };
  leases.set(recovery.token, lease);
  return lease;
}

/** Guard the actual owner manager; only plain recovery data crosses RPC. */
function applyManagerGuard(source) {
  if (source.includes(MARKER)) {
    if (!["communityRecoveryBeforeOptimistic?.()", "communityRecoveryAfterOptimistic?.(",
      "communityRecoveryBeforeDispatch?.()", "initializeRecoveryLease", "communityRecoveryLease.cancelled"].every(x => source.includes(x))) {
      throw new Error('Provider recovery: incomplete prior manager patch');
    }
    return source;
  }
  const method = one(source, new RegExp(`startEmptyTurn\\((${ID}),(${ID})\\)\\{return this\\.streamRecovery\\.cancelTurnContinuation\\(\\1\\),async function\\(\\{conversationId:(${ID}),manager:(${ID}),options:(${ID}),resumeConversation:(${ID}),startTurn:(${ID}),turnMergePolicy:(${ID})\\}\\)\\{`, 'g'), 'empty-turn manager');
  const end = source.indexOf('}steerTurn(', method.index);
  if (end < 0) throw new Error('Provider recovery: missing empty-turn method boundary');
  const original = source.slice(method.index, end + 1);
  const [, argumentThread, argumentOptions, thread, manager, options, , , policy] = method;
  const latest = one(original, new RegExp(`(${ID})\\(\\)\\((${ID})\\((${ID}),${policy}\\),(${ID})=>null!=\\4\\.turnId\\)`, 'g'), 'canonical latest-turn reader');
  const reverse = latest[1], turns = latest[2];
  const helper = `/*${MARKER}*/const communityRecovery=${options}.communityRecovery,communityOwnerRole=null==communityRecovery?null:${manager}.getStreamRole(${thread});let communityClientUserMessageId,communitySyntheticRuntime,communityOwnCreated=!1;const communityAssert=(allowOwn=!1)=>{if(null==communityRecovery)return;const fail=()=>{throw Error("Provider outage recovery is no longer current")};if(communityRecoveryLease.cancelled||${manager}.codexCommunityRecoveryLeases?.get(communityRecovery.token)!==communityRecoveryLease||(${manager}.codexCommunityRecoveryBlockedUntil??0)>Date.now())fail();${manager}.assertActive();const c=${manager}.getConversation(${thread}),role=${manager}.getStreamRole(${thread});if(null==c||communityRecovery.hostId!==${manager}.getHostId()||typeof communityRecovery.expectedTurnId!=="string"||!Number.isFinite(communityRecovery.expiresAt)||Date.now()>communityRecovery.expiresAt||role?.role!=="owner"||role!==communityOwnerRole||null!=communityRecovery.ownerClientId&&role.ownerClientId!==communityRecovery.ownerClientId||${manager}.getWindowActivity()?.canAcquireThreadStream!==!0||(c.requests?.length??0)>0||(c.unconfirmedTurnSubmissions?.length??0)>0)fail();const history=${turns}(c,${policy}),last=${reverse}()(history,x=>null!=x.turnId),pending=history.filter(x=>null==x.turnId&&x.status==="inProgress");if(last?.turnId!==communityRecovery.expectedTurnId||last?.status!=="failed"||last.error?.codexErrorInfo?.httpConnectionFailed?.httpStatusCode!==503)fail();if(allowOwn){if(!communityOwnCreated||pending.length!==1||pending[0].params?.clientUserMessageId!==communityClientUserMessageId||c.threadRuntimeStatus?.type!=="idle"&&c.threadRuntimeStatus!==communitySyntheticRuntime)fail()}else if(pending.length>0||c.threadRuntimeStatus?.type!=="idle")fail()};communityAssert();`;
  let patched = original.replace(method[0], method[0] + helper);
  patched = patched.replace(`startEmptyTurn(${argumentThread},${argumentOptions}){return `,
    `startEmptyTurn(${argumentThread},${argumentOptions}){const communityRecoveryLease=(${initializeRecoveryLease.toString()})(this,${argumentThread},${argumentOptions});if(communityRecoveryLease?.cancelAction)return Promise.resolve();return `);
  // The native readiness branch immediately follows the awaited resume.
  const ready = one(patched, /if\("not-ready"===([$\w]+)\.status\)/g, 'resume readiness guard');
  patched = patched.replace(ready[0], 'communityAssert();' + ready[0]);
  const context = one(patched, new RegExp(`context:\\{writingBlockContextPrepared:${options}\\.writingBlockContextPrepared\\}`, 'g'), 'empty-turn request context');
  patched = patched.replace(context[0], `context:{writingBlockContextPrepared:${options}.writingBlockContextPrepared,...null==communityRecovery?{}:{communityRecoveryBeforeOptimistic:()=>communityAssert(),communityRecoveryAfterOptimistic:runtime=>{communitySyntheticRuntime=runtime;communityOwnCreated=!0},assertRequestCurrent:()=>communityAssert(communityOwnCreated),communityRecoveryBeforeDispatch:()=>communityAssert(!0)}}`);
  const request = one(patched, new RegExp(`request:\\{threadId:${thread},turnTrigger:${options}\\.turnTrigger`, 'g'), 'empty-turn request');
  patched = patched.replace(request[0], `request:{...null==communityRecovery?{}:{clientUserMessageId:communityClientUserMessageId??=crypto.randomUUID()},threadId:${thread},turnTrigger:${options}.turnTrigger`);
  source = source.slice(0, method.index) + patched + source.slice(end + 1);

  // Check just before creating the native optimistic turn and synchronously
  // before dispatch. Capture the native synthetic runtime object itself so a
  // later genuine active status cannot be mistaken for our optimistic state.
  const optimistic = one(source, new RegExp(`(${ID})\\.updateConversationState\\((${ID}),(${ID})=>\\{let (${ID})=\\[\\],(${ID})=\\3\\.previousTurnModel;[\\s\\S]{0,3000}?\\}\\);let (${ID})=null,(${ID})=!1`, 'g'), 'optimistic turn insertion');
  if (!['pendingUserMessageAdmission', 'latestTurnStartMessageId', 'recencyAt'].every(x => optimistic[0].includes(x))) throw new Error('Provider recovery: optimistic insertion semantics drifted');
  const operationPrefix = source.slice(Math.max(0, optimistic.index - 35000), optimistic.index);
  const operations = [...operationPrefix.matchAll(new RegExp(`operation:(${ID}),capabilities:`, 'g'))];
  const operation = operations.at(-1)?.[1];
  if (!operation) throw new Error('Provider recovery: missing turn operation binding');
  const runtime = one(optimistic[0], new RegExp(`\\.threadRuntimeStatus=(${ID})`, 'g'), 'synthetic runtime assignment')[1];
  const split = optimistic[0].lastIndexOf('});let ');
  const injected = `${operation}.context?.communityRecoveryBeforeOptimistic?.();` + optimistic[0].slice(0, split + 3) + `${operation}.context?.communityRecoveryAfterOptimistic?.(${runtime});` + optimistic[0].slice(split + 3);
  source = source.slice(0, optimistic.index) + injected + source.slice(optimistic.index + optimistic[0].length);
  const dispatch = one(source, new RegExp(`(${ID})\\.dispatched\\(\\),(${ID})=${optimistic[1]}\\.getConversation\\(${optimistic[2]}\\)\\?\\.environmentSelectionEvidence`, 'g'), 'turn dispatch boundary');
  return source.slice(0, dispatch.index) + `${operation}.context?.communityRecoveryBeforeDispatch?.();` + source.slice(dispatch.index);
}

const descriptors = [
  { id: 'provider-outage-manager-main', phase: 'main-bundle', order: 150,
    ciPolicy: 'optional', apply: applyManagerGuard },
  { id: 'provider-outage-manager-renderer', phase: 'webview-asset', order: 1150,
    matchPolicy: 'all', ciPolicy: 'optional',
    assetNeedles: ['startEmptyTurn', 'streamRecovery.cancelTurnContinuation'],
    apply: applyManagerGuard },
];
module.exports = { applyManagerGuard, MARKER, descriptors };
