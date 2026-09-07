import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Android Activity draws a native root before Chromium startup so system splash cannot own the screen', async () => {
  const activity = await read('android/app/src/main/java/com/barsa/shopi/MainActivity.java');
  assert.match(activity, /private FrameLayout webRoot/);
  assert.match(activity, /private void installWebSurface\(\)/);
  assert.match(activity, /webRoot = new FrameLayout\(this\)/);
  assert.match(activity, /webRoot\.addView\(webView/);
  assert.match(activity, /setContentView\(webRoot\)/);
  assert.match(activity, /webRoot\.postInvalidateOnAnimation\(\)/);
  const create = activity.match(/onCreate\(Bundle state\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.match(create, /installWebSurface\(\)/);
});

test('WebView relies on Activity hardware acceleration instead of forcing an extra hardware layer', async () => {
  const activity = await read('android/app/src/main/java/com/barsa/shopi/MainActivity.java');
  assert.doesNotMatch(activity, /setLayerType\(View\.LAYER_TYPE_HARDWARE/);
});

test('renderer recovery installs the same immediately drawable native surface', async () => {
  const activity = await read('android/app/src/main/java/com/barsa/shopi/MainActivity.java');
  const recovery = activity.match(/private void recoverRenderer\(boolean crashed\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.match(recovery, /installWebSurface\(\)/);
  assert.match(recovery, /configureWebView\(\)/);
});

test('Android RC refuses splash-only resumes and requires first-window-drawn evidence for all three launches', async () => {
  const workflow = await read('.github/workflows/android-rc-verify.yml');
  assert.match(workflow, /android-launch-\$\{PASS\}-first-draw\.txt/);
  assert.match(workflow, /FIRST_WINDOW_DRAWN/);
  assert.match(workflow, /cold-start, first-draw and logcat gates/);
});