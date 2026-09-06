import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manager = await readFile(new URL('../src/engine/EngineManager.js', import.meta.url), 'utf8');
const doctor = await readFile(new URL('../src/engine/BarsaDoctor.js', import.meta.url), 'utf8');

test('heavy AI and FFmpeg modules stay cold until their first real operation', () => {
  for (const staticImport of ['RIFEEngine', 'UpscaleEngine', 'FaceDetectorEngine', 'FaceRestorationEngine', 'FFmpegEngine']) {
    assert.doesNotMatch(manager, new RegExp(`^import .*\\b${staticImport}\\b`, 'm'));
  }

  assert.match(manager, /createModuleLazyEngine\('rife', async \(\) => \{/);
  assert.match(manager, /await import\('\.\/RIFEEngine\.js'\)/);
  assert.match(manager, /return new RIFEEngine\(models\)/);

  assert.match(manager, /createModuleLazyEngine\('upscale', async \(\) => \{/);
  assert.match(manager, /await import\('\.\/UpscaleEngine\.js'\)/);
  assert.match(manager, /return new UpscaleEngine\(models\)/);

  assert.match(manager, /createModuleLazyEngine\('faceDetector', async \(\) => \{/);
  assert.match(manager, /await import\('\.\/FaceDetectorEngine\.js'\)/);
  assert.match(manager, /return new FaceDetectorEngine\(models\)/);

  assert.match(manager, /createModuleLazyEngine\('face', async \(\) => \{/);
  assert.match(manager, /await import\('\.\/FaceRestorationEngine\.js'\)/);
  assert.match(manager, /return new FaceRestorationEngine\(models, faceDetector\)/);

  assert.match(manager, /createModuleLazyEngine\('ffmpeg', async \(\) => \{/);
  assert.match(manager, /await import\('\.\/FFmpegEngine\.js'\)/);
  assert.match(manager, /return new FFmpegEngine\(\)/);
});

test('lazy cleanup probes do not instantiate unused heavy engines', () => {
  assert.match(manager, /peekEngine\(name\)/);
  assert.match(manager, /if \(engine\.__lazyEngineHandle === true\) return engine\.__peek\(\)/);
  assert.match(manager, /for \(const key of \['rife', 'upscale', 'face', 'faceDetector'\]\)/);
});

test('BARSA Doctor quick model scan only calls live engine methods in deep mode', () => {
  assert.match(doctor, /const engine = this\.manager\.engines\[engineKey\]/);
  assert.match(doctor, /if \(deep && status\.installed && status\.verified && typeof engine\.runSelfTest === 'function'\)/);
});
