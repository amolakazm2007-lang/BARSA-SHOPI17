import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRealtimeEffects } from '../src/engine/RealtimePreviewEngine.js';

function frame(width = 9, height = 9, value = 96) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set([value, value, value, 255], i);
  return { width, height, data };
}

test('exposure raises luminance while negative highlights recover it', () => {
  const exposed = applyRealtimeEffects(frame(), { exposure: 1 });
  const recovered = applyRealtimeEffects(frame(), { exposure: 1, highlights: -1 });
  assert.ok(exposed.data[0] > 180);
  assert.ok(recovered.data[0] < exposed.data[0]);
  assert.equal(exposed.data[3], 255);
});

test('vignette darkens corners more than the center', () => {
  const output = applyRealtimeEffects(frame(9, 9, 180), { vignette: 1 });
  const corner = output.data[0];
  const center = output.data[(4 * 9 + 4) * 4];
  assert.ok(center - corner > 35, `expected visible vignette, got center=${center}, corner=${corner}`);
});
