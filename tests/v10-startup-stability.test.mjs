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

test('release CI boots a real Android AVD and proves the app-launch script executed', async () => {
  const workflow = await read('.github/workflows/build-apk.yml');
  assert.match(workflow, /system-images;android-34;google_apis;x86_64/);
  assert.match(workflow, /avdmanager create avd/);
  assert.match(workflow, /ANDROID_HOME\/emulator\/emulator/);
  assert.match(workflow, /sys\.boot_completed/);
  assert.match(workflow, /EMULATOR_BOOTED/);
  assert.match(workflow, /SCRIPT_ENTERED/);
  assert.match(workflow, /APK_INSTALLED/);
  assert.match(workflow, /am start -W -n com\.barsa\.shopi\/\.MainActivity/);
  assert.match(workflow, /for PASS in 1 2 3/);
  assert.match(workflow, /pidof com\.barsa\.shopi/);
  assert.match(workflow, /LOGCAT_CAPTURED/);
  assert.match(workflow, /FATAL EXCEPTION/);
  assert.match(workflow, /ANR in com\\\.barsa\\\.shopi/);
  assert.match(workflow, /android-startup\.png/);
  assert.match(workflow, /grep -qx 'PASSED' reports\/android-coldstart-gate\.txt/);
  assert.doesNotMatch(workflow, /infrastructure did not reach the app-launch script; APK release continues/);
});
