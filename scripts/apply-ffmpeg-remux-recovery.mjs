import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/engine/FFmpegEngine.js', import.meta.url);
let source = await readFile(path, 'utf8');

function ensureReplace(before, after, already, label) {
  if (source.includes(already)) return;
  if (!source.includes(before)) throw new Error(`FFmpeg recovery anchor missing: ${label}`);
  source = source.replace(before, after);
}

ensureReplace(
  '    this.execTimeoutMs = DEFAULT_EXEC_TIMEOUT_MS;\n',
  '    this.execTimeoutMs = DEFAULT_EXEC_TIMEOUT_MS;\n    this.lastLoadOptions = null;\n',
  'this.lastLoadOptions = null;',
  'constructor load options',
);

ensureReplace(
  "  async load({ multiThread = crossOriginIsolated, onProgress = null, onLog = null } = {}) {\n    if (this.loaded) return;",
  "  async load({ multiThread = crossOriginIsolated, onProgress = null, onLog = null } = {}) {\n    this.lastLoadOptions = { multiThread, onProgress, onLog };\n    if (this.loaded) return;",
  'this.lastLoadOptions = { multiThread, onProgress, onLog };',
  'remember load options',
);

ensureReplace(
  "  async remux({ video, source, outputFormat = 'mp4', elementaryFormat, fps, audioFilter = null, audioBitrateK = 192, videoCRF = 18, videoPreset = 'fast', signal = null }) {\n",
  `  async remux(params) {\n    try {\n      return await this._remuxOnce(params);\n    } catch (error) {\n      if (error?.code !== 'OPERATION_TIMEOUT') throw error;\n      console.warn('[BARSA][FFmpeg][remux-timeout-recreate-retry]', error);\n      await this.load(this.lastLoadOptions || {});\n      return this._remuxOnce(params);\n    }\n  }\n\n  async _remuxOnce({ video, source, outputFormat = 'mp4', elementaryFormat, fps, audioFilter = null, audioBitrateK = 192, videoCRF = 18, videoPreset = 'fast', signal = null }) {\n`,
  'async _remuxOnce({ video, source, outputFormat',
  'remux retry wrapper',
);

await writeFile(path, source);
console.log('FFmpeg remux timeout recovery applied.');
