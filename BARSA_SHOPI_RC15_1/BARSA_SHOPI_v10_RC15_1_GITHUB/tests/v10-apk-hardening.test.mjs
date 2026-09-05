import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AndroidBridge } from '../src/platform/AndroidBridge.js';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Android 16 build target uses an API-36-compatible Android Gradle plugin', async () => {
  const [appGradle, rootGradle] = await Promise.all([read('android/app/build.gradle'), read('android/build.gradle')]);
  assert.match(appGradle, /compileSdk\s+36/);
  assert.match(appGradle, /targetSdk\s+36/);
  assert.match(rootGradle, /com\.android\.application' version '8\.9\.1'/);
});

test('APK shell handles Android 16 insets, predictive back, and WebView renderer loss', async () => {
  const activity = await read('android/app/src/main/java/com/barsa/shopi/MainActivity.java');
  assert.match(activity, /setDecorFitsSystemWindows\(false\)/);
  assert.match(activity, /WindowInsets\.Type\.systemBars\(\)/);
  assert.match(activity, /WindowInsets\.Type\.ime\(\)/);
  assert.match(activity, /OnBackInvokedDispatcher\.PRIORITY_DEFAULT/);
  assert.match(activity, /onRenderProcessGone/);
  assert.match(activity, /cancelAllExports\(\)/);
  assert.match(activity, /FLAG_KEEP_SCREEN_ON/);
  assert.match(activity, /MIXED_CONTENT_NEVER_ALLOW/);
  assert.match(activity, /setAllowFileAccess\(false\)/);
});


test('APK localhost runtime is isolated from external cleartext and framed bridge access', async () => {
  const [manifest, network, server] = await Promise.all([
    read('android/app/src/main/AndroidManifest.xml'),
    read('android/app/src/main/res/xml/network_security_config.xml'),
    read('android/app/src/main/java/com/barsa/shopi/AssetServer.java'),
  ]);
  assert.match(manifest, /usesCleartextTraffic="false"/);
  assert.match(manifest, /networkSecurityConfig="@xml\/network_security_config"/);
  assert.match(network, /base-config cleartextTrafficPermitted="false"/);
  assert.match(network, />127\.0\.0\.1</);
  assert.match(server, /frame-src \'none\'/);
  assert.match(server, /X-Frame-Options: DENY/);
  assert.match(server, /X-Content-Type-Options: nosniff/);
  assert.doesNotMatch(server, /Access-Control-Allow-Origin: \*/);
});

test('native gallery export streams once into a pending MediaStore row and validates exact bytes', async () => {
  const bridge = await read('android/app/src/main/java/com/barsa/shopi/NativeBridge.java');
  assert.match(bridge, /final BufferedOutputStream stream/);
  assert.match(bridge, /resolver\.openOutputStream\(uri, "w"\)/);
  assert.match(bridge, /writtenBytes \+ bytes\.length > expectedBytes/);
  assert.match(bridge, /writtenBytes == expectedBytes/);
  assert.match(bridge, /mediaStoreSize\(session\.resolver, session\.uri\)/);
  assert.match(bridge, /actualBytes != session\.expectedBytes/);
  assert.match(bridge, /MediaStore\.Video\.Media\.IS_PENDING, 1/);
  assert.match(bridge, /MediaStore\.Video\.Media\.IS_PENDING, 0/);
  assert.match(bridge, /cleanupStalePendingExports\(\)/);
  assert.match(bridge, /OWNER_PACKAGE_NAME/);
  assert.match(bridge, /cancelAllExports\(\)/);
  assert.doesNotMatch(bridge, /FileOutputStream/);
  assert.doesNotMatch(bridge, /new FileInputStream/);
});

test('JavaScript Android export preserves chunk sequence and publishes only after all bytes are sent', async () => {
  const chunks = [];
  let expected = 0;
  const api = {
    getDeviceInfo: () => '{}',
    beginExport: (_name, _mime, total) => { expected = Number(total); return 'export-1'; },
    appendExportChunk: (_id, encoded, sequence) => { chunks.push({ sequence, bytes: Buffer.from(encoded, 'base64').length }); return true; },
    finishExport: () => 'content://barsa/export-1',
    cancelExport: () => { throw new Error('should not cancel successful export'); },
  };
  const bridge = new AndroidBridge(api);
  const blob = new Blob([new Uint8Array(2 * 1024 * 1024 + 17)]);
  const progress = [];
  const result = await bridge.saveBlob(blob, 'test.mp4', { onProgress: (p) => progress.push(p) });
  assert.equal(result.bytes, blob.size);
  assert.equal(expected, blob.size);
  assert.deepEqual(chunks.map((x) => x.sequence), [0, 1, 2, 3, 4]);
  assert.equal(chunks.reduce((sum, x) => sum + x.bytes, 0), blob.size);
  assert.equal(progress.at(-1), 1);
});
