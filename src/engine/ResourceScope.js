function safeDispose(resource) {
  if (!resource) return undefined;
  if (typeof resource.close === 'function') return resource.close();
  if (typeof resource.destroy === 'function') return resource.destroy();
  if (typeof resource.release === 'function') return resource.release();
  if (typeof resource.dispose === 'function') return resource.dispose();
  return undefined;
}

function makeReleaseError(label, errors) {
  const error = new AggregateError(errors, `ResourceScope ${label} failed to release ${errors.length} resource(s)`);
  error.code = 'RESOURCE_RELEASE_FAILED';
  error.recoverable = true;
  return error;
}

/**
 * Deterministic ownership boundary for transient render resources.
 *
 * ResourceScope owns every tracked resource exactly once. A resource leaves the
 * scope only after a successful explicit release or when close() disposes the
 * remaining set in reverse ownership order. Cleanup failures are surfaced via
 * onFault and aggregated; they are never silently swallowed.
 */
export class ResourceScope {
  constructor(label = 'render-scope', { onFault = null } = {}) {
    this.label = label;
    this.resources = new Set();
    this.closed = false;
    this.onFault = typeof onFault === 'function' ? onFault : null;
  }

  _report(error, phase, resource = null) {
    try {
      this.onFault?.({
        code: 'RESOURCE_RELEASE_FAILED',
        subsystem: 'lifecycle',
        severity: 'warning',
        recoverable: true,
        message: error?.message || 'Resource cleanup failed',
        error,
        details: { scope: this.label, phase, resourceType: resource?.constructor?.name || typeof resource },
      });
    } catch {
      // Reporting telemetry must never replace the original cleanup failure.
    }
  }

  track(resource) {
    if (!resource) return resource;
    if (this.closed) {
      try {
        const result = safeDispose(resource);
        if (result && typeof result.then === 'function') {
          result.catch((error) => this._report(error, 'track-after-close', resource));
        }
      } catch (error) {
        this._report(error, 'track-after-close', resource);
      }
      const error = new Error(`ResourceScope ${this.label} is already closed`);
      error.code = 'RESOURCE_SCOPE_CLOSED';
      throw error;
    }
    this.resources.add(resource);
    return resource;
  }

  release(resource) {
    if (!resource || !this.resources.delete(resource)) return false;
    try {
      const result = safeDispose(resource);
      if (result && typeof result.then === 'function') {
        result.catch((error) => this._report(error, 'release-async', resource));
      }
    } catch (error) {
      this._report(error, 'release', resource);
      throw error;
    }
    return true;
  }

  async releaseAsync(resource) {
    if (!resource || !this.resources.delete(resource)) return false;
    try {
      await safeDispose(resource);
      return true;
    } catch (error) {
      this._report(error, 'release-async', resource);
      throw error;
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    const resources = [...this.resources].reverse();
    this.resources.clear();
    const failures = [];
    for (const resource of resources) {
      try {
        await safeDispose(resource);
      } catch (error) {
        failures.push(error);
        this._report(error, 'close', resource);
      }
    }
    if (failures.length) throw makeReleaseError(this.label, failures);
  }

  get size() { return this.resources.size; }
}

export async function usingResourceScope(label, callback, options = {}) {
  const scope = new ResourceScope(label, options);
  let primaryError = null;
  try {
    return await callback(scope);
  } catch (error) {
    primaryError = error;
    throw error;
  } finally {
    try {
      await scope.close();
    } catch (cleanupError) {
      if (primaryError) primaryError.cleanupError = cleanupError;
      else throw cleanupError;
    }
  }
}
