import { CircuitBreaker, defaultRetryable, retryTransient, withTimeout } from './OperationGuard.js';

export class ModelAutoProvisioner {
  constructor({ onProgress = null, installTimeoutMs = 180_000 } = {}) {
    this.onProgress = onProgress;
    this.installTimeoutMs = Math.max(30_000, Number(installTimeoutMs) || 180_000);
    this.breakers = new Map();
  }

  async ensure({ role, modelId, engine, registry, allowFallback = true, retries = 3, signal = null }) {
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
      const breaker = this._breaker(`${role}:${modelId}`);
      try {
        const installed = await breaker.execute(() => retryTransient(async ({ attempt }) => {
          const attemptNo = attempt + 1;
          this.onProgress?.({ role, modelId, stage: 'installing', attempt: attemptNo, attempts });
          try {
            await withTimeout(
              installSignal => engine.installCatalogModel(
                modelId,
                progress => this.onProgress?.({ role, modelId, attempt: attemptNo, attempts, ...progress }),
                { signal: installSignal },
              ),
              { timeoutMs: this.installTimeoutMs, label: `model-install:${modelId}`, signal },
            );
            const checked = await engine.isAvailable(modelId);
            if (checked?.available) return { ready: true, modelId, changed: false, installed: true, attempt: attemptNo };
            const error = new Error(`${modelId} installed but did not become runtime-ready`);
            error.code = 'MODEL_RUNTIME_NOT_READY';
            throw error;
          } catch (error) {
            installError = error;
            if (attemptNo < attempts && defaultRetryable(error)) {
              this.onProgress?.({ role, modelId, stage: 'retry-wait', attempt: attemptNo, attempts, error });
            }
            throw error;
          }
        }, {
          attempts,
          baseDelayMs: 700,
          maxDelayMs: 6000,
          jitterMs: 180,
          signal,
          isRetryable: isModelProvisionRetryable,
        }));
        if (installed?.ready) return installed;
      } catch (error) {
        installError = error;
      }
    }

    if (allowFallback && typeof engine.resolveWorkingModel === 'function') {
      this.onProgress?.({ role, modelId, stage: 'fallback' });
      try {
        const fallbackId = await withTimeout(
          fallbackSignal => engine.resolveWorkingModel(progress => this.onProgress?.({ role, requestedModelId: modelId, ...progress }), { signal: fallbackSignal }),
          { timeoutMs: this.installTimeoutMs, label: `model-fallback:${modelId}`, signal },
        );
        if (fallbackId) {
          const checked = await engine.isAvailable(fallbackId);
          if (checked?.available) return { ready: true, modelId: fallbackId, changed: fallbackId !== modelId, installed: true };
        }
      } catch (error) {
        installError ||= error;
      }
    }

    const error = new Error(installError?.message || `No verified automatic model source succeeded for ${modelId}`);
    error.code = installError?.code === 'CIRCUIT_OPEN' ? 'CIRCUIT_OPEN' : 'MODEL_REQUIRED';
    error.role = role;
    error.modelId = modelId;
    error.recoverable = installError?.recoverable === true || error.code === 'CIRCUIT_OPEN';
    error.cause = installError || null;
    throw error;
  }

  _breaker(key) {
    let breaker = this.breakers.get(key);
    if (!breaker) {
      breaker = new CircuitBreaker({ failureThreshold: 3, cooldownMs: 30_000 });
      this.breakers.set(key, breaker);
    }
    return breaker;
  }
}

function isModelProvisionRetryable(error) {
  if (!error) return false;
  if ([
    'MODEL_SOURCE_UNVERIFIED',
    'MODEL_SHA_MISMATCH',
    'MODEL_INVALID',
    'MODEL_RUNTIME_NOT_READY',
    'UNSUPPORTED_CODEC',
  ].includes(error.code)) return false;
  return defaultRetryable(error) || error?.name === 'TimeoutError';
}
