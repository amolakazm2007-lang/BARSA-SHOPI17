import test from 'node:test';
import assert from 'node:assert/strict';
import { CrashProofProofStore } from '../src/engine/CrashProofProofStore.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  setItem(k, v) { this.map.set(k, v); }
  getItem(k) { return this.map.get(k) ?? null; }
  removeItem(k) { this.map.delete(k); }
}

test('proof store persists and reloads release evidence', () => {
  const storage = new MemoryStorage();
  const one = new CrashProofProofStore({ storage, logger: { error() {} } });
  one.mark('hard-timeout', { ms: 50 });
  const two = new CrashProofProofStore({ storage, logger: { error() {} } });
  assert.equal(two.get('hard-timeout')?.ok, true);
  assert.deepEqual(two.get('hard-timeout')?.details, { ms: 50 });
});
