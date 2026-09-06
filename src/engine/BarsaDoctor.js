import { MODEL_REGISTRY } from './UpscaleEngine.js';
import { RIFE_MODEL_REGISTRY } from './RIFEEngine.js';
import { FACE_MODEL_REGISTRY } from './FaceRestorationEngine.js';
import { FACE_DETECTOR_REGISTRY } from './FaceDetectorEngine.js';

const MODEL_SPECS = [
  ['upscale', MODEL_REGISTRY],
  ['rife', RIFE_MODEL_REGISTRY],
  ['face', FACE_MODEL_REGISTRY],
  ['faceDetector', FACE_DETECTOR_REGISTRY],
];

function nowIso() { return new Date().toISOString(); }
function issue(id, severity, message, repair = null, details = null) {
  return { id, severity, message, repair, details };
}
function safeError(error) { return error?.message || String(error || 'Unknown error'); }
function healthScore(checks, issues) {
  let score = 100;
  for (const check of Object.values(checks || {})) if (check.status === 'FAIL') score -= 16;
  for (const item of issues || []) score -= item.severity === 'high' ? 12 : item.severity === 'medium' ? 5 : 2;
  return Math.max(0, Math.min(100, score));
}
function componentScores(checks, issues) {
  const result = {};
  for (const [id, check] of Object.entries(checks || {})) result[id] = check.status === 'PASS' ? 100 : 40;
  for (const item of issues || []) {
    const prefix = String(item.id || '').split(/[:\-]/)[0] || 'general';
    result[prefix] = Math.max(0, (result[prefix] ?? 100) - (item.severity === 'high' ? 25 : item.severity === 'medium' ? 12 : 5));
  }
  return result;
}
function pressureRatio(telemetry = {}) {
  const heap = Number(telemetry.jsHeapLimitMB) > 0 ? Number(telemetry.jsHeapUsedMB || 0) / Number(telemetry.jsHeapLimitMB) : 0;
  const gpu = Number(telemetry.gpuBudgetMB) > 0 ? Number(telemetry.gpuAllocatedMB || 0) / Number(telemetry.gpuBudgetMB) : 0;
  return Math.max(Number.isFinite(heap) ? heap : 0, Number.isFinite(gpu) ? gpu : 0);
}

/**
 * BARSA Doctor: non-destructive diagnostics + explicitly allow-listed repairs.
 * It never deletes a verified model, changes final-render quality settings,
 * or mutates a resumable render session automatically.
 */
export class BarsaDoctor {
  constructor(manager) {
    this.manager = manager;
    this.lastReport = null;
    this.running = false;
    this.historyKey = 'barsa-doctor-health-history-v2';
    this.repairStateKey = 'barsa-doctor-repair-state-v2';
  }

