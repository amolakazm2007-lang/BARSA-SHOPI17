import { BarsaError, withHardTimeout } from './CrashProofRuntime.js';

const SINGLE_CORE = './vendor/ffmpeg-core';
const MULTI_CORE = './vendor/ffmpeg-core-mt';
const DEFAULT_EXEC_TIMEOUT_MS = 120_000;

export class FFmpegEngine extends EventTarget {
  constructor() {
    super();
    this.ffmpeg = null;
    this.loaded = false;
    this.loading = null;
    this.files = new Set();
    this.FFmpegClass = null;
    this.fetchFile = null;
    this.execTimeoutMs = DEFAULT_EXEC_TIMEOUT_MS;
  }

  async load({ multiThread = crossOriginIsolated, onProgress = null, onLog = null } = {}) {
    if (this.loaded) return;
    if (this.loading) return this.loading;
    this.loading = (async () => {
      if (!this.FFmpegClass || !this.fetchFile) {
        const [ffmpegModule, utilModule] = await Promise.all([import('@ffmpeg/ffmpeg'), import('@ffmpeg/util')]);
        this.FFmpegClass = ffmpegModule.FFmpeg;
        this.fetchFile = utilModule.fetchFile;
      }
      let lastError = null;
      for (const base of chooseCoreOrder(multiThread)) {
        this.ffmpeg?.terminate(); this.ffmpeg = this._createInstance(onProgress, onLog);
        const baseURL = new URL(`${base.replace(/^\.\//, '')}/`, document.baseURI).href.replace(/\/$/, '');
        const classWorkerURL = new URL('vendor/ffmpeg-class/worker.js', document.baseURI).href;
        try {
          const loadTimeoutMs = base === MULTI_CORE ? 90_000 : 120_000;
          await withHardTimeout(
            () => this.ffmpeg.load({ classWorkerURL, coreURL: `${baseURL}/ffmpeg-core.js`, wasmURL: `${baseURL}/ffmpeg-core.wasm`, ...(base === MULTI_CORE ? { workerURL: `${baseURL}/ffmpeg-core.worker.js` } : {}) }),
            { timeoutMs: loadTimeoutMs, label: 'FFmpeg core load', onTimeout: () => this._invalidateInstance('FFmpeg core load timeout') },
          );
          this.loaded = true; this.coreMode = base === MULTI_CORE ? 'multi' : 'single'; return;
        } catch (error) {
          lastError = error;
          console.error(`[BARSA][FFmpeg][core-load-failed] ${base}`, error);
          this._invalidateInstance('core load failed');
        }
      }
      throw new BarsaError('FFMPEG_LOAD_FAILED', lastError?.message || 'Could not load a local FFmpeg core', { recoverable: true, cause: lastError });
    })();
    try { await this.loading; }
    finally { this.loading = null; }
  }

  _createInstance(onProgress, onLog) {
    const ffmpeg = new this.FFmpegClass();
    this.lastLogs = [];
    ffmpeg.on('log', ({ type, message }) => { this.lastLogs.push(message); if (this.lastLogs.length > 80) this.lastLogs.shift(); onLog?.({ type, message }); this.dispatchEvent(new CustomEvent('log', { detail: { type, message } })); });
    let lastProgressEmit = 0;
    ffmpeg.on('progress', ({ progress, time }) => {
      const detail = { progress: Math.max(0, Math.min(1, progress || 0)), time };
      const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
      if (detail.progress < 1 && now - lastProgressEmit < 100) return;
      lastProgressEmit = now;
      onProgress?.(detail);
      this.dispatchEvent(new CustomEvent('progress', { detail }));
    });
    return ffmpeg;
  }

