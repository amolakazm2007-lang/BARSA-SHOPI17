import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SettingsStore } from '../src/platform/SettingsStore.js';

test('professional settings store persists and restores versioned payloads', () => {
  const mem = new Map();
  globalThis.localStorage = { setItem:(k,v)=>mem.set(k,v), getItem:k=>mem.get(k)??null, removeItem:k=>mem.delete(k) };
  const store = new SettingsStore({ key:'test.settings' });
  assert.equal(store.save({ quality:'ULTRA', export:{ videoMode:'max' } }), true);
  assert.deepEqual(store.load(), { quality:'ULTRA', export:{ videoMode:'max' } });
  assert.equal(store.clear(), true);
  assert.equal(store.load(), null);
  delete globalThis.localStorage;
});

test('v8 production UI exposes save/reset session controls', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="savePrefsBtn"/);
  assert.match(html, /id="resetPrefsBtn"/);
  assert.match(html, /جلسة احترافية/);
});

test('Android final has branded adaptive icon and unified release workflow', async () => {
  const manifest = await readFile(new URL('../android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8');
  const gradle = await readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
  const workflow = await readFile(new URL('../.github/workflows/build-apk.yml', import.meta.url), 'utf8');
  const icon = await readFile(new URL('../android/app/src/main/res/mipmap-anydpi/ic_launcher.xml', import.meta.url), 'utf8');
  assert.match(manifest, /@mipmap\/ic_launcher/);
  assert.match(icon, /<monochrome/);
  assert.match(gradle, /versionCode 1002000/);
  assert.match(gradle, /versionName '10\.0\.0'/);
  assert.match(workflow, /:app:assembleDebug :app:assembleRelease/);
  assert.match(workflow, /apksigner/);
  assert.match(workflow, /BARSA-SHOPI-v10\.0\.0-FINAL-release-unsigned/);
});
