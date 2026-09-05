import { applyRealtimeEffects } from './RealtimePreviewEngine.js';
import { parseCubeLUT } from './ColorEngine.js';
import { CPUFrameWorker } from './CPUFrameWorker.js';
import { ModelAutoProvisioner } from './ModelAutoProvisioner.js';
import { MODEL_REGISTRY } from './UpscaleEngine.js';
import { RIFE_MODEL_REGISTRY } from './RIFEEngine.js';
import { FACE_MODEL_REGISTRY } from './FaceRestorationEngine.js';
import { FACE_DETECTOR_REGISTRY } from './FaceDetectorEngine.js';

/**
 * In-browser acceptance suite. It deliberately reports SKIPPED/LIMITED when a
 * production model is not installed or a browser API does not expose a fact;
 * it never invents temperature, RAM usage, or hardware-encoder identity.
 */
export class FullDeviceTestEngine {
  constructor(manager) { this.manager = manager; }

  async run({ onProgress = null, autoInstallModels = false } = {}) {
    if (this.manager.activeJobId) throw new Error('Finish or cancel the active render before running the device test');
    const { engines } = this.manager;
    const results = {};
    const capture = async (id, operation) => {
      onProgress?.(id);
      const startedAt = performance.now();
      try { results[id] = { status: 'PASS', result: await operation(), elapsedMs: performance.now() - startedAt }; }
      catch (error) { results[id] = { status: error?.code === 'SKIPPED' ? 'SKIPPED' : 'FAIL', error: error?.message || String(error), elapsedMs: performance.now() - startedAt }; }
      return results[id];
    };

    const hardware = await engines.hardware.runAcceptanceSuite();
    results.hardware = { status: hardware.ready ? 'PASS' : 'LIMITED', result: hardware };

    for (const spec of [
      ['encode1080p60', 1920, 1080, 60, 10],
      ['encode1080p120', 1920, 1080, 120, 10],
      ['encode4k30', 3840, 2160, 30, 6],
      ['encode4k60', 3840, 2160, 60, 6],
    ]) {
      const [id, width, height, framerate, frameCount] = spec;
      await capture(id, () => engines.hardware.runH264SmokeTest({ width, height, framerate, frameCount }));
    }

    await capture('quality', () => runQualitySmoke());
    await capture('color', async () => {
      const canvas = new OffscreenCanvas(320, 180), context = canvas.getContext('2d', { willReadFrequently: true });
      context.fillStyle = 'rgb(90,120,150)'; context.fillRect(0, 0, 320, 180);
      return engines.color.applyToCanvas(canvas, context, { enabled: true, curves: { luma: '0:0,0.5:0.57,1:1' } });
    });
    await capture('lut', () => {
      const lut = parseCubeLUT('LUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1\n');
      if (lut.size !== 2) throw new Error('LUT parser returned the wrong size');
      return { type: lut.type, size: lut.size };
    });
    await capture('cpuWorker', () => runWorkerSmoke());
    await capture('qualityMatrix', () => runQualityMatrixSmoke());
    await capture('audioDSP', () => runAudioSmoke(engines.audio));
    await capture('temporal', () => runTemporalSmoke(engines.temporal));
    await capture('storage', () => runStorageSmoke(engines.storage));
    await capture('mediaProbe', () => runMediaProbeSmoke(engines.media));
    await capture('blur', () => runBlurSmoke(engines.blur));
    await capture('ffmpegRuntime', async () => {
      await engines.ffmpeg.load({ multiThread: Boolean(crossOriginIsolated) });
      return { loaded: true, multithread: Boolean(crossOriginIsolated) };
    });

    await this._modelTest('mobileSR', 'upscale', engines.upscale, 'onnx-model-zoo-sr-x3', MODEL_REGISTRY, results, capture, { autoInstallModels });
    await this._modelTest('realESRGAN', 'upscale', engines.upscale, 'real-esrgan-x4plus', MODEL_REGISTRY, results, capture, { autoInstallModels });
    await this._modelTest('rife', 'rife', engines.rife, 'rife-tensorstack', RIFE_MODEL_REGISTRY, results, capture, { autoInstallModels });
    await this._modelTest('gfpgan', 'face', engines.face, 'gfpgan-1.4', FACE_MODEL_REGISTRY, results, capture, { autoInstallModels });
    await this._modelTest('codeformer', 'face', engines.face, 'codeformer', FACE_MODEL_REGISTRY, results, capture, { autoInstallModels });
    await this._modelTest('yunet', 'face-detection', engines.faceDetector, 'yunet-2026may', FACE_DETECTOR_REGISTRY, results, capture, { autoInstallModels, detector: true });

    const srStatus = await engines.upscale.isAvailable('real-esrgan-x4plus').catch(() => ({ available: false }));
    if (srStatus.available) {
      await capture('safeTile', () => this._probeUpscaleTile('real-esrgan-x4plus'));
    } else {
      results.safeTile = { status: 'SKIPPED', error: 'Real-ESRGAN is not installed/runtime-verified' };
    }

    await capture('cancelRestart', () => this.manager.runCancelRestartSelfTest());

    const statuses = Object.values(results).map((entry) => entry.status);
    const fail = statuses.filter((value) => value === 'FAIL').length;
    const limited = statuses.filter((value) => value === 'LIMITED' || value === 'SKIPPED').length;
    const summary = {
      testedAt: new Date().toISOString(),
      profile: this.manager.capabilities?.deviceProfile || null,
      results,
      verdict: fail ? 'FAIL' : limited ? 'LIMITED' : 'PASS',
      note: 'Temperature and exact process RAM are intentionally not reported because normal browser APIs do not expose reliable physical-device values.',
    };
    try { localStorage.setItem('vtp-full-device-test-v2', JSON.stringify(summary)); } catch {}
    return summary;
  }