  async run(mode = 'quick', { onProgress = null } = {}) {
    if (this.running) throw new Error('BARSA Doctor is already running');
    if (this.manager.activeJobId) throw new Error('Finish or cancel the active render before running BARSA Doctor');
    if (!['quick', 'full', 'stress'].includes(mode)) throw new Error(`Unsupported doctor mode: ${mode}`);
    this.running = true;
    const startedAt = performance.now();
    const checks = {};
    const issues = [];
    const capture = async (id, fn) => {
      onProgress?.(id);
      const started = performance.now();
      try {
        const result = await fn();
        checks[id] = { status: 'PASS', elapsedMs: performance.now() - started, result };
        return result;
      } catch (error) {
        checks[id] = { status: 'FAIL', elapsedMs: performance.now() - started, error: safeError(error) };
        return null;
      }
    };

    try {
      await capture('capabilities', async () => {
        const c = this.manager.capabilities || {};
        if (!c.webCodecs) issues.push(issue('webcodecs-unavailable', 'high', 'WebCodecs is unavailable; native/FFmpeg fallback will be required.'));
        if (!c.opfs) issues.push(issue('opfs-unavailable', 'high', 'OPFS is unavailable; durable resume/cache is limited.'));
        if (!c.indexedDB) issues.push(issue('idb-unavailable', 'high', 'IndexedDB is unavailable; session metadata cannot be persisted reliably.'));
        if (!c.webGPU) issues.push(issue('webgpu-unavailable', 'medium', 'WebGPU is unavailable; AI will use Native/WASM fallback.'));
        return {
          webCodecs: !!c.webCodecs, webGPU: !!c.webGPU, opfs: !!c.opfs, indexedDB: !!c.indexedDB,
          hardwareConcurrency: c.hardwareConcurrency || 1, deviceMemoryGB: c.deviceMemoryGB || null,
          profile: c.deviceProfile?.label || c.deviceProfile?.id || null,
        };
      });

      await capture('storage', async () => {
        const storage = this.manager.engines.storage;
        const estimate = await storage.getStorageUsage();
        const ratio = estimate?.quotaBytes ? Number(estimate.usageBytes || 0) / Number(estimate.quotaBytes) : 0;
        if (ratio >= 0.92) issues.push(issue('storage-critical', 'high', `Storage is ${Math.round(ratio * 100)}% full.`, 'storage-safe-clean'));
        else if (ratio >= 0.80) issues.push(issue('storage-high', 'medium', `Storage is ${Math.round(ratio * 100)}% full.`, 'storage-safe-clean'));
        const resumable = await storage.findResumableSession().catch(() => null);
        return { ...estimate, usageRatio: ratio, resumable: resumable ? { sessionId: resumable.sessionId, status: resumable.status, progress: resumable.progress } : null };
      });

      await capture('performance', async () => {
        const perf = this.manager.engines.performance;
        if (typeof perf.sample === 'function') await perf.sample().catch(() => {});
        const telemetry = { ...(perf.telemetry || {}) };
        const pressure = String(telemetry.pressureState || perf._pressureState || 'normal');
        if (pressure === 'critical') issues.push(issue('memory-pressure-critical', 'high', 'Memory/GPU pressure is critical; close background apps before a long render.', 'release-ai-memory'));
        else if (pressure === 'high') issues.push(issue('memory-pressure-high', 'medium', 'Memory/GPU pressure is elevated.', 'release-ai-memory'));
        return { pressure, telemetry, adaptive: perf.getAdaptiveSettings?.() || null };
      });

      await capture('models', async () => this._checkModels({ issues, deep: mode !== 'quick', onProgress }));

      if (mode !== 'quick') {
        await capture('resume-integrity', async () => {
          const session = await this.manager.engines.storage.findResumableSession().catch(() => null);
          if (!session) return { found: false };
          if (session.status !== 'remux_pending' && session.durableResume !== true) {
            issues.push(issue('resume-legacy', 'medium', 'A resumable session exists but does not have a modern durable checkpoint.'));
          }
          return { found: true, sessionId: session.sessionId, status: session.status, durableResume: session.durableResume === true };
        });
        await capture('hardware', async () => {
          const hardware = await this.manager.engines.hardware.runAcceptanceSuite();
          if (!hardware.ready) issues.push(issue('hardware-limited', 'medium', 'Hardware acceptance suite is limited on this device.'));
          return hardware;
        });
        await capture('cancel-restart', async () => this.manager.runCancelRestartSelfTest());
      }

      if (mode === 'stress') {
        await capture('stress-device-suite', async () => this.manager.deviceTest.run({ autoInstallModels: false, onProgress: stage => onProgress?.(`stress:${stage}`) }));
      }

      await capture('startup-safety', async () => {
        const startup = this.manager.startupSafety || { safeMode: false, failures: 0, reason: null };
        const state = this.manager.crashLoopGuard?.snapshot?.() || null;
        if (startup.safeMode) issues.push(issue('startup-safe-mode', 'medium', 'Crash-loop Safe Mode is active; automatic heavy background model provisioning is suspended for this recovery boot.'));
        return { ...startup, state };
      });

      await capture('runtime-fault-ledger', async () => {
        const snapshot = this.manager.faultLedger?.snapshot?.({ recentLimit: 24 }) || { totalEvents: 0, activeGroups: 0, errorGroups: 0, groups: [], recent: [] };
        if (snapshot.errorGroups > 0) issues.push(issue('runtime-fault-history', 'medium', `Runtime fault ledger contains ${snapshot.errorGroups} active error group(s); inspect the grouped evidence before release.`));
        return snapshot;
      });

      const failCount = Object.values(checks).filter(v => v.status === 'FAIL').length;
      const severe = issues.filter(v => v.severity === 'high').length;
      const verdict = failCount || severe ? 'ATTENTION' : issues.length ? 'GOOD_WITH_NOTES' : 'HEALTHY';
      const report = {
        version: 2, mode, testedAt: nowIso(), elapsedMs: performance.now() - startedAt,
        verdict, checks, issues,
        healthScore: healthScore(checks, issues),
        componentHealth: componentScores(checks, issues),
        devicePassport: this.manager.performancePassport?.snapshot?.() || null,
        runtimeFaults: this.manager.faultLedger?.snapshot?.({ recentLimit: 24 }) || null,
        safeRepairCount: issues.filter(v => v.repair).length,
        note: 'BARSA Doctor repairs are allow-listed, transactional, post-verified, and never change final-render quality or delete a verified model automatically.',
      };
      this.lastReport = report;
      this._persistReport(report);
      return report;
    } finally {
      this.running = false;
    }
  }

