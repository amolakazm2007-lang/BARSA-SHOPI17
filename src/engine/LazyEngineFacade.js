const SYNC_CLEANUP_METHODS = new Set(['destroy', 'dispose', 'release', 'releaseAll', 'releaseMemory', 'terminate', 'close', 'resetTracking']);
const SYNC_PROPERTY_NAMES = new Set(['lastExecutionProvider', 'executionProvider', 'graphCaptureEnabled', 'tensorPool', 'loaded', 'coreMode']);

/**
 * True module-lazy facade for heavy engines.
 * - loader() is not called until an async engine operation is requested.
 * - concurrent first calls share one load promise.
 * - synchronous configuration setters are remembered and replayed after load.
 * - cleanup is a no-op when the engine was never loaded.
 * - EventTarget listeners registered before load are replayed onto the real engine.
 */
export function createModuleLazyEngine(name, loader, { faultReporter = null } = {}) {
  if (typeof loader !== 'function') throw new TypeError(`Lazy engine ${name} requires a loader`);
  let instance = null;
  let loading = null;
  const syncCalls = new Map();
  const listeners = [];

  const report = (code, error, details = {}) => {
    faultReporter?.warning?.(code, {
      subsystem: 'runtime',
      recoverable: error?.recoverable !== false,
      error,
      source: `LazyEngineFacade:${name}`,
      engine: name,
      ...details,
    });
  };

  const replayState = (engine) => {
    for (const [method, args] of syncCalls) {
      if (typeof engine?.[method] === 'function') engine[method](...args);
    }
    for (const { type, listener, options } of listeners) engine?.addEventListener?.(type, listener, options);
  };

  const ensure = async () => {
    if (instance) return instance;
    if (loading) return loading;
    loading = Promise.resolve()
      .then(loader)
      .then((engine) => {
        if (!engine) throw new Error(`Lazy engine ${name} loader returned no instance`);
        instance = engine;
        replayState(engine);
        return engine;
      })
      .catch((error) => {
        report('LAZY_ENGINE_LOAD_FAILED', error);
        throw error;
      })
      .finally(() => { loading = null; });
    return loading;
  };

  const facade = new Proxy({}, {
    get(_target, property) {
      if (property === '__lazyEngineName') return name;
      if (property === 'isLoaded') return () => Boolean(instance);
      if (property === 'preload') return ensure;
      if (property === 'getLoadedInstance') return () => instance;
      if (property === 'setFaultReporter') return (nextReporter) => {
        faultReporter = nextReporter || null;
        instance?.setFaultReporter?.(faultReporter);
        return facade;
      };
      if (property === 'setExecutionPreference') return (...args) => {
        syncCalls.set('setExecutionPreference', args);
        instance?.setExecutionPreference?.(...args);
      };
      if (property === 'addEventListener') return (type, listener, options) => {
        if (instance) return instance.addEventListener?.(type, listener, options);
        listeners.push({ type, listener, options });
      };
      if (property === 'removeEventListener') return (type, listener, options) => {
        if (instance) return instance.removeEventListener?.(type, listener, options);
        const index = listeners.findIndex((entry) => entry.type === type && entry.listener === listener && entry.options === options);
        if (index >= 0) listeners.splice(index, 1);
      };
      if (SYNC_PROPERTY_NAMES.has(property)) return instance?.[property] ?? null;
      if (SYNC_CLEANUP_METHODS.has(property)) return (...args) => {
        if (!instance || typeof instance[property] !== 'function') return undefined;
        try { return instance[property](...args); }
        catch (error) { report('LAZY_ENGINE_CLEANUP_FAILED', error, { method: String(property) }); return undefined; }
      };
      if (typeof property === 'symbol') return undefined;
      return (...args) => ensure().then((engine) => {
        const method = engine?.[property];
        if (typeof method !== 'function') throw new TypeError(`Lazy engine ${name} has no method ${String(property)}`);
        return method.apply(engine, args);
      });
    },
    set(_target, property, value) {
      if (!instance) {
        syncCalls.set(`@property:${String(property)}`, [value]);
        return true;
      }
      instance[property] = value;
      return true;
    },
  });

  return facade;
}
