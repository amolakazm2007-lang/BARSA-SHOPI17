import { BarsaError, withHardTimeout } from './CrashProofRuntime.js';
import { PeriodicResumeVerifier } from './PeriodicResumeVerifier.js';

const DEFAULT_MAX_QUEUE = 4;
const SUPPORT_TIMEOUT_MS = 5000;
const FLUSH_TIMEOUT_MS = 15000;
const QUEUE_STALL_TIMEOUT_MS = 15000;

export class WebCodecsEngine extends EventTarget {
  constructor({ maxQueueSize = DEFAULT_MAX_QUEUE } = {}) {
    super();
    this.maxQueueSize = Math.max(1, Math.floor(maxQueueSize || DEFAULT_MAX_QUEUE));
    this.decoder = null;
    this.encoder = null;
    this.audioDecoder = null;
    this.audioEncoder = null;
    this.closed = false;
  }

  setMaxQueueSize(value = DEFAULT_MAX_QUEUE) {
    this.maxQueueSize = Math.max(1, Math.min(8, Math.floor(Number(value) || DEFAULT_MAX_QUEUE)));
    return this.maxQueueSize;
  }

  async createDecoder({ codecConfig, onFrame, onError = null }) {
    assertWebCodecs('VideoDecoder');
    let support;
    try {
      support = await withHardTimeout(() => VideoDecoder.isConfigSupported(codecConfig), { timeoutMs: SUPPORT_TIMEOUT_MS, label: 'VideoDecoder support probe' });
    } catch (error) {
      throw wrapCodecError('DECODER_PROBE_FAILED', 'Video decoder support probe failed', error);
    }
    if (!support.supported) throw new BarsaError('DECODER_UNSUPPORTED', `Decoder configuration is unsupported: ${codecConfig.codec}`, { recoverable: true });
    this.decoder?.close();
    this.decoder = new VideoDecoder({
      output: (frame) => {
        Promise.resolve(onFrame(frame)).catch((error) => {
          frame.close();
          const wrapped = wrapCodecError('DECODER_OUTPUT_FAILED', 'Decoded frame callback failed', error);
          console.error('[BARSA][WebCodecs][decoder-output-failed]', wrapped);
          onError?.(wrapped);
        });
      },
      error: (error) => {
        const wrapped = wrapCodecError('DECODER_FAILED', 'Video decoder failed', error);
        console.error('[BARSA][WebCodecs][decoder-failed]', wrapped);
        onError?.(wrapped);
      },
    });
    this.decoder.configure(support.config || codecConfig);
    return this.decoder;
  }

  async decodeChunks(chunks, { signal = null } = {}) {
    if (!this.decoder || this.decoder.state !== 'configured') throw new BarsaError('DECODER_NOT_CONFIGURED', 'Decoder is not configured', { recoverable: true });
    try {
      for await (const chunk of chunks) {
        abortIfNeeded(signal);
        await waitForQueueBelow(this.decoder, this.maxQueueSize, signal, {
          label: 'VideoDecoder queue drain',
          onTimeout: () => safeCloseCodec(this, 'decoder'),
        });
        this.decoder.decode(chunk);
      }
      await withHardTimeout(() => this.decoder.flush(), {
        timeoutMs: FLUSH_TIMEOUT_MS,
        label: 'VideoDecoder flush',
        signal,
        onTimeout: () => safeCloseCodec(this, 'decoder'),
      });
    } catch (error) {
      throw error instanceof BarsaError ? error : wrapCodecError('DECODER_FAILED', 'Video decoding failed', error);
    }
  }

  async createEncoder({ config, onChunk, onError = null }) {
    assertWebCodecs('VideoEncoder');
    const normalized = normalizeEncoderConfig(config);
    let support;
    try {
      support = await withHardTimeout(() => VideoEncoder.isConfigSupported(normalized), { timeoutMs: SUPPORT_TIMEOUT_MS, label: 'VideoEncoder support probe' });
    } catch (error) {
      throw wrapCodecError('ENCODER_PROBE_FAILED', 'Video encoder support probe failed', error);
    }
    if (!support.supported) throw new BarsaError('ENCODER_UNSUPPORTED', `Encoder configuration is unsupported: ${normalized.codec}`, { recoverable: true });
    this.encoder?.close();
    this.encoder = new VideoEncoder({
      output: (chunk, metadata) => onChunk(chunk, metadata),
      error: (error) => {
        const wrapped = wrapCodecError('ENCODER_FAILED', 'Video encoder failed', error);
        console.error('[BARSA][WebCodecs][encoder-failed]', wrapped);
        onError?.(wrapped);
      },
    });
    this.encoder.configure(support.config || normalized);
    return this.encoder;
  }

