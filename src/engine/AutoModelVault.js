import { evaluateExtendedModelDownload, connectionSnapshot } from './AutoModelPolicy.js';
export const AUTO_MODEL_PLAN = Object.freeze([
  { role: 'upscale', modelId: 'realesr-general-x4v3-turbo', priority: 'core', label: 'Real-ESRGAN Turbo ×4' },
  { role: 'upscale', modelId: 'onnx-model-zoo-sr-x3', priority: 'core', label: 'Mobile SR ×3' },
  { role: 'rife', modelId: 'rife-tensorstack', priority: 'core', label: 'RIFE 4.9' },
  { role: 'faceDetector', modelId: 'yunet-2026may', priority: 'core', label: 'YuNet 2026 Face Detector' },
  { role: 'upscale', modelId: 'real-esrgan-x4plus', priority: 'extended', label: 'Real-ESRGAN ×4' },
  { role: 'rife', modelId: 'rife47-emmajohnson311', priority: 'extended', label: 'RIFE 4.7' },
  { role: 'face', modelId: 'gfpgan-1.4', priority: 'extended', label: 'GFPGAN 1.4' },
  { role: 'face', modelId: 'codeformer', priority: 'extended', label: 'CodeFormer' },
]);

/**
 * Sequential model provisioning for mobile devices.
 * Large sessions are never loaded together; every model must pass the engine's
 * real runtime self-test before this vault reports it as ready.
 */
export class AutoModelVault {
  constructor({ manager, provisioner, registries, onProgress = null } = {}) {
    this.manager = manager;
    this.provisioner = provisioner;
    this.registries = registries || {};
    this.onProgress = onProgress;
    this.running = null;
  }

  async ensureCore({ includeFace = false, includeAllCatalog = false, forceExtended = false } = {}) {
    if (this.running) return this.running;
    this.running = this._run({ includeFace, includeAllCatalog, forceExtended }).finally(() => { this.running = null; });
    return this.running;
  }

  async _run({ includeFace, includeAllCatalog = false, forceExtended = false }) {
    let plan = AUTO_MODEL_PLAN.filter((item) => item.priority === 'core' || includeAllCatalog || (includeFace && item.role === 'face' && item.modelId === 'gfpgan-1.4'));
    const storage = await this.manager.engines.models?.getStorageUsage?.().catch?.(() => null) || null;
    const connection = connectionSnapshot();
    const allowed = [];
    for (const item of plan) {
      if (item.priority === 'core' || forceExtended) { allowed.push(item); continue; }
      const registry = item.role === 'faceDetector' ? null : this.registries?.[item.role];
      const config = registry?.[item.modelId] || {};
      const policy = evaluateExtendedModelDownload({ expectedSizeBytes: config.expectedSizeBytes || 0, storage, connection, force: false });
      if (policy.allowed) allowed.push(item);
      else this.onProgress?.({ stage: 'model-deferred', ...item, reason: policy.reason });
    }
    plan = allowed;
    const results = [];
    for (let index = 0; index < plan.length; index++) {
      const item = plan[index];
      this.onProgress?.({ stage: 'model-start', index, total: plan.length, ...item });
      try {
        const result = await this._ensureItem(item);
        results.push({ ...item, ok: true, ...result });
        this.onProgress?.({ stage: 'model-ready', index, total: plan.length, ...item });
      } catch (error) {
        results.push({ ...item, ok: false, error: error?.message || String(error) });
        this.onProgress?.({ stage: 'model-error', index, total: plan.length, error, ...item });
      }
      // Release transient inference sessions between large model validations.
      await this._releaseTransient(item.role);
    }
    return {
      ok: results.every((item) => item.ok),
      ready: results.filter((item) => item.ok).length,
      total: results.length,
      results,
    };
  }

  async _ensureItem(item) {
    if (item.role === 'faceDetector') {
      const engine = this.manager.engines.faceDetector;
      const status = await engine.isAvailable(item.modelId);
      if (status.available) return { changed: false, modelId: item.modelId };
      let working = null;
      if (typeof engine.resolveWorkingModel === 'function') {
        working = await engine.resolveWorkingModel({
          install: true,
          onProgress: (progress) => this.onProgress?.({ ...item, stage: 'download', ...progress }),
        });
      } else {
        await engine.installCatalogModel(item.modelId, (progress) => this.onProgress?.({ ...item, stage: 'download', ...progress }));
        working = item.modelId;
      }
      if (!working) throw new Error(`${item.label} and its audited fallback did not pass runtime verification`);
      const checked = await engine.isAvailable(working);
      if (!checked.available) throw new Error(`${working} did not pass runtime verification`);
      return { changed: true, modelId: working, fallbackUsed: working !== item.modelId };
    }

    const engine = this.manager.engines[item.role];
    const registry = this.registries[item.role];
    return this.provisioner.ensure({
      role: item.role,
      modelId: item.modelId,
      engine,
      registry,
      allowFallback: item.role !== 'face',
    });
  }

  async _releaseTransient(role) {
    if (role === 'upscale') this.manager.engines.upscale?.destroy?.();
    if (role === 'rife') this.manager.engines.rife?.destroy?.();
    if (role === 'face') this.manager.engines.face?.destroy?.();
    if (role === 'faceDetector') this.manager.engines.faceDetector?.destroy?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}
