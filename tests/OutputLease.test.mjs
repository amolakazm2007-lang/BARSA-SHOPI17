import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { StorageManager } from '../src/engine/StorageManager.js';

const pipeline = fs.readFileSync(new URL('../src/engine/VideoPipeline.js', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const applyStack = fs.readFileSync(new URL('../src/engine/ApplyStackEngine.js', import.meta.url), 'utf8');

test('completed native output lease removes resumable artifacts but preserves final MP4', async () => {
  const storage = new StorageManager();
  const removed = [];
  let checkpoint = {
    sessionId: 'lease-1',
    fileName: 'render-session-lease-1.bin',
    sourceFileName: 'source-lease-1.mp4',
    outputFileName: 'output-lease-1.mp4',
    status: 'remux_pending',
  };
  storage._drainSessionMutations = async () => {};
  storage.getCheckpoint = async () => checkpoint;
  storage._getRoot = async () => ({ removeEntry: async (name) => { removed.push(name); } });
  storage.deleteFrameCache = async () => { removed.push('frames'); };
  storage._mutateCheckpoint = async (_sessionId, mutate) => { checkpoint = await mutate(checkpoint); return checkpoint; };

  const result = await storage.completeSessionWithOutput('lease-1');
  assert.deepEqual(removed, ['render-session-lease-1.bin', 'source-lease-1.mp4', 'frames']);
  assert.equal(result.status, 'completed');
  assert.equal(result.fileName, null);
  assert.equal(result.sourceFileName, null);
  assert.equal(result.outputFileName, 'output-lease-1.mp4');
});

test('VideoPipeline leases OPFS native output instead of deleting it before blob URL consumption', () => {
  assert.match(pipeline, /const nativeOutputLeased = Boolean\(nativeMp4\?\.opfsOutput\)/);
  assert.match(pipeline, /await storage\.completeSessionWithOutput\(jobId\)/);
  assert.match(pipeline, /release: releaseOutputLease/);
  assert.doesNotMatch(pipeline, /await nativeMp4\?\.releaseOutputFile\?\.\(\);/);
});

test('UI releases final output only when ownership ends', () => {
  assert.match(main, /lastResultRelease=r\.release\|\|null/);
  assert.match(main, /lastResultRelease\?\.\(\).*reset-release-failed/s);
  assert.match(main, /preparedResult\?\.release.*prepared-release-failed/s);
});

test('ApplyStack releases transient native lease only after a durable stage cache file exists', () => {
  assert.match(applyStack, /if \(diskFile\?\.size\) \{[\s\S]*nextFile = diskFile;[\s\S]*await result\.release\?\.\(\);[\s\S]*result\.release = null;/);
});
