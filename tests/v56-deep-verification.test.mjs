import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');

test('Android build is pinned to Java 17 in source and GitHub Actions', async () => {
  const app = await read('android/app/build.gradle');
  const workflow = await read('.github/workflows/build-apk.yml');
  assert.match(app, /sourceCompatibility JavaVersion\.VERSION_17/);
  assert.match(app, /targetCompatibility JavaVersion\.VERSION_17/);
  assert.match(workflow, /java-version: '17'/);
  assert.match(workflow, /BARSA-SHOPI-v10-RC15\.1-FINAL-installable/);
});

test('audio preservation and audio cleaning are independent real controls', async () => {
  const html = await read('index.html');
  const main = await read('src/main.js');
  const pipeline = await read('src/engine/VideoPipeline.js');
  assert.match(html, /id="audioEnabled"/);
  assert.match(html, /id="audioCleanEnabled"/);
  assert.match(main, /enabled:byId\('audioCleanEnabled'\)\.checked/);
  assert.match(pipeline, /settings\.audio\?\.enabled !== false/);
  assert.match(pipeline, /process: streamProcessor\?\.process \|\| undefined/);
});

test('every static byId reference exists in index or dynamic EngineLabs UI', async () => {
  const html = (await read('index.html')) + (await read('src/ui/EngineLabsUI.js'));
  const main = await read('src/main.js');
  const ids = new Set([...html.matchAll(/\bid=["'`]([^"'`$]+)["'`]/g)].map((m) => m[1]));
  const refs = new Set([...main.matchAll(/byId\(['"]([^'"]+)['"]\)/g)].map((m) => m[1]));
  const missing = [...refs].filter((id) => !ids.has(id));
  assert.deepEqual(missing, []);
});
