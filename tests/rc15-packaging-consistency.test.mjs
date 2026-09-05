import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { APP_VERSION, APP_VERSION_CODE } from '../src/version.js';

test('RC15.1 packaging metadata is single-source consistent', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'));
  const gradle = fs.readFileSync(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
  const debug = fs.readFileSync(new URL('../.github/workflows/android-build.yml', import.meta.url), 'utf8');
  const release = fs.readFileSync(new URL('../.github/workflows/android-release.yml', import.meta.url), 'utf8');
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const cacheGraph = fs.readFileSync(new URL('../src/engine/CacheGraphEngine.js', import.meta.url), 'utf8');

  assert.equal(APP_VERSION, '10.0.0-rc15.1');
  assert.equal(APP_VERSION_CODE, 1001501);
  assert.equal(pkg.version, APP_VERSION);
  assert.equal(lock.version, APP_VERSION);
  assert.equal(lock.packages[''].version, APP_VERSION);
  assert.match(gradle, new RegExp(`versionCode ${APP_VERSION_CODE}`));
  assert.match(gradle, new RegExp(`versionName '${APP_VERSION.replaceAll('.', '\\.')}'`));
  assert.match(debug, /BARSA-SHOPI-v10-RC15\.1-debug/);
  assert.match(release, /BARSA-SHOPI-v10-RC15\.1-release/);
  assert.match(main, /version:APP_VERSION/);
  assert.match(cacheGraph, /engineVersion=APP_VERSION/);
});
