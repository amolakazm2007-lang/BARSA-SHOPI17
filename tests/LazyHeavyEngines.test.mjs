import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manager = await readFile(new URL('../src/engine/EngineManager.js', import.meta.url), 'utf8');
const doctor = await readFile(new URL('../src/engine/BarsaDoctor.js', import.meta.url), 'utf8');

test('heavy AI engines are not constructed eagerly in EngineManager constructor', () => {
  assert.doesNotMatch(manager, /rife:\s*new RIFEEngine\(/);
  assert.doesNotMatch(manager, /upscale:\s*new UpscaleEngine\(/);
  assert.doesNotMatch(manager, /face:\s*new FaceRestorationEngine\(/);
  assert.match(manager, /defineLazyEngine\(this\.engines, 'rife'/);
  assert.match(manager, /defineLazyEngine\(this\.engines, 'upscale'/);
  assert.match(manager, /defineLazyEngine\(this\.engines, 'face'/);
});

test('BARSA Doctor quick model scan does not wake lazy AI engines', () => {
  assert.match(doctor, /deep \? this\.manager\.engines\[engineKey\] : this\.manager\.peekEngine\?\.\(engineKey\)/);
  assert.match(doctor, /this\.manager\.peekEngine\?\.\(key\)/);
});
