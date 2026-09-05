import { chooseEncoderConfig, getH264ProbeConfigurations } from './WebCodecsEngine.js';

const POCO_F6_IDENTIFIERS = ['poco f6', '24069pc21g', '24069pc21i'];

/**
 * Detects device-specific performance profiles without treating user-agent
 * data as a security boundary. Detection is only used for safe tuning; users
 * can always select another mode manually.
 */
export class HardwareProbe extends EventTarget {
  constructor() {
    super();
    this.profile = null;
    this.h264Matrix = [];
  }

  async detectProfile() {
    let model = '';
    let platformVersion = '';
    try {
      const values = await navigator.userAgentData?.getHighEntropyValues?.(['model', 'platformVersion']);
      model = values?.model || '';
      platformVersion = values?.platformVersion || '';
    } catch {
      // High-entropy UA data may be intentionally unavailable.
    }
    this.profile = classifyDeviceProfile({
      model,
      userAgent: navigator.userAgent || '',
      platformVersion,
      deviceMemoryGB: navigator.deviceMemory || null,
      hardwareConcurrency: navigator.hardwareConcurrency || 1,
    });
    return this.profile;
  }

  async probeH264() {
    if (!('VideoEncoder' in globalThis)) {
      this.h264Matrix = getH264ProbeConfigurations().map((item) => ({ ...item, supported: false }));
      return this.h264Matrix;
    }
    this.h264Matrix = await Promise.all(getH264ProbeConfigurations().map(async (item) => {
      try {
        const support = await VideoEncoder.isConfigSupported(item.config);
        return {
          id: item.id,
          label: item.label,
          width: item.config.width,
          height: item.config.height,
          framerate: item.config.framerate,
          codec: item.config.codec,
          supported: Boolean(support.supported),
          hardwareRequested: item.config.hardwareAcceleration === 'prefer-hardware',
        };
      } catch (error) {
        return { ...item, config: undefined, supported: false, error: error?.message || String(error) };
      }
    }));
    return this.h264Matrix;
  }

  /**
   * Performs a real, short H.264 encode. WebCodecs exposes hardware use only
   * as a preference, so the result proves that the encoder works and reports
   * its throughput; it deliberately does not claim silicon acceleration.
   */
  async runH264SmokeTest({ width = 1280, height = 720, framerate = 30, frameCount = 12 } = {}) {
    if (!('VideoEncoder' in globalThis) || !('VideoFrame' in globalThis)) {
      throw new Error('WebCodecs VideoEncoder is unavailable');
    }
    const config = await chooseEncoderConfig({
      width,
      height,
      framerate,
      bitrate: Math.max(2_000_000, width * height * framerate * 0.09),
      preferred: ['avc'],
    });
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
    const context = canvas.getContext('2d', { alpha: false });
    let chunks = 0;
    let bytes = 0;
    let failure = null;
    const encoder = new VideoEncoder({
      output: (chunk) => { chunks++; bytes += chunk.byteLength; },
      error: (error) => { failure = error; },
    });
    encoder.configure(config);
    const startedAt = performance.now();
    try {
      for (let index = 0; index < frameCount; index++) {
        const shade = Math.round(index / Math.max(1, frameCount - 1) * 255);
        context.fillStyle = `rgb(${shade},${255 - shade},96)`;
        context.fillRect(0, 0, width, height);
        const frame = new VideoFrame(canvas, {
          timestamp: Math.round(index * 1_000_000 / framerate),
          duration: Math.round(1_000_000 / framerate),
        });
        encoder.encode(frame, { keyFrame: index === 0 });
        frame.close();
      }
      await encoder.flush();
      if (failure) throw failure;
    } finally {
      if (encoder.state !== 'closed') encoder.close();
    }
    const elapsedMs = performance.now() - startedAt;
    const encodeFps = frameCount / Math.max(0.001, elapsedMs / 1000);
    const result = {
      supported: chunks > 0,
      codec: config.codec,
      requestedAcceleration: config.hardwareAcceleration || 'no-preference',
      width,
      height,
      framerate,
      frameCount,
      chunks,
      bytes,
      elapsedMs,
      encodeFps,
    };
    this.dispatchEvent(new CustomEvent('smoketest', { detail: result }));
    return result;
  }

