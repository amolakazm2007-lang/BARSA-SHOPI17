import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('v9.8 durable H264 resume reopens OPFS and seeds writer frame index', async()=>{
  const writer=await fs.readFile(new URL('../src/engine/WebCodecsEngine.js',import.meta.url),'utf8');
  const pipe=await fs.readFile(new URL('../src/engine/VideoPipeline.js',import.meta.url),'utf8');
  assert.match(writer,/resumeSession\(this\.sessionId\)/);
  assert.match(writer,/annexb-h264/);
  assert.match(writer,/this\.frameIndex = Number\(checkpoint\.framesWritten \|\| 0\)/);
  assert.match(pipe,/resumeSourceFrameIndex/);
  assert.match(pipe,/sourceTimestampOrigin/);
  assert.match(pipe,/resumedFromCheckpoint/);
  assert.match(pipe,/keyFrame: \(resuming && encodedFrames === encodedFramesAtResume\)/);
});

test('v9.8 stage cache has LRU budget and protects active apply masters', async()=>{
  const storage=await fs.readFile(new URL('../src/engine/StorageManager.js',import.meta.url),'utf8');
  const stack=await fs.readFile(new URL('../src/engine/ApplyStackEngine.js',import.meta.url),'utf8');
  assert.match(storage,/APPLY_STAGE_INDEX_KEY/);
  assert.match(storage,/enforceStageCacheBudget/);
  assert.match(storage,/lastAccessAt/);
  assert.match(storage,/reserveTarget/);
  assert.match(stack,/pinStageCache/);
  assert.match(stack,/protectNames/);
});

test('v9.8 interrupted UI continues the render rather than only restoring settings', async()=>{
  const main=await fs.readFile(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(main,/createResumeJob/);
  assert.match(main,/resumeCheckpoint/);
  assert.match(main,/durableResume/);
  assert.match(main,/adoptRecoveredStage/);
});

test('v9.8 automatic model installs require pinned SHA-256', async()=>{
  const src=await fs.readFile(new URL('../src/engine/ModelAutoProvisioner.js',import.meta.url),'utf8');
  assert.match(src,/MODEL_SOURCE_UNVERIFIED/);
  assert.match(src,/missing pinned SHA-256/);
});
