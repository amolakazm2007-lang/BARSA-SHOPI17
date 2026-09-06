import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelManager } from '../src/engine/ModelManager.js';
import { processTiled } from '../src/engine/TileProcessor.js';
import { PerformanceManager } from '../src/engine/PerformanceManager.js';
import { WebGpuIoArena } from '../src/engine/WebGpuIoArena.js';
import { WebGpuTileCompositor } from '../src/engine/WebGpuTileCompositor.js';

function streamOf(bytes) {
  return new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } });
}

function fakeModelDirectory() {
  const removed = [];
  return {
    removed,
    async getFileHandle(name) {
      return {
        async createWritable() {
          return {
            async write() {}, async close() {}, async abort() {},
          };
        },
      };
    },
    async removeEntry(name) { removed.push(name); },
  };
}

test('RC14 failed model replacement preserves the previously verified model', async () => {
  const manager = new ModelManager();
  const directory = fakeModelDirectory();
  manager._modelDirectory = async () => directory;
  manager.getMetadata = async () => ({ id: 'm', fileName: 'm-old.onnx', verified: true, sizeBytes: 4 });
  manager._putMetadata = async () => { throw new Error('metadata must not commit after bad hash'); };
  await assert.rejects(
    () => manager._importStream('m', streamOf(new Uint8Array([1,2,3,4])), 4, 'm.onnx', { sha256: '00'.repeat(32) }),
    /digest mismatch/,
  );
  assert.equal(directory.removed.includes('m-old.onnx'), false, 'old verified model must survive failed replacement');
  assert.ok(directory.removed.some((name) => name !== 'm-old.onnx'), 'failed staging file should be removed');
});

test('RC14 successful model replacement retires old bytes only after real inference passes', async () => {
  const manager = new ModelManager();
  const directory = fakeModelDirectory();
  manager._modelDirectory = async () => directory;
  let current = { id: 'm', fileName: 'm-old.onnx', verified: true, testPassed: true, sizeBytes: 4, knownHash: true };
  manager.getMetadata = async () => current;
  const order = [];
  manager._putMetadata = async (meta) => { order.push(`commit:${meta.fileName}:${meta.testPassed}`); current = structuredClone(meta); };
  const originalRemove = directory.removeEntry.bind(directory);
  directory.removeEntry = async (name) => { order.push(`remove:${name}`); return originalRemove(name); };
  const meta = await manager._importStream('m', streamOf(new Uint8Array([1,2,3,4])), 4, 'm.onnx', {});
  assert.notEqual(meta.fileName, 'm-old.onnx');
  assert.equal(directory.removed.includes('m-old.onnx'), false, 'old model must remain until inference passes');
  assert.equal(current.replacementBackup.fileName, 'm-old.onnx');
  await manager.markTestPassed('m', { executionProvider: 'wasm', signature: { ok: true } });
  assert.equal(current.fileName, meta.fileName);
  assert.equal(current.testPassed, true);
  assert.equal('replacementBackup' in current, false);
  assert.equal(directory.removed.includes('m-old.onnx'), true, 'old bytes retire only after inference commit');
  assert.ok(order.findIndex((x) => x === 'remove:m-old.onnx') > order.findIndex((x) => x.includes(':true')), order.join(','));
});

test('RC14 failed replacement inference rolls metadata and bytes back to the previous working model', async () => {
  const manager = new ModelManager();
  const directory = fakeModelDirectory();
  manager._modelDirectory = async () => directory;
  let current = { id: 'm', fileName: 'm-old.onnx', verified: true, testPassed: true, sizeBytes: 4, health: 'ready' };
  manager.getMetadata = async () => current;
  manager._putMetadata = async (meta) => { current = structuredClone(meta); };
  const candidate = await manager._importStream('m', streamOf(new Uint8Array([9,8,7,6])), 4, 'm.onnx', {});
  assert.notEqual(candidate.fileName, 'm-old.onnx');
  await manager.markTestFailed('m', new Error('runtime incompatible'));
  assert.equal(current.fileName, 'm-old.onnx');
  assert.equal(current.testPassed, true);
  assert.match(current.lastReplacementError, /runtime incompatible/);
  assert.equal(directory.removed.includes('m-old.onnx'), false);
  assert.equal(directory.removed.includes(candidate.fileName), true);
});

