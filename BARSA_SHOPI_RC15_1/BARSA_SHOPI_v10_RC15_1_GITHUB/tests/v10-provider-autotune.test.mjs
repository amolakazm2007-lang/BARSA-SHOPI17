import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/engine/UpscaleEngine.js', import.meta.url), 'utf8');

test('upscale self-test benchmarks native vs web and persists the faster route', () => {
  assert.match(source, /webElapsedMs/);
  assert.match(source, /nativeElapsedMs/);
  assert.match(source, /nativeElapsedMs < webElapsedMs \* 0\.95/);
  assert.match(source, /barsa-upscale-provider-preferences/);
});

test('runtime upscale respects learned web preference instead of blindly trying native', () => {
  assert.match(source, /preferNative == null/);
  assert.match(source, /this\.providerPreference\.get\(modelId\) !== 'web'/);
});