  async _checkModels({ issues, deep = false, onProgress = null }) {
    const rows = [];
    for (const [engineKey, registry] of MODEL_SPECS) {
      const engine = this.manager.engines[engineKey];
      if (!engine) continue;
      for (const [modelId, config] of Object.entries(registry || {})) {
        onProgress?.(`model:${modelId}`);
        const status = await this.manager.engines.models.getDetailedStatus(modelId, config).catch(error => ({ state: 'error', lastError: safeError(error) }));
        const row = { modelId, engine: engineKey, installed: !!status.installed, verified: !!status.verified, testPassed: !!status.testPassed, state: status.state || null, provider: status.executionProvider || null };
        if (status.installed && !status.verified) issues.push(issue(`model-unverified:${modelId}`, 'medium', `${modelId}: installed but SHA/size verification is not valid.`, `reverify-model:${engineKey}:${modelId}`));
        if (status.verified && !status.testPassed) issues.push(issue(`model-untested:${modelId}`, 'medium', `${modelId}: file verified but inference self-test has not passed.`, `retest-model:${engineKey}:${modelId}`));
        if (status.state === 'error') issues.push(issue(`model-error:${modelId}`, 'medium', `${modelId}: ${status.lastError || 'model error'}`, `reverify-model:${engineKey}:${modelId}`));
        if (deep && status.installed && status.verified && typeof engine.runSelfTest === 'function') {
          try {
            const test = await engine.runSelfTest(modelId);
            row.liveSelfTest = 'PASS';
            row.selfTest = test;
          } catch (error) {
            row.liveSelfTest = 'FAIL';
            row.selfTestError = safeError(error);
            issues.push(issue(`model-runtime:${modelId}`, 'high', `${modelId}: live inference failed: ${safeError(error)}`, `reverify-model:${engineKey}:${modelId}`));
          }
        }
        rows.push(row);
      }
    }
    return rows;
  }

  async repairSafe(report = this.lastReport, { onProgress = null } = {}) {
    if (!report) throw new Error('Run BARSA Doctor before repair');
    if (this.manager.activeJobId) throw new Error('Finish or cancel the active render before repair');
    const repairs = [];
    const unique = [...new Set((report.issues || []).map(v => v.repair).filter(Boolean))];
    for (const action of unique) {
      onProgress?.(action);
      const gate = this._repairGate(action);
      if (!gate.allowed) {
        repairs.push({ action, status: 'QUARANTINED', error: gate.reason, verified: false });
        continue;
      }
      try {
        if (action === 'storage-safe-clean') {
          await this.manager.engines.storage.pruneTerminalSessions({ keepCompleted: 0 });
          await this.manager.engines.storage.reconcileStageCacheIndex();
          await this.manager.engines.storage.enforceStageCacheBudget();
          const verified = await this._verifyRepair(action);
          this._recordRepairAttempt(action, verified);
          repairs.push({ action, status: verified ? 'FIXED' : 'FAILED', verified, error: verified ? null : 'Post-repair verification failed' });
          continue;
        }
        if (action === 'release-ai-memory') {
          await this._releaseAiMemory();
          const verified = await this._verifyRepair(action);
          this._recordRepairAttempt(action, verified);
          repairs.push({ action, status: verified ? 'FIXED' : 'FAILED', verified, error: verified ? null : 'Post-repair memory pressure is still above the safe threshold' });
          continue;
        }
        if (action.startsWith('reverify-model:') || action.startsWith('retest-model:')) {
          const [, engineKey, modelId] = action.split(':');
          const engine = this.manager.engines[engineKey];
          const config = this._modelConfig(modelId);
          if (!engine || !config) throw new Error('Model engine/config not found');
          await this.manager.engines.models.verifyStoredModel(modelId, config);
          if (typeof engine.runSelfTest === 'function') await engine.runSelfTest(modelId);
          const verified = await this._verifyRepair(action);
          this._recordRepairAttempt(action, verified);
          repairs.push({ action, status: verified ? 'FIXED' : 'FAILED', verified, error: verified ? null : 'Post-repair verification failed' });
          continue;
        }
        repairs.push({ action, status: 'SKIPPED', error: 'Repair action is not allow-listed' });
      } catch (error) {
        this._recordRepairAttempt(action, false);
        this.manager.performancePassport?.noteFailure?.('doctor-repair', action);
        repairs.push({ action, status: 'FAILED', verified: false, error: safeError(error) });
      }
    }
    return { repairedAt: nowIso(), repairs, fixed: repairs.filter(v => v.status === 'FIXED').length, failed: repairs.filter(v => v.status === 'FAILED').length, quarantined: repairs.filter(v => v.status === 'QUARANTINED').length };
  }

