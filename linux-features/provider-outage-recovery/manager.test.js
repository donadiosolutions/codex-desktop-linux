'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const {applyManagerGuard} = require('./manager-patch');
// Exact signed ChatGPT 26.1103.60933 amd64 method, before any feature patch.
const originalMethod = 'startEmptyTurn(e,t){return this.streamRecovery.cancelTurnContinuation(e),async function({conversationId:e,manager:t,options:n,resumeConversation:r,startTurn:i,turnMergePolicy:a}){let s=!t.isCloudHost&&"resume_interrupted_task"===n.turnTrigger,o=s?{includeTurns:!1,requestOptions:{timeoutMs:3e4}}:{includeTurns:!1},l=await r({conversationId:e,model:null,reasoningEffort:null,workspaceRoots:[t.getConversationCwd(e)??"/"],collaborationMode:n.collaborationMode??t.getConversation(e)?.latestCollaborationMode??null},s?"follow-up":"view");if("not-ready"===l.status)throw new tY.uZ(l);let u=t.getConversation(e),d=null==u?null:O()(D(u,a),e=>null!=e.turnId)??null;if(u?.threadRuntimeStatus?.type==="active"||d?.status==="inProgress"&&u?.threadRuntimeStatus?.type!=="idle"){if(null==n.continuationInput||"idle"!==(await t.readThread(e,o)).thread.status.type)return;let r=t.getConversation(e)?.threadRuntimeStatus;if(r!==u?.threadRuntimeStatus&&r?.type!=="idle")return}try{await i({context:{writingBlockContextPrepared:n.writingBlockContextPrepared},request:{threadId:e,turnTrigger:n.turnTrigger,collaborationMode:n.collaborationMode,input:n.continuationInput??[],additionalContext:n.additionalContext}})}catch(a){if(!s)throw a;let n=t.getConversation(e)?.threadRuntimeStatus,r=await t.readThread(e,o).catch(()=>null),i=r?.thread.status;if(i?.type!=="active")throw a;t.getConversation(e)?.threadRuntimeStatus===n&&t.updateConversationState(e,e=>{e.threadRuntimeStatus=i})}}({conversationId:e,manager:this,options:t,resumeConversation:this.#V.bind(this),startTurn:t=>this.executeTurnStart(e,t),turnMergePolicy:this.history.turnMergePolicy})}';

