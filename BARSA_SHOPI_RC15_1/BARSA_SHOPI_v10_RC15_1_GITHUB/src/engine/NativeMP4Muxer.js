/**
 * Small WebCodecs-to-MP4 bridge for H.264 and optional AAC exports. This avoids
 * booting the FFmpeg core when the browser exposes the required encoders.
 * It is intentionally memory-gated by VideoPipeline; large jobs continue to
 * use the OPFS elementary stream and FFmpeg's disk-backed compatibility path.
 */
export class NativeMP4Muxer {
  constructor({ width, height, fps, codec, expectedFrames = 0, storage = null, sessionId = null, audio = null }) {
    if (!codec?.startsWith('avc1') || width < 2 || height < 2 || fps <= 0) throw new Error('Native MP4 mux requires a valid H.264 video configuration');
    this.config = { width, height, fps, codec, expectedFrames };
    this.audioConfig = audio;
    this.storage = storage;
    this.sessionId = sessionId;
    this.target = null;
    this.output = null;
    this.source = null;
    this.audioSource = null;
    this.opfsOutput = null;
    this.streaming = false;
    this.started = false;
    this.mediabunny = null;
    this.finalized = false;
    this.cancelled = false;
  }

  async initialize() {
    if (this.cancelled) throw new Error('Native MP4 muxer was cancelled');
    if (this.started) return;
    try {
      this.mediabunny ||= await import('mediabunny');
      const { AudioSampleSource, BufferTarget, EncodedVideoPacketSource, Mp4OutputFormat, Output, Quality, StreamTarget } = this.mediabunny;
      if (this.storage && this.sessionId) {
        this.opfsOutput = await this.storage.createRandomAccessOutput(this.sessionId, 'mp4');
        this.target = new StreamTarget(this.opfsOutput.writable, { chunked: true, chunkSize: 4 * 1024 * 1024 });
        this.streaming = true;
      } else {
        this.target = new BufferTarget();
      }
      this.output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: this.target });
      this.source = new EncodedVideoPacketSource('avc');
      this.output.addVideoTrack(this.source, {
        frameRate: this.config.fps,
        maximumPacketCount: this.config.expectedFrames || undefined,
      });
      if (this.audioConfig) {
        const sampleRate = this.audioConfig.sampleRate || 48000;
        const numberOfChannels = this.audioConfig.numberOfChannels || 2;
        this.audioSource = new AudioSampleSource({
          codec: 'aac',
          fullCodecString: 'mp4a.40.2',
          quality: new Quality({ bitrate: this.audioConfig.bitrate || 192000 }),
          transform: {
            sampleRate,
            numberOfChannels,
            sampleFormat: 'f32',
            process: this.audioConfig.process || undefined,
          },
        });
        this.output.addAudioTrack(this.audioSource, {
          maximumPacketCount: this.audioConfig.maximumPacketCount || undefined,
        });
      }
      await this.output.start();
      this.started = true;
    } catch (error) {
      this.started = false;
      try {
        if (this.output && (this.output.state === 'started' || this.output.state === 'pending')) await this.output.cancel();
      } catch {}
      await this.releaseOutputFile().catch(() => {});
      throw error;
    }
  }

  async addChunk(chunk, metadata) {
    if (!this.started) throw new Error('Native MP4 muxer has not started');
    await this.addPacket(this.mediabunny.EncodedPacket.fromEncodedChunk(chunk), metadata);
  }

  async addPacket(packet, metadata) {
    if (!this.started || this.finalized || this.cancelled) throw new Error('Native MP4 muxer is not writable');
    await this.source.add(packet, metadata);
  }

  async addAudioSample(sample) {
    if (!this.started || this.finalized || this.cancelled || !this.audioSource) throw new Error('Native AAC track is not writable');
    await this.audioSource.add(sample);
  }

  async finalize() {
    if (this.cancelled) throw new Error('Native MP4 muxer was cancelled');
    if (this.finalized) throw new Error('Native MP4 muxer was already finalized');
    try {
      await this.output.finalize();
      this.finalized = true;
      this.started = false;
      if (this.opfsOutput) {
        const file = await this.opfsOutput.getFile();
        if (!file.size) throw new Error('Native MP4 muxer produced an empty OPFS file');
        return file.slice(0, file.size, 'video/mp4');
      }
      if (!this.target.buffer) throw new Error('Native MP4 muxer produced no output');
      return new Blob([this.target.buffer], { type: 'video/mp4' });
    } catch (error) {
      this.started = false;
      try {
        if (this.output && (this.output.state === 'started' || this.output.state === 'pending')) await this.output.cancel();
      } catch {}
      await this.releaseOutputFile().catch(() => {});
      throw error;
    }
  }

  async releaseOutputFile() {
    await this.opfsOutput?.remove();
    this.opfsOutput = null;
  }

  async cancel() {
    if (this.cancelled) return;
    this.cancelled = true;
    this.started = false;
    if (this.output && (this.output.state === 'started' || this.output.state === 'pending')) await this.output.cancel().catch(() => {});
    await this.releaseOutputFile();
  }
}

/** Returns true only when the browser confirms AAC-LC WebCodecs encoding. */
export async function supportsNativeAAC({ sampleRate = 48000, numberOfChannels = 2, bitrate = 192000 } = {}) {
  if (!('AudioEncoder' in globalThis) || typeof AudioEncoder.isConfigSupported !== 'function') return false;
  try {
    const support = await AudioEncoder.isConfigSupported({
      codec: 'mp4a.40.2',
      sampleRate,
      numberOfChannels,
      bitrate,
    });
    return Boolean(support.supported);
  } catch {
    return false;
  }
}
