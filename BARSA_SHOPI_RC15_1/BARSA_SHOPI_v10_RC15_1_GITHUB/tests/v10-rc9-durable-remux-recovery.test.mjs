import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const storage = fs.readFileSync(new URL('../src/engine/StorageManager.js', import.meta.url), 'utf8');
const writer = fs.readFileSync(new URL('../src/engine/WebCodecsEngine.js', import.meta.url), 'utf8');
const pipeline = fs.readFileSync(new URL('../src/engine/VideoPipeline.js', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('RC9 durable checkpoints are based on persisted frame count, not zero-based frame index', () => {
  assert.match(storage, /session\.framesWritten % Math\.max\(1, checkpointEvery\) === 0/);
  assert.doesNotMatch(storage, /frameIndex % checkpointEvery === 0/);
  assert.match(storage, /durableEncodedFrames: session\.framesWritten/);
});

test('RC9 writer resumes from durable frames and never live encoded progress', () => {
  assert.match(writer, /this\.frameIndex = Number\(checkpoint\.framesWritten \|\| 0\)/);
  assert.match(writer, /liveEncodedFrames: this\.frameIndex/);
  assert.doesNotMatch(writer, /checkpoint\.encodedFrames \|\| checkpoint\.framesWritten/);
});

test('RC9 writer stages resume metadata before encode and commits it at OPFS durability boundaries', () => {
  assert.match(writer, /stageResumeMetadata\(frameNumber, metadata\)/);
  assert.match(writer, /checkpointPatch = this\.resumeMetadata\.get\(nextFrameNumber\)/);
  assert.match(pipeline, /writer\.stageResumeMetadata\(nextEncodedFrame/);
  assert.match(pipeline, /checkpointEvery: renderPlan\.checkpointEvery/);
});

test('RC9 seals completed elementary stream as remux_pending until final output validates', () => {
  assert.match(writer, /status: 'remux_pending'/);
  assert.match(storage, /r\.status === 'in_progress' \|\| r\.status === 'remux_pending'/);
  assert.match(pipeline, /recoverPendingRemux/);
  assert.match(pipeline, /recoveredWithoutRerender: true/);
  assert.match(main, /checkpoint\.status!=='remux_pending'/);
});
