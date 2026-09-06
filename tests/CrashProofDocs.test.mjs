import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('acceptance doc forbids mock-only proof and false 100/100 claims', () => {
  const text = readFileSync('docs/CRASH_PROOF_ACCEPTANCE.md', 'utf8');
  assert.match(text, /UNPROVEN/);
  assert.match(text, /real browser test/);
  assert.match(text, /three force-stop\/cold-start cycles/);
  assert.match(text, /Debug signing is not production signing/);
});
