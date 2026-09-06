import test from 'node:test';
import assert from 'node:assert/strict';
import { crashProofUserMessage } from '../src/engine/CrashProofUserNotice.js';

test('stall message is explicit and never silent', () => {
  const text = crashProofUserMessage({ code: 'PIPELINE_STALLED' });
  assert.match(text, /توقف/);
  assert.match(text, /بأمان/);
});

test('fallback message names the backend selected', () => {
  const text = crashProofUserMessage({ code: 'GPU_DEVICE_LOST' }, { fallback: 'WebGL2' });
  assert.match(text, /WebGL2/);
});
