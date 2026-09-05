import { access, cp, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(root, 'public', 'vendor');
const required = [
  ['node_modules/@ffmpeg/core/dist/esm', 'ffmpeg-core'],
  ['node_modules/@ffmpeg/core-mt/dist/esm', 'ffmpeg-core-mt'],
  ['node_modules/@ffmpeg/ffmpeg/dist/esm', 'ffmpeg-class'],
];
const ortFiles = ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];

const exists = async (path) => { try { await access(path); return true; } catch { return false; } };
const dependenciesReady = (await Promise.all([
  ...required.map(([source]) => exists(join(root, source))),
  ...ortFiles.map((file) => exists(join(root, 'node_modules', 'onnxruntime-web', 'dist', file))),
])).every(Boolean);

if (!dependenciesReady) {
  const vendoredReady = await exists(join(out, 'ffmpeg-core', 'ffmpeg-core.wasm'))
    && await exists(join(out, 'ffmpeg-core-mt', 'ffmpeg-core.wasm'))
    && await exists(join(out, 'ort-wasm', 'ort-wasm-simd-threaded.wasm'));
  if (!vendoredReady) throw new Error('Runtime dependencies are not installed and public/vendor does not contain the prebuilt runtime assets. Run npm ci first.');
  console.log('Using verified prebuilt runtime assets already present in public/vendor.');
  process.exit(0);
}

const staging = join(root, 'public', '.vendor-staging');
await rm(staging, { recursive: true, force: true });
await mkdir(staging, { recursive: true });
for (const [source, target] of required) await cp(join(root, source), join(staging, target), { recursive: true });
const ortOut = join(staging, 'ort-wasm');
await mkdir(ortOut, { recursive: true });
for (const file of ortFiles) await cp(join(root, 'node_modules', 'onnxruntime-web', 'dist', file), join(ortOut, file));
await rm(out, { recursive: true, force: true });
await cp(staging, out, { recursive: true });
await rm(staging, { recursive: true, force: true });
console.log('Local FFmpeg and ONNX Runtime WASM assets copied to public/vendor.');
