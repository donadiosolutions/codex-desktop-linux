"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const vm = require("node:vm");
const crypto = require("node:crypto");
const { Readable } = require("node:stream");
const { applyPluginCliHashPatch } = require("./plugin-cli-hash.js");
const fixture = 'const marker=`chrome_plugin_app_server_processes_stopped`;async function hash(e){return(0,c.createHash)(`sha256`).update(await f.default.readFile(e)).digest(`hex`)}';
function load(source, readFile, createReadStream) {
  return vm.runInNewContext(source + ';hash', { c: crypto, f: { default: { readFile } }, require(name) {
    assert.equal(name, 'node:fs'); return { createReadStream };
  }});
}
test('hashes large CLI contents incrementally without the whole-file Buffer limit', async () => {
  const chunks = [Buffer.from('first'), Buffer.from('last')];
  const tooLarge = Object.assign(new RangeError('File size (3663245000) is greater than 2 GiB'), {code:'ERR_FS_FILE_TOO_LARGE'});
  const readFile = async () => { throw tooLarge; };
  await assert.rejects(load(fixture, readFile)('/large-cli'), error => error === tooLarge);
  const hash = load(applyPluginCliHashPatch(fixture), readFile, path => {
    assert.equal(path, '/large-cli'); return Readable.from(chunks);
  });
  assert.equal(await hash('/large-cli'), crypto.createHash('sha256').update(Buffer.concat(chunks)).digest('hex'));
});
test('stream failures propagate instead of accepting an incomplete digest', async () => {
  const failure = new Error('read failed');
  const hash = load(applyPluginCliHashPatch(fixture), async()=>Buffer.from('ignored'), () => Readable.from((async function*(){yield Buffer.from('prefix'); throw failure;})()));
  await assert.rejects(hash('/bad-cli'), error => error === failure);
});
test('patch matches renamed bindings and rejects ambiguous or changed contracts', () => {
  const patched = applyPluginCliHashPatch(fixture);
  assert.notEqual(patched, fixture);
  assert.equal(applyPluginCliHashPatch(patched), patched);
  const renamed = fixture.replaceAll('hash','renamed').replaceAll('c.createHash','other.createHash');
  assert.notEqual(applyPluginCliHashPatch(renamed), renamed);
  assert.throws(()=>applyPluginCliHashPatch(fixture + fixture));
  assert.throws(()=>applyPluginCliHashPatch(fixture.replace('sha256','md5')));
  assert.throws(()=>applyPluginCliHashPatch(fixture.replace('chrome_plugin_app_server_processes_stopped','other')));
  assert.throws(()=>applyPluginCliHashPatch(patched.replace('for await','for')));
});
test('descriptor patches only the uniquely owned extracted module and remains idempotent', t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { patchPluginCliHash } = require('./plugin-cli-hash.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-plugin-hash-test-'));
  t.after(()=>fs.rmSync(root, {recursive:true}));
  const build = path.join(root,'.vite','build');
  fs.mkdirSync(build,{recursive:true});
  const target = path.join(build,'renamed.js');
  const untouched = path.join(build,'other.js');
  fs.writeFileSync(target,fixture);
  fs.writeFileSync(untouched,'const unrelated=true;');
  assert.equal(patchPluginCliHash(root).changed,true);
  assert.equal(patchPluginCliHash(root).changed,false);
  assert.equal(fs.readFileSync(untouched,'utf8'),'const unrelated=true;');
  const patched = fs.readFileSync(target,'utf8');
  fs.writeFileSync(untouched,fixture);
  assert.throws(()=>patchPluginCliHash(root));
  assert.equal(fs.readFileSync(target,'utf8'),patched);
});