  /** Encodes a real sine-wave buffer as AAC-LC through WebCodecs. */
  async runAACSmokeTest({ sampleRate = 48000, numberOfChannels = 2, bitrate = 192000 } = {}) {
    if (!('AudioEncoder' in globalThis) || !('AudioData' in globalThis)) throw new Error('WebCodecs AudioEncoder is unavailable');
    const config = { codec: 'mp4a.40.2', sampleRate, numberOfChannels, bitrate };
    const support = await AudioEncoder.isConfigSupported(config);
    if (!support.supported) throw new Error('AAC-LC encoding is unsupported');
    let chunks = 0;
    let bytes = 0;
    let failure = null;
    const encoder = new AudioEncoder({
      output: (chunk) => { chunks++; bytes += chunk.byteLength; },
      error: (error) => { failure = error; },
    });
    encoder.configure(config);
    const frameCount = 4800;
    const pcm = new Float32Array(frameCount * numberOfChannels);
    for (let frame = 0; frame < frameCount; frame++) {
      const value = Math.sin(2 * Math.PI * 440 * frame / sampleRate) * 0.15;
      for (let channel = 0; channel < numberOfChannels; channel++) pcm[frame * numberOfChannels + channel] = value;
    }
    const sample = new AudioData({ format: 'f32', sampleRate, numberOfFrames: frameCount, numberOfChannels, timestamp: 0, data: pcm });
    const startedAt = performance.now();
    try {
      encoder.encode(sample);
      sample.close();
      await encoder.flush();
      if (failure) throw failure;
    } finally {
      if (encoder.state !== 'closed') encoder.close();
    }
    return { supported: chunks > 0, codec: config.codec, sampleRate, numberOfChannels, bitrate, chunks, bytes, elapsedMs: performance.now() - startedAt };
  }

