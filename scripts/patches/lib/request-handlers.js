"use strict";

const { findMatchingBrace } = require("./minified-js.js");

function findLegacyRequestHandlerMap(source) {
  const maps = [...source.matchAll(/(?<![\w$.])handlers=\{/g)];
  const classes = [...source.matchAll(/\bclass(?:\s+[A-Za-z_$][\w$]*)?(?:\s+extends\s+[A-Za-z_$][\w$.]*)?\{/g)];
  const candidates = [];
  for (const map of maps) {
    const start = map.index + map[0].length - 1;
    const end = findMatchingBrace(source, start);
    if (end < 0) continue;
    const owner = classes.findLast(entry => entry.index < map.index &&
      findMatchingBrace(source, entry.index + entry[0].length - 1) > end);
    if (!owner) continue;
    const ownerEnd = findMatchingBrace(source, owner.index + owner[0].length - 1);
    const body = source.slice(owner.index, ownerEnd + 1);
    // Register only in the map actually read by the surviving Electron router.
    const router = body.match(/handleVSCodeRequest\([^{}]*\)\{/);
    if (!router) continue;
    const routerStart = router.index + router[0].length - 1;
    const routerText = body.slice(routerStart, findMatchingBrace(body, routerStart) + 1);
    if (!routerText.includes("this.handlers[") || source.slice(start, end).split('"set-remote-wsl-connections-enabled":').length !== 2) continue;
    candidates.push({ start, end, text: source.slice(start + 1, end), ownerStart: owner.index, ownerEnd });
  }
  if (candidates.length !== 1) throw Error("Expected one live FetchHandler request map");
  return candidates[0];
}

// This lives on MessageHandler, reached only after upstream trusted-IPC sender
// validation. Do not register a second ipcMain channel or widen HTTP fetching.
const BRIDGE_METHODS = [
  'codexLinuxRequestControllers=new WeakMap;',
  'async codexLinuxHandleRequest(origin,request){let key=typeof request.url==="string"&&request.url.startsWith("vscode://codex/")?request.url.slice(15):null;if(process.platform!=="linux"||!Object.prototype.hasOwnProperty.call(this.codexLinuxRequestHandlers,key))return false;let requests=this.codexLinuxRequestControllers.get(origin);if(!requests){requests=new Map;this.codexLinuxRequestControllers.set(origin,requests)}let controller=new AbortController,owned=false;try{if(request.method!=="POST"||request.hostId!=null&&request.hostId!=="local"||typeof request.requestId!=="string")throw Error("Invalid Linux feature request");if(requests.has(request.requestId))throw Error("Duplicate Linux feature request");let params=JSON.parse(request.body??"{}");if(params===null||typeof params!=="object"||Array.isArray(params))throw Error("Invalid Linux feature parameters");requests.set(request.requestId,controller);owned=true;let value=await this.codexLinuxRequestHandlers[key]({...params,origin,signal:controller.signal});controller.signal.throwIfAborted();this.chunkedMessageSender.sendInlineMessageForView(origin,{type:"fetch-response",responseType:"success",requestId:request.requestId,status:200,headers:{"content-type":"application/json"},bodyJsonString:JSON.stringify(value??null)})}catch(error){this.chunkedMessageSender.sendInlineMessageForView(origin,{type:"fetch-response",responseType:"error",requestId:request.requestId,status:controller.signal.aborted?499:500,error:error instanceof Error?error.message:String(error)})}finally{if(owned)requests.delete(request.requestId)}return true}',
  'codexLinuxCancelRequest(origin,request){let controller=this.codexLinuxRequestControllers.get(origin)?.get(request.requestId);if(!controller)return false;controller.abort();return true}',
].join('');

function findMessageHandler(source) {
  const candidates = [];
  const classes = [...source.matchAll(/\bclass(?:\s+[A-Za-z_$][\w$]*)?(?:\s+extends\s+[A-Za-z_$][\w$.]*)?\{/g)];
  for (const method of source.matchAll(/async handleMessage\(([\w$]+),([\w$]+)\)\{/g)) {
    const bodyStart = method.index + method[0].length - 1;
    const end = findMatchingBrace(source, bodyStart);
    const body = source.slice(bodyStart, end + 1);
    const [,origin,request] = method;
    const fetch = `case"fetch":await this.fetchWrapper.handleRequest(${origin},${request});break;`;
    const cancel = `case"cancel-fetch":this.fetchWrapper.cancelRequest(${origin},${request});break;`;
    const patchedFetch = `case"fetch":if(await this.codexLinuxHandleRequest(${origin},${request}))break;await this.fetchWrapper.handleRequest(${origin},${request});break;`;
    const patchedCancel = `case"cancel-fetch":if(this.codexLinuxCancelRequest(${origin},${request}))break;this.fetchWrapper.cancelRequest(${origin},${request});break;`;
    if (!(body.includes(fetch)||body.includes(patchedFetch)) || !(body.includes(cancel)||body.includes(patchedCancel))) continue;
    const owner = classes.findLast(entry => entry.index < method.index && findMatchingBrace(source,entry.index+entry[0].length-1)>end);
    if (!owner) continue;
    const ownerEnd = findMatchingBrace(source,owner.index+owner[0].length-1);
    const ownerText = source.slice(owner.index,ownerEnd+1);
    const ownerName = /^class\s+([\w$]+)/.exec(owner[0])?.[1] ?? /([\w$]+)=$/.exec(source.slice(0,owner.index))?.[1];
    const guardedIpc = [...source.matchAll(/\.ipcMain\.handle\([\w$.]+,async\(([\w$]+),([\w$]+)\)=>\{if\(![\w$]+\(\1\)\)return;/g)].some(match => {
      const begin=match.index+match[0].indexOf('=>{')+2;
      const text=source.slice(begin,findMatchingBrace(source,begin)+1);
      return new RegExp(`await [\\w$]+\\.handleMessage\\(${match[1]}\\.sender,${match[2]}\\)`).test(text);
    });
    if (!ownerName || !source.includes(`this.messageHandler=new ${ownerName}(`) ||
        !/await this\.messageHandler\.handleMessage\([\w$]+,[\w$]+\)/.test(source) || !guardedIpc) continue;

    if (!['globalState;', 'windowManager;', 'chunkedMessageSender;', 'fetchWrapper;'].every(field=>ownerText.includes(field))) continue;
    candidates.push({methodStart:method.index,bodyStart,methodEnd:end,ownerStart:owner.index,ownerEnd,fetch,cancel,patchedFetch,patchedCancel,body,ownerText});
  }
  if (candidates.length!==1) throw Error("Expected one live MessageHandler fetch route");
  return candidates[0];
}

function findRequestHandlerMap(source) {
  // Older isolated feature fixtures still exercise the original contract.
  if (!source.includes('case"fetch":')) return findLegacyRequestHandlerMap(source);
  const route = findMessageHandler(source);
  const maps = [...route.ownerText.matchAll(/(?<![\w$.])codexLinuxRequestHandlers=\{/g)];
  if (maps.length===0) {
    if (source.includes('codexLinuxRequest') || source.includes('codexLinuxHandleRequest') || source.includes('codexLinuxCancelRequest')) throw Error("Incomplete Linux request bridge");
    return {...route,start:route.methodStart,end:route.methodStart,text:"",virtual:true};
  }
  if (maps.length!==1 || !route.body.includes(route.patchedFetch) || !route.body.includes(route.patchedCancel) || source.split(BRIDGE_METHODS).length!==2 || !route.ownerText.includes(BRIDGE_METHODS)) throw Error("Disconnected Linux request bridge");
  const start=route.ownerStart+maps[0].index+maps[0][0].length-1;
  const end=findMatchingBrace(source,start);
  return {...route,start,end,text:source.slice(start+1,end)};
}

function handlerKeys(payload) {
  const keys = [...payload.matchAll(/"([^"\\]+)":async/g)].map(match => match[1]);
  if (!keys.length || new Set(keys).size !== keys.length) throw Error("Invalid request handler payload");
  return keys;
}

function hasRegisteredRequestHandlers(source, payload) {
  try {
    const map = findRequestHandlerMap(source);
    return source.split(payload).length === 2 && map.text.includes(payload) &&
      handlerKeys(payload).every(key => map.text.split(`${JSON.stringify(key)}:`).length === 2);
  } catch { return false; }
}

function registerRequestHandlers(source, payload) {
  if (hasRegisteredRequestHandlers(source, payload)) return source;
  const map = findRequestHandlerMap(source);
  if (handlerKeys(payload).some(key => source.includes(`${JSON.stringify(key)}:`))) {
    throw Error("Found incomplete or misplaced request handlers");
  }
  if (map.virtual) {
    const body = map.body.replace(map.fetch,map.patchedFetch).replace(map.cancel,map.patchedCancel);
    return source.slice(0,map.methodStart) + `codexLinuxRequestHandlers={${payload}};` + BRIDGE_METHODS +
      source.slice(map.methodStart,map.bodyStart) + body + source.slice(map.methodEnd+1);
  }
  return source.slice(0, map.start + 1) + payload + (map.text ? "," : "") + source.slice(map.start + 1);
}

module.exports = { findRequestHandlerMap, registerRequestHandlers, hasRegisteredRequestHandlers };