  async _modelTest(id, role, engine, modelId, registry, results, capture, { autoInstallModels = false, detector = false } = {}) {
    let selectedModelId = modelId;
    let available = await engine.isAvailable(selectedModelId).catch(() => ({ available: false }));
    if (!available.available && autoInstallModels) {
      const provisioner = new ModelAutoProvisioner();
      try {
        const provisioned = await provisioner.ensure({ role, modelId: selectedModelId, engine, registry, allowFallback: role !== 'face' && role !== 'face-detection' });
        selectedModelId = provisioned.modelId || selectedModelId;
        available = await engine.isAvailable(selectedModelId).catch(() => ({ available: false }));
      } catch (error) {
        results[id] = { status: 'LIMITED', error: `Automatic model install failed for ${modelId}: ${error.message}` };
        return;
      }
    }
    if (!available.available) {
      results[id] = { status: 'SKIPPED', error: `${selectedModelId} is not installed and runtime-verified` };
      return;
    }
    await capture(id, async () => {
      if (typeof engine.runSelfTest !== 'function') throw new Error('Model engine has no runtime self-test');
      const value = detector ? await engine.runSelfTest(selectedModelId) : await engine.runSelfTest(selectedModelId);
      return { modelId: selectedModelId, requestedModelId: modelId, provider: engine.executionProvider || engine.provider || null, value };
    });
  }

  async _probeUpscaleTile(modelId) {
    const { upscale } = this.manager.engines;
    const candidates = [384, 256, 192, 128];
    const failures = [];
    for (const tileSize of candidates) {
      const width = Math.min(tileSize, 256), height = Math.min(tileSize, 144);
      const input = new OffscreenCanvas(width, height), source = input.getContext('2d', { willReadFrequently: true });
      source.fillStyle = 'rgb(80,130,180)'; source.fillRect(0, 0, width, height);
      const config = (await import('./UpscaleEngine.js')).MODEL_REGISTRY[modelId];
      const output = new OffscreenCanvas(width * config.scale, height * config.scale), destination = output.getContext('2d');
      try {
        const startedAt = performance.now();
        await upscale.upscaleFrame(modelId, source, width, height, destination, { tileSize, overlap: config.overlap, concurrency: 1 });
        return { tileSize, elapsedMs: performance.now() - startedAt, modelId };
      } catch (error) { failures.push(`${tileSize}: ${error.message}`); }
    }
    throw new Error(`No safe Real-ESRGAN tile passed: ${failures.join(' | ')}`);
  }
}

