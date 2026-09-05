import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExtendedModelDownload } from '../src/engine/AutoModelPolicy.js';

const MB = 1024 * 1024;

test('extended model download is allowed with enough storage', () => {
  const result = evaluateExtendedModelDownload({
    expectedSizeBytes: 340 * MB,
    storage: { quotaBytes: 2_000 * MB, usageBytes: 500 * MB },
    connection: { effectiveType: '4g', saveData: false },
  });
  assert.equal(result.allowed, true);
});

test('extended model download defers on data saver', () => {
  const result = evaluateExtendedModelDownload({ expectedSizeBytes: 340 * MB, connection: { saveData: true } });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'data-saver');
});

test('extended model download defers when free storage is unsafe', () => {
  const result = evaluateExtendedModelDownload({
    expectedSizeBytes: 340 * MB,
    storage: { quotaBytes: 600 * MB, usageBytes: 200 * MB },
  });
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'low-storage');
});

test('manual full download can override smart deferral', () => {
  const result = evaluateExtendedModelDownload({ expectedSizeBytes: 340 * MB, connection: { saveData: true }, force: true });
  assert.equal(result.allowed, true);
});