  _persistReport(report) {
    try {
      globalThis.localStorage?.setItem?.('barsa-doctor-last-report-v2', JSON.stringify(report));
      const history = JSON.parse(globalThis.localStorage?.getItem?.(this.historyKey) || '[]');
      history.push({ testedAt: report.testedAt, mode: report.mode, verdict: report.verdict, healthScore: report.healthScore, componentHealth: report.componentHealth });
      globalThis.localStorage?.setItem?.(this.historyKey, JSON.stringify(history.slice(-30)));
    } catch {}
  }

  _repairGate(action) {
    try {
      const state = JSON.parse(globalThis.localStorage?.getItem?.(this.repairStateKey) || '{}');
      const row = state[action];
      if (!row) return { allowed: true };
      const recentFailures = (row.failures || []).filter(ts => Date.now() - ts < 60 * 60 * 1000);
      if (recentFailures.length >= 3) return { allowed: false, reason: 'Repair quarantined after 3 failed verified attempts within one hour' };
      if (row.lastSuccess && Date.now() - row.lastSuccess < 15_000) return { allowed: false, reason: 'Repair cooldown active; avoiding a repair loop' };
    } catch {}
    return { allowed: true };
  }

  _recordRepairAttempt(action, success) {
    try {
      const state = JSON.parse(globalThis.localStorage?.getItem?.(this.repairStateKey) || '{}');
      const row = state[action] ||= { failures: [], lastSuccess: 0 };
      if (success) { row.lastSuccess = Date.now(); row.failures = []; }
      else row.failures = [...(row.failures || []).filter(ts => Date.now() - ts < 60 * 60 * 1000), Date.now()].slice(-6);
      globalThis.localStorage?.setItem?.(this.repairStateKey, JSON.stringify(state));
    } catch {}
  }

  async _verifyRepair(action) {
    if (action === 'storage-safe-clean') {
      const usage = await this.manager.engines.storage.getStorageUsage().catch(() => null);
      return !!usage && Number(usage.usageBytes || 0) <= Number(usage.quotaBytes || Infinity);
    }
    if (action === 'release-ai-memory') {
      const perf = this.manager.engines.performance;
      const deadline = performance.now() + 4000;
      while (performance.now() < deadline) {
        await perf.sample?.().catch(() => {});
        const telemetry = perf.telemetry || {};
        const pressure = String(telemetry.pressureState || perf._pressureState || 'normal');
        const ratio = pressureRatio(telemetry);
        if (pressure !== 'critical' && pressure !== 'high' && ratio < 0.75) return true;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      return false;
    }
    if (action.startsWith('reverify-model:') || action.startsWith('retest-model:')) {
      const [, , modelId] = action.split(':');
      const config = this._modelConfig(modelId);
      const status = await this.manager.engines.models.getDetailedStatus(modelId, config).catch(() => null);
      return !!status?.installed && !!status?.verified && !!status?.testPassed;
    }
    return false;
  }

  _modelConfig(modelId) {
    for (const [, registry] of MODEL_SPECS) if (registry?.[modelId]) return registry[modelId];
    return null;
  }

  async _releaseAiMemory() {
    const engines = this.manager.engines;
    for (const key of ['upscale', 'rife', 'face', 'faceDetector']) {
      const engine = engines[key];
      if (!engine) continue;
      if (typeof engine.releaseMemory === 'function') await engine.releaseMemory();
      else if (typeof engine.destroy === 'function') await engine.destroy();
      else if (typeof engine.dispose === 'function') await engine.dispose();
      else if (typeof engine.releaseAll === 'function') await engine.releaseAll();
    }
  }
}
