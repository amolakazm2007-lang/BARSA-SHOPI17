import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const pipeline = fs.readFileSync('src/engine/VideoPipeline.js','utf8');
const storage = fs.readFileSync('src/engine/StorageManager.js','utf8');
const manager = fs.readFileSync('src/engine/EngineManager.js','utf8');
const codecs = fs.readFileSync('src/engine/WebCodecsEngine.js','utf8');

test('render pipeline bounds encoder and disk-write backlog', () => {
  assert.match(pipeline, /safeCodecQueue/);
  assert.match(pipeline, /maxWriteBacklog/);
  assert.match(pipeline, /waitForWriteBackpressure/);
  assert.match(codecs, /setMaxQueueSize/);
});

test('native MP4 failure falls back to durable elementary stream instead of losing render', () => {
  assert.match(pipeline, /nativeMuxFailure/);
  assert.match(pipeline, /failedMux\.cancel/);
  assert.match(pipeline, /if \(!outputBlob\)/);
  assert.match(pipeline, /ffmpeg\.remux/);
});

test('long-render resources and terminal OPFS sessions are explicitly released', () => {
  assert.match(pipeline, /temporalReconstruction\.destroy/);
  assert.match(pipeline, /stabilization\.destroy/);
  assert.match(pipeline, /ffmpeg\.terminate/);
  assert.match(storage, /pruneTerminalSessions/);
  assert.match(manager, /pruneTerminalSessions/);
});