  async remux({ video, source, outputFormat = 'mp4', elementaryFormat, fps, audioFilter = null, audioBitrateK = 192, videoCRF = 18, videoPreset = 'fast', signal = null }) {
    this._assertLoaded();
    const token = createToken();
    const videoExt = elementaryFormat?.startsWith('ivf') ? 'ivf' : 'h264';
    const videoName = `video-${token}.${videoExt}`;
    const sourceName = `source-${token}.${extensionFor(source?.name || source?.type)}`;
    const outputName = `output-${token}.${outputFormat}`;
    try {
      await this._write(videoName, video);
      if (source) await this._write(sourceName, source);
      abortIfNeeded(signal);
      const args = ['-fflags', '+genpts'];
      if (fps) args.push('-r', String(fps));
      args.push('-i', videoName);
      if (source) args.push('-i', sourceName);
      args.push('-map', '0:v:0');
      if (source) args.push('-map', '1:a:0?');
      const requiresH264Transcode = outputFormat === 'mp4' && videoExt === 'ivf';
      if (requiresH264Transcode) args.push('-vf', 'setpts=PTS-STARTPTS', '-c:v', 'libx264', '-preset', videoPreset, '-crf', String(videoCRF), '-pix_fmt', 'yuv420p');
      else args.push('-c:v', 'copy');
      if (source) {
        if (audioFilter) args.push('-af', audioFilter);
        args.push('-c:a', outputFormat === 'webm' ? 'libopus' : 'aac', '-b:a', `${audioBitrateK}k`);
        if (outputFormat === 'mp4') args.push('-ar', '48000');
        args.push('-shortest');
      }
      if (outputFormat === 'mp4') args.push('-movflags', '+faststart');
      args.push(outputName);
      await this._exec(args, signal);
      const data = await this.ffmpeg.readFile(outputName);
      const exact = data instanceof Uint8Array ? data : new Uint8Array(data);
      return new Blob([exact], { type: outputFormat === 'mp4' ? 'video/mp4' : 'video/webm' });
    } finally { await this._cleanup([videoName, sourceName, outputName]); }
  }

  async transcode(input, inputName = 'input.mp4', options = {}) {
    this._assertLoaded();
    const token = createToken();
    const safeInput = `${token}-${sanitize(inputName)}`;
    const outputName = `${token}-output.${options.format || 'mp4'}`;
    const quality = QUALITY_PRESETS[options.quality || 'BALANCED'];
    try {
      await this._write(safeInput, input);
      const args = ['-i', safeInput, '-c:v', options.codec || quality.codec, '-crf', String(options.crf ?? quality.crf), '-preset', options.preset || quality.preset];
      if (options.videoFilter) args.push('-vf', options.videoFilter);
      if (options.audioFilter && options.includeAudio !== false) args.push('-af', options.audioFilter);
      if (options.includeAudio === false) args.push('-an');
      else args.push('-c:a', options.audioCodec || 'aac', '-b:a', `${options.audioBitrateK || quality.audioBitrateK}k`);
      if ((options.format || 'mp4') === 'mp4') args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart');
      args.push(outputName);
      await this._exec(args, options.signal, options.timeoutMs);
      const data = await this.ffmpeg.readFile(outputName);
      return new Uint8Array(data);
    } finally { await this._cleanup([safeInput, outputName]); }
  }

  async convertFPS(input, inputName, targetFps, signal = null) { return this.transcode(input, inputName, { videoFilter: `fps=${targetFps}`, quality: 'BALANCED', signal }); }

  async trim(input, inputName, startSec, endSec, signal = null) {
    this._assertLoaded();
    const token = createToken();
    const sourceName = `${token}-${sanitize(inputName)}`;
    const outputName = `${token}-trim.${extensionFor(inputName)}`;
    try {
      await this._write(sourceName, input);
      await this._exec(['-ss', String(Math.max(0, startSec)), '-to', String(Math.max(startSec, endSec)), '-i', sourceName, '-c', 'copy', outputName], signal);
      return new Uint8Array(await this.ffmpeg.readFile(outputName));
    } finally { await this._cleanup([sourceName, outputName]); }
  }

