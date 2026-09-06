import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const gpuPath = new URL('../src/engine/WebGPUEngine.js', import.meta.url);
const workerPath = new URL('../src/engine/CPUFrameWorker.js', import.meta.url);

async function source(path) { return readFile(path, 'utf8'); }

test('WebGPU routes fatal device and frame faults through RuntimeFaultReporter contract', async () => {
  const code = await source(gpuPath);
  assert.match(code, /setFaultReporter\(faultReporter\)/);
  assert.match(code, /_reportFatal\('GPU_DEVICE_LOST'/);
  assert.match(code, /GPU_OUT_OF_MEMORY/);
  assert.match(code, /GPU_VALIDATION_ERROR/);
  assert.match(code, /GPU_ERROR_SCOPE_FAILED/);
  assert.match(code, /this\.deviceLost = true/);
  assert.match(code, /throw wrapped/);
});

test('WebGPU failure policy preserves recoverable fallback semantics', async () => {
  const code = await source(gpuPath);
  assert.match(code, /recoverable: true/);
  assert.match(code, /GPU_DEVICE_LOST/);
  assert.match(code, /WEBGPU_FRAME_FAILED/);
  assert.doesNotMatch(code, /resolution\s*[=:]/i);
  assert.doesNotMatch(code, /bitrate\s*[=:]/i);
  assert.doesNotMatch(code, /modelId\s*[=:]/i);
});

test('CPU worker has bounded hang recovery and centralized evidence', async () => {
  const code = await source(workerPath);
  assert.match(code, /WORKER_TIMEOUT/);
  assert.match(code, /WORKER_CRASH/);
  assert.match(code, /WORKER_MESSAGE_ERROR/);
  assert.match(code, /WORKER_POST_FAILED/);
  assert.match(code, /WORKER_TERMINATE_FAILED/);
  assert.match(code, /this\._failWorker\(error\)/);
  assert.match(code, /this\.pending\.clear\(\)/);
  assert.match(code, /setFaultReporter\(faultReporter\)/);
});

test('CPU worker rejects pending work before a fresh worker can be created', async () => {
  const code = await source(workerPath);
  const failStart = code.indexOf('_failWorker(error)');
  const clear = code.indexOf('this.pending.clear()', failStart);
  const reject = code.indexOf('entry.reject(error)', clear);
  assert.ok(failStart >= 0 && clear > failStart && reject > clear);
  assert.match(code, /this\.worker = null/);
});