// Exact signed native optimistic insertion, exercised with controlled preparation
// and transport boundaries; the callbacks are injected by the real patcher.
const nativeOptimistic = 'e.updateConversationState(t,e=>{let t=[],n=e.previousTurnModel;if(null!=n){let r=e.latestCollaborationMode.settings.model;Y.shouldShowModelChange(n,r)&&t.push({id:s(),type:"modelChanged",fromModel:n,toModel:r}),en||(e.previousTurnModel=null)}e7(e,{params:Y.params,pendingUserMessageAdmission:!!en||void 0,requestedReasoningEffort:(null==Y.request.collaborationMode?Y.request.effort:Y.request.collaborationMode.settings.reasoning_effort)??void 0,localMetadata:A,mcpAppModelContextAttachments:x,turnId:null,status:"inProgress",turnStartedAtMs:Date.now(),durationMs:null,finalAssistantStartedAtMs:null,error:null,diff:null,items:t},s),delete e.passiveTurnId,Z?.type!=="active"&&(e.threadRuntimeStatus=J),en||(e.latestTurnStartMessageId=a,er(e));let r=Date.now();e.updatedAt=r,e.recencyAt=r});let ei=null,ea=!1';
const nativePipeline = `async function native({manager:e,conversationId:t,operation:n,capabilities:r}){const J={type:"active"},Z=e.getConversation(t).threadRuntimeStatus,Y={params:{clientUserMessageId:n.request.clientUserMessageId},request:n.request},en=false,A=null,x=null,a=n.request.clientUserMessageId,s=()=>"item";let es;await n.context.assertRequestCurrent?.();${nativeOptimistic};await nativeStage("beforeSend");await n.context.assertRequestCurrent?.();await nativeStage("lastAwait");p.dispatched(),es=e.getConversation(t)?.environmentSelectionEvidence;}`;
function fixture(overrides = {}, patched = true) {
  let conversation = { id:'thread', turns:[{turnId:'failed',status:'failed',params:{},error:{codexErrorInfo:{httpConnectionFailed:{httpStatusCode:503}}}}], requests:[], threadRuntimeStatus:{type:'idle'} };
  const state = { resumes:0, sends:0, starts:0, role:{role:'owner',ownerClientId:'window'}, active:true,nativeCancels:0 };
  const source = originalMethod.replace('this.#V.bind(this)', 'this.resume.bind(this)');
  const patchedSource = patched ? applyManagerGuard(source + "steerTurn(){}" + nativePipeline) : source + "steerTurn(){}" + nativePipeline;
  const method = patchedSource.slice(0, patchedSource.indexOf('async function native('));
  const pipeline = patchedSource.slice(patchedSource.indexOf('async function native('));
  const {Manager,native} = vm.runInNewContext(`(()=>{${pipeline};return {Manager:class {${method}},native}})()`, {
    O:()=>((turns,predicate)=>turns.findLast(predicate)), D:c=>c.turns,
    tY:{uZ:Error}, Date, crypto:require('node:crypto').webcrypto,
    e7:(c,turn)=>c.turns.push(turn),er:()=>{},p:{dispatched:()=>state.sends++},
    nativeStage:async(stage)=>{await (stage==='beforeSend'?state.onBeforeSend:state.onLastAwait)?.();},
  });
  const manager = new Manager();
  Object.assign(manager, {
    streamRecovery:{cancelTurnContinuation(){state.nativeCancels++;}},history:{turnMergePolicy:{}},
    getConversation:()=>conversation, getConversationCwd:()=>'/work',getHostId:()=>'host',
    updateConversationState:(_,mutate)=>mutate(conversation),
    getStreamRole:()=>state.role,getWindowActivity:()=>({canAcquireThreadStream:state.active}),
    assertActive:()=>{ if(state.retired)throw Error('retired'); },
    resume:async()=>{state.resumes++;await state.onResume?.();return {status:'ready'};},
    executeTurnStart:async(_,operation)=>{
      state.starts++;
      await state.onPrepare?.();
      await native({manager,conversationId:'thread',operation});
    },...overrides,
  });
  const options = {turnTrigger:'provider_outage_retry_automatic',communityRecovery:{token:'test-recovery-token-0001',hostId:'host',expectedTurnId:'failed',ownerClientId:'window',expiresAt:Date.now()+10000}};
  return {manager,state,options,get conversation(){return conversation;},set conversation(value){conversation=value;}};
}

test('rejects an active runtime before resuming', async()=>{
  const f=fixture();f.conversation.threadRuntimeStatus={type:'active'};
  await assert.rejects(f.manager.startEmptyTurn('thread',f.options),/recovery/i);
  assert.equal(f.state.resumes,0);assert.equal(f.state.sends,0);
});

test('sends one empty continuation with its own optimistic identity', async()=>{
  const f=fixture();await f.manager.startEmptyTurn('thread',f.options);
  assert.equal(f.state.sends,1);assert.equal(f.state.resumes,1);
  assert.match(f.conversation.turns.at(-1).params.clientUserMessageId,/^[\da-f-]{36}$/);
});

for(const [name,change] of [
  ['changed failed turn',f=>{f.conversation.turns[0]={turnId:'new',status:'failed'};}],
  ['completed turn',f=>{f.conversation.turns[0].status='completed';}],
  ['unconfirmed submission',f=>{f.conversation.unconfirmedTurnSubmissions=[{requestId:'unknown'}];}],
  ['terminal unconfirmed submission',f=>{f.conversation.unconfirmedTurnSubmissions=[{requestId:'unknown',terminal:true}];}],
  ['pending approval',f=>{f.conversation.requests=[{id:'approval'}];}],
  ['lost ownership',f=>{f.state.role={role:'follower'};}],
  ['changed owner identity',f=>{f.state.role={role:'owner',ownerClientId:'different-window'};}],
  ['inactive window',f=>{f.state.active=false;}],
  ['retired manager',f=>{f.state.retired=true;}],
]) {
  test(`rejects ${name} after resume`,async()=>{
    const f=fixture();f.state.onResume=()=>change(f);
    await assert.rejects(f.manager.startEmptyTurn('thread',f.options));
    assert.equal(f.state.starts,0);assert.equal(f.state.sends,0);
  });
}