  async _exec(args, signal = null, timeoutMs = this.execTimeoutMs) {
    this._assertLoaded();
    abortIfNeeded(signal);
    const instance = this.ffmpeg;
    try {
      const code = await withHardTimeout(() => instance.exec(args), {
        timeoutMs: Math.max(10_000, Number(timeoutMs) || this.execTimeoutMs),
        label: 'FFmpeg execution',
        signal,
        onTimeout: () => this._invalidateInstance('execution timeout'),
      });
      if (code !== 0) throw new BarsaError('FFMPEG_EXEC_FAILED', `FFmpeg exited with status ${code}`, { recoverable: true, details: { code, args: args.slice(0, 40) } });
    } catch (error) {
      if (error?.name === 'AbortError' || error?.code === 'OPERATION_TIMEOUT') this._invalidateInstance(error?.code || 'aborted');
      const wrapped = error instanceof BarsaError ? error : new BarsaError('FFMPEG_EXEC_FAILED', `FFmpeg execution failed: ${error?.message || error}`, { recoverable: true, cause: error });
      console.error('[BARSA][FFmpeg][exec-failed]', wrapped, { args: args.slice(0, 40), lastLogs: this.lastLogs?.slice(-10) });
      throw wrapped;
    }
  }

  _invalidateInstance(reason) {
    const instance = this.ffmpeg;
    this.ffmpeg = null;
    this.loaded = false;
    this.coreMode = null;
    try { instance?.terminate?.(); }
    catch (error) { console.error('[BARSA][FFmpeg][terminate-failed]', reason, error); }
  }

  async _write(name, input) {
    this._assertLoaded();
    const data = input instanceof Uint8Array ? input : await this.fetchFile(input);
    await this.ffmpeg.writeFile(name, data);
    this.files.add(name);
  }

  async _cleanup(names) {
    await Promise.all(names.filter(Boolean).map(async (name) => {
      try { await this.ffmpeg?.deleteFile(name); }
      catch (error) { console.warn('[BARSA][FFmpeg][cleanup-failed]', { name, error }); }
      finally { this.files.delete(name); }
    }));
  }

  _assertLoaded() { if (!this.loaded || !this.ffmpeg) throw new BarsaError('FFMPEG_NOT_LOADED', 'FFmpegEngine.load() must complete before processing', { recoverable: true }); }

  terminate() {
    this._invalidateInstance('manual terminate');
    this.files.clear();
  }
}

function chooseCoreOrder(requested) {
  const cores = navigator.hardwareConcurrency || 1, memory = navigator.deviceMemory || 4;
  return requested && crossOriginIsolated && cores >= 4 && cores <= 16 && memory >= 4 ? [MULTI_CORE, SINGLE_CORE] : [SINGLE_CORE];
}

export const QUALITY_PRESETS = {
  LOW: { codec: 'libx264', crf: 28, preset: 'veryfast', audioBitrateK: 96, bitsPerPixel: 0.065 },
  BALANCED: { codec: 'libx264', crf: 21, preset: 'fast', audioBitrateK: 160, bitsPerPixel: 0.11 },
  HIGH: { codec: 'libx264', crf: 17, preset: 'medium', audioBitrateK: 224, bitsPerPixel: 0.18 },
  ULTRA: { codec: 'libx264', crf: 13, preset: 'slow', audioBitrateK: 320, bitsPerPixel: 0.28 },
};

function extensionFor(value = '') {
  const match = String(value).toLowerCase().match(/(?:\.)([a-z0-9]{2,5})$/);
  if (match) return match[1];
  if (String(value).includes('webm')) return 'webm';
  if (String(value).includes('quicktime')) return 'mov';
  return 'mp4';
}
function createToken() { return crypto.randomUUID().replaceAll('-', '').slice(0, 12); }
function sanitize(value) { return value.replace(/[^a-z0-9_.-]/gi, '-').slice(-100); }
function abortIfNeeded(signal) { if (signal?.aborted) throw signal.reason || new DOMException('Operation cancelled', 'AbortError'); }