  async encode(frame, { keyFrame = false, signal = null, closeFrame = true } = {}) {
    if (!this.encoder || this.encoder.state !== 'configured') throw new BarsaError('ENCODER_NOT_CONFIGURED', 'Encoder is not configured', { recoverable: true });
    abortIfNeeded(signal);
    try {
      await waitForQueueBelow(this.encoder, this.maxQueueSize, signal, {
        label: 'VideoEncoder queue drain',
        onTimeout: () => safeCloseCodec(this, 'encoder'),
      });
      this.encoder.encode(frame, { keyFrame });
    } catch (error) {
      throw wrapCodecError('ENCODER_FAILED', 'Video encode operation failed', error);
    } finally {
      if (closeFrame) frame.close();
    }
  }

  async flushEncoder({ signal = null } = {}) {
    if (this.encoder?.state !== 'configured') return;
    try {
      await withHardTimeout(() => this.encoder.flush(), {
        timeoutMs: FLUSH_TIMEOUT_MS,
        label: 'VideoEncoder flush',
        signal,
        onTimeout: () => safeCloseCodec(this, 'encoder'),
      });
    } catch (error) {
      throw error instanceof BarsaError ? error : wrapCodecError('ENCODER_FLUSH_FAILED', 'Video encoder flush failed', error);
    }
  }

  async createAudioDecoder({ codecConfig, onData, onError = null }) {
    assertWebCodecs('AudioDecoder');
    const support = await withHardTimeout(() => AudioDecoder.isConfigSupported(codecConfig), { timeoutMs: SUPPORT_TIMEOUT_MS, label: 'AudioDecoder support probe' });
    if (!support.supported) throw new BarsaError('AUDIO_DECODER_UNSUPPORTED', `Audio decoder configuration is unsupported: ${codecConfig.codec}`, { recoverable: true });
    this.audioDecoder?.close();
    this.audioDecoder = new AudioDecoder({
      output: (data) => {
        Promise.resolve(onData(data)).catch((error) => {
          data.close();
          const wrapped = wrapCodecError('AUDIO_DECODER_OUTPUT_FAILED', 'Decoded audio callback failed', error);
          console.error('[BARSA][WebCodecs][audio-decoder-output-failed]', wrapped);
          onError?.(wrapped);
        });
      },
      error: (error) => {
        const wrapped = wrapCodecError('AUDIO_DECODER_FAILED', 'Audio decoder failed', error);
        console.error('[BARSA][WebCodecs][audio-decoder-failed]', wrapped);
        onError?.(wrapped);
      },
    });
    this.audioDecoder.configure(support.config || codecConfig);
    return this.audioDecoder;
  }

  async createAudioEncoder({ config, onChunk, onError = null }) {
    assertWebCodecs('AudioEncoder');
    const support = await withHardTimeout(() => AudioEncoder.isConfigSupported(config), { timeoutMs: SUPPORT_TIMEOUT_MS, label: 'AudioEncoder support probe' });
    if (!support.supported) throw new BarsaError('AUDIO_ENCODER_UNSUPPORTED', `Audio encoder configuration is unsupported: ${config.codec}`, { recoverable: true });
    this.audioEncoder?.close();
    this.audioEncoder = new AudioEncoder({
      output: (chunk, metadata) => onChunk(chunk, metadata),
      error: (error) => {
        const wrapped = wrapCodecError('AUDIO_ENCODER_FAILED', 'Audio encoder failed', error);
        console.error('[BARSA][WebCodecs][audio-encoder-failed]', wrapped);
        onError?.(wrapped);
      },
    });
    this.audioEncoder.configure(support.config || config);
    return this.audioEncoder;
  }

  close() {
    for (const codec of [this.decoder, this.encoder, this.audioDecoder, this.audioEncoder]) {
      try { if (codec && codec.state !== 'closed') codec.close(); }
      catch (error) { console.warn('[BARSA][WebCodecs][close-failed]', error); }
    }
    this.decoder = null;
    this.encoder = null;
    this.audioDecoder = null;
    this.audioEncoder = null;
    this.closed = true;
  }
}