function skip(message) { const error = new Error(message); error.code = 'SKIPPED'; throw error; }

function runQualitySmoke() {
  const image = new ImageData(96, 54);
  for (let i = 0; i < image.data.length; i += 4) { const v = (i / 4) % 96 < 48 ? 70 : 180; image.data[i] = v; image.data[i + 1] = v + 4; image.data[i + 2] = v + 8; image.data[i + 3] = 255; }
  const before = checksum(image.data);
  applyRealtimeEffects(image, { denoiseAmount: .18, detailAmount: .2, sharpenAmount: .15, dehalo: .1 });
  const after = checksum(image.data);
  if (before === after) throw new Error('Quality pass was a no-op');
  return { changed: true, before, after };
}

async function runWorkerSmoke() {
  if (typeof Worker !== 'function' || typeof ImageData !== 'function') skip('Worker/ImageData unavailable');
  const worker = new CPUFrameWorker();
  try {
    const image = new ImageData(128, 72);
    image.data.fill(90); for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
    const result = await worker.process(image, { effects: { exposure: .2, detailAmount: .1 } });
    if (!result || checksum(result.data) === 0) throw new Error('Worker returned invalid pixels');
    return { supported: true, pixels: result.width * result.height };
  } finally { worker.destroy(); }
}

async function runBlurSmoke(blur) {
  if (typeof VideoFrame !== 'function' || typeof OffscreenCanvas !== 'function') skip('VideoFrame/OffscreenCanvas unavailable');
  blur.configure({ enabled: true, width: 160, height: 90, inputFps: 120, outputFps: 60, amount: 1.5, weighting: 'gaussian_sym', gamma: 1, deduplicate: true, maxSamples: 8 });
  let outputs = 0;
  try {
    for (let index = 0; index < 6; index++) {
      const canvas = new OffscreenCanvas(160, 90), context = canvas.getContext('2d');
      context.fillStyle = 'black'; context.fillRect(0, 0, 160, 90); context.fillStyle = 'white'; context.fillRect(10 + index * 12, 30, 24, 24);
      const frame = new VideoFrame(canvas, { timestamp: Math.round(index * 1_000_000 / 120), duration: Math.round(1_000_000 / 120) });
      const emitted = await blur.push(frame); frame.close();
      outputs += emitted.length; emitted.forEach((value) => value.close());
    }
    const tail = await blur.flush(); outputs += tail.length; tail.forEach((value) => value.close());
    if (!outputs) throw new Error('Blur emitted no output frames');
    return { outputs, diagnostics: blur.diagnostics() };
  } finally { blur.destroy(); }
}

function checksum(data) { let value = 2166136261; for (let i = 0; i < data.length; i += 97) value = Math.imul(value ^ data[i], 16777619) >>> 0; return value; }


function runQualityMatrixSmoke() {
  const cases = [
    ['denoise', { denoiseAmount: .35 }],
    ['detail', { detailAmount: .45 }],
    ['sharpen', { sharpenAmount: .45 }],
    ['exposure', { exposure: .35 }],
    ['contrast', { contrast: 1.25 }],
    ['saturation', { saturation: 1.35 }],
    ['vibrance', { vibrance: .35 }],
    ['temperature', { temperature: .3 }],
    ['dehaze', { dehaze: .3 }],
    ['vignette', { vignette: .35 }],
    ['grain', { grain: .25 }],
  ];
  const changed = [];
  for (const [name, effects] of cases) {
    const image = new ImageData(96, 54);
    for (let i = 0; i < image.data.length; i += 4) {
      const x = (i / 4) % 96, y = Math.floor((i / 4) / 96);
      image.data[i] = (40 + x * 2 + (y % 5) * 3) % 255;
      image.data[i + 1] = (65 + x + (y % 7) * 4) % 255;
      image.data[i + 2] = (90 + x * 1.5 + (y % 3) * 8) % 255;
      image.data[i + 3] = 255;
    }
    const before = checksum(image.data);
    applyRealtimeEffects(image, effects);
    const after = checksum(image.data);
    if (before === after) throw new Error(`${name} was a no-op`);
    changed.push(name);
  }
  return { changed };
}

