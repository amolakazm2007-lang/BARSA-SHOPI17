/** Browser-side MP4 integrity and playback validation. */
export async function validateMP4Export(blob, { width = null, height = null, duration = null, timeoutMs = 12_000 } = {}) {
  if (!(blob instanceof Blob) || blob.size < 24) throw new Error('Exported MP4 is empty or truncated');
  const header = new Uint8Array(await blob.slice(0, Math.min(blob.size, 2 * 1024 * 1024)).arrayBuffer());
  const structure = inspectMP4Structure(header);
  if (!structure.valid) throw new Error(`Exported MP4 failed container validation: ${structure.reason}`);
  if (typeof document === 'undefined') return { ...structure, playable: null };

  const video = document.createElement('video');
  // Playwright's open Chromium build, and some Android WebViews, omit the
  // proprietary AVC decoder even though the app can still mux and inspect a
  // standards-compliant H.264 MP4. Track validation runs immediately after
  // this check, so lack of a local decoder is LIMITED—not a corrupt export.
  if (!video.canPlayType('video/mp4; codecs="avc1.42E01E"')) {
    return { ...structure, playable: null, playbackReason: 'h264-decoder-unavailable' };
  }

  const url = URL.createObjectURL(blob);
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await waitForMetadata(video, timeoutMs);
    if (!video.videoWidth || !video.videoHeight || !Number.isFinite(video.duration)) throw new Error('Browser could not decode exported MP4 metadata');
    if (width && height && (video.videoWidth !== width || video.videoHeight !== height)) {
      throw new Error(`Export size mismatch: ${video.videoWidth}x${video.videoHeight}, expected ${width}x${height}`);
    }
    if (duration && Math.abs(video.duration - duration) > Math.max(0.75, duration * 0.04)) {
      throw new Error(`Export duration mismatch: ${video.duration.toFixed(2)}s, expected ${duration.toFixed(2)}s`);
    }
    return {
      ...structure,
      playable: true,
      width: video.videoWidth,
      height: video.videoHeight,
      duration: video.duration,
    };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

/** Parses top-level ISO BMFF boxes from a prefix without loading the whole file. */
export function inspectMP4Structure(bytes) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (data.length < 16) return { valid: false, reason: 'header_too_short', boxes: [] };
  const boxes = [];
  let offset = 0;
  while (offset + 8 <= data.length) {
    let size = readU32(data, offset);
    const type = String.fromCharCode(...data.subarray(offset + 4, offset + 8));
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > data.length) break;
      const high = readU32(data, offset + 8), low = readU32(data, offset + 12);
      const large = high * 2 ** 32 + low;
      if (!Number.isSafeInteger(large)) return { valid: false, reason: 'box_too_large', boxes };
      size = large; headerSize = 16;
    } else if (size === 0) {
      size = data.length - offset;
    }
    if (size < headerSize) return { valid: false, reason: 'invalid_box_size', boxes };
    boxes.push({ type, offset, size });
    if (size > data.length - offset) break;
    offset += size;
  }
  const ftyp = boxes.find((box) => box.type === 'ftyp');
  if (!ftyp || ftyp.offset !== 0) return { valid: false, reason: 'missing_ftyp', boxes };
  const moov = boxes.find((box) => box.type === 'moov');
  const mdat = boxes.find((box) => box.type === 'mdat');
  return {
    valid: true,
    reason: null,
    boxes,
    fastStart: Boolean(moov && (!mdat || moov.offset < mdat.offset)),
    moovFoundInPrefix: Boolean(moov),
  };
}

