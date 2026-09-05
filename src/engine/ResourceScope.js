function safeDispose(resource) {
  if (!resource) return;
  if (typeof resource.close === 'function') return resource.close();
  if (typeof resource.destroy === 'function') return resource.destroy();
  if (typeof resource.release === 'function') return resource.release();
  if (typeof resource.dispose === 'function') return resource.dispose();
}

/**
 * Tracks transient frame/GPU/tensor resources and deterministically releases
 * them when a render stage completes, aborts, or fails. This reduces reliance
 * on garbage collection during long video jobs.
 */
export class ResourceScope {
  constructor(label = 'render-scope') {
    this.label = label;
    this.resources = new Set();
    this.closed = false;
  }

  track(resource) {
    if (!resource) return resource;
    if (this.closed) {
      try { safeDispose(resource); } catch {}
      throw new Error(`ResourceScope ${this.label} is already closed`);
    }
    this.resources.add(resource);
    return resource;
  }

  release(resource) {
    if (!resource || !this.resources.delete(resource)) return false;
    safeDispose(resource);
    return true;
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
      }
    }
    if (failures.length) {
      const error = new AggregateError(failures, `ResourceScope ${this.label} failed to release ${failures.length} resource(s)`);
      error.code = 'RESOURCE_RELEASE_FAILED';
      throw error;
    }
  }

  get size() { return this.resources.size; }
}

export async function usingResourceScope(label, callback) {
  const scope = new ResourceScope(label);
  try {
    return await callback(scope);
  } finally {
    await scope.close();
  }
}