function runAudioSmoke(audio) {
  const processor = audio.createStreamingProcessor({ noiseReduction: .25, normalizeLufs: -16, truePeakDb: -1.5 });
  class FakeAudioSample {
    constructor({ data, format = 'f32', numberOfChannels, sampleRate, timestamp = 0 }) {
      this.data = data; this.format = format; this.numberOfChannels = numberOfChannels; this.sampleRate = sampleRate; this.timestamp = timestamp;
      this.numberOfFrames = Math.floor(data.length / numberOfChannels);
    }
    copyTo(target) { target.set(this.data); }
  }
  const frames = 2048, channels = 2, data = new Float32Array(frames * channels);
  for (let i = 0; i < frames; i++) {
    const value = Math.sin(i / 13) * .18 + Math.sin(i / 37) * .04;
    data[i * 2] = value; data[i * 2 + 1] = value * .92;
  }
  const output = processor.process(new FakeAudioSample({ data, numberOfChannels: channels, sampleRate: 48000 }));
  const stats = processor.stats();
  if (!output?.data?.length || !stats.frames || stats.peak <= 0) throw new Error('Audio DSP emitted invalid output');
  const filter = audio.buildFFmpegFilter({ noiseReduction: .25 });
  if (!filter.includes('loudnorm') || !filter.includes('afftdn')) throw new Error('Audio FFmpeg filter graph is incomplete');
  return { frames: stats.frames, peak: stats.peak, filter };
}

function runTemporalSmoke(temporal) {
  if (typeof OffscreenCanvas !== 'function') skip('OffscreenCanvas unavailable');
  const canvas = new OffscreenCanvas(160, 90), context = canvas.getContext('2d', { willReadFrequently: true });
  context.fillStyle = 'rgb(90,100,110)'; context.fillRect(0, 0, 160, 90);
  const first = temporal.process(canvas, context, { denoise: .45, antiFlicker: .35, detailStability: .25 });
  context.fillStyle = 'rgba(96,106,116,.96)'; context.fillRect(0, 0, 160, 90);
  const second = temporal.process(canvas, context, { denoise: .45, antiFlicker: .35, detailStability: .25 });
  temporal.reset();
  if (second.difference < 0 || second.blend < 0 || second.blend > 1) throw new Error('Temporal engine returned invalid diagnostics');
  return { first, second };
}

async function runStorageSmoke(storage) {
  if (!navigator.storage?.getDirectory || !('indexedDB' in globalThis)) skip('OPFS/IndexedDB unavailable');
  const id = `selftest-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await storage.beginSession(id, { sourceName: 'selftest.bin', sourceSize: 8, jobOptions: {} });
  try {
    await storage.appendFrame(id, new Uint8Array([1,2,3,4,5,6,7,8]), 0, 1);
    const file = await storage.finalizeSession(id);
    if (!file || file.size !== 8) throw new Error(`OPFS size mismatch: ${file?.size}`);
    return { bytes: file.size };
  } finally { await storage.deleteSession(id).catch(() => {}); }
}

async function runMediaProbeSmoke(media) {
  const response = await fetch('./t720.webm', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Bundled media test asset HTTP ${response.status}`);
  const blob = await response.blob();
  const file = new File([blob], 'selftest.webm', { type: 'video/webm' });
  const info = await media.probe(file);
  if (!info?.width || !info?.height || !Number.isFinite(info.duration) || info.duration <= 0) throw new Error('Media probe returned invalid metadata');
  return { width: info.width, height: info.height, duration: info.duration, codec: info.codec, fps: info.fps };
}
