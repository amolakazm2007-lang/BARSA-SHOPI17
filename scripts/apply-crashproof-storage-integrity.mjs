import { readFileSync, writeFileSync } from 'node:fs';

const file = 'src/engine/StorageManager.js';
let source = readFileSync(file, 'utf8');
const signature = '  async verifySessionIntegrity(sessionId) {';
if (source.includes(signature)) {
  console.log('StorageManager crash-proof integrity method already applied.');
  process.exit(0);
}
const anchor = `  async _writeCheckpoint(sessionId, record) {\n    const db = await this._openDB();\n    return new Promise((resolve, reject) => {\n      const tx = db.transaction(CHECKPOINT_STORE, 'readwrite');\n      tx.objectStore(CHECKPOINT_STORE).put(record);\n      tx.oncomplete = resolve;\n      tx.onerror = () => reject(tx.error);\n    });\n  }\n`;
const count = source.split(anchor).length - 1;
if (count !== 1) throw new Error(`Expected one StorageManager checkpoint anchor, found ${count}`);
const method = `${anchor}\n  /** Verify that the durable OPFS stream still matches the active checkpoint. */\n  async verifySessionIntegrity(sessionId) {\n    const checkpoint = await this.getCheckpoint(sessionId);\n    if (!checkpoint?.fileName) return { ok: false, reason: 'checkpoint-or-file-missing', sessionId };\n    const expectedBytes = Math.max(0, Number(checkpoint.bytesWritten) || 0);\n    const expectedFrames = Math.max(0, Number(checkpoint.durableEncodedFrames ?? checkpoint.framesWritten) || 0);\n    try {\n      const root = await this._getRoot();\n      const file = await (await root.getFileHandle(checkpoint.fileName)).getFile();\n      const ok = file.size >= expectedBytes;\n      return { ok, sessionId, fileName: checkpoint.fileName, fileSize: file.size, expectedBytes, expectedFrames, reason: ok ? null : 'opfs-file-truncated' };\n    } catch (error) {\n      console.error('[BARSA][storage][integrity-check-failed]', { sessionId, error });\n      return { ok: false, sessionId, expectedBytes, expectedFrames, reason: 'opfs-file-unavailable', error: error?.message || String(error) };\n    }\n  }\n`;
source = source.replace(anchor, method);
writeFileSync(file, source);
console.log('StorageManager periodic OPFS integrity verification applied.');
