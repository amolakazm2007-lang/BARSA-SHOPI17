import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const mainSource = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
const doctorSource = await readFile(new URL('../src/engine/BarsaDoctor.js', import.meta.url), 'utf8');

test('startup enters recovery mode after crash-loop threshold and suppresses automatic heavy provisioning', () => {
  assert.match(mainSource, /const crashLoopGuard=new CrashLoopSafeMode\(\)/);
  assert.match(mainSource, /const startupSafety=crashLoopGuard\.beginBoot\(\)/);
  assert.match(mainSource, /if\(startupSafety\.safeMode\).*else scheduleAutomaticModelProvisioning\(\)/s);
  assert.match(mainSource, /CRASH_LOOP_SAFE_MODE/);
});

test('successful boot clears startup failure streak and boot failure is recorded centrally', () => {
  assert.match(mainSource, /boot\(\)\.then\(\(\)=>crashLoopGuard\.markBootHealthy\(\)\)\.catch/);
  assert.match(mainSource, /crashLoopGuard\.markBootFailure\(error,'boot'\)/);
  assert.match(mainSource, /manager\.faultLedger\?\.record/);
});

test('BARSA Doctor surfaces crash-loop safe-mode state as a health check', () => {
  assert.match(doctorSource, /capture\('startup-safety'/);
  assert.match(doctorSource, /startup-safe-mode/);
  assert.match(doctorSource, /this\.manager\.crashLoopGuard\?\.snapshot/);
});