test('RC14 tile cancellation/error always restores canvas state and releases scratch backing store', async (t) => {
  const original = globalThis.OffscreenCanvas;
  const scratch = [];
  class FakeCanvas {
    constructor(width, height) { this.width = width; this.height = height; scratch.push(this); }
    getContext() { return { clearRect() {}, putImageData() {} }; }
  }
  globalThis.OffscreenCanvas = FakeCanvas;
  t.after(() => { if (original === undefined) delete globalThis.OffscreenCanvas; else globalThis.OffscreenCanvas = original; });
  let saves = 0, restores = 0;
  const destCtx = {
    canvas: { width: 8, height: 8 },
    save() { saves++; }, restore() { restores++; }, clearRect() {}, drawImage() {},
    set globalCompositeOperation(_v) {},
  };
  const srcCtx = { getImageData(_x,_y,w,h) { return { width:w, height:h, data:new Uint8ClampedArray(w*h*4) }; } };
  await assert.rejects(() => processTiled({ srcCtx, destCtx, width:4, height:4, scale:2, tileSize:4, overlap:1, runInference:async()=>{ throw new Error('boom'); } }), /boom/);
  assert.equal(saves, 1); assert.equal(restores, 1);
  assert.equal(scratch.length, 1);
  assert.equal(scratch[0].width, 1); assert.equal(scratch[0].height, 1);
});

test('RC14 performance telemetry sampling is single-flight', async () => {
  const manager = new PerformanceManager();
  let calls = 0;
  manager._sampleOnce = async () => { calls++; await new Promise((r) => setTimeout(r, 10)); return { ok:true }; };
  const [a,b,c] = await Promise.all([manager.sample(), manager.sample(), manager.sample()]);
  assert.equal(calls, 1);
  assert.deepEqual(a, {ok:true}); assert.deepEqual(b, {ok:true}); assert.deepEqual(c, {ok:true});
});

test('RC14 GPU compositor rejects frames beyond storage-buffer limits before allocation', (t) => {
  const oldUsage = globalThis.GPUBufferUsage, oldMap = globalThis.GPUMapMode;
  globalThis.GPUBufferUsage = {}; globalThis.GPUMapMode = {};
  t.after(() => { if (oldUsage === undefined) delete globalThis.GPUBufferUsage; else globalThis.GPUBufferUsage=oldUsage; if (oldMap === undefined) delete globalThis.GPUMapMode; else globalThis.GPUMapMode=oldMap; });
  const device = { limits: { maxStorageBufferBindingSize: 128*1024*1024, maxBufferSize: 256*1024*1024 } };
  const compositor = new WebGpuTileCompositor(device);
  assert.equal(compositor.supportsFrameSize(3840,2160), true);
  assert.equal(compositor.supportsFrameSize(4096,2160), false);
});

test('RC14 GPU IO arena never evicts an in-flight slot', (t) => {
  const oldUsage = globalThis.GPUBufferUsage, oldMap = globalThis.GPUMapMode;
  globalThis.GPUBufferUsage = { COPY_DST:1, STORAGE:2, COPY_SRC:4, MAP_READ:8 }; globalThis.GPUMapMode = { READ:1 };
  t.after(() => { if (oldUsage === undefined) delete globalThis.GPUBufferUsage; else globalThis.GPUBufferUsage=oldUsage; if (oldMap === undefined) delete globalThis.GPUMapMode; else globalThis.GPUMapMode=oldMap; });
  const destroyed = [];
  const device = { createBuffer({size}) { return { size, destroy(){ destroyed.push(this); } }; }, limits:{} };
  const ort = { env:{webgpu:{device}}, Tensor:{ fromGpuBuffer(buffer,{dims}) { return {buffer,dims}; } } };
  const arena = new WebGpuIoArena(ort, { maxSlots:1 });
  const first = arena._getOrCreateSlot([{name:'x',dims:[1,3,4,4]}],[1,3,8,8]);
  first.busy = true;
  const second = arena._getOrCreateSlot([{name:'x',dims:[1,3,5,5]}],[1,3,10,10]);
  assert.equal(second.ephemeral, true);
  assert.equal(destroyed.includes(first.outputBuffer), false);
  arena.clear();
});

