"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const { registerRequestHandlers, hasRegisteredRequestHandlers } = require("./request-handlers.js");

// The signed 26.1021.22027 FetchHandler retains one handler and this router.
const fixture = 'var FetchHandler=class{handlers={"set-remote-wsl-connections-enabled":async({enabled:e,origin:t})=>this.windowManager.getPrimaryWindows().some(e=>e.webContents===t)?this.remoteConnectionsHandler.setRemoteWslConnectionsEnabled(e):{remoteWslConnections:this.remoteConnectionsHandler.catalog.read().wsl??[]}};handleVSCodeRequest(e,t,n,r,i){try{let a=t,o=this.handlers[a];if(typeof o!=`function`)throw Error(`${t} not implemented`);let c=()=>o({...n,origin:e,signal:i});return r==null?c():source({source:r,requestKind:t},c)}catch(e){throw e}}};';
const payload = '"linux-probe":async({value:e,origin:t,signal:n})=>({value:e,origin:t,signal:n})';

test("registers requests in the current live FetchHandler map and routes payload and context", async () => {
  const patched = registerRequestHandlers(fixture, payload);
  assert.notEqual(patched, fixture);
  assert.equal(hasRegisteredRequestHandlers(patched, payload), true);
  assert.equal(registerRequestHandlers(patched, payload), patched);
  const context = {}; vm.runInNewContext(patched + 'globalThis.handler=new FetchHandler', context);
  const result = await context.handler.handleVSCodeRequest("window", "linux-probe", {value:42}, null, "signal");
  assert.deepEqual(JSON.parse(JSON.stringify(result)), {value:42,origin:"window",signal:"signal"});
});

test("rejects absent, dead, duplicate, misplaced and partial registration contracts", () => {
  const patched = registerRequestHandlers(fixture, payload);
  for (const source of [fixture.replace("handleVSCodeRequest", "deadRequest"), fixture+fixture,
    'var dead={'+payload+'};'+fixture, patched.replace("handlers={", "handlers={"+payload+","),
    fixture.replace('this.handlers[a]', 'this.otherHandlers[a]')]) {
    assert.equal(hasRegisteredRequestHandlers(source, payload), false);
    assert.throws(() => registerRequestHandlers(source, payload));
  }
});

// Reduced from signed 26.1029.61003: the trusted IPC route reaches this
// MessageHandler; FetchWrapper now only accepts the dictation special case.
const currentFixture = 'var Host=class{globalState;windowManager;chunkedMessageSender;fetchWrapper;constructor(options){Object.assign(this,options)}async handleMessage(e,t){switch(t.type){case"fetch":await this.fetchWrapper.handleRequest(e,t);break;case"cancel-fetch":this.fetchWrapper.cancelRequest(e,t);break;case"other":return"untouched"}}};var Context=class{constructor(){this.messageHandler=new Host({})}async handleMessage(e,t){await this.messageHandler.handleMessage(e,t)}};electron.ipcMain.handle(channel,async(t,n)=>{if(!trusted(t))return;let a=context(t.sender);a?await a.handleMessage(t.sender,n):null});';
function currentHost(source, extra = {}) {
  const context = {AbortController,process:{platform:"linux"},electron:{ipcMain:{handle(){}}},channel:"test"};
  vm.runInNewContext(source + ';globalThis.Host=Host', context);
  const replies = [], forwarded = [];
  const host = new context.Host({chunkedMessageSender:{sendInlineMessageForView:(origin,response)=>replies.push({origin,response})},fetchWrapper:{handleRequest:(...args)=>forwarded.push(args),cancelRequest:(...args)=>forwarded.push(args)},...extra});
  return {host,replies,forwarded};
}
const request = (key, body = {}, requestId = "one") => ({type:"fetch",hostId:"local",requestId,method:"POST",url:"vscode://codex/"+key,body:JSON.stringify(body)});

test("current signed MessageHandler routes registered requests with trusted context and preserves upstream fetch", async () => {
  const patched = registerRequestHandlers(currentFixture,payload);
  assert.equal(registerRequestHandlers(patched,payload),patched);
  assert.equal(hasRegisteredRequestHandlers(patched,payload),true);
  const {host,replies,forwarded} = currentHost(patched);
  const origin = {id:1};
  await host.handleMessage(origin,request("linux-probe",{value:42,origin:"spoof",signal:"spoof"}));
  assert.equal(replies[0].origin,origin);
  const value=JSON.parse(replies[0].response.bodyJsonString);
  assert.deepEqual(value,{value:42,origin:{id:1},signal:{}});
  assert.equal(replies[0].response.requestId,"one");
  assert.equal(replies[0].response.responseType,"success");
  await host.handleMessage(origin,{...request("unknown"),url:"https://example.test"});
  await host.handleMessage(origin,request("unregistered"));
  assert.equal(forwarded.length,2);
  assert.equal(await host.handleMessage(origin,{type:"other"}),"untouched");
});

test("current bridge reports malformed bodies and enforces POST and local host",async()=>{
  const {host,replies}=currentHost(registerRequestHandlers(currentFixture,payload));
  for(const change of [{body:"{"},{body:"[]"},{method:"GET"},{hostId:"remote"}]){
    await host.handleMessage({id:1},{...request("linux-probe"),...change});
    assert.equal(replies.at(-1).response.responseType,"error");
  }
});