for(const [stage,property] of [['preparation','onPrepare'],['before send','onBeforeSend'],['last await','onLastAwait']]) {
  test(`rejects an external active runtime arriving during ${stage}`,async()=>{
    const f=fixture();f.state[property]=()=>{f.conversation.threadRuntimeStatus={type:'active'};};
    await assert.rejects(f.manager.startEmptyTurn('thread',f.options),/recovery/i);
    assert.equal(f.state.sends,0);
  });
  test(`rejects unknown outcomes arriving during ${stage}`,async()=>{
    const f=fixture();f.state[property]=()=>{f.conversation.unconfirmedTurnSubmissions=[{requestId:'unknown',terminal:true}];};
    await assert.rejects(f.manager.startEmptyTurn('thread',f.options),/recovery/i);
    assert.equal(f.state.sends,0);
    assert.equal(f.conversation.unconfirmedTurnSubmissions.length,1);
  });
}

test('rejects a foreign optimistic submission before dispatch',async()=>{
  const f=fixture();f.state.onBeforeSend=()=>{f.conversation.turns.push({turnId:null,status:'inProgress',params:{clientUserMessageId:'foreign'}});};
  await assert.rejects(f.manager.startEmptyTurn('thread',f.options),/recovery/i);
  assert.equal(f.state.sends,0);
});

test('checks the host and expiry before resuming',async()=>{
  for(const replacement of [{hostId:'other'},{expiresAt:0},{expiresAt:NaN},{expectedTurnId:undefined}]) {
    const f=fixture();Object.assign(f.options.communityRecovery,replacement);
    await assert.rejects(async()=>f.manager.startEmptyTurn('thread',f.options),/recovery/i);
    assert.equal(f.state.resumes,0);assert.equal(f.state.sends,0);
  }
});

test('checks expiry at the final synchronous dispatch boundary',async()=>{
  const f=fixture();f.state.onLastAwait=()=>{f.options.communityRecovery.expiresAt=0;};
  await assert.rejects(f.manager.startEmptyTurn('thread',f.options),/recovery/i);
  assert.equal(f.state.sends,0);
});

test('leaves ordinary empty turns and capacity retries unchanged',async()=>{
  const f=fixture();delete f.options.communityRecovery;f.options.turnTrigger='capacity_retry_automatic';
  f.state.role={role:'follower'};f.state.active=false;
  await f.manager.startEmptyTurn('thread',f.options);assert.equal(f.state.sends,1);
});

test('fails closed on incomplete or ambiguous native anchors',()=>{
  const source=originalMethod+'steerTurn(){}'+nativePipeline;
  assert.throws(()=>applyManagerGuard(source.replace('pendingUserMessageAdmission','drifted')),/semantics drifted/);
  assert.throws(()=>applyManagerGuard(source+source),/expected one/);
  assert.throws(()=>applyManagerGuard(originalMethod+'steerTurn(){}'),/optimistic turn insertion/);
  assert.equal(applyManagerGuard(applyManagerGuard(source)),applyManagerGuard(source));
});

test('requires an authoritative structured 503 on the expected failed turn',async()=>{
  for(const error of [null,{codexErrorInfo:'serverOverloaded'},{codexErrorInfo:{httpConnectionFailed:{httpStatusCode:401}}},{message:'503 Service Unavailable'}, {codexErrorInfo:{httpConnectionFailed:{httpStatusCode:'503'}}}]) {
    const f=fixture();f.conversation.turns[0].error=error;
    await assert.rejects(async()=>f.manager.startEmptyTurn('thread',f.options),/recovery/i);
    assert.equal(f.state.resumes,0);assert.equal(f.state.sends,0);
  }
});

test('rejects an owner-to-follower-to-owner flip even with identical IDs',async()=>{
  const f=fixture();f.state.onBeforeSend=()=>{f.state.role={role:'owner',ownerClientId:'window'};};
  await assert.rejects(f.manager.startEmptyTurn('thread',f.options),/recovery/i);
  assert.equal(f.state.sends,0);
});

test('infers changed minified bindings without matching their names',()=>{
  const source=originalMethod+'steerTurn(){}'+nativePipeline;
  const renamed=source.replace(/\b(e|t|n|r|i|a|s|o|l|u|d|Y|J|O|D)\b/g,name=>`renamed_${name}`);
  const patched=applyManagerGuard(renamed);
  assert.ok(patched.includes('renamed_n.context?.communityRecoveryBeforeDispatch?.()'));
  assert.ok(patched.includes('communityOwnerRole=null==communityRecovery?null:renamed_t.getStreamRole(renamed_e)'));
});

