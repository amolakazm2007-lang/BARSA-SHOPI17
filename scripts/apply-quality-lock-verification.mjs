import { readFile, writeFile } from 'node:fs/promises';

async function patch(relativePath, transforms) {
  const path = new URL(`../${relativePath}`, import.meta.url);
  let source = await readFile(path, 'utf8');
  for (const { before, after, already, label } of transforms) {
    if (source.includes(already)) continue;
    if (!source.includes(before)) throw new Error(`Quality-lock anchor missing in ${relativePath}: ${label}`);
    source = source.replace(before, after);
  }
  await writeFile(path, source);
}

await patch('src/engine/RenderFingerprint.js', [
  {
    before: "export async function createQualityLockFingerprint({ settings = {}, width, height, fps, bitrate, models = {} } = {}) {\n",
    after: `export function assertQualityLockFingerprint(expected, actual, { phase = 'render' } = {}) {\n  if (!expected?.hash || !actual?.hash) return true;\n  if (expected.hash === actual.hash && expected.algorithm === actual.algorithm) return true;\n  const error = new Error(\`Final render quality lock changed during \${phase}; resume/commit blocked\`);\n  error.name = 'QualityLockViolationError';\n  error.code = 'QUALITY_LOCK_VIOLATION';\n  error.recoverable = false;\n  error.details = { phase, expected: { algorithm: expected.algorithm, hash: expected.hash }, actual: { algorithm: actual.algorithm, hash: actual.hash } };\n  throw error;\n}\n\nexport async function createQualityLockFingerprint({ settings = {}, width, height, fps, bitrate, models = {} } = {}) {\n`,
    already: 'export function assertQualityLockFingerprint(expected, actual',
    label: 'assert helper',
  },
]);

await patch('src/engine/VideoPipeline.js', [
  {
    before: "import { createQualityLockFingerprint } from './RenderFingerprint.js';\n",
    after: "import { createQualityLockFingerprint, assertQualityLockFingerprint } from './RenderFingerprint.js';\n",
    already: "import { createQualityLockFingerprint, assertQualityLockFingerprint } from './RenderFingerprint.js';",
    label: 'import assertion',
  },
  {
    before: `      const qualityLockFingerprint = await createQualityLockFingerprint({\n        settings, width: outputSize.width, height: outputSize.height, fps: targetFps, bitrate,\n        models: { upscale: settings.upscaleModelId || null, rife: settings.rifeModelId || null, face: settings.faceModelId || null },\n      });\n      codecs.setMaxQueueSize?.(safeCodecQueue);`,
    after: `      const qualityLockFingerprint = await createQualityLockFingerprint({\n        settings, width: outputSize.width, height: outputSize.height, fps: targetFps, bitrate,\n        models: { upscale: settings.upscaleModelId || null, rife: settings.rifeModelId || null, face: settings.faceModelId || null },\n      });\n      if (resuming && resumeCheckpoint?.qualityLockFingerprint) {\n        assertQualityLockFingerprint(resumeCheckpoint.qualityLockFingerprint, qualityLockFingerprint, { phase: 'resume' });\n      }\n      codecs.setMaxQueueSize?.(safeCodecQueue);`,
    already: "phase: 'resume'",
    label: 'resume verification',
  },
  {
    before: "      // OPFS-backed File/Blob objects are not portable snapshots in Chromium: deleting\n",
    after: `      const finalQualityLockFingerprint = await createQualityLockFingerprint({\n        settings, width: outputSize.width, height: outputSize.height, fps: targetFps, bitrate,\n        models: { upscale: settings.upscaleModelId || null, rife: settings.rifeModelId || null, face: settings.faceModelId || null },\n      });\n      assertQualityLockFingerprint(qualityLockFingerprint, finalQualityLockFingerprint, { phase: 'commit' });\n\n      // OPFS-backed File/Blob objects are not portable snapshots in Chromium: deleting\n`,
    already: "phase: 'commit'",
    label: 'commit verification',
  },
  {
    before: "          qualityLockedRender: true,\n",
    after: "          qualityLockedRender: true,\n          qualityLockFingerprint: finalQualityLockFingerprint,\n",
    already: 'qualityLockFingerprint: finalQualityLockFingerprint,',
    label: 'result metadata',
  },
]);

console.log('Render quality fingerprint verification applied at resume and final commit.');
