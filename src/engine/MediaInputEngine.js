/**
 * Container-aware media reader. Mediabunny demuxes presentation timestamps
 * and WebCodecs decodes sequentially, avoiding the dropped/duplicated frames
 * that can occur when repeatedly seeking an HTMLVideoElement.
 */
export class MediaInputEngine {
  constructor() {
    this.sessions = new Set();
  }

  async probe(file, { preciseDuration = false } = {}) {
    const input = await createInput(file);
    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) throw new Error('No video track was found in this file');
      const audioTrack = await input.getPrimaryAudioTrack();
      const audioDecodable = audioTrack ? await audioTrack.canDecode().catch(() => false) : false;
      const durationFromMetadata = await input.getDurationFromMetadata().catch(() => null);
      const duration = preciseDuration || !Number.isFinite(durationFromMetadata)
        ? await input.computeDuration()
        : durationFromMetadata;
      const frameRate = await videoTrack.computeFrameRateMetrics({ targetPacketCount: 180 }).catch(() => null);
      const colorSpace = await videoTrack.getColorSpace().catch(() => null);
      const [width, height, rotation, codec, hdr, audioCodec] = await Promise.all([
        videoTrack.getDisplayWidth(), videoTrack.getDisplayHeight(), videoTrack.getRotation(),
        videoTrack.getCodecParameterString(), videoTrack.hasHighDynamicRange().catch(() => false),
        audioTrack?.getCodecParameterString().catch(() => null),
      ]);
      return {
        width, height, rotation, duration,
        fps: normalizeFps(frameRate?.bestGuessFrameRate),
        variableFrameRate: frameRate ? !frameRate.frameRateIsConstant : null,
        minFps: frameRate?.minFrameRate ?? null,
        maxFps: frameRate?.maxFrameRate ?? null,
        codec: codec || 'unknown',
        hasAudio: Boolean(audioTrack),
        audioDecodable,
        audioCodec: audioCodec || null,
        hdr,
        colorSpace,
      };
    } finally {
      input.dispose();
    }
  }

  async open(file) {
    const input = await createInput(file);
    try {
      const videoTrack = await input.getPrimaryVideoTrack();
      if (!videoTrack) throw new Error('No video track was found in this file');
      if (!await videoTrack.canDecode()) throw new Error('The browser cannot decode this video codec through WebCodecs');
      const audioTrack = await input.getPrimaryAudioTrack();
      const audioDecodable = audioTrack ? await audioTrack.canDecode().catch(() => false) : false;
      const duration = await input.getDurationFromMetadata().catch(() => null) ?? await input.computeDuration();
      const frameRate = await videoTrack.computeFrameRateMetrics({ targetPacketCount: 180 }).catch(() => null);
      const metadata = {
        width: await videoTrack.getDisplayWidth(),
        height: await videoTrack.getDisplayHeight(),
        rotation: await videoTrack.getRotation(),
        duration,
        fps: normalizeFps(frameRate?.bestGuessFrameRate),
        variableFrameRate: frameRate ? !frameRate.frameRateIsConstant : null,
        codec: await videoTrack.getCodecParameterString() || 'unknown',
        hasAudio: Boolean(audioTrack),
        audioDecodable,
        audioCodec: audioTrack ? await audioTrack.getCodecParameterString().catch(() => null) : null,
        hdr: await videoTrack.hasHighDynamicRange().catch(() => false),
        colorSpace: await videoTrack.getColorSpace().catch(() => null),
      };
      const { CanvasSink, AudioSampleSink } = await loadMediabunny();
      const sink = new CanvasSink(videoTrack, {
        width: metadata.width,
        height: metadata.height,
        fit: 'fill',
        poolSize: 2,
      });
      const audioSink = audioDecodable ? new AudioSampleSink(audioTrack) : null;
      const session = new MediaInputSession(input, sink, audioSink, metadata, () => this.sessions.delete(session));
      this.sessions.add(session);
      return session;
    } catch (error) {
      input.dispose();
      throw error;
    }
  }

  destroy() {
    for (const session of this.sessions) session.close();
    this.sessions.clear();
  }
}

class MediaInputSession {
  constructor(input, sink, audioSink, metadata, onClose) {
    this.input = input;
    this.sink = sink;
    this.audioSink = audioSink;
    this.metadata = metadata;
    this.onClose = onClose;
    this.closed = false;
  }

  /** Streams decoded audio with decoder backpressure and constant memory. */
  async *audioSamples({ signal = null } = {}) {
    if (!this.audioSink) throw new Error('The source audio track cannot be decoded by this browser');
    for await (const sample of this.audioSink.samples()) {
      if (signal?.aborted) {
        sample.close();
        abortIfNeeded(signal);
      }
      yield sample;
    }
  }

  async *frames({ signal = null } = {}) {
    for await (const sample of this.sink.canvases()) {
      abortIfNeeded(signal);
      yield {
        source: sample.canvas,
        timestamp: Math.max(0, Math.round(sample.timestamp * 1_000_000)),
        duration: Math.max(1, Math.round(sample.duration * 1_000_000)),
      };
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.input.dispose();
    this.onClose?.();
  }
}

let mediabunnyPromise;
function loadMediabunny() {
  return mediabunnyPromise ||= import('mediabunny');
}

async function createInput(file) {
  if (!(file instanceof Blob)) throw new TypeError('Media input must be a Blob or File');
  const { Input, BlobSource, ALL_FORMATS } = await loadMediabunny();
  return new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
}

function normalizeFps(value) {
  if (!Number.isFinite(value) || value <= 0) return 30;
  return Math.max(1, Math.min(240, Math.round(value * 1000) / 1000));
}

function abortIfNeeded(signal) {
  if (signal?.aborted) throw signal.reason || new DOMException('Operation cancelled', 'AbortError');
}