export class ElementaryVideoWriter {
  constructor({ storage, sessionId, codec, width, height, fps, expectedFrames = 0, checkpointEvery = 30, logger = console }) {
    this.storage = storage;
    this.sessionId = sessionId;
    this.codec = codec;
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.expectedFrames = expectedFrames;
    this.checkpointEvery = checkpointEvery;
    this.frameIndex = 0;
    this.timestampOrigin = null;
    this.lastProgressCommitAt = 0;
    this.progressCommitIntervalMs = 750;
    this.progressUpdateChain = Promise.resolve();
    this.pendingProgress = null;
    this.resumeMetadata = new Map();
    this.logger = logger;
    this.resumeVerifier = new PeriodicResumeVerifier({ storage, sessionId, logger });
    this.format = codec.startsWith('vp09') ? 'ivf-vp9' : codec.startsWith('av01') ? 'ivf-av1' : 'annexb-h264';
  }

  async initialize(metadata = {}, { resume = false } = {}) {
    if (resume) {
      if (this.format !== 'annexb-h264') throw new Error('Durable resume is currently supported only for H.264 intermediate streams');
      const checkpoint = await this.storage.resumeSession(this.sessionId);
      this.frameIndex = Number(checkpoint.framesWritten || 0);
      this.timestampOrigin = Number.isFinite(checkpoint.timestampOrigin) ? checkpoint.timestampOrigin : null;
      return checkpoint;
    }
    await this.storage.beginSession(this.sessionId, {
      ...metadata,
      codec: this.codec,
      elementaryFormat: this.format,
      width: this.width,
      height: this.height,
      fps: this.fps,
    });
    if (this.format.startsWith('ivf')) {
      const fourCC = this.format === 'ivf-vp9' ? 'VP90' : 'AV01';
      await this.storage.appendFrame(this.sessionId, createIVFHeader(this.width, this.height, this.fps, this.expectedFrames, fourCC), 0, Number.MAX_SAFE_INTEGER);
    }
  }

  async write(chunk) {
    const payload = new Uint8Array(chunk.byteLength);
    chunk.copyTo(payload);
    let bytes = payload;
    if (this.format.startsWith('ivf')) {
      this.timestampOrigin ??= chunk.timestamp;
      const relativeTimestamp = Math.max(0, chunk.timestamp - this.timestampOrigin);
      const header = createIVFFrameHeader(payload.byteLength, Math.round(relativeTimestamp * this.fps / 1_000_000));
      bytes = concat(header, payload);
    }
    const nextFrameNumber = this.frameIndex + 1;
    const checkpointPatch = this.resumeMetadata.get(nextFrameNumber) || null;
    const durability = await this.storage.appendFrame(this.sessionId, bytes, this.frameIndex, this.checkpointEvery, checkpointPatch);
    this.frameIndex = nextFrameNumber;
    if (durability?.durable) {
      for (const key of this.resumeMetadata.keys()) if (key <= this.frameIndex) this.resumeMetadata.delete(key);
      await this.resumeVerifier.verify(this.frameIndex);
    }
    this.dispatchProgress(chunk);
  }

  stageResumeMetadata(frameNumber, metadata) {
    const index = Math.max(1, Number(frameNumber) || 1);
    this.resumeMetadata.set(index, { ...(metadata || {}), encodedFrames: index });
    const floor = Math.max(0, index - Math.max(4, this.checkpointEvery * 2));
    for (const key of this.resumeMetadata.keys()) if (key < floor) this.resumeMetadata.delete(key);
  }

  dispatchProgress(chunk, { force = false } = {}) {
    const progress = this.expectedFrames ? Math.min(1, this.frameIndex / this.expectedFrames) : null;
    this.pendingProgress = { liveEncodedFrames: this.frameIndex, progress, stage: 'encoding', lastTimestamp: chunk.timestamp };
    const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    if (!force && (!this.expectedFrames || this.frameIndex < this.expectedFrames) && now - this.lastProgressCommitAt < this.progressCommitIntervalMs) return;
    this.lastProgressCommitAt = now;
    const patch = this.pendingProgress;
    this.pendingProgress = null;
    this._queueProgressUpdate(patch);
  }

  _queueProgressUpdate(patch) {
    this.progressUpdateChain = this.progressUpdateChain
      .catch((error) => { this.logger.warn?.('[BARSA][writer][previous-progress-update-failed]', error); })
      .then(() => this.storage.updateSession(this.sessionId, patch))
      .catch((error) => { this.logger.warn?.('[BARSA][writer][progress-update-failed]', error); });
  }

  async _flushProgress() {
    if (this.pendingProgress) {
      const patch = this.pendingProgress;
      this.pendingProgress = null;
      this._queueProgressUpdate(patch);
    }
    try { await this.progressUpdateChain; }
    catch (error) { this.logger.warn?.('[BARSA][writer][progress-flush-failed]', error); }
  }

