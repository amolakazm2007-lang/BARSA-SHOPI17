import test from 'node:test';
import assert from 'node:assert/strict';
import { StreamingSHA256 } from '../src/engine/ModelManager.js';

test('streaming SHA-256 matches standard vectors across chunk boundaries', () => {
  const encoder = new TextEncoder();
  const digest = new StreamingSHA256();
  digest.update(encoder.encode('a'));
  digest.update(encoder.encode('bc'));
  assert.equal(digest.hex(), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

  const long = new StreamingSHA256();
  const bytes = encoder.encode('x'.repeat(10_000));
  for (let index = 0; index < bytes.length; index += 37) long.update(bytes.subarray(index, index + 37));
  assert.equal(long.hex(), 'e4ee97ec252749d2096447e849628d0d7734f51700416eefbb33574bf0b3ee75');
});
