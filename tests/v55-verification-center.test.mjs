import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const device = await readFile(new URL('../src/engine/FullDeviceTestEngine.js', import.meta.url), 'utf8');

test('v5.5 exposes a real on-device verification center', () => {
  assert.match(html, /مركز التحقق/);
  assert.match(html, /hardwareTestAutoModels/);
  assert.match(main, /manager\.deviceTest\.run/);
});

test('v5.5 device test covers real processing families', () => {
  for (const id of ['qualityMatrix','audioDSP','temporal','storage','mediaProbe','blur','ffmpegRuntime','mobileSR','realESRGAN','rife','gfpgan','codeformer','yunet','cancelRestart']) {
    assert.match(device, new RegExp(`['\"]${id}['\"]`), `missing ${id}`);
  }
  assert.match(device, /engines\.ffmpeg\.load/);
  assert.match(device, /media\.probe/);
  assert.match(device, /storage\.beginSession/);
  assert.match(device, /createStreamingProcessor/);
});
