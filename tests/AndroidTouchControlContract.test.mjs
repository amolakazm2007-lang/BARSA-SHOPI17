import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('Android packaged UI disables overlapping sticky control layers and restores touch gestures', async () => {
  const sync = await read('scripts/sync-android.mjs');
  assert.match(sync, /BARSA Android touch-control hardening/);
  assert.match(sync, /\.master-tabs,html\.native-android \.workflow-strip,html\.native-android \.lab-nav\{position:static!important/);
  assert.match(sync, /\.controls-panel,html\.native-android \.stage-panel\{contain:none!important/);
  assert.match(sync, /touch-action:manipulation/);
  assert.match(sync, /input\[type=\"range\"\].*touch-action:pan-x/);
  assert.match(sync, /overscroll-behavior-y:auto!important/);
});

test('Android sync fails closed if no CSS asset is available for the touch patch', async () => {
  const sync = await read('scripts/sync-android.mjs');
  assert.match(sync, /if\(cssFiles\.length===0\) throw new Error/);
  assert.match(sync, /for\(const cssFile of cssFiles\) await appendFile/);
});
