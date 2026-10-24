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

const { applyLinuxNativeDesktopAppsHandlerPatch } = require("../impl/computer-use.js");
const nativeFactory = 'function wJe(){if(process.platform===`darwin`||process.platform===`win32`)return{getByBundleId:async e=>await lk(e)??await s.F(e),list:s.L,getIcon:async({appPath:e,size:t})=>t===`medium`?{iconSmall:null,iconMedium:await Zl(e)}:{iconSmall:await Xl(e)}}}';
const nativeFixture = nativeFactory + fixture.replace('class{handlers=', 'class{nativeApplications=wJe();handlers=');

test("current native applications service and registered requests share the Linux implementation", async () => {
  const patched = applyLinuxNativeDesktopAppsHandlerPatch(nativeFixture);
  assert.notEqual(patched, nativeFixture);
  assert.equal(applyLinuxNativeDesktopAppsHandlerPatch(patched), patched);
  new vm.Script(patched);
  const commands = [];
  const context = { process: {platform:"linux", env:{CODEX_LINUX_COMPUTER_USE_BACKEND_SOURCE:"/backend",XDG_DATA_DIRS:"/empty"}}, Buffer,
    require(name) {
      if (name === "node:child_process") return {spawnSync(bin,args,opts){commands.push({bin,args,opts});return {status:0,stdout:JSON.stringify({windows:[{app_id:"org.example.Editor",title:"Document",focused:true}]})};}};
      if (name === "node:fs") return {existsSync:p=>p==="/backend",accessSync(){},constants:{X_OK:1}};
      if (name === "node:os") return {homedir:()=>""};
      return require(name);
    } };
  vm.runInNewContext(patched+'globalThis.handler=new FetchHandler', context);
  const result = await context.handler.handleVSCodeRequest("window", "native-desktop-apps", {}, null, null);
  assert.equal(result.apps[0].bundleId,"org.example.Editor");
  assert.equal(result.apps[0].focused,true);
  assert.equal((await context.handler.nativeApplications.getByBundleId("org.example.Editor")).bundleId,"org.example.Editor");
  assert.equal(await context.handler.nativeApplications.getByBundleId("absent"),null);
  const icon = await context.handler.handleVSCodeRequest("window","computer-use-native-desktop-app-icon",{appPath:"linux:org.example.Editor"});
  assert.equal(icon.iconSmall,"");
  assert.equal(commands.length,3);
  assert.ok(commands.every(command=>command.opts.timeout===2500));
});

test("native applications port rejects missing duplicate disconnected and partial service contracts", () => {
  const patched = applyLinuxNativeDesktopAppsHandlerPatch(nativeFixture);
  const warn = console.warn;console.warn=()=>{};
  try {
    for (const source of [nativeFixture.replace("nativeApplications=wJe()", "unusedApplications=wJe()"),
      nativeFixture+nativeFactory, nativeFixture.replace("getByBundleId:","getById:"),
      patched.replace('"native-desktop-apps":', '"dead-native-desktop-apps":')]) {
      assert.equal(applyLinuxNativeDesktopAppsHandlerPatch(source),source);
    }
  } finally { console.warn=warn; }
});
