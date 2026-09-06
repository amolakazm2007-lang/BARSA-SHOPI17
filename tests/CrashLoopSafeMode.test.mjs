import test from 'node:test';
import assert from 'node:assert/strict';
import { CrashLoopSafeMode, CRASH_LOOP_FAILURE_THRESHOLD } from '../src/engine/CrashLoopSafeMode.js';

class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(key) { return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.map.set(key, String(value)); }
}

test('safe mode activates only after repeated failed boots inside the crash window', () => {
  const storage = new MemoryStorage();
  let now = 1000;
  for (let i = 0; i < CRASH_LOOP_FAILURE_THRESHOLD; i++) {
    const guard = new CrashLoopSafeMode({ storage, now: () => now });
    const boot = guard.beginBoot();
    assert.equal(boot.safeMode, false);
    guard.markBootFailure(new Error(`failure-${i}`));
    now += 1000;
  }
  const recoveryBoot = new CrashLoopSafeMode({ storage, now: () => now }).beginBoot();
  assert.equal(recoveryBoot.safeMode, true);
  assert.equal(recoveryBoot.reason, 'CRASH_LOOP_THRESHOLD');
});

test('successful safe boot clears the crash streak for the following launch', () => {
  const storage = new MemoryStorage();
  let now = 10_000;
  for (let i = 0; i < 3; i++) {
    const guard = new CrashLoopSafeMode({ storage, now: () => now });
    guard.beginBoot();
    guard.markBootFailure(new Error('boom'));
    now += 1000;
  }
  const safeGuard = new CrashLoopSafeMode({ storage, now: () => now });
  assert.equal(safeGuard.beginBoot().safeMode, true);
  assert.equal(safeGuard.markBootHealthy(), true);
  now += 1000;
  const next = new CrashLoopSafeMode({ storage, now: () => now }).beginBoot();
  assert.equal(next.safeMode, false);
  assert.equal(next.failures, 0);
});

test('stale boot failures outside the crash window do not force safe mode', () => {
  const storage = new MemoryStorage();
  let now = 1000;
  const guard = new CrashLoopSafeMode({ storage, now: () => now });
  guard.beginBoot();
  guard.markBootFailure(new Error('old failure'));
  now += 11 * 60 * 1000;
  const fresh = new CrashLoopSafeMode({ storage, now: () => now }).beginBoot();
  assert.equal(fresh.safeMode, false);
  assert.equal(fresh.failures, 0);
});
