import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ui = fs.readFileSync(new URL('../src/ui/EngineLabsUI.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('v5.3 exposes numeric controls beside quality and color sliders', () => {
  assert.match(ui, /data-sync-range/);
  assert.match(ui, /stage-value-control/);
  assert.match(ui, /pro-value-row/);
});

test('v5.3 blur has shutter angle, presets and blur-only MP4 render', () => {
  assert.match(ui, /blur-shutter-angle/);
  assert.match(ui, /data-blur-preset="gameplay"/);
  assert.match(ui, /رندر البلور فقط MP4/);
  assert.match(ui, /shutterAngle/);
});

test('v5.3 export presets are wired to real export controls', () => {
  assert.match(html, /data-export-preset="master"/);
  assert.match(html, /data-export-preset="poco"/);
  assert.match(main, /data-export-preset/);
  assert.match(main, /exportVideoBitrateMbps/);
});
