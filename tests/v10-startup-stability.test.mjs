import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('native ONNX runtime is lazy and cannot initialize ORT inside Activity construction', async () => {
  const nativeAi = await read('android/app/src/main/java/com/barsa/shopi/NativeAiRuntime.java');
  const ctor = nativeAi.match(/NativeAiRuntime\(Context context\)\{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.ok(ctor.length > 0, 'NativeAiRuntime constructor not found');
  assert.doesNotMatch(ctor, /OrtEnvironment\.getEnvironment\(/);
  assert.match(nativeAi, /private volatile OrtEnvironment environment/);
  assert.match(nativeAi, /private OrtEnvironment environment\(\)/);
  assert.match(nativeAi, /OrtEnvironment\.getEnvironment\(\)/);
});

test('Android shell fail-closes automatic model downloads on cold start', async () => {
  const activity = await read('android/app/src/main/java/com/barsa/shopi/MainActivity.java');
  assert.match(activity, /localStorage\.getItem\('barsa\.autoModels'\)!=='on'/);
  assert.match(activity, /localStorage\.setItem\('barsa\.autoModels','off'\)/);
  assert.match(activity, /localStorage\.getItem\('barsa\.autoFullModels'\)!=='on'/);
  assert.match(activity, /STARTUP_WATCHDOG_MS/);
  assert.match(activity, /onPageCommitVisible/);
  assert.match(activity, /onRenderProcessGone/);
  assert.match(activity, /nativeAi\.releaseSessions\(\)/);
});

test('release CI performs real APK cold-start crash and ANR gating', async () => {
  const workflow = await read('.github/workflows/build-apk.yml');
  assert.match(workflow, /android-emulator-runner@v2/);
  assert.match(workflow, /am start -W -n com\.barsa\.shopi\/\.MainActivity/);
  assert.match(workflow, /for PASS in 1 2 3/);
  assert.match(workflow, /pidof com\.barsa\.shopi/);
  assert.match(workflow, /FATAL EXCEPTION/);
  assert.match(workflow, /ANR in com\\\.barsa\\\.shopi/);
  assert.match(workflow, /android-startup\.png/);
});
