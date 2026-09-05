import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDeviceProfile, evaluateAcceptance } from '../src/engine/HardwareProbe.js';
import { getH264CodecCandidates, getH264ProbeConfigurations } from '../src/engine/WebCodecsEngine.js';

test('POCO F6 model code activates the tuned mobile profile', () => {
  const profile = classifyDeviceProfile({
    userAgent: 'Mozilla/5.0 (Linux; Android 14; 24069PC21G)',
    deviceMemoryGB: 8,
    hardwareConcurrency: 8,
  });
  assert.equal(profile.id, 'poco-f6');
  assert.equal(profile.recommendedMode, 'poco-f6');
  assert.equal(profile.tileSize, 384);
  assert.equal(profile.batchSize, 2);
});

test('strong unknown Android remains adaptive instead of being mislabeled POCO F6', () => {
  const profile = classifyDeviceProfile({
    userAgent: 'Mozilla/5.0 (Linux; Android 15; GenericPhone)',
    deviceMemoryGB: 12,
    hardwareConcurrency: 8,
  });
  assert.equal(profile.id, 'high-end-android');
  assert.equal(profile.detected, false);
});

test('H.264 candidates use levels suitable for 1080p60 and 4K60', () => {
  assert.equal(getH264CodecCandidates(1920, 1080, 60)[0], 'avc1.64002a');
  assert.equal(getH264CodecCandidates(3840, 2160, 30)[0], 'avc1.640033');
  assert.equal(getH264CodecCandidates(3840, 2160, 60)[0], 'avc1.640034');
  assert.equal(getH264CodecCandidates(7680, 4320, 30)[0], 'avc1.64003c');
  assert.deepEqual(getH264ProbeConfigurations().map((item) => item.id), ['1080p60', '4k30', '4k60']);
});

test('device acceptance requires H.264 and OPFS core paths', () => {
  const excellent = evaluateAcceptance({ webgpu: { ok: true }, h264: { ok: true }, aac: { ok: true }, opfs: { ok: true }, h2644k60: { ok: true } });
  assert.deepEqual({ score: excellent.score, ready: excellent.ready, grade: excellent.grade }, { score: 100, ready: true, grade: 'excellent' });
  const missingStorage = evaluateAcceptance({ webgpu: { ok: true }, h264: { ok: true }, aac: { ok: true }, opfs: { ok: false }, h2644k60: { ok: true } });
  assert.equal(missingStorage.ready, false);
  assert.equal(missingStorage.score, 80);
});