test("current bridge cancellation is scoped to sender and releases request state",async()=>{
  const waiting='"linux-wait":async({signal})=>new Promise((resolve,reject)=>signal.addEventListener("abort",()=>reject(Error("cancelled")),{once:true}))';
  const {host,replies,forwarded}=currentHost(registerRequestHandlers(currentFixture,waiting));
  const origin={id:1},other={id:2};
  const pending=host.handleMessage(origin,request("linux-wait"));
  await host.handleMessage(other,{type:"cancel-fetch",requestId:"one"});
  assert.equal(replies.length,0);
  assert.equal(forwarded.length,1);
  await host.handleMessage(origin,{type:"cancel-fetch",requestId:"one"});
  await pending;
  assert.equal(replies[0].response.status,499);
  assert.equal(host.codexLinuxRequestControllers.get(origin).size,0);
});

test("current bridge fails closed on ambiguous, disconnected and partial contracts",()=>{
  const patched=registerRequestHandlers(currentFixture,payload);
  for(const source of [currentFixture+currentFixture,currentFixture.replace('this.messageHandler=new Host(', 'this.unused=new Other('),currentFixture.replace('a.handleMessage(t.sender,n)', 'a.unused(t.sender,n)'),currentFixture.replace('this.fetchWrapper.cancelRequest(e,t)','other.cancelRequest(e,t)'),patched.replace('this.codexLinuxHandleRequest(e,t)','this.unusedRequest(e,t)'),patched.replace('codexLinuxRequestHandlers={','unusedRequestHandlers={')]){
    assert.equal(hasRegisteredRequestHandlers(source,payload),false);
    assert.throws(()=>registerRequestHandlers(source,payload));
  }
});

// Exact sendRequest method from signed async/24191: vscode URLs retain the
// legacy fetch envelope while HTTP URLs use fetchJson.
const rendererSendRequest = "async sendRequest(e,t,n){if(!t.startsWith(\"vscode://codex/\")&&\"/codex/dictation-stream-connect-info\"!==t)return this.fetchJson(t,{...n,method:e});let r=crypto.randomUUID(),i={requestId:r,method:e,url:t,headers:n?.headers,body:n?.body,responsePriority:n?.responsePriority};return new Promise((e,t)=>{let a=()=>{this.pendingRequests.delete(r),n?.signal?.removeEventListener(\"abort\",a),o.QY.getInstance().dispatchMessage(\"cancel-fetch\",{requestId:r});let e=n?.signal?.reason;t(e instanceof Error?e:new DOMException(\"The operation was aborted\",\"AbortError\"))};if(this.pendingRequests.set(r,{cleanup:()=>n?.signal?.removeEventListener(\"abort\",a),resolve:e,reject:t}),n?.signal?.addEventListener(\"abort\",a,{once:!0}),n?.signal?.aborted)return void a();try{n?.assertRequestCurrent?.(),o.QY.getInstance().dispatchMessage(\"fetch\",i)}catch(e){throw this.pendingRequests.delete(r),n?.signal?.removeEventListener(\"abort\",a),e}})}";

test("signed renderer sendRequest roundtrips a serialized envelope through guarded IPC", async () => {
  const patched=registerRequestHandlers(currentFixture,payload);
  let ipcHandler,host,renderer;
  const origin={id:71};
  const context={AbortController,process:{platform:"linux"},channel:"codex_desktop:message-from-view",trusted:event=>event.sender===origin,context:()=>({handleMessage:(...args)=>host.handleMessage(...args)}),electron:{ipcMain:{handle:(_channel,handler)=>{ipcHandler=handler}}}};
  vm.runInNewContext(patched+';globalThis.Host=Host',context);
  host=new context.Host({chunkedMessageSender:{sendInlineMessageForView:(_origin,response)=>{
    const wire=JSON.parse(JSON.stringify(response)),pending=renderer.pendingRequests.get(wire.requestId);
    renderer.pendingRequests.delete(wire.requestId);
    wire.responseType==="success"?pending.resolve({status:wire.status,body:JSON.parse(wire.bodyJsonString)}):pending.reject(Error(wire.error));
  }},fetchWrapper:{handleRequest:()=>{throw Error("Unexpected upstream fetch")}}});
  let call;
  const bridge={sendMessageFromView:async envelope=>{call=ipcHandler({sender:origin},JSON.parse(JSON.stringify(envelope)));await call}};
  const rendererContext={crypto:{randomUUID:()=>"wire-id"},o:{QY:{getInstance:()=>({dispatchMessage:(type,params)=>bridge.sendMessageFromView({type,...params})})}}};
  vm.runInNewContext('globalThis.Renderer=class{pendingRequests=new Map;'+rendererSendRequest+'}',rendererContext);
  renderer=new rendererContext.Renderer;
  const value=await renderer.sendRequest("POST","vscode://codex/linux-probe",{body:JSON.stringify({value:19})});
  await call;
  assert.deepEqual(value.body,{value:19,origin:{id:71},signal:{}});
  assert.equal(renderer.pendingRequests.size,0);
  const size=host.codexLinuxRequestControllers.get(origin).size;
  await ipcHandler({sender:{id:999}},request("linux-probe"));
  assert.equal(host.codexLinuxRequestControllers.get(origin).size,size);
});


test("registration rewrites only the verified owning method",()=>{
  const decoy='async function dead(e,t){switch(t.type){case"fetch":await this.fetchWrapper.handleRequest(e,t);break;case"cancel-fetch":this.fetchWrapper.cancelRequest(e,t);break;}}';
  const patched=registerRequestHandlers(decoy+currentFixture,payload);
  assert.equal(patched.startsWith(decoy),true);
  assert.equal(hasRegisteredRequestHandlers(patched,payload),true);
});
