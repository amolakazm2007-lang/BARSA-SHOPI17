import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();

// Locked to the exact npm versions in package-lock.json for BARSA SHOPI v9.0.
const expected = [
  {
    path: 'public/vendor/ffmpeg-core/ffmpeg-core.wasm',
    size: 32232419,
    sha256: '9f57947a5bd530d8f00c5b3f2cb2a3492faa7e5d823315342d6a8656d0a6b7b7',
  },
  {
    path: 'public/vendor/ffmpeg-core/ffmpeg-core.js',
    size: 111804,
    sha256: '67a48f11645f85439f3fde4f2119042c16b374b910206b7a7a24f342e28dcae3',
  },
  {
    path: 'public/vendor/ffmpeg-core-mt/ffmpeg-core.wasm',
    size: 32718323,
    sha256: 'be2c97605366b78f3f13e21b52e81a55a79e1f29c133b03a68ec187b1a2ec41a',
  },
  {
    path: 'public/vendor/ffmpeg-core-mt/ffmpeg-core.js',
    size: 128947,
    sha256: '270a2e6ff945e173238610669a3f7132df5f9c52698a9bf708cf5c2ab6bda0de',
  },
  {
    path: 'public/vendor/ffmpeg-core-mt/ffmpeg-core.worker.js',
    size: 2115,
    sha256: 'f77898d631dc010b45c29c23cb4379c611a7d7b131bf591d08a656bb729a4ca3',
  },
  {
    path: 'public/vendor/ort-wasm/ort-wasm-simd-threaded.jsep.wasm',
    size: 21872216,
    sha256: 'b45970d0632383a057c27ca5b660b216f8e00c17cf8db9f6207b5e4abc839368',
  },
  {
    path: 'public/vendor/ort-wasm/ort-wasm-simd-threaded.wasm',
    size: 11210254,
    sha256: '71aef04959c5c1b6de461b6538e2058e306610034a85aad2742d0c7fd4533fe4',
  },
];

const failures = [];
for (const item of expected) {
  const full = join(root, item.path);
  if (!existsSync(full)) {
    failures.push(`MISSING ${item.path}`);
    continue;
  }

  const size = statSync(full).size;
  if (size !== item.size) {
    failures.push(`SIZE ${item.path}: expected ${item.size}, got ${size}`);
    continue;
  }

  const sha256 = createHash('sha256').update(readFileSync(full)).digest('hex');
  if (sha256 !== item.sha256) {
    failures.push(`SHA256 ${item.path}: expected ${item.sha256}, got ${sha256}`);
  }
}

if (failures.length) {
  console.error('RUNTIME VERIFY: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  console.error('The APK build is intentionally blocked because a generated FFmpeg/ONNX runtime asset is missing, truncated, corrupted, or from an unexpected version.');
  process.exit(1);
}

console.log('RUNTIME VERIFY: PASS');
console.log(`Verified ${expected.length} generated FFmpeg/ONNX runtime assets by exact byte size and SHA-256.`);
