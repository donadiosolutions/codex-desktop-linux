"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { findMatchingBrace } = require("../../scripts/patches/lib/minified-js.js");
const { findMainProcessChunks, listWebviewAssetNames } = require("../../scripts/patches/lib/assets.js");
const { applyCurrentRemoteTerminalStatusPatch, matchesCurrentRemoteTerminalStatusContract } = require("./current-status.js");
const {
  applyCurrentRemoteControlHostParamsPatch,
  matchesCurrentRemoteControlHostParamsContract,
} = require("./current-services.js");

const { applyCurrentRevokeSetupReset, matchesCurrentRevokeSetupReset } = require("./current-settings.js");

const DEVICE_KEY_CLIENT_MARKER = "codexLinuxRemoteControlDeviceKeyClient";
const DEVICE_KEY_IDENT = "[A-Za-z_$][\\w$]*";

const DEVICE_KEY_ADDON_MARKER = "codexLinuxRemoteControlDeviceKeyAddon";

const REMOTE_CONTROL_OUTBOUND_TAB_GATE_MARKER = "codexLinuxRemoteControlOutboundTabGate";
const REMOTE_CONNECTIONS_REFRESH_MARKER = "codexLinuxRemoteConnectionsRefreshNow";
const REMOTE_CONTROL_LOAD_GATE_MARKER = "codexLinuxRemoteControlLoadGateEnabled";
const REMOTE_CONTROL_LOAD_GATE_NEEDLE =
  /function ([A-Za-z_$][\w$]*)\(\)\{return ([A-Za-z_$][\w$]*)\(`1042620455`\)\}/u;
const REMOTE_MOBILE_REASONING_SUMMARY_MARKER = "codexLinuxRemoteMobileReasoningSummaryNone";
const REMOTE_MOBILE_CONVERSATION_HYDRATION_MARKER =
  "codexLinuxRemoteMobileConversationHydration";
const REMOTE_CONTROL_ENABLEMENT_BRIDGE_MARKER = "codexLinuxRemoteControlEnablementBridge";
const REMOTE_CONTROL_ENABLE_FOR_HOST_PARAMS_MARKER = "codexLinuxRemoteControlEnableForHostParams";
const REMOTE_CONTROL_AUTO_CONNECT_CLEANUP_MARKER = "codexLinuxRemoteControlAutoConnectCleanup";
const REMOTE_MOBILE_ACTIVE_STATUS_MARKER = "codexLinuxRemoteMobileActiveStatus";
const REMOTE_CONTROL_STATUS_READ_GUARD_MARKER = "codexLinuxRemoteControlShouldReadStatus";
const REMOTE_CONTROL_STATUS_WAIT_MARKER = "codexLinuxRemoteControlStatusWaitMs";
const REMOTE_CONTROL_REVOKE_SETUP_RESET_MARKER = "codexLinuxRemoteControlResetMobileSetupAfterRevoke";
const REMOTE_CONTROL_VISIBILITY_MARKER = "codexLinuxRemoteControlVisibilityEnabled";
const REMOTE_CONTROL_UI_VISIBILITY_MARKER = "codexLinuxRemoteControlUiVisibilityEnabled";
const REMOTE_CONTROL_COPY_MARKER = "codexLinuxRemoteControlCopy";
const REMOTE_MOBILE_APP_SERVER_REMOTE_CONTROL_MARKER = "codexLinuxRemoteMobileLocalAppServerArgs";
const REMOTE_MOBILE_APP_SERVER_BASE_ARGS_NEEDLE = '["-c","features.code_mode_host=true"]';
const REMOTE_MOBILE_APP_SERVER_REMOTE_CONTROL_HELPER =
  "function codexLinuxRemoteMobileLocalAppServerArgs(e,t){if(process.env.CODEX_REMOTE_CONTROL_APP_SERVER_MODE===`proxy`){let n=process.env.CODEX_REMOTE_CONTROL_APP_SERVER_PROXY_SOCKET;if(n?.startsWith(`%h/`)&&process.env.HOME)n=`${process.env.HOME}${n.slice(2)}`;return[...e,...t,`app-server`,`proxy`,...(n?[`--sock`,n]:[])]}return t.length===0?[...e,`app-server`,`--remote-control`,`--analytics-default-enabled`]:[`app-server`,...e,...t,`--remote-control`,`--analytics-default-enabled`]}";
// Startup checks (`--print-startup-config`) are one-shot runs; app-server
// rejects them together with `--remote-control` or the `proxy` subcommand.
const REMOTE_MOBILE_APP_SERVER_STARTUP_GUARD_MARKER = "codexLinuxStartupCommandAppServerArgs";
const REMOTE_MOBILE_APP_SERVER_STARTUP_GUARD_HELPER =
  "function codexLinuxStartupCommandAppServerArgs(e,t){if(t==null||process.platform!==`linux`)return e;let n=e.indexOf(`app-server`);return n>=0&&e[n+1]===`proxy`?[...e.slice(0,n),`app-server`,`--analytics-default-enabled`]:e.filter(e=>e!==`--remote-control`)}";
const REMOTE_MOBILE_APP_SERVER_STARTUP_ARGS_PATTERN =
  /\.\.\.([A-Za-z_$][\w$]*)\.args,\.\.\.([A-Za-z_$][\w$]*)\.startupCommand\?\.args\?\?\[\]/gu;
