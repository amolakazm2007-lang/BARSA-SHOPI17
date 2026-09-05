import { evaluateExtendedModelDownload, connectionSnapshot } from './AutoModelPolicy.js';
export const AUTO_MODEL_PLAN = Object.freeze([
  { role: 'upscale', modelId: 'realesr-general-x4v3-turbo', priority: 'core', label: 'Real-ESRGAN Turbo ×4' },
  { role: 'upscale', modelId: 'onnx-model-zoo-sr-x3', priority: 'core', label: 'Mobile SR ×3' },
  // The old TensorStack-first candidate can answer 401. Explicit core
  // provisioning therefore starts with the independently mirrored 4.7 export.
  // Users can still manually install any audited RIFE catalog entry.
  { role: 'rife', modelId: 'rife47-emmajohnson311', priority: 'core', label: 'RIFE 4.7 public mirror' },
  { role: 'faceDetector', modelId: 'yunet-2026may', priority: 'core', label: 'YuNet 2026 Face Detector' },
  { role: 'upscale', modelId: 'real-esrgan-x4plus', priority: 'extended', label: 'Real-ESRGAN ×4' },
  { role: 'rife', modelId: 'rife-tensorstack', priority: 'extended', label: 'RIFE 4.9' },
  { role: 'face', modelId: 'gfpgan-1.4', priority: 'extended', label: 'GFPGAN 1.4' },
  { role: 'face', modelId: 'codeformer', priority: 'extended', label: 'CodeFormer' },
]);

/**
 * Sequential model provisioning for mobile devices.
 * Large sessions are never loaded together; every model must pass the engine's
 * real runtime self-test before this vault reports it as ready.
 *
 * SECURITY/STABILITY INVARIANT:
 * In an interactive browser/WebView, network provisioning is allowed only while
 * handling a real user activation. This is deliberately enforced here, at the
 * model-vault boundary, rather than only in UI code. It prevents boot, idle,
 * visibility, connectivity, or retry hooks from ever starting hidden multi-MB
 * model downloads. Node/non-DOM callers remain available for deterministic unit
 * tests and tooling. Manual local model import does not pass through this vault.
 */
export class AutoModelVault {
  constructor({ manager, provisioner, registries, onProgress = null } = {}) {
    this.manager = manager;
    this.provisioner = provisioner;
    this.registries = registries || {};
    this.onProgress = onProgress;
    this.running = null;
  }

  _interactiveProvisioningAllowed() {
    // No DOM means unit-test/tooling context, not a user-facing runtime.
    if (typeof globalThis.document === 'undefined') return true;
    const activation = globalThis.navigator?.userActivation;
    // Fail closed in browsers that expose no activation state: model downloads
    // remain available through the explicit per-model install/import controls.
    return activation?.isActive === true;
  }

  async ensureCore({ includeFace = false, includeAllCatalog = false, forceExtended = false } = {}) {
    if (!this._interactiveProvisioningAllowed()) {
      const result = {
        ok: true,
        ready: 0,
        total: 0,
        results: [],
        deferred: true,
        reason: 'user-action-required',
      };
      this.onProgress?.({ stage: 'model-deferred', reason: result.reason, label: 'AI models' });
      return result;
    }
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
      await cooperativeUiYield();
      try {
        const result = await this._ensureItem(item);
        results.push({ ...item, ok: true, ...result });
        this.onProgress?.({ stage: 'model-ready', index, total: plan.length, ...item });
      } catch (error) {
        results.push({ ...item, ok: false, error: error?.message || String(error) });
        this.onProgress?.({ stage: 'model-error', index, total: plan.length, error, ...item });
      }
      await this._releaseTransient(item.role);
      await cooperativeUiYield({ paint: true });
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
    await cooperativeUiYield();
  }
}

/**
 * Give input, layout and paint a chance to run between heavyweight model jobs.
 * scheduler.yield() is used when available; all Android WebView/Chromium builds
 * retain a zero-delay fallback. `paint` additionally waits for one frame in a
 * visible document. This only changes scheduling, never model/output quality.
 */
export async function cooperativeUiYield({ paint = false } = {}) {
  if (globalThis.scheduler?.yield) {
    await globalThis.scheduler.yield();
  } else {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (paint && typeof globalThis.requestAnimationFrame === 'function' && globalThis.document?.visibilityState !== 'hidden') {
    await new Promise((resolve) => globalThis.requestAnimationFrame(() => resolve()));
  }
}
