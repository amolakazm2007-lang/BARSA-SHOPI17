import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { MediaInputEngine } from '../src/engine/MediaInputEngine.js';

test('container probe reads real WebM dimensions, timing and codec', async () => {
  const bytes = await readFile(new URL('./tiny-render.webm', import.meta.url));
  const engine = new MediaInputEngine();
  const metadata = await engine.probe(new Blob([bytes], { type: 'video/webm' }), { preciseDuration: true });
  assert.equal(metadata.width, 320);
  assert.equal(metadata.height, 180);
  assert.ok(metadata.duration > 0);
  assert.equal(metadata.fps, 12);
  assert.match(metadata.codec, /vp09|vp9/i);
  assert.equal(metadata.hasAudio, false);
  engine.destroy();
});