const REMOTE_CONTROL_APP_INITIAL_ASSET_PATTERN = /^app-initial-[^.]+\.js$/u;
const REMOTE_CONTROL_APP_PRIMARY_ASSET_PATTERN = /^app-primary-[^.]+\.js$/u;
const REMOTE_CONTROL_VISIBILITY_ASSET_PATTERN = /^[^.]+\.js$/u;
const REMOTE_CONTROL_RSPACK_ASSET_PATTERN = /^(?:async\/)?\d+\.[0-9a-f]+\.js$/u;
const REMOTE_CONTROL_LINUX_COPY_REPLACEMENTS = [
  ["defaultMessage:`Mac`", "defaultMessage:`Linux`"],
  ["Keep this Mac awake", "Keep this Linux desktop awake"],
  ["Devices that can control this Mac", "Devices that can control this Linux desktop"],
  ["Control this Mac from your phone or other device", "Control this Linux desktop from your phone or other device"],
  ["Add device to control this Mac remotely", "Add device to control this Linux desktop remotely"],
  ["Control other devices from this Mac", "Control other devices from this Linux desktop"],
  ["Authorize this Mac to control other devices signed in to your ChatGPT account", "Authorize this Linux desktop to control other devices signed in to your ChatGPT account"],
  ["Allow this Mac to be discovered and controlled", "Allow this Linux desktop to be discovered and controlled"],
  ["Control this Mac", "Control this Linux desktop"],
  ["Devices you can control from this Mac", "Devices you can control from this Linux desktop"],
  ["SSH connections from this Mac", "SSH connections from this Linux desktop"],
  ["Use your Mac apps while locked", "Use your Linux apps while locked"],
  ["Control Mac apps from your phone", "Control Linux apps from your phone"],
  ["Let Codex control the apps on your Mac.", "Let Codex control apps on this Linux desktop."],
  ["Let Codex control the apps on your Mac", "Let Codex control apps on this Linux desktop"],
  ["Let ChatGPT control apps on your Mac", "Let ChatGPT control apps on this Linux desktop"],
  ["connected to ChatGPT on a Mac", "connected to ChatGPT on this Linux desktop"],
  ["Connect a device to this Mac", "Connect a device to this Linux desktop"],
  ["Connect your phone to this Mac", "Connect your phone to this Linux desktop"],
  ["Add device to control this Mac remotely", "Add a device to control this Linux desktop remotely"],
  ["Keep Mac awake", "Keep Linux desktop awake"],
  ["this Mac", "this Linux desktop"],
  ["local Mac", "local Linux desktop"],
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceOnce(source, needle, replacement) {
  if (!source.includes(needle)) {
    return null;
  }
  return source.replace(needle, replacement);
}

function linuxDeviceKeyProviderSource({ childProcessVar, cryptoVar, fsVar, pathVar }) {
  return [
    `const ${pathVar}=require(\`node:path\`),${fsVar}=require(\`node:fs\`),${cryptoVar}=require(\`node:crypto\`),${childProcessVar}=require(\`node:child_process\`);`,
    "const codexLinuxRemoteControlKeyStoreVersion=2,codexLinuxRemoteControlKeyStoreMaxBytes=1048576,codexLinuxRemoteControlKeyStoreMaxKeys=64;",
    "function codexLinuxRemoteControlAssertOwnedRegularStat(e){if(!e.isFile())throw Error(`Linux remote control key state must be a regular file`);if(typeof process.getuid==`function`&&e.uid!==process.getuid())throw Error(`Linux remote control key state is owned by another user`);if((e.mode&511)!==384)throw Error(`Linux remote control key state permissions must be 0600`);return e}",
    "function codexLinuxRemoteControlAssertOwnedRegularFile(e,t){let n=t.lstatSync(e);if(n.isSymbolicLink())throw Error(`Linux remote control key state must be a regular file`);return codexLinuxRemoteControlAssertOwnedRegularStat(n)}",
    "function codexLinuxRemoteControlDeviceKeyStorePath(){",
    `let codexLinuxRemoteControlConfigRoot=process.env.XDG_CONFIG_HOME&&process.env.XDG_CONFIG_HOME.trim()?process.env.XDG_CONFIG_HOME.trim():process.env.HOME?${pathVar}.join(process.env.HOME,\`.config\`):null;`,
    "if(codexLinuxRemoteControlConfigRoot==null)throw Error(`Linux remote control device keys require HOME or XDG_CONFIG_HOME`);",
    `if(!${pathVar}.isAbsolute(codexLinuxRemoteControlConfigRoot))throw Error(\`Linux remote control device key config root must be absolute\`);`,
    `let codexLinuxRemoteControlSharedConfigDirectory=${pathVar}.join(codexLinuxRemoteControlConfigRoot,\`codex-desktop\`);${fsVar}.mkdirSync(codexLinuxRemoteControlSharedConfigDirectory,{recursive:!0});`,
    `let codexLinuxRemoteControlSharedConfigDirectoryStat=${fsVar}.lstatSync(codexLinuxRemoteControlSharedConfigDirectory);if(codexLinuxRemoteControlSharedConfigDirectoryStat.isSymbolicLink()||!codexLinuxRemoteControlSharedConfigDirectoryStat.isDirectory())throw Error(\`Linux remote control shared config path must be a regular directory\`);`,
    "if(typeof process.getuid==`function`&&codexLinuxRemoteControlSharedConfigDirectoryStat.uid!==process.getuid())throw Error(`Linux remote control shared config directory is owned by another user`);",
    `let codexLinuxRemoteControlKeyStoreDirectory=${pathVar}.join(codexLinuxRemoteControlSharedConfigDirectory,\`remote-control-device-keys\`);${fsVar}.mkdirSync(codexLinuxRemoteControlKeyStoreDirectory,{recursive:!0,mode:448});`,
    `let codexLinuxRemoteControlKeyStoreDirectoryStat=${fsVar}.lstatSync(codexLinuxRemoteControlKeyStoreDirectory);if(codexLinuxRemoteControlKeyStoreDirectoryStat.isSymbolicLink()||!codexLinuxRemoteControlKeyStoreDirectoryStat.isDirectory())throw Error(\`Linux remote control device key directory must be a regular directory\`);`,
    "if(typeof process.getuid==`function`&&codexLinuxRemoteControlKeyStoreDirectoryStat.uid!==process.getuid())throw Error(`Linux remote control device key directory is owned by another user`);",
    "if((codexLinuxRemoteControlKeyStoreDirectoryStat.mode&511)!==448)throw Error(`Linux remote control device key directory permissions must be 0700`);",
    `let codexLinuxRemoteControlKeyStorePath=${pathVar}.join(codexLinuxRemoteControlKeyStoreDirectory,\`remote-control-device-keys-v1.json\`),codexLinuxRemoteControlLegacyKeyStorePath=${pathVar}.join(codexLinuxRemoteControlSharedConfigDirectory,\`remote-control-device-keys-v1.json\`);`,
    `if(!${fsVar}.existsSync(codexLinuxRemoteControlKeyStorePath)&&${fsVar}.existsSync(codexLinuxRemoteControlLegacyKeyStorePath)){let codexLinuxRemoteControlLegacyKeyStoreStat=codexLinuxRemoteControlAssertOwnedRegularFile(codexLinuxRemoteControlLegacyKeyStorePath,${fsVar});if(codexLinuxRemoteControlLegacyKeyStoreStat.size>codexLinuxRemoteControlKeyStoreMaxBytes)throw Error(\`Linux remote control device key store exceeds size limit\`);${fsVar}.renameSync(codexLinuxRemoteControlLegacyKeyStorePath,codexLinuxRemoteControlKeyStorePath)}`,
    "return codexLinuxRemoteControlKeyStorePath",
    "}",
    "function codexLinuxRemoteControlValidateDeviceKeyRecord(e,t){if(e==null||typeof e!=`object`||Array.isArray(e))throw Error(`Linux remote control device key record is invalid`);let n=[[e.keyId,128],[e.publicKeySpkiDerBase64,8192],[e.createdAt,64]],r=typeof e.privateKeyPkcs8Pem==`string`&&e.privateKeyPkcs8Pem.length>0&&e.privateKeyPkcs8Pem.length<=16384,i=typeof e.privateKeyCiphertextBase64==`string`&&e.privateKeyCiphertextBase64.length>0&&e.privateKeyCiphertextBase64.length<=32768,a=e.storageBackend==null||typeof e.storageBackend==`string`&&e.storageBackend.length>0&&e.storageBackend.length<=64,o=e.detectedBackend==null||typeof e.detectedBackend==`string`&&e.detectedBackend.length>0&&e.detectedBackend.length<=64;if(n.some(([e,t])=>typeof e!=`string`||e.length===0||e.length>t)||(!r&&!i)||r&&i||!a||!o||e.keyId!==t||e.algorithm!==`ecdsa_p256_sha256`||e.protectionClass!==`os_protected_nonextractable`||!Number.isFinite(Date.parse(e.createdAt)))throw Error(`Linux remote control device key record is invalid`)}",
    "function codexLinuxRemoteControlValidateDeviceKeyStore(e){if(e==null||typeof e!=`object`||Array.isArray(e)||e.version!==codexLinuxRemoteControlKeyStoreVersion||e.keys==null||typeof e.keys!=`object`||Array.isArray(e.keys))throw Error(`Linux remote control device key store schema is invalid`);let t=Object.entries(e.keys);if(t.length>codexLinuxRemoteControlKeyStoreMaxKeys)throw Error(`Linux remote control device key store exceeds key limit`);for(let[n,r]of t)codexLinuxRemoteControlValidateDeviceKeyRecord(r,n);return e}",
    "function codexLinuxRemoteControlPublicDeviceKey(codexLinuxRemoteControlKeyRecord){",
    "return{algorithm:codexLinuxRemoteControlKeyRecord.algorithm,keyId:codexLinuxRemoteControlKeyRecord.keyId,protectionClass:codexLinuxRemoteControlKeyRecord.protectionClass,publicKeySpkiDerBase64:codexLinuxRemoteControlKeyRecord.publicKeySpkiDerBase64}",
    "}",
    "function codexLinuxRemoteControlStorage(){",
    "let codexLinuxRemoteControlSafeStorage=null,codexLinuxRemoteControlDetectedBackend=`unavailable`;",
    "try{let codexLinuxRemoteControlElectron=require(`electron`),codexLinuxRemoteControlCandidate=codexLinuxRemoteControlElectron?.safeStorage;if(codexLinuxRemoteControlCandidate!=null){codexLinuxRemoteControlDetectedBackend=typeof codexLinuxRemoteControlCandidate.getSelectedStorageBackend===`function`?codexLinuxRemoteControlCandidate.getSelectedStorageBackend():`unknown`;if(codexLinuxRemoteControlDetectedBackend!==`unknown`&&codexLinuxRemoteControlDetectedBackend!==`basic_text`&&(typeof codexLinuxRemoteControlCandidate.isEncryptionAvailable!==`function`||codexLinuxRemoteControlCandidate.isEncryptionAvailable()))codexLinuxRemoteControlSafeStorage=codexLinuxRemoteControlCandidate}}catch{}",
    "return{safeStorage:codexLinuxRemoteControlSafeStorage,detectedBackend:codexLinuxRemoteControlDetectedBackend}",
    "}",
    "function codexLinuxRemoteControlStorageFields(codexLinuxRemoteControlPrivateKeyPem){",
    "let codexLinuxRemoteControlStorageState=codexLinuxRemoteControlStorage();",
    "if(codexLinuxRemoteControlStorageState.safeStorage==null){console.warn(`WARN: Linux remote control keychain unavailable; storing device key with file permissions 0600 (detected backend: ${codexLinuxRemoteControlStorageState.detectedBackend})`);return{privateKeyPkcs8Pem:codexLinuxRemoteControlPrivateKeyPem,storageBackend:`file_0600`,detectedBackend:codexLinuxRemoteControlStorageState.detectedBackend}}",
    "return{privateKeyCiphertextBase64:codexLinuxRemoteControlStorageState.safeStorage.encryptString(codexLinuxRemoteControlPrivateKeyPem).toString(`base64`),storageBackend:codexLinuxRemoteControlStorageState.detectedBackend,detectedBackend:codexLinuxRemoteControlStorageState.detectedBackend}",
    "}",
    "function codexLinuxRemoteControlPrivateKeyPem(codexLinuxRemoteControlKeyRecord){",
    "if(typeof codexLinuxRemoteControlKeyRecord.privateKeyPkcs8Pem===`string`)return codexLinuxRemoteControlKeyRecord.privateKeyPkcs8Pem;",
    "if(typeof codexLinuxRemoteControlKeyRecord.privateKeyCiphertextBase64!==`string`)throw Error(`Linux remote control device key has no private key material`);",
    "let codexLinuxRemoteControlStorageState=codexLinuxRemoteControlStorage();if(codexLinuxRemoteControlStorageState.safeStorage==null)throw Error(`Linux remote control device keychain is unavailable`);",
    "try{return codexLinuxRemoteControlStorageState.safeStorage.decryptString(Buffer.from(codexLinuxRemoteControlKeyRecord.privateKeyCiphertextBase64,`base64`))}catch(codexLinuxRemoteControlDecryptError){throw Error(`Failed to decrypt Linux remote control device key`)}",
    "}",
    "function codexLinuxReadRemoteControlDeviceKeyStore(){",
    "let codexLinuxRemoteControlKeyStorePath=codexLinuxRemoteControlDeviceKeyStorePath();",
    `if(!${fsVar}.existsSync(codexLinuxRemoteControlKeyStorePath))return{version:codexLinuxRemoteControlKeyStoreVersion,keys:{}};`,
    `let codexLinuxRemoteControlKeyStoreStat=codexLinuxRemoteControlAssertOwnedRegularFile(codexLinuxRemoteControlKeyStorePath,${fsVar});if(codexLinuxRemoteControlKeyStoreStat.size>codexLinuxRemoteControlKeyStoreMaxBytes)throw Error(\`Linux remote control device key store exceeds size limit\`);`,
    `let codexLinuxRemoteControlKeyStoreFd=${fsVar}.openSync(codexLinuxRemoteControlKeyStorePath,${fsVar}.constants.O_RDONLY|${fsVar}.constants.O_NOFOLLOW),codexLinuxRemoteControlKeyStoreText;try{codexLinuxRemoteControlKeyStoreStat=codexLinuxRemoteControlAssertOwnedRegularStat(${fsVar}.fstatSync(codexLinuxRemoteControlKeyStoreFd));if(codexLinuxRemoteControlKeyStoreStat.size>codexLinuxRemoteControlKeyStoreMaxBytes)throw Error(\`Linux remote control device key store exceeds size limit\`);let codexLinuxRemoteControlKeyStoreBuffer=Buffer.alloc(codexLinuxRemoteControlKeyStoreStat.size),codexLinuxRemoteControlKeyStoreOffset=0,codexLinuxRemoteControlKeyStoreBytesRead;while(codexLinuxRemoteControlKeyStoreOffset<codexLinuxRemoteControlKeyStoreBuffer.length&&(codexLinuxRemoteControlKeyStoreBytesRead=${fsVar}.readSync(codexLinuxRemoteControlKeyStoreFd,codexLinuxRemoteControlKeyStoreBuffer,codexLinuxRemoteControlKeyStoreOffset,codexLinuxRemoteControlKeyStoreBuffer.length-codexLinuxRemoteControlKeyStoreOffset,codexLinuxRemoteControlKeyStoreOffset))>0)codexLinuxRemoteControlKeyStoreOffset+=codexLinuxRemoteControlKeyStoreBytesRead;codexLinuxRemoteControlKeyStoreText=codexLinuxRemoteControlKeyStoreBuffer.subarray(0,codexLinuxRemoteControlKeyStoreOffset).toString(\`utf8\`)}finally{${fsVar}.closeSync(codexLinuxRemoteControlKeyStoreFd)}`,
    "let codexLinuxRemoteControlKeyStore;try{codexLinuxRemoteControlKeyStore=JSON.parse(codexLinuxRemoteControlKeyStoreText)}catch{throw Error(`Linux remote control device key store contains invalid JSON`)}",
    "if(codexLinuxRemoteControlKeyStore&&(codexLinuxRemoteControlKeyStore.version==null||codexLinuxRemoteControlKeyStore.version===1))codexLinuxRemoteControlKeyStore={version:codexLinuxRemoteControlKeyStoreVersion,keys:codexLinuxRemoteControlKeyStore.keys};return codexLinuxRemoteControlValidateDeviceKeyStore(codexLinuxRemoteControlKeyStore)",
    "}",
    "function codexLinuxRemoteControlMigrateDeviceKeyStore(e){let t=codexLinuxRemoteControlStorage();if(t.safeStorage==null)return null;let n={version:codexLinuxRemoteControlKeyStoreVersion,keys:{...e.keys}},r=!1;for(let [e,i] of Object.entries(n.keys))if(typeof i.privateKeyPkcs8Pem===`string`)try{let a=codexLinuxRemoteControlStorageFields(i.privateKeyPkcs8Pem);n.keys[e]={...i,...a};delete n.keys[e].privateKeyPkcs8Pem;r=!0}catch{console.warn(`WARN: Could not migrate Linux remote control device key to safeStorage; retaining legacy file-backed key`)}return r?n:null}",
    `function codexLinuxRemoteControlOpenKeyStoreLock(){let e=codexLinuxRemoteControlDeviceKeyStorePath()+\`.lock\`,t,n=!1;try{try{t=${fsVar}.openSync(e,${fsVar}.constants.O_RDWR|${fsVar}.constants.O_CREAT|${fsVar}.constants.O_EXCL|${fsVar}.constants.O_NOFOLLOW,384),n=!0}catch(r){if(r?.code!==\`EEXIST\`)throw r;t=${fsVar}.openSync(e,${fsVar}.constants.O_RDWR|${fsVar}.constants.O_NOFOLLOW)}n&&${fsVar}.fchmodSync(t,384),codexLinuxRemoteControlAssertOwnedRegularStat(${fsVar}.fstatSync(t));return t}catch(r){try{t!=null&&${fsVar}.closeSync(t)}catch{}throw r}}`,
    `function codexLinuxRemoteControlResolveExecutable(codexLinuxRemoteControlExecutableName){let codexLinuxRemoteControlSearchDirectories=[...(process.env.PATH??\`\`).split(${pathVar}.delimiter),\`/run/current-system/sw/bin\`,\`/nix/var/nix/profiles/default/bin\`,\`/usr/local/bin\`,\`/usr/bin\`,\`/bin\`],codexLinuxRemoteControlSeenDirectories=new Set;for(let codexLinuxRemoteControlDirectory of codexLinuxRemoteControlSearchDirectories){if(!codexLinuxRemoteControlDirectory||!${pathVar}.isAbsolute(codexLinuxRemoteControlDirectory)||codexLinuxRemoteControlSeenDirectories.has(codexLinuxRemoteControlDirectory))continue;codexLinuxRemoteControlSeenDirectories.add(codexLinuxRemoteControlDirectory);try{let codexLinuxRemoteControlExecutablePath=${fsVar}.realpathSync(${pathVar}.join(codexLinuxRemoteControlDirectory,codexLinuxRemoteControlExecutableName)),codexLinuxRemoteControlExecutableStat=${fsVar}.statSync(codexLinuxRemoteControlExecutablePath);if(!codexLinuxRemoteControlExecutableStat.isFile())continue;${fsVar}.accessSync(codexLinuxRemoteControlExecutablePath,${fsVar}.constants.X_OK);return codexLinuxRemoteControlExecutablePath}catch{}}return null}`,
    `function codexLinuxWithRemoteControlKeyStoreLock(codexLinuxRemoteControlLockedOperation){let codexLinuxRemoteControlLockFd=codexLinuxRemoteControlOpenKeyStoreLock(),codexLinuxRemoteControlFlockPath=codexLinuxRemoteControlResolveExecutable(\`flock\`),codexLinuxRemoteControlShellPath=codexLinuxRemoteControlResolveExecutable(\`sh\`);if(codexLinuxRemoteControlFlockPath==null||codexLinuxRemoteControlShellPath==null){${fsVar}.closeSync(codexLinuxRemoteControlLockFd);throw Error(\`Linux remote control device key store requires flock and sh\`)}return new Promise((codexLinuxRemoteControlResolve,codexLinuxRemoteControlReject)=>{let codexLinuxRemoteControlLockProcess;try{codexLinuxRemoteControlLockProcess=${childProcessVar}.spawn(codexLinuxRemoteControlFlockPath,[\`-x\`,\`-w\`,\`5\`,\`/proc/self/fd/3\`,codexLinuxRemoteControlShellPath,\`-c\`,\`printf 'ready\\n'; cat >/dev/null\`],{stdio:[\`pipe\`,\`pipe\`,\`pipe\`,codexLinuxRemoteControlLockFd]})}finally{${fsVar}.closeSync(codexLinuxRemoteControlLockFd)}let codexLinuxRemoteControlStdout=\`\`,codexLinuxRemoteControlStderr=\`\`,codexLinuxRemoteControlResult,codexLinuxRemoteControlReady=!1,codexLinuxRemoteControlOperationDone=!1,codexLinuxRemoteControlProcessDone=!1,codexLinuxRemoteControlExitCode=null,codexLinuxRemoteControlFailure=null,codexLinuxRemoteControlTimer=setTimeout(()=>{codexLinuxRemoteControlReady||(codexLinuxRemoteControlFailure=Error(\`Timed out waiting for Linux remote control device key store lock\`),codexLinuxRemoteControlOperationDone=!0,codexLinuxRemoteControlLockProcess.kill())},5500),codexLinuxRemoteControlSettle=()=>{if(!codexLinuxRemoteControlOperationDone||!codexLinuxRemoteControlProcessDone)return;codexLinuxRemoteControlFailure?codexLinuxRemoteControlReject(codexLinuxRemoteControlFailure):codexLinuxRemoteControlExitCode===0?codexLinuxRemoteControlResolve(codexLinuxRemoteControlResult):codexLinuxRemoteControlReject(Error(\`Linux remote control device key store lock failed\`))};codexLinuxRemoteControlLockProcess.stderr.on(\`data\`,codexLinuxRemoteControlChunk=>{codexLinuxRemoteControlStderr=(codexLinuxRemoteControlStderr+String(codexLinuxRemoteControlChunk)).slice(-4096)}),codexLinuxRemoteControlLockProcess.on(\`error\`,codexLinuxRemoteControlError=>{clearTimeout(codexLinuxRemoteControlTimer),codexLinuxRemoteControlFailure=codexLinuxRemoteControlError,codexLinuxRemoteControlOperationDone=!0,codexLinuxRemoteControlProcessDone=!0,codexLinuxRemoteControlSettle()}),codexLinuxRemoteControlLockProcess.on(\`close\`,codexLinuxRemoteControlCode=>{clearTimeout(codexLinuxRemoteControlTimer),codexLinuxRemoteControlExitCode=codexLinuxRemoteControlCode,codexLinuxRemoteControlProcessDone=!0,codexLinuxRemoteControlReady||(codexLinuxRemoteControlFailure=Error(codexLinuxRemoteControlStderr.trim()||\`Timed out waiting for Linux remote control device key store lock\`),codexLinuxRemoteControlOperationDone=!0),codexLinuxRemoteControlSettle()}),codexLinuxRemoteControlLockProcess.stdout.on(\`data\`,codexLinuxRemoteControlChunk=>{if(codexLinuxRemoteControlReady)return;codexLinuxRemoteControlStdout+=String(codexLinuxRemoteControlChunk);if(!codexLinuxRemoteControlStdout.includes(\`ready\\n\`))return;codexLinuxRemoteControlReady=!0,clearTimeout(codexLinuxRemoteControlTimer),Promise.resolve().then(codexLinuxRemoteControlLockedOperation).then(codexLinuxRemoteControlValue=>{codexLinuxRemoteControlResult=codexLinuxRemoteControlValue,codexLinuxRemoteControlOperationDone=!0,codexLinuxRemoteControlLockProcess.stdin.end(),codexLinuxRemoteControlSettle()},codexLinuxRemoteControlError=>{codexLinuxRemoteControlFailure=codexLinuxRemoteControlError,codexLinuxRemoteControlOperationDone=!0,codexLinuxRemoteControlLockProcess.stdin.end(),codexLinuxRemoteControlSettle()})})})}`,
    "function codexLinuxWriteRemoteControlDeviceKeyStore(codexLinuxRemoteControlKeyStore){",
    `codexLinuxRemoteControlValidateDeviceKeyStore(codexLinuxRemoteControlKeyStore);let codexLinuxRemoteControlKeyStorePath=codexLinuxRemoteControlDeviceKeyStorePath(),codexLinuxRemoteControlKeyStoreDirectory=${pathVar}.dirname(codexLinuxRemoteControlKeyStorePath),codexLinuxRemoteControlTempPath=codexLinuxRemoteControlKeyStorePath+\`.tmp-\`+${cryptoVar}.randomUUID(),codexLinuxRemoteControlKeyStoreText=JSON.stringify(codexLinuxRemoteControlKeyStore,null,2)+\`\\n\`,codexLinuxRemoteControlTempFd=null,codexLinuxRemoteControlDirectoryFd=null,codexLinuxRemoteControlTempCreated=!1;if(Buffer.byteLength(codexLinuxRemoteControlKeyStoreText,\`utf8\`)>codexLinuxRemoteControlKeyStoreMaxBytes)throw Error(\`Linux remote control device key store exceeds size limit\`);`,
    `try{codexLinuxRemoteControlTempFd=${fsVar}.openSync(codexLinuxRemoteControlTempPath,${fsVar}.constants.O_WRONLY|${fsVar}.constants.O_CREAT|${fsVar}.constants.O_EXCL|${fsVar}.constants.O_NOFOLLOW,384),codexLinuxRemoteControlTempCreated=!0,${fsVar}.writeFileSync(codexLinuxRemoteControlTempFd,codexLinuxRemoteControlKeyStoreText,\`utf8\`),${fsVar}.fsyncSync(codexLinuxRemoteControlTempFd),${fsVar}.closeSync(codexLinuxRemoteControlTempFd),codexLinuxRemoteControlTempFd=null;${fsVar}.existsSync(codexLinuxRemoteControlKeyStorePath)&&codexLinuxRemoteControlAssertOwnedRegularFile(codexLinuxRemoteControlKeyStorePath,${fsVar});${fsVar}.renameSync(codexLinuxRemoteControlTempPath,codexLinuxRemoteControlKeyStorePath),codexLinuxRemoteControlTempCreated=!1;try{codexLinuxRemoteControlDirectoryFd=${fsVar}.openSync(codexLinuxRemoteControlKeyStoreDirectory,${fsVar}.constants.O_RDONLY),${fsVar}.fsyncSync(codexLinuxRemoteControlDirectoryFd),${fsVar}.closeSync(codexLinuxRemoteControlDirectoryFd),codexLinuxRemoteControlDirectoryFd=null}catch(codexLinuxRemoteControlDirectorySyncError){try{codexLinuxRemoteControlDirectoryFd!=null&&${fsVar}.closeSync(codexLinuxRemoteControlDirectoryFd)}catch{}codexLinuxRemoteControlDirectoryFd=null;console.warn(\`WARN: Linux remote control device-key store rename committed but directory fsync failed; crash durability is not confirmed\`)}}catch(codexLinuxRemoteControlWriteError){try{codexLinuxRemoteControlTempFd!=null&&${fsVar}.closeSync(codexLinuxRemoteControlTempFd)}catch{}try{codexLinuxRemoteControlDirectoryFd!=null&&${fsVar}.closeSync(codexLinuxRemoteControlDirectoryFd)}catch{}try{codexLinuxRemoteControlTempCreated&&${fsVar}.rmSync(codexLinuxRemoteControlTempPath,{force:!0})}catch{}throw codexLinuxRemoteControlWriteError}`,
    "}",
    `function ${DEVICE_KEY_ADDON_MARKER}(){return{`,
    "createDeviceKey:async codexLinuxRemoteControlProtectionClass=>{",
    `let codexLinuxRemoteControlKeyPair=(0,${cryptoVar}.generateKeyPairSync)(\`ec\`,{namedCurve:\`P-256\`}),codexLinuxRemoteControlPublicKey=codexLinuxRemoteControlKeyPair.publicKey,codexLinuxRemoteControlSigningKey=codexLinuxRemoteControlKeyPair[\`private\`+\`Key\`];`,
    `let codexLinuxRemoteControlKeyId=(0,${cryptoVar}.randomUUID)(),codexLinuxRemoteControlPublicKeySpkiDerBase64=codexLinuxRemoteControlPublicKey.export({type:\`spki\`,format:\`der\`}).toString(\`base64\`),codexLinuxRemoteControlSigningKeyPkcs8Pem=codexLinuxRemoteControlSigningKey.export({type:\`pkcs8\`,format:\`pem\`});`,
    "let codexLinuxRemoteControlKeyRecord={algorithm:`ecdsa_p256_sha256`,keyId:codexLinuxRemoteControlKeyId,protectionClass:`os_protected_nonextractable`,publicKeySpkiDerBase64:codexLinuxRemoteControlPublicKeySpkiDerBase64,...codexLinuxRemoteControlStorageFields(codexLinuxRemoteControlSigningKeyPkcs8Pem),createdAt:new Date().toISOString()};",
    "await codexLinuxWithRemoteControlKeyStoreLock(()=>{let e=codexLinuxReadRemoteControlDeviceKeyStore(),t=codexLinuxRemoteControlMigrateDeviceKeyStore(e)??e;t.version=codexLinuxRemoteControlKeyStoreVersion,t.keys={...t.keys,[codexLinuxRemoteControlKeyId]:codexLinuxRemoteControlKeyRecord},codexLinuxWriteRemoteControlDeviceKeyStore(t)});",
    "return codexLinuxRemoteControlPublicDeviceKey(codexLinuxRemoteControlKeyRecord)",
    "},",
    "deleteDeviceKey:async codexLinuxRemoteControlKeyId=>codexLinuxWithRemoteControlKeyStoreLock(()=>{let e=codexLinuxReadRemoteControlDeviceKeyStore(),t=codexLinuxRemoteControlMigrateDeviceKeyStore(e)??e;delete t.keys[codexLinuxRemoteControlKeyId],codexLinuxWriteRemoteControlDeviceKeyStore(t)}),",
    "getDeviceKeyPublic:async codexLinuxRemoteControlKeyId=>codexLinuxWithRemoteControlKeyStoreLock(()=>{let e=codexLinuxReadRemoteControlDeviceKeyStore(),t=codexLinuxRemoteControlMigrateDeviceKeyStore(e)??e;t!==e&&codexLinuxWriteRemoteControlDeviceKeyStore(t);let n=t.keys?.[codexLinuxRemoteControlKeyId];if(n==null)throw Error(`Linux remote control device key not found`);codexLinuxRemoteControlPrivateKeyPem(n);return codexLinuxRemoteControlPublicDeviceKey(n)}),",
    `signDeviceKey:async(codexLinuxRemoteControlKeyId,codexLinuxRemoteControlSerializedPayload)=>codexLinuxWithRemoteControlKeyStoreLock(()=>{if(!Buffer.isBuffer(codexLinuxRemoteControlSerializedPayload))throw Error(\`Linux remote control device key payload must be serialized\`);let e=codexLinuxReadRemoteControlDeviceKeyStore(),t=codexLinuxRemoteControlMigrateDeviceKeyStore(e)??e;t!==e&&codexLinuxWriteRemoteControlDeviceKeyStore(t);let n=t.keys?.[codexLinuxRemoteControlKeyId];if(n==null)throw Error(\`Linux remote control device key not found\`);let i=(0,${cryptoVar}.createPrivateKey)(codexLinuxRemoteControlPrivateKeyPem(n)),a=(0,${cryptoVar}.sign)(\`sha256\`,codexLinuxRemoteControlSerializedPayload,i).toString(\`base64\`);return{algorithm:n.algorithm,signatureDerBase64:a}})`,
    "}}",
    // Keep upstream payload serialization and validation; replace only the addon.
    `function ${DEVICE_KEY_CLIENT_MARKER}(e){let t=new e(null),n=${DEVICE_KEY_ADDON_MARKER}();return t.addon=n,t.getAddon=()=>n,t}`,
  ].join("");
}

function deviceKeyPatchState(source) {
  const providerMatches = [...source.matchAll(/class (?<providerClass>[A-Za-z_$][\w$]*)\{/gu)]
    .flatMap((match) => {
      const open = match.index + match[0].length - 1;
      const end = findMatchingBrace(source, open);
      if (end <= open) return [];
      const body = source.slice(open + 1, end);
      const hasProviderMethods = body.includes("resourcesPath;addon=null;") &&
        /createDeviceKey\([A-Za-z_$][\w$]*\)\{return this\.getAddon\(\)\.createDeviceKey\(/u.test(body) &&
        /deleteDeviceKey\([A-Za-z_$][\w$]*\)\{return this\.getAddon\(\)\.deleteDeviceKey\(/u.test(body) &&
        /getDeviceKeyPublic\([A-Za-z_$][\w$]*\)\{return this\.getAddon\(\)\.getDeviceKeyPublic\(/u.test(body) &&
        body.includes("getAddon(){") && body.includes("resourcesPath") &&
        body.includes("remote-control-device-key.node") &&
        (body.includes("signDeviceKey(") || body.includes("signBytes("));
      return hasProviderMethods ? [{ ...match, groups: { ...match.groups, providerClass: match.groups.providerClass } }] : [];
    });
  if (providerMatches.length !== 1) {
    return { kind: providerMatches.length > 1 ? "ambiguous" : "partial" };
  }
  const providerMatch = providerMatches[0];
  const providerSource = linuxDeviceKeyProviderSource({
    childProcessVar: "codexLinuxRemoteControlChildProcess",
    cryptoVar: "codexLinuxRemoteControlCrypto",
    fsVar: "codexLinuxRemoteControlFs",
    pathVar: "codexLinuxRemoteControlPath",
  });
  const providerSourceCount = source.split(providerSource).length - 1;
  const providerClass = escapeRegExp(providerMatch.groups.providerClass);
  const currentConstructionPattern = new RegExp(
    `this\\.remoteControlDeviceKeyClient=new (?<clientClass>${DEVICE_KEY_IDENT})\\((?<args>[\\s\\S]{1,300}?)\\),this\\.executionHostRegistry`,
    "gu",
  );
  const patchedConstructionPattern = new RegExp(
    `this\\.remoteControlDeviceKeyClient=process\\.platform===\`linux\`\\?` +
      `${DEVICE_KEY_CLIENT_MARKER}\\((?<clientClass>${DEVICE_KEY_IDENT})\\):new \\k<clientClass>\\((?<args>[\\s\\S]{1,300}?)\\),` +
      `this\\.executionHostRegistry`,
    "gu",
  );
  const currentConstructions = [...source.matchAll(currentConstructionPattern)];
  const patchedConstructions = [...source.matchAll(patchedConstructionPattern)];
  const hasCanonicalPayloadSerializer = (body) =>
    /return\{\.\.\.await this\.(?:signBytes|getAddon\(\)\.signDeviceKey)\([A-Za-z_$][\w$]*,(?<serialized>[A-Za-z_$][\w$]*)\),signedPayloadBase64:\k<serialized>\.toString\("base64"\)\}/u.test(body);
  const isProviderClass = (clientClass) => {
    const classPattern = clientClass === providerMatch.groups.providerClass
      ? new RegExp(`class ${providerClass}\\{` , "u")
      : new RegExp(`class ${escapeRegExp(clientClass)} extends ${providerClass}\\{`, "u");
    const match = classPattern.exec(source);
    if (match == null) return false;
    const start = match.index;
    const nextClass = source.indexOf("class ", start + match[0].length);
    const body = source.slice(start, nextClass < 0 ? source.length : nextClass);
    return body.includes("codex-device-key-sign-payload/v1") &&
      body.includes("signDeviceKey(") && hasCanonicalPayloadSerializer(body) &&
      (clientClass === providerMatch.groups.providerClass || body.includes("signBytes("));
  };
  const providerStart = providerMatch.index;

  if (currentConstructions.length === 1 && isProviderClass(currentConstructions[0].groups.clientClass) && patchedConstructions.length === 0 &&
      providerSourceCount === 0 && !source.includes(DEVICE_KEY_CLIENT_MARKER) &&
      !source.includes(DEVICE_KEY_ADDON_MARKER) &&
      /[;}]$/u.test(source.slice(Math.max(0, providerStart - 1), providerStart))) {
    return {
      kind: "current",
      providerStart,
      providerClass: currentConstructions[0].groups.clientClass,
      construction: currentConstructions[0],
      providerSource,
    };
  }
  if (currentConstructions.length === 0 && patchedConstructions.length === 1 && isProviderClass(patchedConstructions[0].groups.clientClass) &&
      providerSourceCount === 1 && source.indexOf(providerSource) + providerSource.length === providerStart) {
    return { kind: "patched" };
  }
  if (currentConstructions.length > 0 && patchedConstructions.length > 0) {
    return { kind: "mixed" };
  }
  if (currentConstructions.length > 1 || patchedConstructions.length > 1 || providerSourceCount > 1) {
    return { kind: "ambiguous" };
  }
  return { kind: "partial" };
}

function applyLinuxRemoteControlDeviceKeyPatch(source) {
  const state = deviceKeyPatchState(source);
  if (state.kind === "patched") {
    return source;
  }
  if (state.kind !== "current") {
    if (source.includes(DEVICE_KEY_CLIENT_MARKER) || source.includes(DEVICE_KEY_ADDON_MARKER)) {
      console.warn("WARN: Found incomplete Linux remote-control device-key patch - refusing partial state");
    } else {
      console.warn("WARN: Could not find remote-control device-key bundle needles - skipping Linux remote-control device-key patch");
    }
    return source;
  }

  const { construction, providerClass, providerSource, providerStart } = state;
  // The construction follows the provider in upstream; patch it first so the
  // provider offset stays valid either way.
  const constructionEnd = construction.index + construction[0].length;
  const patchedConstruction =
    `this.remoteControlDeviceKeyClient=process.platform===\`linux\`?${DEVICE_KEY_CLIENT_MARKER}(${providerClass}):` +
    `new ${providerClass}(${construction.groups.args}),this.executionHostRegistry`;
  const withConstruction = construction.index > providerStart
    ? source.slice(0, construction.index) + patchedConstruction + source.slice(constructionEnd)
    : null;
  if (withConstruction == null) {
    console.warn("WARN: Remote-control device-key client is constructed before its provider - skipping Linux remote-control device-key patch");
    return source;
  }
  const patched = withConstruction.slice(0, providerStart) + providerSource + withConstruction.slice(providerStart);
  return deviceKeyPatchState(patched).kind === "patched" ? patched : source;
}

const REMOTE_CONTROL_KEY_MATERIAL_403_MESSAGE =
  "Remote control request failed (403): Remote-control client key material missing";
// Upstream now throws 403 responses with the bare server detail, so the
// prefixed 403 check alone no longer recovers from missing key material.
const REMOTE_CONTROL_RECOVERABLE_MESSAGES = [
  "Remote-control client key material missing",
  "Remote-control client has been revoked",
];
const REMOTE_CONTROL_RECOVERABLE_CHECKS_PATTERN = new RegExp(
  `\\((?<checks>"[^"\\\\]*"===(?<error>${DEVICE_KEY_IDENT})\\.message(?:\\|\\|"[^"\\\\]*"===\\k<error>\\.message)*)\\)`,
  "gu",
);

function applyLinuxRemoteControlClientRevocationRecoveryPatch(source) {
  const messageCheck = (message, error) => `"${message}"===${error}.message`;
  const predicates = [...source.matchAll(REMOTE_CONTROL_RECOVERABLE_CHECKS_PATTERN)].filter((match) =>
    match.groups.checks.split("||").some((check) =>
      check === messageCheck(REMOTE_CONTROL_KEY_MATERIAL_403_MESSAGE, match.groups.error) ||
      check === messageCheck("Remote-control client key material missing", match.groups.error),
    ),
  );
  if (predicates.length !== 1) {
    console.warn(
      `WARN: Expected one remote-control recoverable error predicate, found ${predicates.length} - skipping revoked-client recovery patch`,
    );
    return source;
  }
  const [predicate] = predicates;
  const { checks, error } = predicate.groups;
  const existing = checks.split("||");
  const missing = REMOTE_CONTROL_RECOVERABLE_MESSAGES
    .map((message) => messageCheck(message, error))
    .filter((check) => !existing.includes(check));
  if (missing.length === 0) {
    return source;
  }
  const start = predicate.index + 1;
  return source.slice(0, start) + [checks, ...missing].join("||") + source.slice(start + checks.length);
}

function applyLinuxRemoteMobileAppServerRemoteControlPatch(source) {
  return applyLinuxRemoteMobileStartupCommandArgsGuard(
    applyLinuxRemoteMobileAppServerRemoteControlLaunchPatch(source),
  );
}

function applyLinuxRemoteMobileStartupCommandArgsGuard(source) {
  if (
    source.includes(REMOTE_MOBILE_APP_SERVER_STARTUP_GUARD_MARKER) ||
    !hasLinuxRemoteMobileLocalAppServerRemoteControlPatch(source)
  ) {
    return source;
  }
  const guarded = source.replace(
    REMOTE_MOBILE_APP_SERVER_STARTUP_ARGS_PATTERN,
    (_match, launch, options) =>
      `...${REMOTE_MOBILE_APP_SERVER_STARTUP_GUARD_MARKER}(${launch}.args,${options}.startupCommand),` +
      `...${options}.startupCommand?.args??[]`,
  );
  if (guarded === source) {
    return source;
  }
  return guarded.replace(
    REMOTE_MOBILE_APP_SERVER_REMOTE_CONTROL_HELPER,
    `${REMOTE_MOBILE_APP_SERVER_REMOTE_CONTROL_HELPER}${REMOTE_MOBILE_APP_SERVER_STARTUP_GUARD_HELPER}`,
  );
}

function applyLinuxRemoteMobileAppServerRemoteControlLaunchPatch(source) {
  if (source.includes(REMOTE_MOBILE_APP_SERVER_REMOTE_CONTROL_MARKER)) {
    if (!hasLinuxRemoteMobileLocalAppServerRemoteControlPatch(source)) {
      console.warn(
        "WARN: Found an incomplete local Desktop app-server remote-control patch - refusing to accept partial state",
      );
    }
    return source;
  }
  const baseArgsMatches = [
    ...source.matchAll(
      new RegExp(`([A-Za-z_$][\\w$]*)=${escapeRegExp(REMOTE_MOBILE_APP_SERVER_BASE_ARGS_NEEDLE)}`, "gu"),
    ),
  ];
  if (baseArgsMatches.length !== 1) {
    return source;
  }

  const baseArgsVariable = baseArgsMatches[0][1];
  const launchReturnPattern = new RegExp(
    "return 0===(?<overrides>[A-Za-z_$][\\w$]*)\\.length\\?" +
      "\\[\\.\\.\\." + escapeRegExp(baseArgsVariable) +
      ',"app-server","--analytics-default-enabled"\\]:' +
      '\\["app-server",\\.\\.\\.' + escapeRegExp(baseArgsVariable) +
      ',\\.\\.\\.\\k<overrides>,"--analytics-default-enabled"\\]',
    "gu",
  );
  const launchReturnMatches = [...source.matchAll(launchReturnPattern)];
  if (launchReturnMatches.length !== 1) {
    return source;
  }

  const launchReturn = launchReturnMatches[0];
  const functionIndex = source.lastIndexOf("function ", launchReturn.index);
  const nextFunctionIndex = source.indexOf("}function", functionIndex);
  if (functionIndex < 0 || (nextFunctionIndex >= 0 && launchReturn.index >= nextFunctionIndex)) {
    return source;
  }

  // Startup-policy queries share this builder with the persistent server. Pass
  // their context through both CLI resolution branches before choosing a mode.
  const launchFunction = /^function ([A-Za-z_$][\w$]*)\(\)\{/u.exec(source.slice(functionIndex));
  if (!launchFunction) return source;
  const launchName = launchFunction[1];
  const ownerPattern = /function(?: ([A-Za-z_$][\w$]*))?\(([A-Za-z_$][\w$]*)\)\{/gu;
  const owners = [...source.matchAll(ownerPattern)].flatMap((match) => {
    const open = match.index + match[0].length - 1;
    const end = findMatchingBrace(source, open);
    const body = source.slice(open, end + 1);
    const calls = new RegExp(`args:${escapeRegExp(launchName)}\\(\\)`, "gu");
    return body.includes(`${match[2]}.hostConfig.codex_cli_command`) &&
      [...body.matchAll(calls)].length === 2
      ? [{ name: match[1], body, argument: match[2], calls }]
      : [];
  });
  if (owners.length !== 2) return source;
  if (!owners.some(owner => owner.body.includes(`includeRuntime:null==${owner.argument}.startupCommand`))) return source;
  const nativeOwners = owners.filter(owner => !owner.body.includes("includeRuntime:"));
  if (nativeOwners.length !== 1) return source;
  const nativeName = nativeOwners[0].name;
  const nativeCallPattern = new RegExp(`${escapeRegExp(nativeName)}\\(\\{hostConfig:([A-Za-z_$][\\w$]*)\\.hostConfig,repoRoot:\\1\\.repoRoot,resourcesPath:\\1\\.resourcesPath\\}\\)`, "gu");
  if ([...source.matchAll(nativeCallPattern)].length !== 1) return source;

  const overridesVariable = launchReturn.groups.overrides;
  const currentReturnExpression = launchReturn[0].slice("return ".length);
  const patchedReturn =
    `return process.platform===\`linux\`&&codexLinuxRemoteMobileStartupCommand==null?` +
    `${REMOTE_MOBILE_APP_SERVER_REMOTE_CONTROL_MARKER}(${baseArgsVariable},${overridesVariable}):` +
    currentReturnExpression;
  let replaced =
    source.slice(0, launchReturn.index) +
    patchedReturn +
    source.slice(launchReturn.index + launchReturn[0].length);
  replaced =
    replaced.slice(0, functionIndex) +
    replaced.slice(functionIndex).replace(
      `function ${launchName}(){`,
      `function ${launchName}(codexLinuxRemoteMobileStartupCommand){`,
    );
  for (const owner of owners) {
    replaced = replaced.replace(owner.body, owner.body.replace(
      owner.calls,
      `args:${launchName}(${owner.argument}.startupCommand)`,
    ));
  }
  replaced = replaced.replace(nativeCallPattern, (call, argument) =>
    call.replace("})", `,startupCommand:${argument}.startupCommand})`),
  );
  // Insert after a leading "use strict" so prepending the helper does not
  // demote the directive to a plain expression and de-strict the bundle.
  const insertAt = replaced.startsWith('"use strict";')
    ? '"use strict";'.length
    : replaced.startsWith("'use strict';")
      ? "'use strict';".length
      : 0;
  return `${replaced.slice(0, insertAt)}${REMOTE_MOBILE_APP_SERVER_REMOTE_CONTROL_HELPER}${replaced.slice(insertAt)}`;
}

function hasLinuxRemoteMobileLocalAppServerRemoteControlPatch(source) {
  return (
    source.includes(REMOTE_MOBILE_APP_SERVER_REMOTE_CONTROL_HELPER) &&
    new RegExp(
      "return process\\.platform===`linux`&&codexLinuxRemoteMobileStartupCommand==null\\?" +
        REMOTE_MOBILE_APP_SERVER_REMOTE_CONTROL_MARKER +
        "\\([A-Za-z_$][\\w$]*,[A-Za-z_$][\\w$]*\\):",
      "u",
    ).test(source)
  );
}

function applyLinuxRemoteMobileAppServerRemoteControlExtractedAppPatch(extractedDir) {
  const mainProcess = findMainProcessChunks(extractedDir);
  if (mainProcess == null) {
    const reason = `missing main-process chunks in ${path.join(extractedDir, ".vite", "build")}`;
    console.warn(`WARN: Could not find app-server launch bundle - skipping remote mobile app-server remote-control patch`);
    return { matched: 0, changed: 0, reason };
  }

  const { buildDir, chunks: candidates } = mainProcess;

  let matched = 0;
  let changed = 0;
  for (const candidate of candidates) {
    const filePath = path.join(buildDir, candidate);
    const source = fs.readFileSync(filePath, "utf8");
    if (
      !source.includes(REMOTE_MOBILE_APP_SERVER_BASE_ARGS_NEEDLE) &&
      !source.includes(REMOTE_MOBILE_APP_SERVER_REMOTE_CONTROL_MARKER)
    ) {
      continue;
    }
    const patched = applyLinuxRemoteMobileAppServerRemoteControlPatch(source);
    if (patched !== source) {
      matched += 1;
      fs.writeFileSync(filePath, patched, "utf8");
      changed += 1;
    } else if (hasLinuxRemoteMobileLocalAppServerRemoteControlPatch(source)) {
      matched += 1;
    }
  }

  if (matched === 0) {
    const reason = "no local Desktop app-server base args found";
    console.warn(
      "WARN: Could not find local Desktop app-server base args - skipping remote mobile app-server remote-control patch",
    );
    return { matched, changed, reason };
  }
  return { matched, changed };
}

function applyLinuxRemoteControlClientRevokeSetupResetPatch(source) {
  const current = applyCurrentRevokeSetupReset(source);
  if (current !== null) return current;
  if (source.includes(REMOTE_CONTROL_REVOKE_SETUP_RESET_MARKER)) {
    return source;
  }
  if (!source.includes("remote-control-client-revoke-success")) {
    return source;
  }

  const currentStateKeysMatch = source.match(/([A-Za-z_$][\w$]*)\.CODEX_MOBILE_SETUP_COMPLETED/u);
  const currentStateSetterMatch = source.match(
    /([A-Za-z_$][\w$]*)\([A-Za-z_$][\w$]*,[A-Za-z_$][\w$]*\.keepRemoteControlAwakeWhilePluggedIn,/u,
  );
  const currentStateKeysVar = currentStateKeysMatch?.[1] ?? null;
  const currentStateSetterVar = currentStateSetterMatch?.[1] ?? null;
  const currentRevokePattern =
    /onRevoked:([A-Za-z_$][\w$]*)=>\{([A-Za-z_$][\w$]*)\.setData\(([A-Za-z_$][\w$]*)=>\3\?\.filter\(\3=>\3\.clientId!==\1\)\),\2\.invalidate\(\)\},onRevokeResult:([A-Za-z_$][\w$]*)=>\{([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*),([A-Za-z_$][\w$]*),\{result:\4\}\)\}/u;
  const currentRevokeMatch = source.match(currentRevokePattern);
  if (currentStateKeysVar != null && currentStateSetterVar != null && currentRevokeMatch != null) {
    const ownerFunctionStart = source.lastIndexOf("function ", currentRevokeMatch.index);
    if (
      ownerFunctionStart < 0 ||
      !/^function [A-Za-z_$][\w$]*\(/u.test(source.slice(ownerFunctionStart, ownerFunctionStart + 128))
    ) {
      console.warn("WARN: Could not find remote-control revoke helper insertion point - skipping setup reset patch");
      return source;
    }
    const ownerPrefix = source.slice(ownerFunctionStart, currentRevokeMatch.index);
    const localClientIdMatch = ownerPrefix.match(
      /localRemoteControlClientId:([A-Za-z_$][\w$]*)/u,
    );
    if (localClientIdMatch == null) {
      console.warn("WARN: Could not find local remote-control client id - skipping setup reset patch");
      return source;
    }
    const localClientIdVar = localClientIdMatch[1];
    const anchorPositions = [
      currentStateKeysMatch.index,
      currentStateSetterMatch.index,
      currentRevokeMatch.index,
      ownerFunctionStart,
      ownerFunctionStart + localClientIdMatch.index,
    ];
    if (Math.max(...anchorPositions) - Math.min(...anchorPositions) > 16_384) {
      console.warn("WARN: Remote-control revoke setup-reset anchors are too far apart - skipping setup reset patch");
      return source;
    }
    const helper = [
      `function ${REMOTE_CONTROL_REVOKE_SETUP_RESET_MARKER}(e,t,n,r,i,o){`,
      "let a=e?.filter(e=>(e.clientId??e.client_id)!==t);",
      "let s=a?.filter(e=>(e.clientId??e.client_id)!==o);",
      "return s?.length===0&&i(n,r.CODEX_MOBILE_SETUP_COMPLETED,!1),a",
      "}",
    ].join("");
    return `${source.slice(0, ownerFunctionStart)}${helper}${source.slice(ownerFunctionStart)}`
      .replace(
        currentRevokePattern,
        (_needle, clientIdVar, querySnapshotVar, dataVar, resultVar, trackFn, desktopHostVar, revokeEventVar) =>
          `onRevoked:${clientIdVar}=>{${querySnapshotVar}.setData(${dataVar}=>${REMOTE_CONTROL_REVOKE_SETUP_RESET_MARKER}(${dataVar},${clientIdVar},${desktopHostVar},${currentStateKeysVar},${currentStateSetterVar},${localClientIdVar})),${querySnapshotVar}.invalidate()},onRevokeResult:${resultVar}=>{${trackFn}(${desktopHostVar},${revokeEventVar},{result:${resultVar}})}`,
      );
  }
  console.warn("WARN: Could not find remote-control revoke success handler - skipping setup reset patch");
  return source;
}

function matchesLinuxRemoteControlClientRevokeSetupResetContract(source) {
  if (matchesCurrentRevokeSetupReset(source)) return true;
  return source.includes("remote-control-client-revoke-success") &&
    source.includes("CODEX_MOBILE_SETUP_COMPLETED") &&
    source.includes("localRemoteControlClientId:");
}

function linuxRemoteControlEnablementOwnerPattern(flags = "u") {
  return new RegExp(
    `function ([A-Za-z_$][\\w$]*)\\(\\)\\{let ([A-Za-z_$][\\w$]*)=\\(0,([A-Za-z_$][\\w$]*)\\.c\\)\\(10\\),` +
      `\\{checkGate:([A-Za-z_$][\\w$]*),isLoading:([A-Za-z_$][\\w$]*)\\}=([A-Za-z_$][\\w$]*)\\(\\),` +
      `([A-Za-z_$][\\w$]*);\\2\\[0\\]===\\4\\?\\7=\\2\\[1\\]:\\(\\7=\\4\\(([A-Za-z_$][\\w$]*)\\),` +
      `\\2\\[0\\]=\\4,\\2\\[1\\]=\\7\\);let ([A-Za-z_$][\\w$]*)=\\7,([A-Za-z_$][\\w$]*);` +
      `\\2\\[2\\]!==\\4\\|\\|\\2\\[3\\]!==\\9\\?\\(\\10=\\4\\(\`1042620455\`\\)\\|\\|\\9,` +
      `\\2\\[2\\]=\\4,\\2\\[3\\]=\\9,\\2\\[4\\]=\\10\\):\\10=\\2\\[4\\];` +
      `let ([A-Za-z_$][\\w$]*)=\\10(?:\\|\\|/\\*${REMOTE_CONTROL_ENABLEMENT_BRIDGE_MARKER}\\*/` +
      `typeof navigator!=\`undefined\`&&navigator\\.userAgent\\.includes\\(\`Linux\`\\))?,` +
      `([A-Za-z_$][\\w$]*),([A-Za-z_$][\\w$]*);return `,
    flags,
  );
}

function countText(source, needle) {
  return source.split(needle).length - 1;
}

function findLinuxRemoteControlEnablementOwners(source) {
  const matches = [...source.matchAll(linuxRemoteControlEnablementOwnerPattern("gu"))];
  return matches.filter((match) => {
    const followingFunction = source.slice(match.index + 1).search(/\}function [A-Za-z_$][\w$]*\(/u);
    const structuralEnd = followingFunction < 0
      ? source.length
      : match.index + 1 + followingFunction + 1;
    const owner = source.slice(match.index, Math.min(structuralEnd, match.index + 6_000));
    return countText(owner, ".remoteConnections") === 1 &&
      countText(owner, ".setRemoteControlEnabled(") === 1 &&
      countText(owner, "[remote-connections/gate-bridge]") === 1;
  });
}

function matchesLinuxRemoteControlEnablementBridgeContract(source) {
  if (source.includes('"[remote-connections/gate-bridge]') && applyCurrentRemoteControlEnablementBridgePatch(source) != null) return true;
  return findLinuxRemoteControlEnablementOwners(source).length === 1 &&
    countText(source, ".setRemoteControlEnabled(") === 1 &&
    countText(source, "[remote-connections/gate-bridge]") === 1;
}

function findSemanticMatches(dir, regex) {
  if (!fs.existsSync(dir)) return [];
  const matches = [];
  for (const name of listWebviewAssetNames(dir, /\.js$/u)) {
    const source = fs.readFileSync(path.join(dir, name), "utf8");
    const pattern = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
    for (const _match of source.matchAll(pattern)) matches.push(name);
  }
  return matches;
}

function validateLinuxRemoteControlAutoConnectContract(extractedDir) {
  const serviceMatches = findSemanticMatches(
    path.join(extractedDir, ".vite", "build"),
    /setAutoConnect\((?<params>[A-Za-z_$][\w$]*)\)\{return this\.(?<service>[A-Za-z_$][\w$]*)\.setRemoteConnectionAutoConnect\(\k<params>\.hostId,\k<params>\.autoConnect\)\}/u,
  );
  const callerMatches = findSemanticMatches(
    path.join(extractedDir, "webview", "assets"),
    /async function [A-Za-z_$][\w$]*\((?<choice>[A-Za-z_$][\w$]*)\)\{let (?<service>[A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\.(?:appServices\.)?remoteConnections;if\((?:\k<service>==null|null==\k<service>)\)throw Error\(["`]Remote connections are unavailable["`]\);return \k<service>\.setAutoConnect\(\k<choice>\)\}/u,
  );
  if (serviceMatches.length !== 1 || callerMatches.length !== 1) {
    const reason = `could not uniquely resolve upstream auto-connect service and caller (service=${serviceMatches.length}, caller=${callerMatches.length})`;
    console.warn(`WARN: ${reason}`);
    return { matched: false, changed: false, reason };
  }
  return { matched: true, changed: false };
}

// The signed Rspack build keeps these contracts in module factories. Insert
// helpers beside the owning function, never at the ESM chunk's outer scope.
function currentFunctionOwner(source, marker) {
  const at = source.indexOf(marker);
  if (at < 0 || source.indexOf(marker, at + marker.length) >= 0) return null;
  const start = source.lastIndexOf("function ", at);
  if (start < 0) return null;
  const open = source.indexOf("{", start);
  const end = findMatchingBrace(source, open);
  if (end < at) return null;
  return { start, end: end + 1, text: source.slice(start, end + 1) };
}

function applyCurrentRemoteControlEnablementBridgePatch(source) {
  const owner = currentFunctionOwner(source, "[remote-connections/gate-bridge]");
  if (owner == null || !owner.text.includes('(0,')) return null;
  if (owner.text.includes(REMOTE_CONTROL_ENABLEMENT_BRIDGE_MARKER)) return source;
  const pattern = /let (?<enabled>[A-Za-z_$][\w$]*)=(?<gate>[A-Za-z_$][\w$]*);return /gu;
  const matches = [...owner.text.matchAll(pattern)];
  if (matches.length !== 1 || !owner.text.includes('"1042620455"') ||
      countText(owner.text, ".setRemoteControlEnabled(") !== 1) return null;
  const match = matches[0];
  if (!owner.text.includes(`enabled:${match.groups.enabled},oneToOnePairingInAppEnabled:`)) return null;
  const replacement = `let ${match.groups.enabled}=${match.groups.gate}||/*${REMOTE_CONTROL_ENABLEMENT_BRIDGE_MARKER}*/typeof navigator!=\`undefined\`&&navigator.userAgent.includes(\`Linux\`);return `;
  return source.slice(0, owner.start) + owner.text.replace(match[0], replacement) + source.slice(owner.end);
}

function applyCurrentRemoteControlStatusReadGuardPatch(source) {
  const owner = currentFunctionOwner(source, '"Failed to read remote-control status"');
  if (owner == null) return null;
  if (owner.text.includes(REMOTE_CONTROL_STATUS_READ_GUARD_MARKER)) return source;
  const args = /^function [\w$]+\((?<store>[\w$]+),(?<host>[\w$]+),(?<client>[\w$]+),(?<current>[\w$]+)\)/u.exec(owner.text);
  const state = /let (?<abort>[\w$]+)=new AbortController,(?<active>[\w$]+)=\(\)=>![\w$]+\.signal\.aborted&&\([\w$]+\?\.\(\)\?\?!0\),/u.exec(owner.text);
  const read = /(?<request>\(0,[\w$]+\.[\w$]+\)\([\w$]+\.sendRequest\("remoteControl\/status\/read",void 0\),[\w$]+\.signal\)\.then\([\w$]+=>\{(?<store>[\w$]+)\.get\([\w$]+,[\w$]+\)===[\w$]+&&(?<active>[\w$]+)\(\)&&(?<setter>[\w$]+)\([\w$]+,[\w$]+,[\w$]+\)\}\)\.catch\([\w$]+=>\{[\w$]+\(\)&&[\w$]+\.[\w$]+\.error\("Failed to read remote-control status",\{safe:\{\},sensitive:\{error:[\w$]+\}\}\)\}\))/u.exec(owner.text);
  if (args == null || state == null || read == null ||
      read.groups.store !== args.groups.store || read.groups.active !== state.groups.active ||
      countText(owner.text, 'methods:"remoteControl/status/changed"') !== 1 ||
      countText(owner.text, "[Symbol.dispose]()") !== 3) return null;
  const { host, store } = args.groups;
  const replacement = `${REMOTE_CONTROL_STATUS_READ_GUARD_MARKER}(${host})?${read[0]}:(${state.groups.active}()&&${read.groups.setter}(${store},${host},{status:\`disabled\`,available:!1,accessRequired:!1}),void 0)`;
  return source.slice(0, owner.start) + REMOTE_CONTROL_STATUS_READ_HELPER + owner.text.replace(read[0], replacement) + source.slice(owner.end);
}

function applyCurrentRemoteControlStatusWaitPatch(source) {
  if (source.includes(REMOTE_CONTROL_STATUS_WAIT_MARKER)) return source;
  const pattern = /setTimeout\(\(\)=>\{(?<resolve>[\w$]+)\(Error\("Timed out waiting for remote control to connect"\)\)\},5e3\)/gu;
  const matches = [...source.matchAll(pattern)];
  if (matches.length !== 1 || !source.includes('methods:"remoteControl/status/changed"')) return null;
  return source.replace(matches[0][0], matches[0][0].replace(",5e3)", `,typeof navigator!=\`undefined\`&&navigator.userAgent.includes(\`Linux\`)?3e4:5e3/*${REMOTE_CONTROL_STATUS_WAIT_MARKER}*/)`));
}

function matchesCurrentRemoteControlLoadGateContract(source) {
  return [...source.matchAll(/function [A-Za-z_$][\w$]*\(\)\{return\(0,[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\)\("1042620455"\)\}/gu)].length === 1;
}

function matchesCurrentRemoteControlCopyContract(source) {
  return source.includes(REMOTE_CONTROL_COPY_MARKER) ||
    source.includes("codexMobile.setupDialog.") && source.includes("this Mac") ||
    source.includes("codexMobile.setupPage.initial.heading") && source.includes("Connect your phone to this Mac") ||
    source.includes("this Mac") &&
      (source.includes("Remote connections") || source.includes("remoteConnections") || source.includes("remote control"));
}

function matchesCurrentRemoteConnectionsRefreshContract(source) {
  return source.includes(REMOTE_CONNECTIONS_REFRESH_MARKER) ||
    (source.includes("refresh-remote-connections") ||
      source.includes("[remote-connections/settings] auto_refresh_failed") &&
      source.includes(".refreshRemoteControl()") && source.includes(".sshConnections.refresh()")) && source.includes("setInterval");
}

function applyCurrentRemoteMobileReasoningSummaryPatch(source) {
  const log = '"Reasoning summary turn-start config resolved"';
  if (!source.includes(log)) return null;
  if (source.includes(REMOTE_MOBILE_REASONING_SUMMARY_MARKER)) return source;
  const owner = currentFunctionOwner(source, log);
  if (owner == null) return null;
  const summary = /(?<prefix>let |,)(?<summary>[\w$]+)=[\w$]+\?\.summary\?\?"none";(?<settings>[\w$]+)\?\.summary!==void 0&&\(\k<summary>=\k<settings>\.summary\),null!=(?<runtime>[\w$]+)\.reasoningSummaryOverride&&\(\k<summary>=\k<runtime>\.reasoningSummaryOverride\),\k<summary>=null==(?<config>[\w$]+)\?null:\k<config>\.model_reasoning_summary\?\?\k<summary>,void 0!==(?<request>[\w$]+)\.summary&&\(\k<summary>=\k<request>\.summary\);/u.exec(owner.text);
  const fn = /^function (?<name>[\w$]+)\(/u.exec(owner.text);
  if (summary == null || fn == null) return null;
  const callerPattern = new RegExp(`${fn.groups.name}\\((?<manager>[\\w$]+),[\\w$]+,[\\w$]+,[\\w$]+,[\\w$]+,(?<conversation>[\\w$]+),\\{(?=canUseProjectlessWorkspace:!(?<classifier>\\(0,[\\w$]+\\.[\\w$]+\\))\\(\\k<manager>\\.getHostId\\(\\)\\))`, "gu");
  const callers = [...source.matchAll(callerPattern)];
  if (callers.length !== 1) return null;
  const caller = callers[0];
  const suffix = `/*${REMOTE_MOBILE_REASONING_SUMMARY_MARKER}*/navigator.userAgent.includes(\`Linux\`)&&${summary.groups.runtime}.codexLinuxRemoteMobileHost&&${summary.groups.request}.summary===void 0&&(${summary.groups.summary}=\`none\`);`;
  const changes = [
    { index: owner.start + summary.index + summary[0].length, text: suffix },
    { index: caller.index + caller[0].length, text: `codexLinuxRemoteMobileHost:${caller.groups.classifier}(${caller.groups.manager}.getHostId())&&${caller.groups.conversation}.mode===\`durable\`,` },
  ].sort((a, b) => b.index - a.index);
  for (const change of changes) source = source.slice(0, change.index) + change.text + source.slice(change.index);
  return source;
}

function applyLinuxRemoteControlLoadGatePatch(source) {
  if (source.includes(REMOTE_CONTROL_LOAD_GATE_MARKER)) {
    return source;
  }
  if (!source.includes("1042620455")) {
    return source;
  }

  const current = /function ([A-Za-z_$][\w$]*)\(\)\{return(?<call>\(0,[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\)\("1042620455"\))\}/gu;
  const candidates = [...source.matchAll(current)];
  if (candidates.length === 1) {
    const [match] = candidates;
    return source.replace(match[0], `function ${match[1]}(){return typeof navigator!=\`undefined\`&&navigator.userAgent.includes(\`Linux\`)||${match.groups.call}}/*${REMOTE_CONTROL_LOAD_GATE_MARKER}*/`);
  }
  const match = source.match(REMOTE_CONTROL_LOAD_GATE_NEEDLE);
  if (match == null) {
    console.warn("WARN: Could not find remote-control loader rollout gate - skipping Linux remote-control load gate patch");
    return source;
  }

  const [, functionName, statsigFn] = match;
  return source.replace(
    REMOTE_CONTROL_LOAD_GATE_NEEDLE,
    [
      `function ${functionName}(){return codexLinuxRemoteControlLoadGateEnabled()||${statsigFn}(\`1042620455\`)}`,
      "function codexLinuxRemoteControlLoadGateEnabled(){",
      "return typeof navigator!=`undefined`&&navigator.userAgent.includes(`Linux`)",
      "}",
    ].join(""),
  );
}

function remoteControlVisibilityContract(source) {
  const ownerPattern = /function ([A-Za-z_$][\w$]*)\(\{remoteControlConnectionsState:([A-Za-z_$][\w$]*),slingshotEnabled:([A-Za-z_$][\w$]*)\}\)\{([^{}]*)\}/gu;
  const owners = [...source.matchAll(ownerPattern)];
  if (owners.length !== 1) return null;

  const [owner] = owners;
  const [, , stateVar, slingshotVar, body] = owner;
  const current =
    `return ${slingshotVar}&&(${stateVar}?.available??!0)&&${stateVar}?.accessRequired!==!0`;
  const patchedMarker = `${REMOTE_CONTROL_VISIBILITY_MARKER}(?:\\*/\\*${REMOTE_CONTROL_UI_VISIBILITY_MARKER})?`;
  const patchedPattern = new RegExp(
    `^let codexLinuxRemoteControlVisibilityLinux=typeof navigator!=\`undefined\`&&navigator\\.userAgent\\.includes\\(\`Linux\`\\);` +
      `/\\*${patchedMarker}\\*/return\\(codexLinuxRemoteControlVisibilityLinux\\|\\|${slingshotVar}\\)&&` +
      `\\(codexLinuxRemoteControlVisibilityLinux\\|\\|\\(${stateVar}\\?\\.available\\?\\?!0\\)\\)&&` +
      `${stateVar}\\?\\.accessRequired!==!0$`,
    "gu",
  );
  const state = body === current ? "current" : patchedPattern.test(body) ? "patched" : null;
  if (state == null) return null;

  return {
    body,
    bodyIndex: owner.index + owner[0].indexOf(body),
    slingshotVar,
    state,
    stateVar,
  };
}

function matchesRemoteControlVisibilityContract(source) {
  return remoteControlVisibilityContract(source) != null;
}

function applyLinuxRemoteControlVisibilityPatch(source) {
  const contract = remoteControlVisibilityContract(source);
  if (contract == null) {
    if (source.includes("remoteControlConnectionsState") || source.includes(REMOTE_CONTROL_VISIBILITY_MARKER)) {
      console.warn("WARN: Could not find unique remote-control visibility gate - skipping Linux remote-control visibility patch");
    }
    return source;
  }
  if (contract.state === "patched") {
    return source;
  }

  const { body, bodyIndex, slingshotVar, stateVar } = contract;
  const replacement =
    `let codexLinuxRemoteControlVisibilityLinux=typeof navigator!=\`undefined\`&&navigator.userAgent.includes(\`Linux\`);` +
    `/*${REMOTE_CONTROL_VISIBILITY_MARKER}*/return(codexLinuxRemoteControlVisibilityLinux||${slingshotVar})&&` +
    `(codexLinuxRemoteControlVisibilityLinux||(${stateVar}?.available??!0))&&${stateVar}?.accessRequired!==!0`;
  return source.slice(0, bodyIndex) + replacement + source.slice(bodyIndex + body.length);
}

function replaceLinuxRemoteControlCopy(source) {
  let patched = source;
  let changed = false;
  for (const [macCopy, linuxCopy] of REMOTE_CONTROL_LINUX_COPY_REPLACEMENTS) {
    if (patched.includes(macCopy)) {
      patched = patched.split(macCopy).join(linuxCopy);
      changed = true;
    }
  }
  return { patched, changed };
}

function applyLinuxRemoteControlCopyPatch(source) {
  const hasMarker = source.includes(REMOTE_CONTROL_COPY_MARKER);
  const { patched, changed } = replaceLinuxRemoteControlCopy(source);
  if (!changed) {
    if (hasMarker) {
      return source;
    }
    if (
      !source.includes("this Mac") &&
      !source.includes("Keep this Mac awake") &&
      !source.includes("Control this Mac") &&
      !source.includes("local Mac") &&
      !source.includes("settings.remoteConnections")
    ) {
      return source;
    }
    console.warn("WARN: Could not find remote-control Mac copy - skipping Linux remote-control copy patch");
    return source;
  }
  return hasMarker ? patched : `/*${REMOTE_CONTROL_COPY_MARKER}*/${patched}`;
}

function applyLinuxRemoteControlSettingsUxPatch(source) {
  let patched = replaceLinuxRemoteControlCopy(source).patched;
  patched = applyLinuxRemoteControlOutboundTabGatePatch(patched);

  return patched;
}

function applyLinuxRemoteControlOutboundTabGatePatch(source) {
  if (source.includes(REMOTE_CONTROL_OUTBOUND_TAB_GATE_MARKER)) {
    return source;
  }

  const gates = [...source.matchAll(/([A-Za-z_$][\w$]*)=(?:[A-Za-z_$][\w$]*|\(0,[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\))\(["`]782640499["`]\)/gu)];
  const gateMatch = gates.length === 1 ? gates[0] : null;
  if (gateMatch == null) {
    return source;
  }

  const [, hiddenGateVar] = gateMatch;
  const negatedGate = new RegExp(
    `([A-Za-z_$][\\w$]*)=!${hiddenGateVar}(?=,[A-Za-z_$][\\w$]*=(?:[A-Za-z_$][\\w$]*==null|null==[A-Za-z_$][\\w$]*))`,
    "gu",
  );
  if ([...source.matchAll(negatedGate)].length > 1) return source;
  const patched = source.replace(
    negatedGate,
    `$1=/*${REMOTE_CONTROL_OUTBOUND_TAB_GATE_MARKER}*/(typeof navigator!=\`undefined\`&&navigator.userAgent.includes(\`Linux\`)||!${hiddenGateVar})`,
  );
  if (patched === source) {
    console.warn("WARN: Could not find remote-control outbound tab gate consumer - skipping Linux outbound tab gate patch");
  }
  return patched;
}

function applyLinuxRemoteConnectionsRefreshPatch(source) {
  if (source.includes(REMOTE_CONNECTIONS_REFRESH_MARKER)) {
    return source;
  }

  let patched = source;
  const intervalConstantRegex = /(^|[,\s;])([A-Za-z_$][\w$]*)=15e3(?=[,;])/u;
  if (intervalConstantRegex.test(patched) && patched.includes("refresh-remote-connections")) {
    patched = patched.replace(intervalConstantRegex, "$1$2=5e3");
  } else if (patched.includes("15e3") && patched.includes("refresh-remote-connections")) {
    console.warn("WARN: Could not find remote-connections refresh interval constant - skipping interval patch");
  }

  const effectPattern =
    /([A-Za-z_$][\w$]*)=\(\)=>\{let ([A-Za-z_$][\w$]*)=null,([A-Za-z_$][\w$]*)=!1,([A-Za-z_$][\w$]*)=async\(\)=>\{\3\|\|\(\3=!0,\2=new AbortController,await ?\(async\(\)=>\{await ([A-Za-z_$][\w$]*)\(\2\.signal\)\}\)\(\)\.finally\(\(\)=>\{\2=null,\3=!1\}\)\)\},([A-Za-z_$][\w$]*)=window\.setInterval\(\(\)=>\{\4\(\)\},([A-Za-z_$][\w$]*|15e3)\);return\(\)=>\{\2\?\.abort\(\),window\.clearInterval\(\6\)\}\}/;
  const match = patched.match(effectPattern);
  if (match == null) {
    if (patched.includes("refresh-remote-connections") && patched.includes("setInterval")) {
      console.warn("WARN: Could not find remote-connections auto-refresh effect - skipping resume refresh patch");
    }
    return patched;
  }

  const [
    needle,
    effectVar,
    abortVar,
    pendingVar,
    refreshVar,
    refreshEventVar,
    intervalVar,
    intervalConstantVar,
  ] = match;
  const replacement =
    `${effectVar}=()=>{let ${abortVar}=null,${pendingVar}=!1,${refreshVar}=async()=>{${pendingVar}||(${pendingVar}=!0,${abortVar}=new AbortController,await(async()=>{await ${refreshEventVar}(${abortVar}.signal)})().finally(()=>{${abortVar}=null,${pendingVar}=!1}))},` +
    `codexLinuxRemoteConnectionsRefreshTimer=null,codexLinuxRemoteConnectionsRefreshLast=0,${REMOTE_CONNECTIONS_REFRESH_MARKER}=()=>{if(document.visibilityState===\`hidden\`)return;let e=Date.now(),t=()=>{codexLinuxRemoteConnectionsRefreshLast=Date.now(),codexLinuxRemoteConnectionsRefreshTimer=null,${refreshVar}()};if(e-codexLinuxRemoteConnectionsRefreshLast<1e3){codexLinuxRemoteConnectionsRefreshTimer!=null&&window.clearTimeout(codexLinuxRemoteConnectionsRefreshTimer),codexLinuxRemoteConnectionsRefreshTimer=window.setTimeout(t,1e3-(e-codexLinuxRemoteConnectionsRefreshLast));return}t()},` +
    `${intervalVar}=window.setInterval(()=>{${refreshVar}()},${intervalConstantVar === "15e3" ? "5e3" : intervalConstantVar});` +
    `document.addEventListener(\`visibilitychange\`,${REMOTE_CONNECTIONS_REFRESH_MARKER}),` +
    `window.addEventListener(\`focus\`,${REMOTE_CONNECTIONS_REFRESH_MARKER}),` +
    `window.addEventListener(\`online\`,${REMOTE_CONNECTIONS_REFRESH_MARKER}),` +
    `window.addEventListener(\`resume\`,${REMOTE_CONNECTIONS_REFRESH_MARKER});` +
    `return()=>{${abortVar}?.abort(),window.clearInterval(${intervalVar}),` +
    `codexLinuxRemoteConnectionsRefreshTimer!=null&&window.clearTimeout(codexLinuxRemoteConnectionsRefreshTimer),` +
    `document.removeEventListener(\`visibilitychange\`,${REMOTE_CONNECTIONS_REFRESH_MARKER}),` +
    `window.removeEventListener(\`focus\`,${REMOTE_CONNECTIONS_REFRESH_MARKER}),` +
    `window.removeEventListener(\`online\`,${REMOTE_CONNECTIONS_REFRESH_MARKER}),` +
    `window.removeEventListener(\`resume\`,${REMOTE_CONNECTIONS_REFRESH_MARKER})}}`;

  return patched.replace(needle, replacement);
}

function applyLinuxRemoteTerminalStatusRecoveryPatch(source) {
  const current = applyCurrentRemoteTerminalStatusPatch(source);
  if (current !== source) return current;
  if (
    source.includes("codexLinuxRemoteTerminalStatusWaitingOnUserInput") &&
    source.includes("hasUserInputRequest:codexLinuxRemoteHasUserInputRequest") &&
    source.includes("&&codexLinuxRemoteHasUserInputRequest")
  ) {
    return source;
  }

  if (
    !source.includes("hasInProgressSideChat") ||
    !source.includes("isResponseInProgress") ||
    !source.includes("threadRuntimeStatus") ||
    !source.includes("pendingRequestType")
  ) {
    return source;
  }

  const userInputRequestHelper =
    "function codexLinuxRemoteHasUserInputRequest(e){try{return Array.isArray(e)&&e.some(e=>e?.method===`item/tool/requestUserInput`||e?.method===`item/tool/requestOptionPicker`||e?.method===`item/tool/requestSetupCodexContextPicker`||e?.method===`item/tool/call`&&(e?.params?.tool===`request_onboarding_input`||e?.params?.tool===`request_option_picker`||e?.params?.tool===`setup_codex_context_picker`||e?.params?.tool===`setup_codex_step`))}catch{return!1}}";
  const buildTerminalStatusReplacement = (
    fnName,
    sideChatVar,
    responseProgressVar,
    systemErrorVar,
    resumeStateVar,
    runtimeStatusVar,
  ) =>
    `function ${fnName}({hasInProgressSideChat:${sideChatVar},isResponseInProgress:${responseProgressVar},latestTurnHasSystemError:${systemErrorVar},resumeState:${resumeStateVar},threadRuntimeStatus:${runtimeStatusVar},hasUserInputRequest:codexLinuxRemoteHasUserInputRequestPending=!0}){let codexLinuxRemoteTerminalStatusActive=${runtimeStatusVar}?.type===\`active\`,codexLinuxRemoteTerminalStatusActiveFlags=Array.isArray(${runtimeStatusVar}?.activeFlags)?${runtimeStatusVar}.activeFlags:null,codexLinuxRemoteTerminalStatusWaitingOnUserInput=codexLinuxRemoteTerminalStatusActiveFlags?.includes(\`waitingOnUserInput\`)===!0,codexLinuxRemoteTerminalStatusLoading=codexLinuxRemoteTerminalStatusActive&&(${responseProgressVar}===!0||codexLinuxRemoteTerminalStatusActiveFlags==null||codexLinuxRemoteTerminalStatusActiveFlags.length>0&&(!codexLinuxRemoteTerminalStatusWaitingOnUserInput||codexLinuxRemoteHasUserInputRequestPending===!0));return ${sideChatVar}?\`loading\`:${runtimeStatusVar}?.type===\`systemError\`?\`error\`:codexLinuxRemoteTerminalStatusLoading?\`loading\`:${resumeStateVar}===\`needs_resume\`?\`idle\`:${systemErrorVar}?\`error\`:${responseProgressVar}===!0?\`loading\`:\`idle\`}`;

  const terminalStatusPattern =
    /function ([A-Za-z_$][\w$]*)\(\{hasInProgressSideChat:([A-Za-z_$][\w$]*),isResponseInProgress:([A-Za-z_$][\w$]*),latestTurnHasSystemError:([A-Za-z_$][\w$]*),resumeState:([A-Za-z_$][\w$]*),threadRuntimeStatus:([A-Za-z_$][\w$]*)\}\)\{return \2\?`loading`:\6\?\.type===`systemError`\?`error`:\6\?\.type===`active`\?`loading`:\5===`needs_resume`\?`idle`:\4\?`error`:\3===!0\?`loading`:`idle`\}/u;
  const terminalStatusMatch = source.match(terminalStatusPattern);
  if (terminalStatusMatch == null) {
    console.warn(
      "WARN: Could not find remote terminal status function - skipping Linux remote terminal status recovery patch",
    );
    return source;
  }
  const [
    ,
    terminalStatusFnName,
    sideChatVar,
    responseProgressVar,
    systemErrorVar,
    resumeStateVar,
    runtimeStatusVar,
  ] = terminalStatusMatch;

  const pendingRequestPattern =
    /function ([A-Za-z_$][\w$]*)\(\{pendingRequestType:([A-Za-z_$][\w$]*),requests:([A-Za-z_$][\w$]*),resumeState:([A-Za-z_$][\w$]*),threadRuntimeStatus:([A-Za-z_$][\w$]*)\}\)\{return \3==null\|\|\4==null\?null:\4===`needs_resume`\?\5\?\.type===`active`&&\5\.activeFlags\.includes\(`waitingOnApproval`\)&&([A-Za-z_$][\w$]*)\(\3\)\?`approval`:\5\?\.type===`active`&&\5\.activeFlags\.includes\(`waitingOnUserInput`\)\?`response`:null:([A-Za-z_$][\w$]*)\(\2\)\?`approval`:\2===`userInput`\?`response`:null\}/u;
  const pendingRequestMatch = source.match(pendingRequestPattern);
  if (pendingRequestMatch == null) {
    console.warn(
      "WARN: Could not find remote pending-request function - skipping Linux remote terminal status recovery patch",
    );
    return source;
  }
  const [
    ,
    pendingRequestFnName,
    pendingTypeVar,
    requestsVar,
    pendingResumeStateVar,
    pendingRuntimeStatusVar,
    approvalRequestFn,
    approvalTypeFn,
  ] = pendingRequestMatch;

  const pendingCallPattern = new RegExp(
    `${escapeRegExp(pendingRequestFnName)}\\(\\{pendingRequestType:[^{}]+?,requests:([^{}]*\\([^{}]*\\)[^{}]*?),resumeState:[^{}]+?,threadRuntimeStatus:[^{}]+?\\}\\)`,
    "u",
  );
  const requestExpression = source.match(pendingCallPattern)?.[1] ?? null;
  const terminalCallPattern = new RegExp(
    `${escapeRegExp(terminalStatusFnName)}\\(\\{hasInProgressSideChat:([^{}]+?),isResponseInProgress:([^{}]+?),resumeState:([^{}]+?),threadRuntimeStatus:([^{}]+?),latestTurnHasSystemError:([^{}]+?)\\}\\)`,
    "u",
  );
  if (requestExpression == null || !terminalCallPattern.test(source)) {
    console.warn(
      "WARN: Could not wire remote terminal status to pending user-input requests - skipping Linux remote terminal status recovery patch",
    );
    return source;
  }

  let patched = source.replace(
    terminalStatusPattern,
    `${userInputRequestHelper}${buildTerminalStatusReplacement(
      terminalStatusFnName,
      sideChatVar,
      responseProgressVar,
      systemErrorVar,
      resumeStateVar,
      runtimeStatusVar,
    )}`,
  );
  patched = patched.replace(
    pendingRequestPattern,
    `function ${pendingRequestFnName}({pendingRequestType:${pendingTypeVar},requests:${requestsVar},resumeState:${pendingResumeStateVar},threadRuntimeStatus:${pendingRuntimeStatusVar}}){return ${requestsVar}==null||${pendingResumeStateVar}==null?null:${pendingResumeStateVar}===\`needs_resume\`?${pendingRuntimeStatusVar}?.type===\`active\`&&Array.isArray(${pendingRuntimeStatusVar}?.activeFlags)&&${pendingRuntimeStatusVar}.activeFlags.includes(\`waitingOnApproval\`)&&${approvalRequestFn}(${requestsVar})?\`approval\`:${pendingRuntimeStatusVar}?.type===\`active\`&&Array.isArray(${pendingRuntimeStatusVar}?.activeFlags)&&${pendingRuntimeStatusVar}.activeFlags.includes(\`waitingOnUserInput\`)&&codexLinuxRemoteHasUserInputRequest(${requestsVar})?\`response\`:null:${approvalTypeFn}(${pendingTypeVar})?\`approval\`:${pendingTypeVar}===\`userInput\`?\`response\`:null}`,
  );
  patched = patched.replace(
    terminalCallPattern,
    `${terminalStatusFnName}({hasInProgressSideChat:$1,isResponseInProgress:$2,resumeState:$3,threadRuntimeStatus:$4,latestTurnHasSystemError:$5,hasUserInputRequest:codexLinuxRemoteHasUserInputRequest(${requestExpression})})`,
  );

  return patched;
}

const REMOTE_CONTROL_STATUS_READ_HELPER =
  `function ${REMOTE_CONTROL_STATUS_READ_GUARD_MARKER}(e){return !(typeof navigator!=\`undefined\`&&navigator.userAgent.includes(\`Linux\`)&&typeof e==\`string\`&&(e.startsWith(\`remote-ssh\`)||e.startsWith(\`remote-control:\`)))}`;

function remoteControlStatusReadPattern(patched = false) {
  const guard = patched ? `${REMOTE_CONTROL_STATUS_READ_GUARD_MARKER}\\(\\k<host>\\)\\?` : "";
  const blocked = patched
    ? `:\\(\\k<active>\\(\\)&&\\k<setter>\\(\\k<store>,\\k<host>,\\{status:\\x60disabled\\x60,available:!1,accessRequired:!1\\}\\),void 0\\)`
    : "";
  return new RegExp(
    String.raw`function (?<fn>${DEVICE_KEY_IDENT})\((?<store>${DEVICE_KEY_IDENT}),(?<host>${DEVICE_KEY_IDENT}),(?<client>${DEVICE_KEY_IDENT}),(?<current>${DEVICE_KEY_IDENT})\)\{if\((?<skip>${DEVICE_KEY_IDENT})\(\k<host>\)\)return\(\)=>\{\}` +
      String.raw`;let (?<abort>${DEVICE_KEY_IDENT})=new AbortController,(?<active>${DEVICE_KEY_IDENT})=\(\)=>!\k<abort>\.signal\.aborted&&\(\k<current>\?\.\(\)\?\?!0\),(?<initial>${DEVICE_KEY_IDENT})=\k<store>\.get\((?<atom>${DEVICE_KEY_IDENT}),\k<host>\)` +
      String.raw`,(?<subscription>${DEVICE_KEY_IDENT})=\k<client>\.subscribe\(\{type:\x60notification\x60,key:\{hostId:\k<host>\},methods:\x60remoteControl/status/changed\x60,listener:\(\{params:(?<params>${DEVICE_KEY_IDENT})\}\)=>\{\k<active>\(\)&&(?<setter>${DEVICE_KEY_IDENT})\(\k<store>,\k<host>,\k<params>\)\}\}\)` +
      String.raw`,(?<resolved>${DEVICE_KEY_IDENT}),(?<cleanup>${DEVICE_KEY_IDENT})=\(\)=>\{\k<abort>\.signal\.aborted\|\|\(\k<abort>\.abort\(\),\k<subscription>\[Symbol\.dispose\]\(\),\k<resolved>\?\.\[Symbol\.dispose\]\(\)\)\}` +
      String.raw`;return \k<subscription>\.onRpcBroken\(\k<cleanup>` +
      String.raw`\),\k<subscription>\.then\((?<ready>${DEVICE_KEY_IDENT})=>\{\k<active>\(\)\?\(\k<resolved>=\k<ready>,\k<ready>\.onRpcBroken\(\k<cleanup>\)\):\k<ready>\[Symbol\.dispose\]\(\)\},\k<cleanup>\),` +
      guard +
      String.raw`(?<read>(?<cancel>${DEVICE_KEY_IDENT})\(\k<client>\.sendRequest\(\x60remoteControl/status/read\x60,void 0\),\k<abort>\.signal\)\.then\((?<result>${DEVICE_KEY_IDENT})=>\{\k<store>\.get\(\k<atom>,\k<host>\)===\k<initial>&&\k<active>\(\)&&\k<setter>\(\k<store>,\k<host>,\k<result>\)\}\)\.catch\((?<error>${DEVICE_KEY_IDENT})=>\{\k<active>\(\)&&(?<logger>${DEVICE_KEY_IDENT})\.error\(\x60Failed to read remote-control status\x60,\{safe:\{\},sensitive:\{error:\k<error>\}\}\)\}\))` +
      blocked + String.raw`,\k<cleanup>\}`,
    "gu",
  );
}

function applyLinuxRemoteControlStatusReadGuardPatch(source) {
  const current = applyCurrentRemoteControlStatusReadGuardPatch(source);
  if (current != null) return current;
  if (!source.includes("remoteControl/status/read") &&
      !source.includes(REMOTE_CONTROL_STATUS_READ_GUARD_MARKER)) return source;
  const pristine = [...source.matchAll(remoteControlStatusReadPattern())];
  const patched = [...source.matchAll(remoteControlStatusReadPattern(true))];
  const helperCount = source.split(REMOTE_CONTROL_STATUS_READ_HELPER).length - 1;
  const markerCount = source.split(REMOTE_CONTROL_STATUS_READ_GUARD_MARKER).length - 1;
  if (pristine.length === 0 && patched.length === 1 && helperCount === 1 && markerCount === 2) {
    return source;
  }
  if (pristine.length !== 1 || patched.length !== 0 || markerCount !== 0) {
    console.warn("WARN: Could not find unique complete remote-control status subscription - skipping Linux remote-control status guard patch");
    return source;
  }
  const [match] = pristine;
  const { host, active, setter, store, read } = match.groups;
  const guardedRead = `${REMOTE_CONTROL_STATUS_READ_GUARD_MARKER}(${host})?${read}:` +
    `(${active}()&&${setter}(${store},${host},{status:\`disabled\`,available:!1,accessRequired:!1}),void 0)`;
  return source.slice(0, match.index) + REMOTE_CONTROL_STATUS_READ_HELPER +
    match[0].replace(read, guardedRead) + source.slice(match.index + match[0].length);
}

function applyLinuxRemoteControlStatusWaitPatch(source) {
  const current = applyCurrentRemoteControlStatusWaitPatch(source);
  if (current != null) return current;
  if (source.includes(REMOTE_CONTROL_STATUS_WAIT_MARKER)) {
    return source;
  }
  if (
    !source.includes("Timed out waiting for remote control to connect") ||
    !source.includes("remoteControl/status/changed")
  ) {
    return source;
  }

  const timeoutVariableMatch = source.match(
    /setTimeout\(\(\)=>\{[^}]{0,300}Timed out waiting for remote control to connect[^}]{0,300}\},([A-Za-z_$][\w$]*)\)/u,
  );
  if (timeoutVariableMatch == null) {
    console.warn("WARN: Could not find remote-control status timeout variable - skipping Linux remote-control status wait patch");
    return source;
  }

  const timeoutVariable = timeoutVariableMatch[1];
  const statusWaitRegex = new RegExp(
    `\\b${escapeRegExp(timeoutVariable)}=5e3(?=,[A-Za-z_$][\\w$]*=([A-Za-z_$][\\w$]*)\\(([A-Za-z_$][\\w$]*),e=>null\\),[A-Za-z_$][\\w$]*=\\1\\(\\2,e=>!1\\),[A-Za-z_$][\\w$]*=[A-Za-z_$][\\w$]*\\(\\2,)`,
    "u",
  );
  if (!statusWaitRegex.test(source)) {
    console.warn("WARN: Could not find remote-control status wait needle - skipping Linux remote-control status wait patch");
    return source;
  }

  return source.replace(
    statusWaitRegex,
    `${timeoutVariable}=typeof navigator!=\`undefined\`&&navigator.userAgent.includes(\`Linux\`)?3e4:5e3/*${REMOTE_CONTROL_STATUS_WAIT_MARKER}*/`,
  );
}

function applyLinuxRemoteControlEnablementBridgePatch(source) {
  const current = applyCurrentRemoteControlEnablementBridgePatch(source);
  if (current != null) return current;
  const owners = findLinuxRemoteControlEnablementOwners(source);
  const ownerCount = Math.max(
    owners.length,
    countText(source, ".setRemoteControlEnabled("),
    countText(source, "[remote-connections/gate-bridge]"),
  );
  if (!matchesLinuxRemoteControlEnablementBridgeContract(source)) {
    applyLinuxRemoteControlEnableForHostParamsPatch(source);
    const markerIndex = source.indexOf("[remote-connections/gate-bridge]");
    const enablementIndex = source.indexOf("setRemoteControlEnabled");
    if (markerIndex >= 0 && enablementIndex >= 0 && Math.abs(markerIndex - enablementIndex) > 4_500) {
      console.warn("WARN: Remote-control enablement bridge anchors are too far apart - skipping Linux remote-control bridge patch");
    } else {
      console.warn(`WARN: Could not uniquely resolve current remote-control enablement bridge owner (owners=${ownerCount}) - skipping Linux remote-control bridge patch`);
    }
    return source;
  }

  let patched = applyLinuxRemoteControlEnableForHostParamsPatch(source);

  const markerIndex = patched.indexOf("[remote-connections/gate-bridge]");
  const enablementIndex = patched.indexOf("setRemoteControlEnabled");
  if (markerIndex < 0 || enablementIndex < 0) {
    if (!patched.includes(REMOTE_CONTROL_ENABLEMENT_BRIDGE_MARKER)) {
      console.warn("WARN: Could not find current remote-control enablement bridge anchors - skipping Linux remote-control bridge patch");
    }
    return patched;
  }
  if (Math.abs(markerIndex - enablementIndex) > 4_500) {
    console.warn("WARN: Remote-control enablement bridge anchors are too far apart - skipping Linux remote-control bridge patch");
    return patched;
  }

  const regionStart = Math.max(0, Math.min(markerIndex, enablementIndex) - 1_000);
  const regionEnd = Math.min(patched.length, Math.max(markerIndex, enablementIndex) + 4_500);
  const prefix = patched.slice(0, regionStart);
  const suffix = patched.slice(regionEnd);
  let region = patched.slice(regionStart, regionEnd);

  if (patched.includes(REMOTE_CONTROL_ENABLEMENT_BRIDGE_MARKER)) return patched;

  const currentBridgePattern = linuxRemoteControlEnablementOwnerPattern();
  const patchedRegion = region.replace(
    currentBridgePattern,
    (needle, _functionName, _cacheVar, _compilerVar, _checkGateVar, _isLoadingVar, _gateHookVar, _primaryGateValueVar, _primaryGateIdVar, _primaryGateVar, gateValueVar, enabledVar) =>
      needle.replace(
        `let ${enabledVar}=${gateValueVar},`,
        `let ${enabledVar}=${gateValueVar}||/*${REMOTE_CONTROL_ENABLEMENT_BRIDGE_MARKER}*/typeof navigator!=\`undefined\`&&navigator.userAgent.includes(\`Linux\`),`,
      ),
  );
  if (patchedRegion === region) {
    console.warn("WARN: Could not find remote-control enablement bridge needle - skipping Linux remote-control bridge patch");
    return patched;
  }
  return prefix + patchedRegion + suffix;
}

function applyLinuxRemoteControlEnableForHostParamsPatch(source) {
  const current = applyCurrentRemoteControlHostParamsPatch(source);
  if (current != null) return current;
  let patched = source;

  if (!patched.includes(REMOTE_CONTROL_ENABLE_FOR_HOST_PARAMS_MARKER)) {
    const enabledForHostNullParamsPattern =
      /("set-remote-control-enabled-for-host":[A-Za-z_$][\w$]*\(\([A-Za-z_$][\w$]*,\{enabled:[A-Za-z_$][\w$]*\}\)=>[A-Za-z_$][\w$]*\.sendRequest\([A-Za-z_$][\w$]*\?`remoteControl\/enable`:`remoteControl\/disable`,)null(\)\))/u;
    const beforeEnableForHostParamsPatch = patched;
    patched = patched.replace(
      enabledForHostNullParamsPattern,
      `$1void 0/*${REMOTE_CONTROL_ENABLE_FOR_HOST_PARAMS_MARKER}*/$2`,
    );
    if (
      patched === beforeEnableForHostParamsPatch &&
      patched.includes("set-remote-control-enabled-for-host")
    ) {
      console.warn("WARN: Could not find remote-control enable-for-host params needle - skipping Linux remote-control host params patch");
    }
  }

  return patched;
}

function applyLinuxRemoteMobileActiveStatusPatch(source) {
  if (source.includes(REMOTE_MOBILE_ACTIVE_STATUS_MARKER)) {
    return source;
  }
  if (
    source.includes("e.resumeState===`needs_resume`?e.threadRuntimeStatus:null") &&
    source.includes("?`running`:e.hasUnreadTurn?`review`:`idle`")
  ) {
    return source;
  }

  const statusPattern =
    /function ([A-Za-z_$][\w$]*)\(\{latestTurnStatus:([A-Za-z_$][\w$]*),resumeState:([A-Za-z_$][\w$]*),streamRole:([A-Za-z_$][\w$]*),threadRuntimeStatus:([A-Za-z_$][\w$]*)\}\)\{return \4==null\?\3===`needs_resume`\?`needs-resume`:`read-only`:\4\.role===`follower`\?`follower`:\5\?\.type===`active`\|\|\2===`inProgress`\?`active`:`inactive`\}/u;
  if (!statusPattern.test(source)) {
    if (source.includes("latestTurnStatus:") && source.includes("streamRole:") && source.includes("threadRuntimeStatus:")) {
      console.warn("WARN: Could not find active-status renderer needle - skipping remote mobile active-status patch");
    }
    return source;
  }

  return source.replace(
    statusPattern,
    `function $1({latestTurnStatus:$2,resumeState:$3,streamRole:$4,threadRuntimeStatus:$5}){/*${REMOTE_MOBILE_ACTIVE_STATUS_MARKER}*/return $4?.role===\`follower\`?\`follower\`:$5?.type===\`active\`||$2===\`inProgress\`?\`active\`:$4==null?$3===\`needs_resume\`?\`needs-resume\`:\`read-only\`:\`inactive\`}`,
  );
}

function hasCurrentRemoteMobileActiveStatus(source) {
  return currentRemoteActiveStatusPattern().test(source);
}

function currentRemoteActiveStatusPattern() {
  return /function\(\{latestTurnStatus:(?<turn>[A-Za-z_$][\w$]*),resumeState:(?<resume>[A-Za-z_$][\w$]*),streamRole:(?<stream>[A-Za-z_$][\w$]*),threadRuntimeStatus:(?<runtime>[A-Za-z_$][\w$]*)\}\)\{return null==\k<stream>\?"needs_resume"===\k<resume>\?"needs-resume":"read-only":"follower"===\k<stream>\.role\?"follower":\k<runtime>\?\.type==="active"\|\|"inProgress"===\k<turn>\?"active":"inactive"\}/gu;
}

function currentActiveReplacement({ turn, resume, stream, runtime }) {
  return `function({latestTurnStatus:${turn},resumeState:${resume},streamRole:${stream},threadRuntimeStatus:${runtime}}){/*${REMOTE_MOBILE_ACTIVE_STATUS_MARKER}*/return ${stream}?.role==="follower"?"follower":${runtime}?.type==="active"||${turn}==="inProgress"?"active":${stream}==null?${resume}==="needs_resume"?"needs-resume":"read-only":"inactive"}`;
}

function currentActiveContract(source) {
  const pristine = [...source.matchAll(currentRemoteActiveStatusPattern())];
  if (pristine.length === 1 && !source.includes(REMOTE_MOBILE_ACTIVE_STATUS_MARKER)) return pristine[0];
  const patched = [...source.matchAll(/function\(\{latestTurnStatus:(?<turn>[A-Za-z_$][\w$]*),resumeState:(?<resume>[A-Za-z_$][\w$]*),streamRole:(?<stream>[A-Za-z_$][\w$]*),threadRuntimeStatus:(?<runtime>[A-Za-z_$][\w$]*)\}\)\{\/\*codexLinuxRemoteMobileActiveStatus\*\//gu)];
  return pristine.length === 0 && patched.length === 1 && source.split(REMOTE_MOBILE_ACTIVE_STATUS_MARKER).length === 2 &&
    source.includes(currentActiveReplacement(patched[0].groups)) ? true : null;
}

function hasCurrentRemoteMobileActiveStatus(source) {
  return currentActiveContract(source) !== null;
}

function applyCurrentRemoteMobileActiveStatusPatch(source) {
  const contract = currentActiveContract(source);
  if (contract === null || contract === true) return source;
  return source.slice(0, contract.index) + currentActiveReplacement(contract.groups) + source.slice(contract.index + contract[0].length);
}

function remoteMobileConversationHydrationGuardPattern({ patched = false, flags = "u" } = {}) {
  const marker = patched
    ? `/\\*${REMOTE_MOBILE_CONVERSATION_HYDRATION_MARKER}\\*/`
    : "";
  const hostGuard = patched
    ? "!this\\.manager\\.isCloudHost&&this\\.manager\\.getHostId\\(\\)!==`local`\\|\\|"
    : "!this\\.manager\\.isCloudHost\\|\\|";
  const methodGuard = patched
    ? `(?<notification>${DEVICE_KEY_IDENT})\\.method!==\`turn/started\`&&` +
      `\\k<notification>\\.method!==\`turn/completed\`&&` +
      `\\(this\\.manager\\.getHostId\\(\\)!==\`local\`\\|\\|` +
      `\\k<notification>\\.method!==\`item/started\`&&` +
      `\\k<notification>\\.method!==\`item/completed\`\\)`
    : `(?<notification>${DEVICE_KEY_IDENT})\\.method!==\`turn/started\`&&` +
      `\\k<notification>\\.method!==\`turn/completed\``;
  return new RegExp(
    `return (?<pending>${DEVICE_KEY_IDENT})==null\\?${marker}${hostGuard}${methodGuard}\\|\\|` +
      `this\\.context\\.threadStore\\.conversations\\.has\\((?<conversation>${DEVICE_KEY_IDENT})\\)\\|\\|` +
      `this\\.context\\.threadStore\\.isConversationSuppressed\\(\\k<conversation>\\)\\?!1:` +
      `\\(this\\.beginDiscovery\\(\\k<conversation>,(?<ignore>${DEVICE_KEY_IDENT})\\),` +
      `this\\.buffer\\.buffer\\((?<delivery>${DEVICE_KEY_IDENT}),\\k<ignore>\\)\\):` +
      `\\(\\k<pending>\\.ignored\\.add\\(\\k<ignore>\\),this\\.buffer\\.buffer\\(\\k<delivery>,\\k<ignore>\\)\\)\\}`,
    flags,
  );
}

function remoteMobileConversationHydrationContract(source) {
  const pristineMatches = [
    ...source.matchAll(remoteMobileConversationHydrationGuardPattern({ flags: "gu" })),
  ];
  const patchedMatches = [
    ...source.matchAll(remoteMobileConversationHydrationGuardPattern({ patched: true, flags: "gu" })),
  ];
  const markerCount = source.split(REMOTE_MOBILE_CONVERSATION_HYDRATION_MARKER).length - 1;
  const state = markerCount === 0 && pristineMatches.length === 1 && patchedMatches.length === 0
    ? "pristine"
    : markerCount === 1 && pristineMatches.length === 0 && patchedMatches.length === 1
      ? "patched"
      : null;
  if (state == null) return null;

  const match = state === "pristine" ? pristineMatches[0] : patchedMatches[0];
  const lifecycle = source.slice(match.index, match.index + 4_096);
  if (
    lifecycle.split("this.context.threadStore.hydrateActiveThread(").length - 1 !== 1 ||
    lifecycle.split("this.buffer.release(").length - 1 !== 1 ||
    lifecycle.split("Failed to discover thread from event").length - 1 !== 1
  ) {
    return null;
  }
  return { match, state };
}

function matchesRemoteMobileConversationHydrationContract(source) {
  if (matchesCurrentRemoteMobileConversationHydrationContract(source)) return true;
  return remoteMobileConversationHydrationContract(source) != null;
}

function currentRemoteMobileConversationHydrationMethod(source) {
  const token = "bufferNotification(";
  const owners = [];
  let at = source.indexOf(token);
  while (at >= 0) {
    const open = source.indexOf("{", at + token.length);
    if (open >= 0) {
      const end = findMatchingBrace(source, open);
      if (end >= open) {
        const owner = { start: at, end: end + 1, text: source.slice(at, end + 1) };
        if (owner.text.includes('this.manager.isCloudHost||"turn/started"!==n.method&&"turn/completed"!==n.method') &&
            owner.text.includes("this.beginDiscovery(i,t)")) owners.push(owner);
      }
    }
    at = source.indexOf(token, at + token.length);
  }
  return owners.length === 1 ? owners[0] : null;
}

function matchesCurrentRemoteMobileConversationHydrationContract(source) {
  if (source.includes(REMOTE_MOBILE_CONVERSATION_HYDRATION_MARKER)) return true;
  const method = currentRemoteMobileConversationHydrationMethod(source);
  return method != null &&
    method.text.includes('this.manager.isCloudHost||"turn/started"!==n.method&&"turn/completed"!==n.method') &&
    method.text.includes("this.beginDiscovery(i,t)") &&
    method.text.includes("this.buffer.buffer(e,t)") &&
    method.text.includes("this.context.threadStore.isConversationSuppressed(i)");
}

function applyCurrentRemoteMobileConversationHydrationPatch(source) {
  if (source.includes(REMOTE_MOBILE_CONVERSATION_HYDRATION_MARKER)) return source;
  const method = currentRemoteMobileConversationHydrationMethod(source);
  if (method == null) return null;
  const gate = '!this.manager.isCloudHost||"turn/started"!==n.method&&"turn/completed"!==n.method';
  if (!method.text.includes(gate) ||
      !method.text.includes("this.beginDiscovery(i,t)") ||
      !method.text.includes("this.buffer.buffer(e,t)") ||
      !method.text.includes("this.context.threadStore.isConversationSuppressed(i)")) return null;
  const allowed = '(this.manager.isCloudHost&&("turn/started"===n.method||"turn/completed"===n.method)||this.manager.getHostId()===`local`&&("turn/started"===n.method||"turn/completed"===n.method||"item/started"===n.method||"item/completed"===n.method))';
  const replacement = `!(${allowed})/*${REMOTE_MOBILE_CONVERSATION_HYDRATION_MARKER}*/`;
  const patchedMethod = method.text.replace(gate, replacement);
  return source.slice(0, method.start) + patchedMethod + source.slice(method.end);
}

function applyLinuxRemoteMobileConversationHydrationPatch(source) {
  const current = applyCurrentRemoteMobileConversationHydrationPatch(source);
  if (current != null) return current;
  const contract = remoteMobileConversationHydrationContract(source);
  if (contract == null) {
    if (
      source.includes(REMOTE_MOBILE_CONVERSATION_HYDRATION_MARKER) ||
      source.includes("Failed to discover thread from event") ||
      source.includes("Received item/completed for unknown conversation")
    ) {
      console.warn(
        "WARN: Could not find unique complete conversation-hydration lifecycle - skipping Linux remote mobile hydration patch",
      );
    }
    return source;
  }
  if (contract.state === "patched") return source;

  const { conversation, notification, pending, ignore, delivery } = contract.match.groups;
  const replacement =
    `return ${pending}==null?/*${REMOTE_MOBILE_CONVERSATION_HYDRATION_MARKER}*/` +
    "!this.manager.isCloudHost&&this.manager.getHostId()!==`local`||" +
    `${notification}.method!==\`turn/started\`&&${notification}.method!==\`turn/completed\`&&` +
    `(this.manager.getHostId()!==\`local\`||${notification}.method!==\`item/started\`&&` +
    `${notification}.method!==\`item/completed\`)||` +
    `this.context.threadStore.conversations.has(${conversation})||` +
    `this.context.threadStore.isConversationSuppressed(${conversation})?!1:` +
    `(this.beginDiscovery(${conversation},${ignore}),this.buffer.buffer(${delivery},${ignore})):` +
    `(${pending}.ignored.add(${ignore}),this.buffer.buffer(${delivery},${ignore}))}`;
  return source.slice(0, contract.match.index) + replacement +
    source.slice(contract.match.index + contract.match[0].length);
}

function applyLinuxRemoteMobileReasoningSummaryPatch(source) {
  const current = applyCurrentRemoteMobileReasoningSummaryPatch(source);
  if (current != null) return current;
  const logMarker = "Reasoning summary turn-start config resolved";
  const logIndexes = [...source.matchAll(new RegExp(escapeRegExp(logMarker), "gu"))].map(
    (match) => match.index,
  );
  if (logIndexes.length === 0) {
    console.warn(
      "WARN: Could not find reasoning-summary turn-start log marker - skipping Linux remote mobile summary patch",
    );
    return source;
  }
  if (logIndexes.length !== 1) {
    console.warn(
      "WARN: Found ambiguous reasoning-summary resolver/caller contracts - skipping Linux remote mobile summary patch",
    );
    return source;
  }

  const [logIndex] = logIndexes;
  const functionStart = source.lastIndexOf("async function ", logIndex);
  const turnStartPrefix = functionStart === -1 ? "" : source.slice(functionStart, logIndex);
  const currentSummaryPattern =
    /(?<prefix>let |,)(?<summary>[A-Za-z_$][\w$]*)=[A-Za-z_$][\w$]*\?\.summary\?\?`none`;(?<latestSettings>[A-Za-z_$][\w$]*)\?\.summary!==void 0&&\(\k<summary>=\k<latestSettings>\.summary\),(?<runtime>[A-Za-z_$][\w$]*)\.reasoningSummaryOverride!=null&&\(\k<summary>=\k<runtime>\.reasoningSummaryOverride\),\k<summary>=(?<modelConfig>[A-Za-z_$][\w$]*)==null\?null:\k<modelConfig>\.model_reasoning_summary\?\?\k<summary>,(?<request>[A-Za-z_$][\w$]*)\.summary!==void 0&&\(\k<summary>=\k<request>\.summary\);/u;
  const summaryMatches = [
    ...turnStartPrefix.matchAll(new RegExp(currentSummaryPattern.source, "gu")),
  ];
  if (summaryMatches.length === 0) {
    console.warn(
      "WARN: Could not find reasoning-summary turn-start resolver - skipping Linux remote mobile summary patch",
    );
    return source;
  }
  if (summaryMatches.length !== 1) {
    console.warn(
      "WARN: Found ambiguous reasoning-summary resolver/caller contracts - skipping Linux remote mobile summary patch",
    );
    return source;
  }

  const [summaryMatch] = summaryMatches;
  const { request: requestVar, summary: summaryVar } = summaryMatch.groups;
  const functionHeader = turnStartPrefix.match(/async function ([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)[,)]/u);
  const helperName = functionHeader?.[1];
  if (helperName == null) {
    console.warn(
      "WARN: Could not find reasoning-summary turn-start helper - skipping Linux remote mobile summary patch",
    );
    return source;
  }
  const callerPrefix =
    `(?<prefix>${escapeRegExp(helperName)}\\((?<manager>[A-Za-z_$][\\w$]*),` +
      `[A-Za-z_$][\\w$]*,[A-Za-z_$][\\w$]*,[A-Za-z_$][\\w$]*,[A-Za-z_$][\\w$]*,` +
      `(?<conversation>[A-Za-z_$][\\w$]*),\\{)`;
  const callerContract =
    `(?=canUseProjectlessWorkspace:!(?<classifier>[A-Za-z_$][\\w$]*)\\(\\k<manager>\\.getHostId\\(\\)\\),[\\s\\S]{0,1000}?` +
    `reasoningSummaryOverride:\\k<manager>\\.getDefaultFeatureOverride\\(\`concurrent_reasoning_summaries\`\\)===!0\\|\\|[A-Za-z_$][\\w$]*\\?\`detailed\`:null)`;
  const pristineCallerMatches = [...source.matchAll(new RegExp(callerPrefix + callerContract, "gu"))];
  const patchedCallerPattern = new RegExp(
    callerPrefix +
      `codexLinuxRemoteMobileHost:(?<patchedClassifier>[A-Za-z_$][\\w$]*)\\(\\k<manager>\\.getHostId\\(\\)\\)&&` +
      `\\k<conversation>\\.mode===\`durable\`,` +
      `(?=canUseProjectlessWorkspace:!\\k<patchedClassifier>\\(\\k<manager>\\.getHostId\\(\\)\\),[\\s\\S]{0,1000}?` +
      `reasoningSummaryOverride:\\k<manager>\\.getDefaultFeatureOverride\\(\`concurrent_reasoning_summaries\`\\)===!0\\|\\|[A-Za-z_$][\\w$]*\\?\`detailed\`:null)`,
    "gu",
  );
  const patchedCallerMatches = [...source.matchAll(patchedCallerPattern)];

  const patchedResolverSuffix =
    `/*${REMOTE_MOBILE_REASONING_SUMMARY_MARKER}*/` +
    `navigator.userAgent.includes(\`Linux\`)&&${summaryMatch.groups.runtime}.codexLinuxRemoteMobileHost&&${requestVar}.summary===void 0&&(${summaryVar}=\`none\`);`;
  const absoluteMatchStart = functionStart + summaryMatch.index;
  const absoluteMatchEnd = absoluteMatchStart + summaryMatch[0].length;
  const resolverIsPatched = source.startsWith(patchedResolverSuffix, absoluteMatchEnd);
  const markerCount = source.split(REMOTE_MOBILE_REASONING_SUMMARY_MARKER).length - 1;
  const completePristinePair =
    !resolverIsPatched &&
    markerCount === 0 &&
    pristineCallerMatches.length === 1 &&
    patchedCallerMatches.length === 0;
  const completePatchedPair =
    resolverIsPatched &&
    markerCount === 1 &&
    pristineCallerMatches.length === 0 &&
    patchedCallerMatches.length === 1;

  if (completePatchedPair) {
    return source;
  }
  if (!completePristinePair) {
    console.warn(
      "WARN: Found ambiguous or incomplete reasoning-summary resolver/caller contract - skipping Linux remote mobile summary patch",
    );
    return source;
  }

  const replacement =
    `${summaryMatch[0]}/*${REMOTE_MOBILE_REASONING_SUMMARY_MARKER}*/` +
    `navigator.userAgent.includes(\`Linux\`)&&${summaryMatch.groups.runtime}.codexLinuxRemoteMobileHost&&${requestVar}.summary===void 0&&(${summaryVar}=\`none\`);`;
  const [currentCallerMatch] = pristineCallerMatches;
  const callerReplacement =
    `${currentCallerMatch.groups.prefix}codexLinuxRemoteMobileHost:` +
    `${currentCallerMatch.groups.classifier}(${currentCallerMatch.groups.manager}.getHostId())&&` +
    `${currentCallerMatch.groups.conversation}.mode===\`durable\`,`;
  const edits = [
    { index: absoluteMatchStart, length: summaryMatch[0].length, replacement },
    { index: currentCallerMatch.index, length: currentCallerMatch[0].length, replacement: callerReplacement },
  ].sort((left, right) => right.index - left.index);
  return edits.reduce(
    (patched, edit) =>
      `${patched.slice(0, edit.index)}${edit.replacement}${patched.slice(edit.index + edit.length)}`,
    source,
  );
}

module.exports = [
  {
    id: "linux-remote-control-device-key",
    phase: "main-bundle",
    order: 20_100,
    ciPolicy: "optional",
    apply: applyLinuxRemoteControlDeviceKeyPatch,
  },
  {
    id: "linux-remote-control-client-revocation-recovery",
    phase: "main-bundle",
    order: 20_116,
    ciPolicy: "optional",
    apply: applyLinuxRemoteControlClientRevocationRecoveryPatch,
  },
  {
    id: "linux-remote-mobile-app-server-remote-control",
    phase: "extracted-app:post-webview",
    order: 20_117,
    ciPolicy: "optional",
    apply: applyLinuxRemoteMobileAppServerRemoteControlExtractedAppPatch,
  },
  {
    id: "linux-remote-control-load-gate",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_RSPACK_ASSET_PATTERN,
    assetMatch: matchesCurrentRemoteControlLoadGateContract,
    order: 20_118,
    ciPolicy: "optional",
    missingDescription: "remote-control loader gate bundle",
    skipDescription: "Linux remote-control load gate patch",
    apply: applyLinuxRemoteControlLoadGatePatch,
  },
  {
    id: "linux-remote-control-visibility",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_RSPACK_ASSET_PATTERN,
    assetMatch: matchesRemoteControlVisibilityContract,
    matchPolicy: "all",
    order: 20_120,
    ciPolicy: "optional",
    missingDescription: "remote-control connections visibility bundle",
    skipDescription: "Linux remote-control visibility patch",
    apply: applyLinuxRemoteControlVisibilityPatch,
  },
  {
    id: "linux-remote-control-copy",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_RSPACK_ASSET_PATTERN,
    assetMatch: matchesCurrentRemoteControlCopyContract,
    matchPolicy: "all",
    order: 20_130,
    ciPolicy: "optional",
    missingDescription: "remote-control settings or mobile setup bundle",
    skipDescription: "Linux remote-control copy patch",
    apply: applyLinuxRemoteControlCopyPatch,
  },
  {
    id: "linux-remote-control-settings-ux",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_RSPACK_ASSET_PATTERN,
    assetMatch: (source) => source.includes("782640499") || source.includes(REMOTE_CONTROL_OUTBOUND_TAB_GATE_MARKER),
    matchPolicy: "all",
    order: 20_135,
    ciPolicy: "optional",
    missingDescription: "remote connections settings bundle",
    skipDescription: "Linux remote-control settings UX patch",
    apply: applyLinuxRemoteControlSettingsUxPatch,
  },
  {
    id: "linux-remote-control-client-revoke-setup-reset",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_RSPACK_ASSET_PATTERN,
    assetMatch: matchesLinuxRemoteControlClientRevokeSetupResetContract,
    order: 20_138,
    ciPolicy: "optional",
    missingDescription: "remote connections settings bundle",
    skipDescription: "Linux remote-control client revoke setup reset patch",
    apply: applyLinuxRemoteControlClientRevokeSetupResetPatch,
  },
  {
    id: "linux-remote-connections-refresh",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_RSPACK_ASSET_PATTERN,
    assetMatch: matchesCurrentRemoteConnectionsRefreshContract,
    matchPolicy: "all",
    order: 20_140,
    ciPolicy: "optional",
    missingDescription: "remote connections settings bundle",
    skipDescription: "Linux remote-connections refresh patch",
    apply: applyLinuxRemoteConnectionsRefreshPatch,
  },
  {
    id: "linux-remote-mobile-reasoning-summary-none",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_RSPACK_ASSET_PATTERN,
    assetMatch: (source) =>
      source.includes("Reasoning summary turn-start config resolved") &&
      source.includes("reasoningSummaryOverride") &&
      source.includes("canUseProjectlessWorkspace:"),
    order: 20_149,
    ciPolicy: "optional",
    missingDescription: "turn-start reasoning summary resolver",
    skipDescription: "Linux remote-mobile reasoning summary patch",
    apply: applyLinuxRemoteMobileReasoningSummaryPatch,
  },
  {
    id: "linux-remote-mobile-conversation-hydration",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_RSPACK_ASSET_PATTERN,
    assetMatch: matchesRemoteMobileConversationHydrationContract,
    order: 20_151,
    ciPolicy: "optional",
    missingDescription: "app-server conversation hydration lifecycle",
    skipDescription: "Linux remote-mobile conversation hydration patch",
    apply: applyLinuxRemoteMobileConversationHydrationPatch,
  },
  {
    id: "linux-remote-terminal-status-recovery",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_RSPACK_ASSET_PATTERN,
    assetMatch: matchesCurrentRemoteTerminalStatusContract,
    order: 20_152,
    ciPolicy: "optional",
    missingDescription: "app-server conversation manager bundle",
    skipDescription: "Linux remote terminal status recovery patch",
    apply: applyLinuxRemoteTerminalStatusRecoveryPatch,
  },
  {
    id: "linux-remote-control-status-read-guard",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_RSPACK_ASSET_PATTERN,
    assetMatch: (source) => source.includes('"Failed to read remote-control status"') && source.includes('"remoteControl/status/read"'),
    order: 20_153,
    ciPolicy: "optional",
    missingDescription: "app-server manager signals bundle",
    skipDescription: "Linux remote-control status read guard patch",
    apply: applyLinuxRemoteControlStatusReadGuardPatch,
  },
  {
    id: "linux-remote-control-status-wait",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_RSPACK_ASSET_PATTERN,
    assetMatch: (source) => source.includes('"Timed out waiting for remote control to connect"') && source.includes('"remoteControl/status/changed"'),
    order: 20_154,
    ciPolicy: "optional",
    missingDescription: "app-server manager signals bundle",
    skipDescription: "Linux remote-control status wait patch",
    apply: applyLinuxRemoteControlStatusWaitPatch,
  },
  {
    id: "linux-remote-control-enable-for-host-params",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_RSPACK_ASSET_PATTERN,
    assetMatch: matchesCurrentRemoteControlHostParamsContract,
    matchPolicy: "all",
    order: 20_155,
    ciPolicy: "optional",
    missingDescription: "app main remote-control host toggle bundle",
    skipDescription: "Linux remote-control host toggle params patch",
    apply: applyLinuxRemoteControlEnableForHostParamsPatch,
  },
  {
    id: "linux-remote-control-enablement-bridge",
    phase: "webview-asset",
    pattern: /^[A-Za-z0-9_-]+\.js$/,
    assetMatch: matchesLinuxRemoteControlEnablementBridgeContract,
    order: 20_156,
    ciPolicy: "optional",
    missingDescription: "app main bundle",
    skipDescription: "Linux remote-control enablement bridge patch",
    apply: applyLinuxRemoteControlEnablementBridgePatch,
  },
  {
    id: "linux-remote-control-auto-connect-contract",
    phase: "extracted-app:post-webview",
    order: 20_157,
    ciPolicy: "optional",
    apply: validateLinuxRemoteControlAutoConnectContract,
  },
  {
    id: "linux-remote-mobile-active-status",
    phase: "webview-asset",
    pattern: REMOTE_CONTROL_RSPACK_ASSET_PATTERN,
    assetMatch: hasCurrentRemoteMobileActiveStatus,
    matchPolicy: "all",
    ciPolicy: "optional",
    order: 20_160,
    apply: applyCurrentRemoteMobileActiveStatusPatch,
  },
];

module.exports.applyLinuxRemoteControlDeviceKeyPatch = applyLinuxRemoteControlDeviceKeyPatch;
module.exports.applyLinuxRemoteMobileAppServerRemoteControlPatch =
  applyLinuxRemoteMobileAppServerRemoteControlPatch;
module.exports.hasLinuxRemoteMobileLocalAppServerRemoteControlPatch =
  hasLinuxRemoteMobileLocalAppServerRemoteControlPatch;
module.exports.applyLinuxRemoteMobileReasoningSummaryPatch = applyLinuxRemoteMobileReasoningSummaryPatch;
module.exports.applyLinuxRemoteMobileConversationHydrationPatch =
  applyLinuxRemoteMobileConversationHydrationPatch;
module.exports.applyLinuxRemoteTerminalStatusRecoveryPatch = applyLinuxRemoteTerminalStatusRecoveryPatch;
module.exports.applyLinuxRemoteControlStatusReadGuardPatch = applyLinuxRemoteControlStatusReadGuardPatch;
module.exports.applyLinuxRemoteControlStatusWaitPatch = applyLinuxRemoteControlStatusWaitPatch;
module.exports.applyLinuxRemoteControlEnablementBridgePatch = applyLinuxRemoteControlEnablementBridgePatch;
module.exports.matchesLinuxRemoteControlEnablementBridgeContract =
  matchesLinuxRemoteControlEnablementBridgeContract;
module.exports.validateLinuxRemoteControlAutoConnectContract =
  validateLinuxRemoteControlAutoConnectContract;
module.exports.applyLinuxRemoteControlEnableForHostParamsPatch =
  applyLinuxRemoteControlEnableForHostParamsPatch;
module.exports.applyLinuxRemoteMobileActiveStatusPatch = applyLinuxRemoteMobileActiveStatusPatch;
module.exports.applyLinuxRemoteControlClientRevocationRecoveryPatch =
  applyLinuxRemoteControlClientRevocationRecoveryPatch;
module.exports.applyLinuxRemoteControlClientRevokeSetupResetPatch =
  applyLinuxRemoteControlClientRevokeSetupResetPatch;
module.exports.applyLinuxRemoteControlLoadGatePatch = applyLinuxRemoteControlLoadGatePatch;
module.exports.applyLinuxRemoteConnectionsRefreshPatch = applyLinuxRemoteConnectionsRefreshPatch;
module.exports.applyLinuxRemoteControlVisibilityPatch = applyLinuxRemoteControlVisibilityPatch;
module.exports.applyLinuxRemoteControlCopyPatch = applyLinuxRemoteControlCopyPatch;
module.exports.applyLinuxRemoteControlSettingsUxPatch = applyLinuxRemoteControlSettingsUxPatch;