  async finalize({ remuxPending = true, patch = null } = {}) {
    await this._flushProgress();
    return this.storage.finalizeSession(this.sessionId, remuxPending
      ? { status: 'remux_pending', stage: 'remuxing', progress: 0.87, patch }
      : { status: 'completed', stage: 'completed', progress: 1, patch });
  }

  async abort(reason) {
    this.pendingProgress = null;
    try { await this.progressUpdateChain; }
    catch (error) { this.logger.warn?.('[BARSA][writer][abort-progress-drain-failed]', error); }
    return this.storage.abortSession(this.sessionId, reason?.message || String(reason || 'cancelled'));
  }
}

export async function getSupportedCodecs(width = 1920, height = 1080, framerate = 30) {
  const candidates = [
    { name: 'H.264', codec: 'avc1.640028' },
    { name: 'H.265', codec: 'hev1.1.6.L153.B0' },
    { name: 'VP9', codec: 'vp09.00.50.08' },
    { name: 'AV1', codec: 'av01.0.08M.08' },
  ];
  return Promise.all(candidates.map(async (candidate) => {
    try {
      const [decode, encode] = await Promise.all([
        withHardTimeout(() => VideoDecoder.isConfigSupported({ codec: candidate.codec, codedWidth: width, codedHeight: height }), { timeoutMs: SUPPORT_TIMEOUT_MS, label: `${candidate.name} decode probe` }),
        withHardTimeout(() => VideoEncoder.isConfigSupported({ codec: candidate.codec, width, height, bitrate: Math.max(1_000_000, width * height * framerate * 0.08), framerate, hardwareAcceleration: 'prefer-hardware' }), { timeoutMs: SUPPORT_TIMEOUT_MS, label: `${candidate.name} encode probe` }),
      ]);
      return { ...candidate, decode: !!decode.supported, encode: !!encode.supported };
    } catch (error) {
      console.warn('[BARSA][WebCodecs][codec-probe-failed]', candidate, error);
      return { ...candidate, decode: false, encode: false };
    }
  }));
}

export async function chooseEncoderConfig({ width, height, framerate, bitrate, preferred = ['avc', 'vp9', 'av1'], acceleration = 'auto' }) {
  const codecs = {
    avc: getH264CodecCandidates(width, height, framerate).map((codec) => ({ codec, avc: { format: 'annexb' } })),
    vp9: [{ codec: width * height <= 1280 * 720 ? 'vp09.00.10.08' : 'vp09.00.40.08' }, { codec: 'vp09.00.50.08' }],
    av1: [{ codec: width * height <= 1280 * 720 ? 'av01.0.04M.08' : 'av01.0.08M.08' }],
  };
  const accelerationOrder = acceleration === 'hardware' ? ['prefer-hardware', 'no-preference'] : acceleration === 'software' ? ['prefer-software', 'no-preference'] : ['prefer-hardware', 'no-preference', 'prefer-software'];
  for (const name of preferred) {
    for (const profile of codecs[name] || []) for (const hardwareAcceleration of accelerationOrder) for (const rateControl of [{ bitrateMode: 'variable' }, {}]) {
      const candidate = normalizeEncoderConfig({ ...profile, ...rateControl, width, height, framerate, bitrate, hardwareAcceleration, latencyMode: 'quality', alpha: 'discard' });
      try {
        const support = await withHardTimeout(() => VideoEncoder.isConfigSupported(candidate), { timeoutMs: SUPPORT_TIMEOUT_MS, label: `VideoEncoder probe ${candidate.codec}` });
        if (support.supported) return support.config || candidate;
      } catch (error) {
        console.warn('[BARSA][WebCodecs][encoder-candidate-failed]', { codec: candidate.codec, hardwareAcceleration, error });
      }
    }
  }
  throw new BarsaError('ENCODER_UNSUPPORTED', 'No requested WebCodecs video encoder is supported on this device', { recoverable: true });
}

export function getH264CodecCandidates(width, height, framerate = 30) {
  const pixels = width * height;
  if (pixels > 4096 * 2304) return framerate > 30 ? ['avc1.64003d', 'avc1.64003e', 'avc1.64003c'] : ['avc1.64003c', 'avc1.64003d', 'avc1.64003e'];
  if (pixels > 1920 * 1080) return framerate > 30 ? ['avc1.640034', 'avc1.640033', 'avc1.4d0034'] : ['avc1.640033', 'avc1.4d0033', 'avc1.640034'];
  if (pixels > 1280 * 720 || framerate > 30) return ['avc1.64002a', 'avc1.4d002a', 'avc1.640028'];
  return ['avc1.42001f', 'avc1.4d001f', 'avc1.64001f'];
}

