import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectMP4Structure, validateMP4Tracks } from '../src/engine/ExportValidator.js';

function box(type, payload = new Uint8Array()) {
  const bytes = new Uint8Array(8 + payload.length);
  new DataView(bytes.buffer).setUint32(0, bytes.length);
  for (let index = 0; index < 4; index++) bytes[4 + index] = type.charCodeAt(index);
  bytes.set(payload, 8);
  return bytes;
}

function join(...parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

test('MP4 validator recognizes Fast Start order', () => {
  const report = inspectMP4Structure(join(box('ftyp', new Uint8Array(8)), box('moov'), box('mdat')));
  assert.equal(report.valid, true);
  assert.equal(report.fastStart, true);
  assert.deepEqual(report.boxes.map((item) => item.type), ['ftyp', 'moov', 'mdat']);
});

test('MP4 validator rejects missing ftyp and reports non-fast-start order', () => {
  assert.equal(inspectMP4Structure(join(box('moov'), box('mdat'))).valid, false);
  const report = inspectMP4Structure(join(box('ftyp', new Uint8Array(8)), box('mdat'), box('moov')));
  assert.equal(report.valid, true);
  assert.equal(report.fastStart, false);
});

test('MP4 track validator enforces H.264 and AAC presence', () => {
  const result = validateMP4Tracks({ width: 1920, height: 1080, codec: 'avc1.64002a', hasAudio: true, audioCodec: 'mp4a.40.2' }, { width: 1920, height: 1080, expectAudio: true });
  assert.equal(result.valid, true);
  assert.throws(() => validateMP4Tracks({ width: 1920, height: 1080, codec: 'vp09', hasAudio: true, audioCodec: 'opus' }, { width: 1920, height: 1080, expectAudio: true }), /not H.264/);
  assert.throws(() => validateMP4Tracks({ width: 1920, height: 1080, codec: 'avc1.64002a', hasAudio: false }, { width: 1920, height: 1080, expectAudio: true }), /missing/);
});
