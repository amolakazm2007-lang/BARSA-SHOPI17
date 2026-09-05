import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeFileName } from '../src/platform/AndroidBridge.js';

test('sanitizeFileName keeps mp4 extension and removes unsafe characters', () => {
  assert.equal(sanitizeFileName('my:video?.mp4'), 'my_video_.mp4');
  assert.equal(sanitizeFileName('BARSA export'), 'BARSA export.mp4');
});
