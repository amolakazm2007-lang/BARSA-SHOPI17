import test from 'node:test';
import assert from 'node:assert/strict';
import { ElementaryVideoWriter } from '../src/engine/WebCodecsEngine.js';

function fakeChunk(timestamp = 0) {
  const data = new Uint8Array([1,2,3,4]);
  return { byteLength: data.length, timestamp, copyTo(target) { target.set(data); } };
}

test('elementary writer does not transact IndexedDB on every encoded frame', async () => {
  let updates = 0;
  const storage = {
    beginSession: async () => {}, appendFrame: async () => {},
    updateSession: async () => { updates++; },
    finalizeSession: async () => new Blob(['ok']), abortSession: async () => {},
  };
  const writer = new ElementaryVideoWriter({ storage, sessionId:'x', codec:'avc1.42E01E', width:16, height:16, fps:60, expectedFrames:600 });
  await writer.initialize();
  for (let i=0;i<120;i++) await writer.write(fakeChunk(i * 16667));
  assert.ok(updates <= 2, `expected throttled metadata writes, got ${updates}`);
  await writer.finalize();
  assert.ok(updates >= 1);
});

test('unknown frame-count render is still throttled', async () => {
  let updates = 0;
  const storage = {
    beginSession: async () => {}, appendFrame: async () => {}, updateSession: async () => { updates++; },
    finalizeSession: async () => new Blob(['ok']), abortSession: async () => {},
  };
  const writer = new ElementaryVideoWriter({ storage, sessionId:'x', codec:'avc1.42E01E', width:16, height:16, fps:30 });
  await writer.initialize();
  for (let i=0;i<60;i++) await writer.write(fakeChunk(i * 33333));
  assert.ok(updates <= 2, `unknown-size job wrote metadata ${updates} times`);
  await writer.finalize();
});
