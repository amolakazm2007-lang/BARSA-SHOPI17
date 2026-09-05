import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const required = [
  ['public/vendor/ffmpeg-core/ffmpeg-core.wasm', 32_232_419],
  ['public/vendor/ffmpeg-core/ffmpeg-core.js', 111_804],
  ['public/vendor/ffmpeg-core-mt/ffmpeg-core.wasm', 32_718_323],
  ['public/vendor/ffmpeg-core-mt/ffmpeg-core.js', 128_947],
  ['public/vendor/ffmpeg-core-mt/ffmpeg-core.worker.js', 2_115],
  ['public/vendor/ort-wasm/ort-wasm-simd-threaded.jsep.wasm', 21_872_216],
  ['public/vendor/ort-wasm/ort-wasm-simd-threaded.wasm', 11_210_254],
  ['public/models/super-resolution-10.onnx', 240_078],
  ['src/engine/VideoPipeline.js', 1],
  ['src/engine/ModelManager.js', 1],
  ['src/engine/ModelAutoProvisioner.js', 1],
  ['src/engine/FullDeviceTestEngine.js', 1],
  ['src/engine/CPUFrameWorker.js', 1],
  ['src/workers/frame-effects.worker.js', 1],
];

const failures = [];
for (const [path, exactSize] of required) {
  const full = join(root, path);
  if (!existsSync(full)) { failures.push(`MISSING ${path}`); continue; }
  const size = statSync(full).size;
  if (exactSize > 1 && size !== exactSize) failures.push(`SIZE ${path}: expected ${exactSize}, got ${size}`);
  if (size < 1) failures.push(`EMPTY ${path}`);
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const dep of ['@ffmpeg/core','@ffmpeg/core-mt','@ffmpeg/ffmpeg','@ffmpeg/util','mediabunny','onnxruntime-web']) {
  if (!pkg.dependencies?.[dep]) failures.push(`DEPENDENCY ${dep} is missing from package.json`);
}
for (const dep of ['playwright','vite']) if (!pkg.devDependencies?.[dep]) failures.push(`DEV DEPENDENCY ${dep} is missing from package.json`);

const sourceFiles = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(js|mjs)$/.test(entry.name)) sourceFiles.push(full);
  }
}
walk(join(root, 'src'));
const forbidden = [/\beval\s*\(/, /new\s+Function\s*\(/, /http:\/\//];
for (const file of sourceFiles) {
  const text = readFileSync(file, 'utf8');
  for (const pattern of forbidden) if (pattern.test(text)) failures.push(`POLICY ${relative(root,file)} matched ${pattern}`);
}

const hashTargets = required.filter(([p,size]) => size > 1).map(([p]) => p);
const hashes = {};
for (const path of hashTargets) {
  const full = join(root, path);
  if (existsSync(full)) hashes[path] = createHash('sha256').update(readFileSync(full)).digest('hex');
}

if (failures.length) {
  console.error('FINAL AUDIT: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('FINAL AUDIT: PASS');
console.log(`Checked ${required.length} critical files, ${sourceFiles.length} source modules, package dependencies, and runtime asset sizes.`);
for (const [path, hash] of Object.entries(hashes)) console.log(`${hash}  ${path}`);