  /** Runs and verifies a tiny compute pass, destroying every GPU allocation. */
  async runWebGPUSmokeTest() {
    if (!navigator.gpu) throw new Error('WebGPU is unavailable');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No WebGPU adapter was returned');
    const device = await adapter.requestDevice();
    const values = new Float32Array([1, 2, 3, 4]);
    const storage = device.createBuffer({ size: values.byteLength, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: values.byteLength, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    try {
      device.queue.writeBuffer(storage, 0, values);
      const module = device.createShaderModule({ code: '@group(0) @binding(0) var<storage, read_write> values: array<f32>; @compute @workgroup_size(4) fn main(@builtin(global_invocation_id) id: vec3<u32>) { values[id.x] = values[id.x] + 1.0; }' });
      const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
      const bindGroup = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: storage } }] });
      const commands = device.createCommandEncoder();
      const pass = commands.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.dispatchWorkgroups(1);
      pass.end();
      commands.copyBufferToBuffer(storage, 0, readback, 0, values.byteLength);
      const startedAt = performance.now();
      device.queue.submit([commands.finish()]);
      await readback.mapAsync(GPUMapMode.READ);
      const result = new Float32Array(readback.getMappedRange().slice(0));
      readback.unmap();
      if (!result.every((value, index) => value === values[index] + 1)) throw new Error('WebGPU compute verification failed');
      return { supported: true, elapsedMs: performance.now() - startedAt, adapter: adapter.info?.description || adapter.info?.architecture || 'WebGPU' };
    } finally {
      storage.destroy();
      readback.destroy();
      device.destroy();
    }
  }

  /** Measures an actual OPFS write/read cycle and removes the probe file. */
  async runOPFSSmokeTest({ bytes = 2 * 1024 * 1024 } = {}) {
    if (!navigator.storage?.getDirectory) throw new Error('OPFS is unavailable');
    const root = await navigator.storage.getDirectory();
    const name = `vtp-probe-${crypto.randomUUID()}.bin`;
    const data = new Uint8Array(bytes);
    for (let index = 0; index < data.length; index += 4096) data[index] = index / 4096 & 255;
    try {
      const handle = await root.getFileHandle(name, { create: true });
      const writeStarted = performance.now();
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
      const writeMs = performance.now() - writeStarted;
      const readStarted = performance.now();
      const file = await handle.getFile();
      const read = new Uint8Array(await file.arrayBuffer());
      const readMs = performance.now() - readStarted;
      if (read.length !== data.length || read[0] !== data[0] || read[read.length - 4096] !== data[data.length - 4096]) throw new Error('OPFS data verification failed');
      return {
        supported: true,
        bytes,
        writeMBps: bytes / 1048576 / Math.max(0.001, writeMs / 1000),
        readMBps: bytes / 1048576 / Math.max(0.001, readMs / 1000),
      };
    } finally {
      await root.removeEntry(name).catch(() => {});
    }
  }

  /** Runs the real device acceptance suite requested by the user. */
  async runAcceptanceSuite() {
    const capture = async (name, operation) => {
      try { return [name, { ok: true, result: await operation() }]; }
      catch (error) { return [name, { ok: false, error: error?.message || String(error) }]; }
    };
    const pairs = await Promise.all([
      capture('webgpu', () => this.runWebGPUSmokeTest()),
      capture('h264', () => this.runH264SmokeTest()),
      capture('aac', () => this.runAACSmokeTest()),
      capture('opfs', () => this.runOPFSSmokeTest()),
    ]);
    const tests = Object.fromEntries(pairs);
    const fourKSupported = this.h264Matrix.some((item) => item.id === '4k60' && item.supported);
    tests.h2644k60 = fourKSupported
      ? (await capture('h2644k60', () => this.runH264SmokeTest({ width: 3840, height: 2160, framerate: 60, frameCount: 4 })))[1]
      : { ok: false, skipped: true, error: '4K60 configuration was not advertised' };
    const verdict = evaluateAcceptance(tests);
    const result = { testedAt: new Date().toISOString(), profile: this.profile, tests, ...verdict };
    try { localStorage.setItem('vtp-device-acceptance', JSON.stringify(result)); } catch {}
    this.dispatchEvent(new CustomEvent('acceptance', { detail: result }));
    return result;
  }
}

export function evaluateAcceptance(tests = {}) {
  const weights = { webgpu: 25, h264: 30, aac: 15, opfs: 20, h2644k60: 10 };
  let score = 0;
  for (const [name, weight] of Object.entries(weights)) if (tests[name]?.ok) score += weight;
  const coreReady = ['h264', 'opfs'].every((name) => tests[name]?.ok);
  return {
    score,
    ready: coreReady,
    grade: score >= 90 ? 'excellent' : score >= 70 ? 'good' : score >= 50 ? 'limited' : 'unsupported',
  };
}

/** @param {{model?:string,userAgent?:string,platformVersion?:string,deviceMemoryGB?:number|null,hardwareConcurrency?:number}} info */
export function classifyDeviceProfile(info = {}) {
  const fingerprint = `${info.model || ''} ${info.userAgent || ''}`.toLowerCase();
  const isPocoF6 = POCO_F6_IDENTIFIERS.some((identifier) => fingerprint.includes(identifier));
  if (isPocoF6) {
    return {
      id: 'poco-f6',
      label: 'POCO F6 · Turbo',
      detected: true,
      model: info.model || 'POCO F6',
      recommendedMode: 'poco-f6',
      tileSize: 384,
      batchSize: 2,
      thermalClass: 'mobile-performance',
    };
  }
  const strongMobile = (info.deviceMemoryGB || 0) >= 8 && (info.hardwareConcurrency || 0) >= 8
    && /android/i.test(info.userAgent || '');
  return {
    id: strongMobile ? 'high-end-android' : 'generic',
    label: strongMobile ? 'Android قوي' : 'جهاز تلقائي',
    detected: false,
    model: info.model || '',
    recommendedMode: strongMobile ? 'quality' : 'auto',
    thermalClass: strongMobile ? 'mobile-performance' : 'adaptive',
  };
}
