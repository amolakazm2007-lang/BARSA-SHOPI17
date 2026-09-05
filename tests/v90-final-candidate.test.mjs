import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { RenderResilienceEngine } from '../src/engine/RenderResilienceEngine.js';

test('v9 final keeps model choice manual with no render-time substitution', () => {
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /allowFallback:false/);
  assert.match(main, /فعّل RIFE واختر النموذج يدوياً/);
  assert.doesNotMatch(main, /allowFallback:role!==['"]face['"]/);
});

test('v9 production EngineManager does not instantiate the legacy auto model selector', () => {
  const manager = fs.readFileSync(new URL('../src/engine/EngineManager.js', import.meta.url), 'utf8');
  assert.doesNotMatch(manager, /new ModelAutoSelector/);
  assert.doesNotMatch(manager, /autoModelSelector:/);
});

test('render resilience diagnostics reset cleanly between jobs', () => {
  const r = new RenderResilienceEngine({ sampleEveryFrames: 1 });
  r.noteBackendFallback();
  r.evaluate({ frameIndex: 1, codecQueue: 9, writeBacklog: 9, plan: { codecQueue: 1, writeBacklog: 1 } });
  assert.ok(r.diagnostics().backendFallbacks > 0);
  r.reset();
  const d = r.diagnostics();
  assert.equal(d.backendFallbacks, 0);
  assert.equal(d.recoveryCount, 0);
  assert.equal(d.recentActions.length, 0);
});

test('automatic model provisioning stays idle once a source video is selected', () => {
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /const idleForModels=\(\)=>!activeJobId&&!sourceFile/);
  assert.match(main, /إدارة النماذج متوقفة أثناء الرندر/);
});

test('v9 final metadata is unified across web Android and GitHub artifacts', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const gradle = fs.readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
  const workflow = fs.readFileSync(new URL('../.github/workflows/build-apk.yml', import.meta.url), 'utf8');
  assert.equal(pkg.version, '10.0.0-rc15.1');
  assert.equal(lock.version, '10.0.0-rc15.1');
  assert.equal(lock.packages[''].version, '10.0.0-rc15.1');
  assert.match(gradle, /versionCode 1001501/);
  assert.match(gradle, /versionName '10\.0\.0-rc15\.1'/);
  assert.match(workflow, /BARSA-SHOPI-v10-RC15\.1-FINAL-installable/);
  assert.match(workflow, /BARSA-SHOPI-v10-RC15\.1-release-unsigned/);
});