export function getH264ProbeConfigurations() {
  return [
    { id: '1080p60', label: '1080p · 60 FPS', config: probeConfig(1920, 1080, 60, 12_000_000) },
    { id: '4k30', label: '4K · 30 FPS', config: probeConfig(3840, 2160, 30, 35_000_000) },
    { id: '4k60', label: '4K · 60 FPS', config: probeConfig(3840, 2160, 60, 55_000_000) },
  ];
}

function probeConfig(width, height, framerate, bitrate) {
  return { codec: getH264CodecCandidates(width, height, framerate)[0], width, height, framerate, bitrate, bitrateMode: 'variable', hardwareAcceleration: 'prefer-hardware', latencyMode: 'quality', alpha: 'discard', avc: { format: 'annexb' } };
}

function normalizeEncoderConfig(config) {
  const width = Math.max(2, Math.floor(config.width / 2) * 2);
  const height = Math.max(2, Math.floor(config.height / 2) * 2);
  return { ...config, width, height, framerate: Math.max(1, config.framerate || 30) };
}

function assertWebCodecs(name) { if (!(name in globalThis)) throw new BarsaError('WEBCODECS_UNAVAILABLE', `${name} is unavailable in this browser`, { recoverable: true, details: { name } }); }
function abortIfNeeded(signal) { if (signal?.aborted) throw signal.reason || new DOMException('Operation cancelled', 'AbortError'); }
function safeCloseCodec(owner, key) { try { owner[key]?.close?.(); } catch (error) { console.warn(`[BARSA][WebCodecs][${key}-timeout-close-failed]`, error); } finally { owner[key] = null; } }
function wrapCodecError(code, prefix, error) { return error instanceof BarsaError ? error : new BarsaError(code, `${prefix}: ${error?.message || error}`, { recoverable: true, cause: error }); }

async function waitForQueueBelow(codec, maxQueueSize, signal, { label = 'WebCodecs queue drain', onTimeout = null } = {}) {
  return withHardTimeout(async () => {
    while (codecQueueSize(codec) >= maxQueueSize) {
      abortIfNeeded(signal);
      if (!codec || codec.state !== 'configured') {
        throw new BarsaError('WEBCODECS_QUEUE_UNAVAILABLE', `${label} stopped because codec is not configured`, { recoverable: true });
      }
      await waitForQueue(codec, signal);
    }
  }, {
    timeoutMs: QUEUE_STALL_TIMEOUT_MS,
    label,
    signal,
    onTimeout,
  });
}

function codecQueueSize(codec) {
  const value = codec?.encodeQueueSize ?? codec?.decodeQueueSize ?? 0;
  return Math.max(0, Number(value) || 0);
}

async function waitForQueue(codec, signal) {
  abortIfNeeded(signal);
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); codec?.removeEventListener?.('dequeue', onDequeue); signal?.removeEventListener?.('abort', onAbort); fn(value); };
    const onDequeue = () => finish(resolve);
    const onAbort = () => finish(reject, signal.reason || new DOMException('Operation cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(resolve), 16);
    codec?.addEventListener?.('dequeue', onDequeue, { once: true });
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

function createIVFHeader(width, height, fps, frameCount, fourCC) {
  const bytes = new Uint8Array(32); const view = new DataView(bytes.buffer); bytes.set([68, 75, 73, 70], 0); view.setUint16(4, 0, true); view.setUint16(6, 32, true); bytes.set([...fourCC].map((char) => char.charCodeAt(0)), 8); view.setUint16(12, width, true); view.setUint16(14, height, true); view.setUint32(16, Math.round(fps * 1000), true); view.setUint32(20, 1000, true); view.setUint32(24, frameCount >>> 0, true); view.setUint32(28, 0, true); return bytes;
}
function createIVFFrameHeader(length, timestamp) { const bytes = new Uint8Array(12); const view = new DataView(bytes.buffer); view.setUint32(0, length, true); view.setUint32(4, timestamp >>> 0, true); view.setUint32(8, Math.floor(timestamp / 0x100000000), true); return bytes; }
function concat(a, b) { const output = new Uint8Array(a.length + b.length); output.set(a, 0); output.set(b, a.length); return output; }