/** Verifies the actual muxed tracks instead of trusting encoder settings. */
export function validateMP4Tracks(metadata, { width, height, expectAudio = true } = {}) {
  if (!metadata || !Number.isFinite(metadata.width) || !Number.isFinite(metadata.height)) throw new Error('MP4 track metadata is unavailable');
  if (width && height && (metadata.width !== width || metadata.height !== height)) throw new Error(`MP4 video track is ${metadata.width}x${metadata.height}; expected ${width}x${height}`);
  if (!/^(avc1|avc3)/i.test(metadata.codec || '')) throw new Error(`MP4 video track is not H.264: ${metadata.codec || 'unknown'}`);
  if (expectAudio && !metadata.hasAudio) throw new Error('MP4 audio track is missing');
  if (!expectAudio && metadata.hasAudio) throw new Error('MP4 contains audio although audio was disabled');
  if (expectAudio && !/^mp4a/i.test(metadata.audioCodec || '')) throw new Error(`MP4 audio track is not AAC: ${metadata.audioCodec || 'unknown'}`);
  return {
    valid: true,
    videoCodec: metadata.codec,
    audioCodec: metadata.hasAudio ? metadata.audioCodec : null,
    hasAudio: metadata.hasAudio,
    width: metadata.width,
    height: metadata.height,
  };
}

/** Constant-memory CFR timestamp validator for long renders. */
export class FramePacingMonitor {
  constructor(targetFps, { toleranceRatio = 0.08 } = {}) {
    if (!(targetFps > 0)) throw new RangeError('Target FPS must be positive');
    this.targetFps = targetFps;
    this.expectedDelta = 1_000_000 / targetFps;
    this.tolerance = Math.max(2, this.expectedDelta * toleranceRatio);
    this.frames = 0;
    this.lastTimestamp = null;
    this.nonMonotonic = 0;
    this.irregular = 0;
    this.missing = 0;
    this.minDelta = Infinity;
    this.maxDelta = 0;
  }

  seedResume({ frames = 0, lastTimestamp = null } = {}) {
    this.frames = Math.max(0, Number(frames) || 0);
    this.lastTimestamp = Number.isFinite(Number(lastTimestamp)) ? Number(lastTimestamp) : null;
    this.resumed = this.frames > 0;
  }

  observe(timestamp) {
    if (!Number.isFinite(timestamp)) throw new Error('Encoded frame timestamp is not finite');
    if (this.lastTimestamp != null) {
      const delta = timestamp - this.lastTimestamp;
      if (delta <= 0) this.nonMonotonic++;
      else {
        this.minDelta = Math.min(this.minDelta, delta);
        this.maxDelta = Math.max(this.maxDelta, delta);
        if (Math.abs(delta - this.expectedDelta) > this.tolerance) this.irregular++;
        if (delta > this.expectedDelta * 1.5) this.missing += Math.max(1, Math.round(delta / this.expectedDelta) - 1);
      }
    }
    this.lastTimestamp = timestamp;
    this.frames++;
  }

  finalize({ allowIrregularRatio = 0.02 } = {}) {
    if (!this.frames) throw new Error('No video frames were encoded');
    const deltas = Math.max(0, this.frames - 1);
    const irregularRatio = deltas ? this.irregular / deltas : 0;
    if (this.nonMonotonic || this.missing || irregularRatio > allowIrregularRatio) {
      throw new Error(`Invalid frame pacing: ${this.nonMonotonic} non-monotonic, ${this.missing} missing, ${this.irregular} irregular timestamps`);
    }
    return {
      valid: true,
      resumed: Boolean(this.resumed),
      frames: this.frames,
      targetFps: this.targetFps,
      nonMonotonic: this.nonMonotonic,
      missing: this.missing,
      irregular: this.irregular,
      minDeltaUs: Number.isFinite(this.minDelta) ? this.minDelta : null,
      maxDeltaUs: this.maxDelta || null,
    };
  }
}

function waitForMetadata(video, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timeout);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onLoaded = (event) => finish(resolve, event);
    const onError = () => finish(reject, video.error || new Error('Exported MP4 is not playable'));
    const timeout = setTimeout(() => finish(reject, new Error('MP4 playback validation timed out')), timeoutMs);
    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
  });
}

function readU32(data, offset) {
  return ((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]) >>> 0;
}
