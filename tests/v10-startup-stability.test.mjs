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

test('stale callbacks cannot evaluate JavaScript on a destroyed WebView', async () => {
  const activity = await read('android/app/src/main/java/com/barsa/shopi/MainActivity.java');
  assert.match(activity, /private int webViewGeneration = 0/);
  assert.match(activity, /private boolean isCurrentWebView\(WebView target, int generation\)/);
  assert.match(activity, /target == webView && generation == webViewGeneration/);
  assert.match(activity, /if \(!isCurrentWebView\(target, targetGeneration\)\) return/);
  assert.match(activity, /WebView stale = webView/);
  assert.match(activity, /webView = null/);
  assert.match(activity, /webViewGeneration\+\+/);
  assert.match(activity, /ViewCompat\.setOnApplyWindowInsetsListener\(stale, null\)/);
});

test('release CI boots a real Android AVD and proves the bounded app-launch script executed', async () => {
  const workflow = await read('.github/workflows/build-apk.yml');
  const gate = await read('scripts/android-coldstart-gate.sh');

  assert.match(workflow, /system-images;android-34;google_apis;x86_64/);
  assert.match(workflow, /scripts\/android-coldstart-gate\.sh/);
  assert.match(workflow, /grep -qx 'PASSED' reports\/android-coldstart-gate\.txt/);
  assert.doesNotMatch(workflow, /infrastructure did not reach the app-launch script; APK release continues/);

  assert.match(gate, /avdmanager create avd/);
  assert.match(gate, /ANDROID_HOME\/emulator\/emulator/);
  assert.match(gate, /sys\.boot_completed/);
  assert.match(gate, /EMULATOR_BOOTED/);
  assert.match(gate, /SCRIPT_ENTERED/);
  assert.match(gate, /APK_INSTALLED/);
  assert.match(gate, /timeout 30s adb shell am start -W/);
  assert.match(gate, /for PASS in 1 2 3/);
  assert.match(gate, /pidof \"\$PACKAGE\"/);
  assert.match(gate, /topResumedActivity=/);
  assert.match(gate, /ResumedActivity:/);
  assert.match(gate, /ADB_OFFLINE_AFTER_START/);
  assert.match(gate, /LOGCAT_CAPTURED/);
  assert.match(gate, /capture_diagnostics/);
  assert.match(gate, /activity exit-info/);
  assert.match(gate, /FATAL EXCEPTION/);
  assert.match(gate, /android-startup\.png/);
  assert.match(gate, /PASSED/);
});
