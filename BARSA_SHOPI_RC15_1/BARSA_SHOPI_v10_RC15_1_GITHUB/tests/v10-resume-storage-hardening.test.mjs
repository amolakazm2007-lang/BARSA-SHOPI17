import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const storage = await fs.readFile(new URL('../src/engine/StorageManager.js', import.meta.url), 'utf8');

test('v10 resume truncates uncheckpointed tail before append', () => {
  assert.match(storage, /createWritable\(\{ keepExistingData: true \}\)/);
  assert.match(storage, /await writable\.truncate\(Number\(checkpoint\.bytesWritten\)\)/);
  assert.match(storage, /await writable\.seek\(Number\(checkpoint\.bytesWritten\)\)/);
});

test('v10 resumable search skips corrupt newest sessions', () => {
  assert.match(storage, /for \(const candidate of interrupted\)/);
  assert.match(storage, /const bytesWritten = Number\(candidate\.bytesWritten\)/);
  assert.match(storage, /file\.size < bytesWritten\) continue/);
  assert.match(storage, /source\.size !== candidate\.sourceSize\) continue/);
});

test('v10 source streaming releases reader lock on success and failure', () => {
  assert.match(storage, /reader\.cancel\(error\)/);
  assert.match(storage, /reader\.releaseLock/);
});

test('v10 refuses duplicate active writer for same session', () => {
  assert.match(storage, /activeWriters\.has\(sessionId\)/);
});

test('v10 quota failures are translated into actionable storage errors', () => {
  assert.match(storage, /_storageWriteError/);
  assert.match(storage, /INSUFFICIENT_STORAGE/);
  assert.match(storage, /QuotaExceededError/);
  assert.match(storage, /Local storage became full during/);
});

test('v10 resume rejects non-active or malformed checkpoints', () => {
  assert.match(storage, /checkpoint\.status !== 'in_progress'/);
  assert.match(storage, /invalid byte offset/);
  assert.match(storage, /invalid frame count/);
  assert.match(storage, /Resume stream is smaller than its durable checkpoint/);
});