import fs from 'node:fs';

test('RC14 Android WebView trusts only the exact BARSA loopback origin and port', () => {
  const src = fs.readFileSync(new URL('../android/app/src/main/java/com/barsa/shopi/MainActivity.java', import.meta.url), 'utf8');
  assert.match(src, /private boolean isTrustedAppUri\(Uri uri\)/);
  assert.match(src, /"http"\.equalsIgnoreCase\(uri\.getScheme\(\)\)/);
  assert.match(src, /"127\.0\.0\.1"\.equals\(uri\.getHost\(\)\)/);
  assert.match(src, /uri\.getPort\(\) == assetServer\.port\(\)/);
  assert.doesNotMatch(src, /"localhost"\.equalsIgnoreCase\(host\)/);
});

test('RC14 offline retry removes its online listener even when timeout wins', () => {
  const src = fs.readFileSync(new URL('../src/engine/ModelAutoProvisioner.js', import.meta.url), 'utf8');
  assert.match(src, /removeEventListener\?\.\('online', onOnline\)/);
  assert.match(src, /clearTimeout\(timer\)/);
});

test('RC14 thermal safety contains callback failures instead of killing the monitor', () => {
  const src = fs.readFileSync(new URL('../src/engine/ThermalGuard.js', import.meta.url), 'utf8');
  assert.match(src, /callbackerror/);
  assert.match(src, /try\{onState\?\.\(info\);\}catch/);
  assert.match(src, /try\{paused=pause\?\.\(\)===true;\}catch/);
  assert.match(src, /try\{resumed=resume\?\.\(\)===true;\}catch/);
});