test('rejects incomplete prior patch markers',()=>{
  assert.throws(()=>applyManagerGuard('/*codexCommunityRecoveryManagerGuardV1*/'),/incomplete/i);
});

test('cancels during preparation through the existing plain-data method',async()=>{
  const f=fixture();f.options.communityRecovery.token='cancel-test-token-0001';
  f.state.onPrepare=()=>{f.state.onPrepare=null;return f.manager.startEmptyTurn('thread',{communityRecovery:{...f.options.communityRecovery,action:'cancel'}});};
  await assert.rejects(f.manager.startEmptyTurn('thread',f.options),/recovery/i);
  assert.equal(f.state.sends,0);assert.equal(f.state.resumes,1);
});

for(const [stage,property] of [['resume','onResume'],['before send','onBeforeSend'],['last await','onLastAwait']]) {
  test(`cancels via the existing RPC during ${stage}`,async()=>{
    const f=fixture();f.state[property]=()=>f.manager.startEmptyTurn('thread',{communityRecovery:{...f.options.communityRecovery,action:'cancel'}});
    await assert.rejects(f.manager.startEmptyTurn('thread',f.options),/recovery/i);
    assert.equal(f.state.sends,0);assert.equal(f.state.resumes,1);assert.equal(f.state.nativeCancels,1);
  });
}

test('preemptive cancellation tombstone blocks the later start without native actions',async()=>{
  const f=fixture();await f.manager.startEmptyTurn('thread',{communityRecovery:{...f.options.communityRecovery,action:'cancel'}});
  assert.equal(f.state.nativeCancels,0);assert.equal(f.state.resumes,0);
  await assert.rejects(async()=>f.manager.startEmptyTurn('thread',f.options),/recovery/i);
  assert.equal(f.state.nativeCancels,0);assert.equal(f.state.sends,0);
});

test('duplicate token cannot submit twice after acceptance or unknown outcome',async()=>{
  const f=fixture();await f.manager.startEmptyTurn('thread',f.options);
  await assert.rejects(async()=>f.manager.startEmptyTurn('thread',f.options),/recovery/i);
  assert.equal(f.state.sends,1);
});

test('prunes expired leases and caps cancellation memory with a safe barrier',async()=>{
  const f=fixture();f.manager.codexCommunityRecoveryLeases=new Map([['old',{expiresAt:0}]]);
  await f.manager.startEmptyTurn('thread',{communityRecovery:{...f.options.communityRecovery,action:'cancel'}});
  assert.equal(f.manager.codexCommunityRecoveryLeases.has('old'),false);
  for(let i=0;i<127;i++) await f.manager.startEmptyTurn('thread',{communityRecovery:{...f.options.communityRecovery,token:`cancellation-token-${i}`,action:'cancel'}});
  assert.equal(f.manager.codexCommunityRecoveryLeases.size,128);
  const fresh={...f.options.communityRecovery,token:'cancellation-overflow-token'};
  await f.manager.startEmptyTurn('thread',{communityRecovery:{...fresh,action:'cancel'}});
  assert.equal(f.manager.codexCommunityRecoveryLeases.size,128);
  await assert.rejects(async()=>f.manager.startEmptyTurn('thread',{communityRecovery:fresh}),/recovery/i);
  assert.equal(f.state.nativeCancels,0);assert.equal(f.state.sends,0);
});

test('rejects malformed and mismatched cancellation tokens',async()=>{
  const f=fixture();
  for(const replacement of [{token:'short'}, {expiresAt:Date.now()+1000000},{action:'invalid'}]) {
    await assert.rejects(async()=>f.manager.startEmptyTurn('thread',{communityRecovery:{...f.options.communityRecovery,...replacement}}),/recovery/i);
  }
  await f.manager.startEmptyTurn('thread',{communityRecovery:{...f.options.communityRecovery,action:'cancel'}});
  await assert.rejects(async()=>f.manager.startEmptyTurn('different-thread',{communityRecovery:{...f.options.communityRecovery,action:'cancel'}}),/recovery/i);
  assert.equal(f.state.nativeCancels,0);
});

test('permits native pre-optimistic current-request assertions',async()=>{
  const f=fixture();f.state.onPrepare=async()=>{};
  await f.manager.startEmptyTurn('thread',f.options);
  assert.equal(f.state.sends,1);
});
