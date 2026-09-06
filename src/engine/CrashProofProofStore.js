const PREFIX = 'barsa-crashproof-proof:';

export class CrashProofProofStore {
  constructor({ storage = globalThis.localStorage, logger = console } = {}) {
    this.storage = storage;
    this.logger = logger;
    this.memory = new Map();
  }

  mark(name, details = null) {
    const record = { ok: true, at: new Date().toISOString(), details };
    this.memory.set(name, record);
    try { this.storage?.setItem?.(`${PREFIX}${name}`, JSON.stringify(record)); }
    catch (error) { this.logger.error?.('[BARSA][proof-store-write-failed]', name, error); }
    return record;
  }

  get(name) {
    if (this.memory.has(name)) return this.memory.get(name);
    try {
      const raw = this.storage?.getItem?.(`${PREFIX}${name}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      this.memory.set(name, parsed);
      return parsed;
    } catch (error) {
      this.logger.error?.('[BARSA][proof-store-read-failed]', name, error);
      return null;
    }
  }

  booleanMap(names) {
    return Object.fromEntries(names.map((name) => [name, this.get(name)?.ok === true]));
  }

  clear(name) {
    this.memory.delete(name);
    try { this.storage?.removeItem?.(`${PREFIX}${name}`); }
    catch (error) { this.logger.error?.('[BARSA][proof-store-clear-failed]', name, error); }
  }
}
