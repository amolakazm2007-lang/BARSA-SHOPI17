import test from 'node:test';
import assert from 'node:assert/strict';
import { applyColorToImageData, buildCurveTable, compileColorSettings, parseCubeLUT, parseCurve, sampleCubeLUT } from '../src/engine/ColorEngine.js';

const IDENTITY_CUBE = `TITLE "Identity"
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1`;

test('valid .cube data is parsed and trilinearly sampled', () => {
  const lut = parseCubeLUT(IDENTITY_CUBE);
  assert.equal(lut.type, '3d');
  assert.equal(lut.size, 2);
  const mapped = sampleCubeLUT(lut, .25, .5, .75);
  assert.ok(Math.abs(mapped[0] - .25) < 1e-6);
  assert.ok(Math.abs(mapped[1] - .5) < 1e-6);
  assert.ok(Math.abs(mapped[2] - .75) < 1e-6);
});

test('malformed LUTs and curves fail closed', () => {
  assert.throws(() => parseCubeLUT('LUT_3D_SIZE 2\n0 0 0'), /expected/);
  assert.throws(() => parseCurve('0.2:0,1:1'), /start/);
});

test('curve and color controls modify real pixel values', () => {
  const table = buildCurveTable('0:0,0.5:0.25,1:1');
  assert.ok(table[Math.floor(table.length / 2)] < .3);
  const pixels = { width: 1, height: 1, data: new Uint8ClampedArray([64, 96, 128, 255]) };
  const compiled = compileColorSettings({ lift: .05, colorGamma: 1.1, gain: 1.05, curves: { luma: '0:0,1:1' } });
  applyColorToImageData(pixels, compiled);
  assert.notDeepEqual([...pixels.data.slice(0, 3)], [64, 96, 128]);
  assert.equal(pixels.data[3], 255);
});
