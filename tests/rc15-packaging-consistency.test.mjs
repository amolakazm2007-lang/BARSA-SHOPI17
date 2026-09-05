import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { APP_VERSION, APP_VERSION_CODE } from '../src/version.js';

test('v10 FINAL packaging metadata is single-source consistent after lock normalization', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const gradle = fs.readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
  const workflow = fs.readFileSync(new URL('../.github/workflows/build-apk.yml', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const cacheGraph = fs.readFileSync(new URL('../src/engine/CacheGraphEngine.js', import.meta.url), 'utf8');

  assert.equal(APP_VERSION, '10.0.0');
  assert.equal(APP_VERSION_CODE, 1002000);
  assert.equal(pkg.version, APP_VERSION);
  assert.equal(lock.version, APP_VERSION);
  assert.equal(lock.packages[''].version, APP_VERSION);
  assert.match(gradle, new RegExp(`versionCode ${APP_VERSION_CODE}`));
  assert.match(gradle, new RegExp(`versionName '${APP_VERSION.replaceAll('.', '\\.')}'`));
  assert.match(workflow, /BARSA-SHOPI-v10\.0\.0-FINAL-installable/);
  assert.match(workflow, /BARSA-SHOPI-v10\.0\.0-FINAL-release-unsigned/);
  assert.match(workflow, /normalize-version-lock\.mjs/);
  assert.match(main, /version:APP_VERSION/);
  assert.match(cacheGraph, /engineVersion=APP_VERSION/);
});
