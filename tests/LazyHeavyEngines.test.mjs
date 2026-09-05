import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manager = await readFile(new URL('../src/engine/EngineManager.js', import.meta.url), 'utf8');
const doctor = await readFile(new URL('../src/engine/BarsaDoctor.js', import.meta.url), 'utf8');

test('heavy AI engines are not constructed eagerly in EngineManager engine table', () => {
  assert.doesNotMatch(manager, /rife:\s*new RIFEEngine\(/);
  assert.doesNotMatch(manager, /upscale:\s*new UpscaleEngine\(/);
  assert.doesNotMatch(manager, /face:\s*new FaceRestorationEngine\(/);
  assert.doesNotMatch(manager, /faceDetector:\s*new FaceDetectorEngine\(/);
  assert.match(manager, /createLazyEngineHandle\('rife', \(\) => new RIFEEngine\(models\)\)/);
  assert.match(manager, /createLazyEngineHandle\('upscale', \(\) => new UpscaleEngine\(models\)\)/);
  assert.match(manager, /createLazyEngineHandle\('faceDetector', \(\) => new FaceDetectorEngine\(models\)\)/);
  assert.match(manager, /createLazyEngineHandle\('face', \(\) => new FaceRestorationEngine\(models, faceDetector\)\)/);
});

test('lazy cleanup probes do not instantiate unused heavy engines', () => {
  assert.match(manager, /LAZY_CLEANUP_METHODS\.has\(property\) && !instance/);
  assert.match(manager, /return \(\) => undefined/);
  assert.match(manager, /peekEngine\(name\)/);
});

test('BARSA Doctor quick model scan only calls live engine methods in deep mode', () => {
  assert.match(doctor, /const engine = this\.manager\.engines\[engineKey\]/);
  assert.match(doctor, /if \(deep && status\.installed && status\.verified && typeof engine\.runSelfTest === 'function'\)/);
});
