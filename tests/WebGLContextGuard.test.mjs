import test from 'node:test';
import assert from 'node:assert/strict';
import { WebGLContextGuard } from '../src/engine/WebGLContextGuard.js';

if (!globalThis.CustomEvent) {
  globalThis.CustomEvent = class CustomEvent extends Event { constructor(type, init = {}) { super(type); this.detail = init.detail; } };
}

class FakeCanvas extends EventTarget {}

test('context loss is surfaced and blocks rendering until restoration', () => {
  const canvas = new FakeCanvas();
  const guard = new WebGLContextGuard({ canvas, logger: { error() {}, warn() {} } });
  canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
  assert.equal(guard.lost, true);
  assert.throws(() => guard.assertAvailable(), (error) => error.code === 'WEBGL_CONTEXT_LOST');
  canvas.dispatchEvent(new Event('webglcontextrestored'));
  assert.equal(guard.lost, false);
  assert.doesNotThrow(() => guard.assertAvailable());
  guard.dispose();
});
