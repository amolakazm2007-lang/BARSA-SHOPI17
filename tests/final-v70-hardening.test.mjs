import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ModelAutoProvisioner } from '../src/engine/ModelAutoProvisioner.js';

test('model provisioner retries transient install failures and verifies readiness', async () => {
  let installs = 0;
  let available = false;
  const engine = {
    async isAvailable() { return { available }; },
    async installCatalogModel() {
      installs++;
      if (installs < 2) throw new Error('temporary network error');
      available = true;
    },
  };
  const p = new ModelAutoProvisioner();
  const result = await p.ensure({ role: 'upscale', modelId: 'm', engine, registry: { m: { remoteURL: 'https://example.test/m.onnx', sha256: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc' } }, allowFallback: false, retries: 2 });
  assert.equal(result.ready, true);
  assert.equal(installs, 2);
});

test('final Android shell is Java 17, v10 FINAL and high-priority hardware WebView', async () => {
  const gradle = await readFile(new URL('../android/app/build.gradle', import.meta.url), 'utf8');
  const main = await readFile(new URL('../android/app/src/main/java/com/barsa/shopi/MainActivity.java', import.meta.url), 'utf8');
  assert.match(gradle, /versionCode 1002000/);
  assert.match(gradle, /versionName '10\.0\.0'/);
  assert.match(gradle, /JavaVersion\.VERSION_17/);
  assert.match(main, /WindowInsets\.Type\.ime\(\)/);
  assert.match(main, /WindowInsets\.Type\.displayCutout\(\)/);
  assert.match(main, /LAYER_TYPE_HARDWARE/);
  assert.match(main, /RENDERER_PRIORITY_IMPORTANT/);
});
