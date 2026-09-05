const DB_NAME = 'video-toolkit-pro-nihui';
const STORE_NAME = 'packs';
const DIRECTORY_NAME = 'ncnn-models';
const MAX_NCNN_PACK_BYTES = 512 * 1024 * 1024;
const MIN_STORAGE_RESERVE_BYTES = 256 * 1024 * 1024;

/**
 * Imports and validates Nihui/NCNN model pairs without pretending that a
 * native Vulkan executable can run inside a browser. The pair is persisted
 * in OPFS for conversion, export, or a future NCNN-WASM runtime.
 */
export class NihuiModelBridge {
  constructor() {
    this.db = null;
    this.root = null;
  }

  async importPack({ role, files, name = null, onProgress = null }) {
    const list = Array.from(files || []);
    const param = list.find((file) => /\.param$/i.test(file.name));
    const weights = list.find((file) => /\.bin$/i.test(file.name));
    if (!param || !weights) throw new Error('اختر ملفي NCNN معاً: model.param و model.bin');
    if (!weights.size) throw new Error('ملف أوزان NCNN فارغ');
    const total = param.size + weights.size;
    if (total > MAX_NCNN_PACK_BYTES) throw new Error('حزمة NCNN تتجاوز حد الأمان 512 MB');
    await ensureStorageCapacity(total);
    const inspection = inspectNcnnParam(await param.text());
    if (!inspection.valid) throw new Error(`ملف NCNN param غير صالح: ${inspection.reason}`);

    const id = `${sanitize(role || 'custom')}-${crypto.randomUUID().slice(0, 8)}`;
    const directory = await (await this._directory()).getDirectoryHandle(id, { create: true });
    let written = 0;
    const paramFile = sanitizeFileName(param.name);
    const weightsFile = sanitizeFileName(weights.name);
    try {
      for (const file of [param, weights]) {
        const targetName = file === param ? paramFile : weightsFile;
        await streamToFile(directory, targetName, file, (bytes) => {
          written += bytes;
          onProgress?.({ received: written, total, pct: written / total });
        });
      }
    } catch (error) {
      await (await this._directory()).removeEntry(id, { recursive: true }).catch(() => {});
      throw error;
    }

    const metadata = {
      id,
      name: name || param.name.replace(/\.param$/i, ''),
      role: role || 'custom',
      format: 'ncnn',
      paramFile,
      weightsFile,
      sizeBytes: total,
      layerCount: inspection.layerCount,
      blobCount: inspection.blobCount,
      importedAt: Date.now(),
      execution: 'stored-only',
      compatibility: 'requires-onnx-conversion-or-ncnn-wasm',
      sourceFamily: 'nihui-ncnn-vulkan',
    };
    try {
      await this._put(metadata);
      return metadata;
    } catch (error) {
      // Metadata is the commit point. Never leave a large unreferenced pack
      // behind if IndexedDB fails after OPFS writes completed.
      await (await this._directory()).removeEntry(id, { recursive: true }).catch(() => {});
      throw error;
    }
  }

  async listPacks() {
    const db = await this._openDB();
    return requestResult(db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll());
  }

  async deletePack(id) {
    await (await this._directory()).removeEntry(id, { recursive: true }).catch(() => {});
    const db = await this._openDB();
    await transactionDone(db, (store) => store.delete(id));
  }

  compatibilityReport() {
    return {
      nativeNihuiVulkanInBrowser: false,
      ncnnPairImport: true,
      executionPath: 'ONNX Runtime Web (WebGPU, then WASM fallback)',
      reason: 'Nihui releases are native NCNN/Vulkan executables; browsers expose WebGPU rather than native Vulkan process execution.',
    };
  }

  async _directory() {
    if (!this.root) {
      if (!navigator.storage?.getDirectory) throw new Error('OPFS غير متاح لحفظ حزم NCNN');
      this.root = await navigator.storage.getDirectory();
    }
    return this.root.getDirectoryHandle(DIRECTORY_NAME, { create: true });
  }

  async _openDB() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.db;
  }

  async _put(metadata) {
    const db = await this._openDB();
    await transactionDone(db, (store) => store.put(metadata));
  }

  close() {
    this.db?.close();
    this.db = null;
  }
}

/** Validates the text header used by NCNN param files. */
export function inspectNcnnParam(text) {
  const lines = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== '7767517') return { valid: false, reason: 'magic 7767517 غير موجود' };
  const counts = lines[1]?.split(/\s+/).map(Number);
  if (!counts || counts.length < 2 || !counts.every(Number.isFinite)) return { valid: false, reason: 'عدادات الطبقات غير صحيحة' };
  const [layerCount, blobCount] = counts;
  if (layerCount < 1 || blobCount < 1 || lines.length < layerCount + 2) return { valid: false, reason: 'ملف param ناقص' };
  return { valid: true, layerCount, blobCount };
}

async function streamToFile(directory, name, blob, onChunk) {
  const safeName = sanitizeFileName(name);
  const handle = await directory.getFileHandle(safeName, { create: true });
  const writable = await handle.createWritable();
  const reader = blob.stream().getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      await writable.write(value);
      onChunk(value.byteLength);
    }
    await writable.close();
  } catch (error) {
    await reader.cancel(error).catch(() => {});
    await writable.abort(error).catch(() => {});
    await directory.removeEntry(safeName).catch(() => {});
    throw error;
  } finally {
    reader.releaseLock?.();
  }
}

function transactionDone(db, mutate) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    mutate(tx.objectStore(STORE_NAME));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function sanitize(value) {
  return String(value).replace(/[^a-z0-9_-]/gi, '-').replace(/-+/g, '-').slice(0, 48);
}

function sanitizeFileName(value) {
  return String(value).replace(/[^a-z0-9_.-]/gi, '-').slice(-120);
}

async function ensureStorageCapacity(requiredBytes) {
  if (!navigator.storage?.estimate) return;
  const estimate = await navigator.storage.estimate().catch(() => null);
  if (!estimate?.quota) return;
  const free = Math.max(0, estimate.quota - (estimate.usage || 0));
  if (free < requiredBytes + MIN_STORAGE_RESERVE_BYTES) {
    const error = new Error('مساحة التخزين غير كافية لاستيراد حزمة NCNN بأمان');
    error.code = 'INSUFFICIENT_STORAGE';
    throw error;
  }
}
