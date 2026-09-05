export class ModelAutoProvisioner {
  constructor({ onProgress = null } = {}) {
    this.onProgress = onProgress;
  }

  async ensure({ role, modelId, engine, registry, allowFallback = true, retries = 3 }) {
    if (!modelId) return { ready: true, modelId: null, changed: false };
    if (!engine?.isAvailable) throw new Error(`Missing model engine for ${role}`);
    const current = await engine.isAvailable(modelId);
    if (current?.available) return { ready: true, modelId, changed: false };

    const config = registry?.[modelId] || {};
    const hasRemoteSource = Boolean(config.remoteURL || config.downloadCandidates?.length);
    const hasBundledSource = Boolean(config.bundledURL);
    if ((hasRemoteSource || hasBundledSource) && !/^[a-f0-9]{64}$/i.test(String(config.sha256 || ''))) {
      const integrityError = new Error(`Automatic install is blocked for ${modelId}: missing pinned SHA-256`);
      integrityError.code = 'MODEL_SOURCE_UNVERIFIED';
      throw integrityError;
    }
    const installable = hasBundledSource || hasRemoteSource;
    let installError = null;
    if (installable && typeof engine.installCatalogModel === 'function') {
      const attempts = Math.max(1, Math.min(4, Number(retries) || 1));
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          this.onProgress?.({ role, modelId, stage: 'installing', attempt, attempts });
          await engine.installCatalogModel(modelId, (progress) => this.onProgress?.({ role, modelId, attempt, attempts, ...progress }));
          const checked = await engine.isAvailable(modelId);
          if (checked?.available) return { ready: true, modelId, changed: false, installed: true, attempt };
          installError = new Error(`${modelId} installed but did not become runtime-ready`);
        } catch (error) {
          installError = error;
        }
        if (attempt < attempts) {
          this.onProgress?.({ role, modelId, stage: 'retry-wait', attempt, attempts, error: installError });
          await waitForRetry(attempt);
        }
      }
    }

    if (allowFallback && typeof engine.resolveWorkingModel === 'function') {
      this.onProgress?.({ role, modelId, stage: 'fallback' });
      const fallbackId = await engine.resolveWorkingModel((progress) => this.onProgress?.({ role, requestedModelId: modelId, ...progress }));
      if (fallbackId) {
        const checked = await engine.isAvailable(fallbackId);
        if (checked?.available) return { ready: true, modelId: fallbackId, changed: fallbackId !== modelId, installed: true };
      }
    }

    const error = new Error(installError?.message || `No verified automatic model source succeeded for ${modelId}`);
    error.code = 'MODEL_REQUIRED';
    error.role = role;
    error.modelId = modelId;
    throw error;
  }
}

async function waitForRetry(attempt) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => { if (settled) return; settled = true; clearTimeout(timer); globalThis.removeEventListener?.('online', onOnline); resolve(); };
      const onOnline = () => finish();
      const timer = setTimeout(finish, 8000);
      globalThis.addEventListener?.('online', onOnline, { once: true });
    });
  } else {
    await delay(Math.min(6000, 700 * (2 ** Math.max(0, attempt - 1))));
  }
}
function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