test('RC14 native asset server does not silently swallow request failures', () => {
  const src = fs.readFileSync(new URL('../android/app/src/main/java/com/barsa/shopi/AssetServer.java', import.meta.url), 'utf8');
  assert.match(src, /Log\.e\(TAG, "request failed", error\)/);
  assert.match(src, /Log\.w\(TAG,/);
});

test('RC14 native AI localhost routes require a per-process secret token', () => {
  const server = fs.readFileSync(new URL('../android/app/src/main/java/com/barsa/shopi/AssetServer.java', import.meta.url), 'utf8');
  const bridge = fs.readFileSync(new URL('../android/app/src/main/java/com/barsa/shopi/NativeBridge.java', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../src/platform/NativeAiClient.js', import.meta.url), 'utf8');
  assert.match(server, /x-barsa-token/);
  assert.match(server, /MessageDigest\.isEqual/);
  assert.match(server, /writeError\(out, 403, "Forbidden"\)/);
  assert.match(bridge, /getNativeAiToken\(\)/);
  assert.match(client, /'X-Barsa-Token': this\.token/);
});

test('RC14 native session release removes registry entries before closing holders', () => {
  const runtime = fs.readFileSync(new URL('../android/app/src/main/java/com/barsa/shopi/NativeAiRuntime.java', import.meta.url), 'utf8');
  assert.match(runtime, /List<SessionHolder> closing = new ArrayList<>\(sessions\.values\(\)\);\s*sessions\.clear\(\);/s);
  assert.match(runtime, /if \(sessions\.get\(safeModelId\) != holder\) continue;/);
});

test('RC14 manual Upscale and RIFE replacement never ignores a selected local file', () => {
  const upscale = fs.readFileSync(new URL('../src/engine/UpscaleEngine.js', import.meta.url), 'utf8');
  const rife = fs.readFileSync(new URL('../src/engine/RIFEEngine.js', import.meta.url), 'utf8');
  for (const source of [upscale, rife]) {
    assert.match(source, /if \(localFile\) \{\s*await this\.modelManager\.importModel/s);
  }
});

test('RC14 repair path no longer deletes the working model before replacement download', () => {
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const repair = main.slice(main.indexOf('async function repairSelectedModel'), main.indexOf('async function deleteSelectedModel'));
  assert.doesNotMatch(repair, /models\.deleteModel\(id\)/);
  assert.match(repair, /engine\.installCatalogModel\(id\)/);
});

test('RC14 verification failure of a staged replacement rolls back to the previous model', async () => {
  const manager = new ModelManager();
  const directory = fakeModelDirectory();
  manager._modelDirectory = async () => directory;
  let current = {
    id: 'm', fileName: 'm-new.onnx', sizeBytes: 4, verified: true, testPassed: false,
    replacementBackup: { id:'m', fileName:'m-old.onnx', sizeBytes:4, verified:true, testPassed:true, health:'ready' },
  };
  manager.getMetadata = async () => current;
  manager.getStatus = async () => ({ ...current, installed: true });
  manager.openModelFile = async () => new Blob([new Uint8Array([1,2,3])]); // size mismatch
  manager._putMetadata = async (meta) => { current = structuredClone(meta); };
  await assert.rejects(() => manager.verifyStoredModel('m'), /file-size verification/);
  assert.equal(current.fileName, 'm-old.onnx');
  assert.equal(current.testPassed, true);
  assert.equal(directory.removed.includes('m-new.onnx'), true);
  assert.equal(directory.removed.includes('m-old.onnx'), false);
});

test('RC14 checkpoint mutations are serialized so concurrent patches cannot erase each other', async () => {
  const { StorageManager } = await import('../src/engine/StorageManager.js');
  const manager = new StorageManager();
  let record = { sessionId:'s', status:'in_progress', progress:0, durableEncodedFrames:0 };
  manager.getCheckpoint = async () => structuredClone(record);
  manager._writeCheckpoint = async (_id, next) => {
    await new Promise((r) => setTimeout(r, next.progress === 0.5 ? 15 : 1));
    record = structuredClone(next);
  };
  await Promise.all([
    manager.updateSession('s', { progress:0.5 }),
    manager.updateSession('s', { durableEncodedFrames:42 }),
  ]);
  assert.equal(record.progress, 0.5);
  assert.equal(record.durableEncodedFrames, 42);
  assert.equal(manager.sessionMutationChains.size, 0);
});

test('RC14 StorageManager removes stale active writer state on durable checkpoint lifecycle failure', () => {
  const src = fs.readFileSync(new URL('../src/engine/StorageManager.js', import.meta.url), 'utf8');
  assert.match(src, /this\.activeWriters\.delete\(sessionId\);\s*throw await this\._storageWriteError\(error, 'durable checkpoint'\)/s);
  assert.match(src, /this\.sessionMutationChains = new Map\(\)/);
  assert.match(src, /async _mutateCheckpoint\(sessionId, mutate\)/);
});

test('RC14 storage shutdown and deletion drain queued checkpoint mutations before DB cleanup', () => {
  const src = fs.readFileSync(new URL('../src/engine/StorageManager.js', import.meta.url), 'utf8');
  const deleteBody = src.slice(src.indexOf('async deleteSession(sessionId)'), src.indexOf('async getStorageUsage'));
  const closeBody = src.slice(src.indexOf('async close()'), src.indexOf('\n}', src.indexOf('async close()')));
  assert.match(deleteBody, /await this\._drainSessionMutations\(sessionId\)/);
  assert.match(closeBody, /await this\._drainSessionMutations\(\)/);
  assert.ok(closeBody.indexOf('_drainSessionMutations') < closeBody.indexOf('this.db?.close'));
});
