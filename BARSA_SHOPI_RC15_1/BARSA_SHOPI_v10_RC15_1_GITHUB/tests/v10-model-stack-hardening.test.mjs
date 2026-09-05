import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ModelManager } from '../src/engine/ModelManager.js';
import { FACE_DETECTOR_REGISTRY } from '../src/engine/FaceDetectorEngine.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('v10 model downloads use single-flight coordination', async () => {
  const manager = new ModelManager();
  let runs = 0;
  const eventsA = [], eventsB = [];
  const task = (emit) => new Promise((resolve) => setTimeout(() => {
    runs += 1;
    emit({ stage: 'download', received: 5, total: 10, pct: .5 });
    resolve({ sizeBytes: 10 });
  }, 5));
  const a = manager._singleFlightInstall('same-model', (e) => eventsA.push(e), task);
  const b = manager._singleFlightInstall('same-model', (e) => eventsB.push(e), task);
  assert.strictEqual(a, b);
  await Promise.all([a, b]);
  assert.equal(runs, 1);
  assert.ok(eventsA.some((e) => e.stage === 'download'));
  assert.ok(eventsB.some((e) => e.stage === 'download'));
});

test('v10 network catalog models stream directly to OPFS instead of RAM chunk aggregation', () => {
  const source = read('src/engine/ModelManager.js');
  assert.match(source, /Every network model is streamed directly into OPFS/);
  assert.doesNotMatch(source, /const chunks = \[\]/);
  assert.match(source, /response\.body,/);
});

test('v10 detailed model status exposes numeric progress and true running readiness', async () => {
  const manager = new ModelManager();
  manager.getStatus = async () => ({ installed: true, verified: true, testPassed: true, sizeBytes: 100, executionProvider: 'webgpu' });
  const status = await manager.getDetailedStatus('model', { expectedSizeBytes: 100 });
  assert.equal(status.progressPercent, 100);
  assert.equal(status.ready, true);
  assert.equal(status.running, true);
  assert.equal(status.state, 'running');
  assert.equal(status.executionProvider, 'webgpu');
});


test('v10 detailed model status preserves actionable error state', async () => {
  const manager = new ModelManager();
  manager.getStatus = async () => ({ installed: false, verified: false, testPassed: false, health: 'failed' });
  manager.transferState.set('broken', { stage: 'error', pct: .42, received: 42, total: 100, error: new Error('digest mismatch') });
  const status = await manager.getDetailedStatus('broken', { expectedSizeBytes: 100 });
  assert.equal(status.state, 'error');
  assert.equal(status.progressPercent, 42);
  assert.match(status.lastError, /digest mismatch/);
});

test('v10 YuNet 2026 source uses the audited current mirror and keeps pinned bytes', () => {
  const cfg = FACE_DETECTOR_REGISTRY['yunet-2026may'];
  assert.equal(cfg.expectedSizeBytes, 229738);
  assert.equal(cfg.sha256, 'ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0');
  assert.match(cfg.remoteURL, /pollen-robotics\/face_detection_yunet_2026may/);
  assert.equal(cfg.downloadCandidates.length, 2);
  assert.ok(cfg.downloadCandidates.some((url) => /opencv\/opencv_zoo/.test(url)));
});

test('v10 model GUI shows numeric suite state and restored model choices', () => {
  const html = read('index.html');
  const main = read('src/main.js');
  assert.match(html, /id="modelSuiteSummary"/);
  assert.match(html, /id="modelAuditAllBtn"/);
  assert.match(html, /data-suite-model="yunet-2023mar"/);
  assert.match(html, /value="real-esrgan-x8-facefusion"/);
  assert.match(main, /getDetailedStatus\(id,config\)/);
  assert.match(main, /شغال/);
  assert.match(main, /يحمل/);
  assert.match(main, /auditAllInstalledModels/);
  assert.match(main, /مسارات AI جاهزة/);
});

test('v10 auto vault uses audited face detector fallback chain', () => {
  const vault = read('src/engine/AutoModelVault.js');
  assert.match(vault, /resolveWorkingModel\(\{/);
  assert.match(vault, /fallbackUsed/);
  const detector = read('src/engine/FaceDetectorEngine.js');
  assert.match(detector, /retries = 2/);
  assert.match(detector, /downloadCandidates/);
});
