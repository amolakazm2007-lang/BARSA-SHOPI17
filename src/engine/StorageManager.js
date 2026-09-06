// StorageManager — real Origin Private File System (OPFS) streaming
// storage + IndexedDB checkpointing, for resumable rendering.
//
// Verified real in this project's sandbox (no network needed — OPFS and
// IndexedDB are both local browser APIs): navigator.storage.getDirectory()
// succeeds, FileSystemWritableFileStream.write()/close() succeed. See
// tests/StorageManager.test.mjs for the automated version of that check
// plus the full write/checkpoint/resume/corruption-recovery cycle.

const CHECKPOINT_DB = 'video-toolkit-pro-checkpoints';
const CHECKPOINT_STORE = 'sessions';
const SETTINGS_STORE = 'settings';
const OPFS_SESSION_PREFIX = 'render-session-';
const OPFS_FRAME_PREFIX = 'frames-';
const OPFS_SOURCE_PREFIX = 'source-';

const APPLY_STAGE_INDEX_KEY = 'apply-stage-index-v2';
const DEFAULT_STAGE_CACHE_MAX_BYTES = 4 * 1024 * 1024 * 1024;
const MIN_STAGE_CACHE_RESERVE_BYTES = 512 * 1024 * 1024;

export class StorageManager {
  constructor() {
    this.db = null;
    this.root = null;
    this.activeWriters = new Map(); // sessionId -> FileSystemWritableFileStream
    this.sessionMutationChains = new Map(); // serialize read-modify-write checkpoint mutations per session
  }

  async _openDB() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(CHECKPOINT_DB, 2);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(CHECKPOINT_STORE)) {
          req.result.createObjectStore(CHECKPOINT_STORE, { keyPath: 'sessionId' });
        }
        if (!req.result.objectStoreNames.contains(SETTINGS_STORE)) {
          req.result.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  async _getRoot() {
    if (this.root) return this.root;
    if (!('storage' in navigator) || !navigator.storage.getDirectory) {
      throw new Error('OPFS not available on this browser — StorageManager requires navigator.storage.getDirectory()');
    }
    this.root = await navigator.storage.getDirectory();
    return this.root;
  }

  /**
   * Begins a new render session: creates an OPFS file and opens a
   * writable stream for chunk-by-chunk frame dumping, and writes an
   * initial IndexedDB checkpoint record. Real, sequential OPFS writes
   * (one FileSystemWritableFileStream per session — OPFS does not allow
   * multiple concurrent writable streams on the same file, so this
   * project deliberately processes one render at a time, consistent with
   * the "one heavy job at a time" rule already used elsewhere).
   */
  async beginSession(sessionId, metadata) {
    if (!sessionId || typeof sessionId !== 'string') throw new TypeError('sessionId must be a non-empty string');
    if (this.activeWriters.has(sessionId)) throw new Error(`Render session \"${sessionId}\" already has an active writer`);
    await this.requestPersistence();
    const root = await this._getRoot();
    const fileName = `${OPFS_SESSION_PREFIX}${sessionId}.bin`;
    const fileHandle = await root.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    this.activeWriters.set(sessionId, { writable, bytesWritten: 0, framesWritten: 0, fileName });

    try {
      await this._writeCheckpoint(sessionId, {
        sessionId,
        fileName,
        metadata,
        framesWritten: 0,
        bytesWritten: 0,
        status: 'in_progress',
        startedAt: Date.now(),
        updatedAt: Date.now(),
        progress: 0,
        stage: 'initializing',
      });
    } catch (error) {
      await writable.abort(error).catch(() => {});
      this.activeWriters.delete(sessionId);
      await root.removeEntry(fileName).catch(() => {});
      throw error;
    }
    return { fileName };
  }

  /**
   * Streams one processed frame's bytes to the OPFS file for this
   * session, and updates the IndexedDB checkpoint every `checkpointEvery`
   * frames (default 10) rather than on every single frame — matches the
   * spec's "after every N frames" requirement while keeping IndexedDB
   * write volume reasonable.
   *
   * Real bug found in testing: FileSystemWritableFileStream buffers
   * writes and only makes them durable on close() — a continuously-open
   * stream for the whole session means a genuine crash (not just our
   * object reference being dropped, an ACTUAL tab close/crash) loses
   * EVERYTHING since the stream was opened, making "checkpoint every N
   * frames" meaningless for real recovery. Confirmed directly: a
   * findResumableSession() check against an open-but-crashed stream
   * correctly found file.size still at 0, not the bytes we'd written.
   * Fix: close and reopen (in append mode) the writable stream at each
   * checkpoint boundary, so the bytes written so far are genuinely
   * flushed to disk before continuing — real durability at the cost of
   * the close/reopen overhead every `checkpointEvery` frames.
   */
  async appendFrame(sessionId, frameBytes, frameIndex, checkpointEvery = 10, checkpointPatch = null) {
    const session = this.activeWriters.get(sessionId);
    if (!session) throw new Error(`No active OPFS session "${sessionId}" — call beginSession() first`);

    try {
      await session.writable.write(frameBytes);
    } catch (error) {
      throw await this._storageWriteError(error, 'render');
    }
    session.bytesWritten += frameBytes.byteLength ?? frameBytes.length;
    session.framesWritten = Math.max(session.framesWritten, frameIndex + 1);

    const durableBoundary = session.framesWritten % Math.max(1, checkpointEvery) === 0;
    if (durableBoundary) {
      // Flush for real: close this stream and reopen in append mode so
      // the bytes written so far actually survive a crash. Treat reopen +
      // checkpoint as one lifecycle boundary: never leave an active map entry
      // pointing at a closed/failed stream.
      let newWritable = null;
      try {
        await session.writable.close();
        const root = await this._getRoot();
        const fileHandle = await root.getFileHandle(session.fileName);
        newWritable = await fileHandle.createWritable({ keepExistingData: true });
        await newWritable.seek(session.bytesWritten);
        session.writable = newWritable;

        await this._mutateCheckpoint(sessionId, (existing) => ({
          ...existing,
          ...(checkpointPatch || {}),
          framesWritten: session.framesWritten,
          bytesWritten: session.bytesWritten,
          durableEncodedFrames: session.framesWritten,
          updatedAt: Date.now(),
        }));
      } catch (error) {
        await newWritable?.abort?.(error).catch(() => {});
        this.activeWriters.delete(sessionId);
        throw await this._storageWriteError(error, 'durable checkpoint');
      }
    }
    return { durable: durableBoundary, framesWritten: session.framesWritten, bytesWritten: session.bytesWritten };
  }

  /**
   * Stores a self-contained frame or tile as a separate OPFS file. Separate
   * files make random access and crash recovery possible without scanning a
   * monolithic byte stream. The caller chooses the encoding (PNG/WebP/raw).
   */
  async cacheFrame(sessionId, frameIndex, data, { extension = 'bin', metadata = null } = {}) {
    const root = await this._getRoot();
    const directory = await root.getDirectoryHandle(`${OPFS_FRAME_PREFIX}${sessionId}`, { create: true });
    const name = `${String(frameIndex).padStart(10, '0')}.${extension.replace(/[^a-z0-9]/gi, '') || 'bin'}`;
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(data);
      await writable.close();
    } catch (error) {
      await writable.abort(error).catch(() => {});
      throw await this._storageWriteError(error, 'frame cache');
    }

    if (metadata) await this.setValue(`frame:${sessionId}:${frameIndex}`, metadata);
    return { name, size: (await handle.getFile()).size };
  }

  async readCachedFrame(sessionId, frameIndex, extension = 'bin') {
    const root = await this._getRoot();
    const directory = await root.getDirectoryHandle(`${OPFS_FRAME_PREFIX}${sessionId}`);
    const name = `${String(frameIndex).padStart(10, '0')}.${extension.replace(/[^a-z0-9]/gi, '') || 'bin'}`;
    return (await directory.getFileHandle(name)).getFile();
  }

  async deleteFrameCache(sessionId) {
    const root = await this._getRoot();
    await root.removeEntry(`${OPFS_FRAME_PREFIX}${sessionId}`, { recursive: true }).catch(() => {});
  }

  async cacheSourceFile(sessionId, file, onProgress = null) {
    const root = await this._getRoot();
    const name = `${OPFS_SOURCE_PREFIX}${sessionId}-${sanitizeFileName(file.name || 'input.bin')}`;
    const handle = await root.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    const reader = file.stream().getReader();
    let written = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        await writable.write(value);
        written += value.byteLength;
        onProgress?.({ received: written, total: file.size, progress: written / Math.max(1, file.size) });
      }
      await writable.close();
    } catch (error) {
      await reader.cancel(error).catch(() => {});
      await writable.abort(error).catch(() => {});
      await root.removeEntry(name).catch(() => {});
      throw await this._storageWriteError(error, 'source cache');
    } finally {
      reader.releaseLock?.();
    }
    const checkpoint = await this.getCheckpoint(sessionId);
    if (checkpoint) {
      try {
        await this.updateSession(sessionId, {
          sourceFileName: name,
          sourceOriginalName: file.name,
          sourceType: file.type,
          sourceSize: file.size,
        });
      } catch (error) {
        await root.removeEntry(name).catch(() => {});
        throw error;
      }
    }
    return (await handle.getFile()).size;
  }

  async getCachedSourceFile(sessionId) {
    const checkpoint = await this.getCheckpoint(sessionId);
    if (!checkpoint?.sourceFileName) return null;
    const root = await this._getRoot();
    return (await root.getFileHandle(checkpoint.sourceFileName)).getFile();
  }

  /** Write job progress/state atomically to IndexedDB. */
  async updateSession(sessionId, patch) {
    return this._mutateCheckpoint(sessionId, (current) => ({
      ...current,
      ...patch,
      sessionId,
      updatedAt: Date.now(),
    }));
  }

  async _drainSessionMutations(sessionId = null) {
    if (sessionId != null) {
      await this.sessionMutationChains.get(sessionId)?.catch(() => {});
      return;
    }
    await Promise.all([...this.sessionMutationChains.values()].map((promise) => promise.catch(() => {})));
  }

  async _mutateCheckpoint(sessionId, mutate) {
    const previous = this.sessionMutationChains.get(sessionId) || Promise.resolve();
    let operation;
    operation = previous
      .catch(() => {})
      .then(async () => {
        const current = await this.getCheckpoint(sessionId);
        if (!current) throw new Error(`No checkpoint found for session "${sessionId}"`);
        const next = await mutate(current);
        await this._writeCheckpoint(sessionId, next);
        return next;
      });
    this.sessionMutationChains.set(sessionId, operation);
    operation.finally(() => {
      if (this.sessionMutationChains.get(sessionId) === operation) this.sessionMutationChains.delete(sessionId);
    }).catch(() => {});
    return operation;
  }

  /** Marks a session complete, closes the OPFS writable stream, and returns the final file. */
  async finalizeSession(sessionId, { status = 'completed', stage = status === 'remux_pending' ? 'remuxing' : 'completed', progress = status === 'completed' ? 1 : undefined, patch = null } = {}) {
    const session = this.activeWriters.get(sessionId);
    if (!session) throw new Error(`No active OPFS session "${sessionId}"`);
    try {
      await session.writable.close();
    } catch (error) {
      await session.writable.abort(error).catch(() => {});
      throw await this._storageWriteError(error, 'finalize');
    } finally {
      this.activeWriters.delete(sessionId);
    }

    await this._mutateCheckpoint(sessionId, (existing) => ({
      ...existing,
      ...(patch || {}),
      status,
      framesWritten: session.framesWritten,
      bytesWritten: session.bytesWritten,
      durableEncodedFrames: session.framesWritten,
      ...(progress == null ? {} : { progress }),
      stage,
      updatedAt: Date.now(),
    }));

    const root = await this._getRoot();
    const fileHandle = await root.getFileHandle(session.fileName);
    return fileHandle.getFile();
  }

  /**
   * Aborts a session — releases the writable stream lock (required before
   * the file can be reopened or deleted) and marks the checkpoint failed.
   * Always call this on error/cancel, or the OPFS file stays locked for
   * the rest of the page's lifetime (a real, documented OPFS gotcha —
   * FileSystemWritableFileStream holds an exclusive lock until closed or
   * aborted).
   */
  async abortSession(sessionId, reason) {
    const session = this.activeWriters.get(sessionId);
    if (session) {
      await session.writable.abort(reason).catch(() => {}); // best-effort — stream may already be in a bad state
      this.activeWriters.delete(sessionId);
    }
    const existing = await this.getCheckpoint(sessionId);
    if (existing) {
      const abortReason = typeof reason === 'string' ? reason : (reason?.message || reason?.name || 'aborted');
      await this._mutateCheckpoint(sessionId, (current) => ({ ...current, status: 'aborted', updatedAt: Date.now(), abortReason }));
    }
  }

  async getCheckpoint(sessionId) {
    const db = await this._openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHECKPOINT_STORE, 'readonly');
      const req = tx.objectStore(CHECKPOINT_STORE).get(sessionId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async _writeCheckpoint(sessionId, record) {
    const db = await this._openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(CHECKPOINT_STORE, 'readwrite');
      tx.objectStore(CHECKPOINT_STORE).put(record);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  /** Verify that the durable OPFS stream still matches the active checkpoint. */
  async verifySessionIntegrity(sessionId) {
    const checkpoint = await this.getCheckpoint(sessionId);
    if (!checkpoint?.fileName) return { ok: false, reason: 'checkpoint-or-file-missing', sessionId };
    const expectedBytes = Math.max(0, Number(checkpoint.bytesWritten) || 0);
    const expectedFrames = Math.max(0, Number(checkpoint.durableEncodedFrames ?? checkpoint.framesWritten) || 0);
    try {
      const root = await this._getRoot();
      const file = await (await root.getFileHandle(checkpoint.fileName)).getFile();
      const ok = file.size >= expectedBytes;
      return { ok, sessionId, fileName: checkpoint.fileName, fileSize: file.size, expectedBytes, expectedFrames, reason: ok ? null : 'opfs-file-truncated' };
    } catch (error) {
      console.error('[BARSA][storage][integrity-check-failed]', { sessionId, error });
      return { ok: false, sessionId, expectedBytes, expectedFrames, reason: 'opfs-file-unavailable', error: error?.message || String(error) };
    }
  }

  /**
   * Finds the most recent interrupted (in_progress, not completed/aborted)
   * session, if any — this is the real mechanism behind "auto-resume
   * detector": EngineManager calls this once at startup and, if it finds
   * an interrupted session whose OPFS file still exists and is non-empty,
   * offers to resume from the last checkpointed frame index rather than
   * restarting the whole render.
   */
  async findResumableSession() {
    const db = await this._openDB();
    const all = await new Promise((resolve, reject) => {
      const tx = db.transaction(CHECKPOINT_STORE, 'readonly');
      const req = tx.objectStore(CHECKPOINT_STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const interrupted = all.filter((r) => r.status === 'in_progress' || r.status === 'remux_pending').sort((a, b) => b.updatedAt - a.updatedAt);
    if (interrupted.length === 0) return null;

    // Do not let one corrupt newest checkpoint hide an older valid render.
    // Iterate newest -> oldest and return the first session whose durable
    // elementary stream (and, when recorded, cached source) still exist.
    for (const candidate of interrupted) {
    const bytesWritten = Number(candidate.bytesWritten);
    const framesWritten = Number(candidate.framesWritten);
    if (!candidate.sessionId || !candidate.fileName || !Number.isFinite(bytesWritten) || bytesWritten < 0 || !Number.isFinite(framesWritten) || framesWritten < 0) continue;
    // Verify the OPFS file actually still exists and roughly matches the
    // checkpointed byte count — an interrupted session with a since-
    // deleted or truncated file is not resumable, and claiming it is
    // would be exactly the kind of unverified "READY" state this project
    // avoids elsewhere (ModelManager, UpscaleEngine, etc.).
    try {
      const root = await this._getRoot();
      const fileHandle = await root.getFileHandle(candidate.fileName);
      const file = await fileHandle.getFile();
      if (file.size < bytesWritten) continue; // checkpoint claims bytes that are not durable
      if (candidate.sourceFileName) {
        try {
          const source = await (await root.getFileHandle(candidate.sourceFileName)).getFile();
          if (candidate.sourceSize && source.size !== candidate.sourceSize) continue;
        } catch {
          continue;
        }
      }
      return candidate;
    } catch {
      continue;
    }
    }
    return null;
  }

  async listSessions({ statuses } = {}) {
    const db = await this._openDB();
    const all = await new Promise((resolve, reject) => {
      const tx = db.transaction(CHECKPOINT_STORE, 'readonly');
      const request = tx.objectStore(CHECKPOINT_STORE).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    const allowed = statuses ? new Set(statuses) : null;
    return all.filter((item) => !allowed || allowed.has(item.status)).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  /** Re-opens an existing OPFS file for appending, to continue a resumed session. */
  async resumeSession(sessionId) {
    if (this.activeWriters.has(sessionId)) throw new Error(`Render session "${sessionId}" already has an active writer`);
    const checkpoint = await this.getCheckpoint(sessionId);
    if (!checkpoint) throw new Error(`No checkpoint found for session "${sessionId}"`);
    if (checkpoint.status !== 'in_progress') throw new Error(`Render session "${sessionId}" is not frame-resumable (status: ${checkpoint.status || 'unknown'})`);
    if (!Number.isFinite(Number(checkpoint.bytesWritten)) || Number(checkpoint.bytesWritten) < 0) throw new Error('Resume checkpoint has an invalid byte offset');
    if (!Number.isFinite(Number(checkpoint.framesWritten)) || Number(checkpoint.framesWritten) < 0) throw new Error('Resume checkpoint has an invalid frame count');
    const root = await this._getRoot();
    const fileHandle = await root.getFileHandle(checkpoint.fileName, { create: false });
    const durableFile = await fileHandle.getFile();
    if (durableFile.size < Number(checkpoint.bytesWritten)) throw new Error('Resume stream is smaller than its durable checkpoint');
    if (checkpoint.sourceFileName) {
      const source = await (await root.getFileHandle(checkpoint.sourceFileName, { create: false })).getFile();
      if (checkpoint.sourceSize && source.size !== checkpoint.sourceSize) throw new Error('Cached source no longer matches the resume checkpoint');
    }
    // Preserve the durable prefix, discard only the uncheckpointed tail.
    const writable = await fileHandle.createWritable({ keepExistingData: true });
    try {
      // A browser/process crash may leave bytes beyond the last durable
      // checkpoint. They are explicitly untrusted. Truncate them before
      // appending, otherwise stale tail bytes can survive the resumed render
      // and corrupt the elementary stream/remux.
      await writable.truncate(Number(checkpoint.bytesWritten));
      await writable.seek(Number(checkpoint.bytesWritten));
      this.activeWriters.set(sessionId, {
        writable,
        bytesWritten: Number(checkpoint.bytesWritten),
        framesWritten: Number(checkpoint.framesWritten),
        fileName: checkpoint.fileName,
      });
      return checkpoint;
    } catch (error) {
      await writable.abort(error).catch(() => {});
      throw error;
    }
  }


  async getSessionFile(sessionId) {
    const checkpoint = await this.getCheckpoint(sessionId);
    if (!checkpoint?.fileName) throw new Error(`No render stream found for session "${sessionId}"`);
    const root = await this._getRoot();
    return (await root.getFileHandle(checkpoint.fileName, { create: false })).getFile();
  }

  /**
   * Commits a validated native output without duplicating it into RAM. Resume-only
   * artifacts are removed immediately, while the final OPFS MP4 remains leased to
   * the UI until the result is replaced/cleared. The completed checkpoint lets
   * startup pruning recover an orphaned lease after a renderer/process death.
   */
  async completeSessionWithOutput(sessionId) {
    await this._drainSessionMutations(sessionId);
    const checkpoint = await this.getCheckpoint(sessionId);
    if (!checkpoint?.outputFileName) throw new Error(`No validated output lease found for session "${sessionId}"`);
    const root = await this._getRoot();
    if (checkpoint.fileName) await root.removeEntry(checkpoint.fileName).catch(() => {});
    if (checkpoint.sourceFileName) await root.removeEntry(checkpoint.sourceFileName).catch(() => {});
    await this.deleteFrameCache(sessionId);
    return this._mutateCheckpoint(sessionId, (current) => ({
      ...current,
      status: 'completed',
      stage: 'completed',
      progress: 1,
      fileName: null,
      sourceFileName: null,
      completedAt: Date.now(),
      updatedAt: Date.now(),
    }));
  }

  /** Cleans up an OPFS file + its checkpoint record — call after a successful download/export. */
  async deleteSession(sessionId) {
    // Let any already-scheduled checkpoint mutation settle before deleting
    // the record. Otherwise a late progress write can resurrect a session
    // after cleanup completed.
    await this._drainSessionMutations(sessionId);
    const active = this.activeWriters.get(sessionId);
    if (active) {
      await active.writable.abort('session deleted').catch(() => {});
      this.activeWriters.delete(sessionId);
    }
    const checkpoint = await this.getCheckpoint(sessionId);
    if (checkpoint) {
      if (checkpoint.fileName) {
        try {
          const root = await this._getRoot();
          await root.removeEntry(checkpoint.fileName);
        } catch { /* already gone — fine */ }
      }
      if (checkpoint.sourceFileName) {
        try {
          const root = await this._getRoot();
          await root.removeEntry(checkpoint.sourceFileName);
        } catch {}
      }
      if (checkpoint.outputFileName) {
        try {
          const root = await this._getRoot();
          await root.removeEntry(checkpoint.outputFileName);
        } catch {}
      }
    }
    await this.deleteFrameCache(sessionId);
    const db = await this._openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CHECKPOINT_STORE, 'readwrite');
      tx.objectStore(CHECKPOINT_STORE).delete(sessionId);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  /**
   * Removes terminal render sessions that can no longer be resumed. The UI does
   * not reopen completed outputs after an app restart, so keeping their source,
   * elementary stream and MP4 copies only consumes quota and can make the next
   * long render fail before it starts.
   */
  async pruneTerminalSessions({ keepCompleted = 0 } = {}) {
    const terminal = await this.listSessions({ statuses: ['completed', 'aborted'] }).catch(() => []);
    let completedKept = 0;
    let removed = 0;
    for (const session of terminal) {
      if (session.status === 'completed' && completedKept < keepCompleted) {
        completedKept++;
        continue;
      }
      await this.deleteSession(session.sessionId).catch(() => {});
      removed++;
    }
    return removed;
  }

  /** Real storage accounting, reusing the same navigator.storage.estimate() API as ModelManager. */
  async getStorageUsage() {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      return { usageBytes: est.usage, quotaBytes: est.quota };
    }
    return { usageBytes: null, quotaBytes: null };
  }

  async assertCapacity(requiredBytes, { reserveBytes = 64 * 1024 * 1024 } = {}) {
    const { usageBytes, quotaBytes } = await this.getStorageUsage();
    if (usageBytes == null || quotaBytes == null) return { availableBytes: null, requiredBytes, sufficient: true };
    const availableBytes = Math.max(0, quotaBytes - usageBytes);
    const sufficient = availableBytes >= requiredBytes + reserveBytes;
    if (!sufficient) {
      const error = new Error(`Insufficient local storage: ${(availableBytes / 1073741824).toFixed(2)} GB available, ${(requiredBytes / 1073741824).toFixed(2)} GB required`);
      error.code = 'INSUFFICIENT_STORAGE';
      error.availableBytes = availableBytes;
      error.requiredBytes = requiredBytes;
      throw error;
    }
    return { availableBytes, requiredBytes, sufficient };
  }

  /** Creates a positioned OPFS sink compatible with Mediabunny StreamTarget. */
  async createRandomAccessOutput(sessionId, extension = 'mp4') {
    const root = await this._getRoot();
    const fileName = `output-${sessionId}.${extension.replace(/[^a-z0-9]/gi, '') || 'bin'}`;
    const handle = await root.getFileHandle(fileName, { create: true });
    const fileStream = await handle.createWritable();
    const writable = new WritableStream({
      write: (chunk) => fileStream.write(chunk),
      close: () => fileStream.close(),
      abort: (reason) => fileStream.abort(reason),
    });
    try {
      await this.updateSession(sessionId, { outputFileName: fileName });
    } catch (error) {
      await fileStream.abort(error).catch(() => {});
      await root.removeEntry(fileName).catch(() => {});
      throw error;
    }
    return {
      fileName,
      writable,
      getFile: () => handle.getFile(),
      remove: () => root.removeEntry(fileName).catch(() => {}),
    };
  }

  async requestPersistence() {
    if (!navigator.storage?.persist) return false;
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }

  async setValue(key, value) {
    const db = await this._openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite');
      tx.objectStore(SETTINGS_STORE).put({ key, value, updatedAt: Date.now() });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }

  async getValue(key, fallback = null) {
    const db = await this._openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(SETTINGS_STORE, 'readonly');
      const request = tx.objectStore(SETTINGS_STORE).get(key);
      request.onsuccess = () => resolve(request.result?.value ?? fallback);
      request.onerror = () => reject(request.error);
    });
  }

  async cacheStageBlob(sessionId, stageKey, blob, metadata = null) {
    if (!sessionId || !stageKey || !blob?.size) throw new Error('Invalid apply-stage cache request');
    await this.assertCapacity(Math.max(blob.size * 1.15, 64 * 1024 * 1024), { reserveBytes: MIN_STAGE_CACHE_RESERVE_BYTES });
    const root = await this._getRoot();
    const safeSession = sanitizeFileName(sessionId);
    const safeStage = sanitizeFileName(stageKey);
    const name = `apply-stage-${safeSession}-${safeStage}.mp4`;
    const handle = await root.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(blob);
      await writable.close();
    } catch (error) {
      await writable.abort(error).catch(() => {});
      await root.removeEntry(name).catch(() => {});
      throw await this._storageWriteError(error, 'apply-stage cache');
    }
    const file = await handle.getFile();
    const now = Date.now();
    const index = await this._getStageCacheIndex();
    index[name] = {
      name, sessionId, stageKey, bytes: file.size, createdAt: index[name]?.createdAt || now,
      lastAccessAt: now, metadata: metadata || null, pinned: false,
    };
    await this.setValue(APPLY_STAGE_INDEX_KEY, index);
    if (metadata) await this.setValue(`apply-stage:${name}`, metadata);
    await this.enforceStageCacheBudget({ protectNames: [name] }).catch(() => {});
    return { name, size: file.size };
  }

  async readStageCache(name) {
    if (!name) return null;
    const root = await this._getRoot();
    try {
      const file = await (await root.getFileHandle(name)).getFile();
      const index = await this._getStageCacheIndex();
      if (index[name]) {
        const now = Date.now();
        const sizeChanged = Number(index[name].bytes || 0) !== file.size;
        // Avoid an IndexedDB transaction on every cache hit. LRU precision to
        // the nearest 30 seconds is more than enough and removes needless I/O
        // while scrubbing/reapplying the same prepared stage.
        const touchDue = now - Number(index[name].lastAccessAt || 0) >= 30_000;
        if (sizeChanged || touchDue) {
          index[name].lastAccessAt = now;
          index[name].bytes = file.size;
          await this.setValue(APPLY_STAGE_INDEX_KEY, index).catch(() => {});
        }
      }
      return file;
    } catch {
      const index = await this._getStageCacheIndex();
      if (index[name]) { delete index[name]; await this.setValue(APPLY_STAGE_INDEX_KEY, index).catch(() => {}); }
      return null;
    }
  }

  async deleteStageCache(name) {
    if (!name) return;
    const root = await this._getRoot();
    await root.removeEntry(name).catch(() => {});
    const index = await this._getStageCacheIndex();
    if (index[name]) { delete index[name]; await this.setValue(APPLY_STAGE_INDEX_KEY, index).catch(() => {}); }
  }

  async _getStageCacheIndex() {
    const value = await this.getValue(APPLY_STAGE_INDEX_KEY, {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  async getStageCacheUsage() {
    const index = await this._getStageCacheIndex();
    const entries = Object.values(index);
    return { entries, count: entries.length, bytes: entries.reduce((sum, item) => sum + Number(item.bytes || 0), 0) };
  }

  async pinStageCache(names = []) {
    const wanted = new Set((names || []).filter(Boolean));
    const index = await this._getStageCacheIndex();
    let changed = false;
    for (const item of Object.values(index)) {
      const next = wanted.has(item.name);
      if (item.pinned !== next) { item.pinned = next; changed = true; }
    }
    if (changed) await this.setValue(APPLY_STAGE_INDEX_KEY, index);
  }

  async reconcileStageCacheIndex() {
    const root = await this._getRoot();
    const index = await this._getStageCacheIndex();
    const actual = new Set();
    for await (const [name, handle] of root.entries()) {
      if (!name.startsWith('apply-stage-') || handle.kind !== 'file') continue;
      actual.add(name);
      if (!index[name]) {
        // An unindexed stage cannot be referenced by ApplyStack. It is usually
        // a remnant of a killed write/app update, so remove it instead of
        // silently consuming quota forever.
        await root.removeEntry(name).catch(() => {});
      }
    }
    let changed = false;
    for (const name of Object.keys(index)) {
      if (actual.has(name)) continue;
      delete index[name];
      changed = true;
    }
    if (changed) await this.setValue(APPLY_STAGE_INDEX_KEY, index).catch(() => {});
    return { indexed: Object.keys(index).length, orphanFilesRemoved: [...actual].filter((name) => !index[name]).length };
  }

  async enforceStageCacheBudget({ maxBytes = null, protectNames = [] } = {}) {
    await this.reconcileStageCacheIndex().catch(() => {});
    const usage = await this.getStorageUsage().catch(() => ({ usageBytes: null, quotaBytes: null }));
    const dynamicCap = usage.quotaBytes ? Math.max(512 * 1024 * 1024, Math.min(DEFAULT_STAGE_CACHE_MAX_BYTES, Math.floor(usage.quotaBytes * 0.38))) : DEFAULT_STAGE_CACHE_MAX_BYTES;
    const budget = Math.max(256 * 1024 * 1024, Number(maxBytes) || dynamicCap);
    const reserveTarget = usage.quotaBytes ? Math.max(MIN_STAGE_CACHE_RESERVE_BYTES, Math.floor(usage.quotaBytes * 0.08)) : MIN_STAGE_CACHE_RESERVE_BYTES;
    const protectedSet = new Set(protectNames.filter(Boolean));
    const index = await this._getStageCacheIndex();
    let total = Object.values(index).reduce((sum, item) => sum + Number(item.bytes || 0), 0);
    let free = usage.quotaBytes == null ? Infinity : Math.max(0, usage.quotaBytes - (usage.usageBytes || 0));
    const candidates = Object.values(index)
      .filter(item => !item.pinned && !protectedSet.has(item.name))
      .sort((a, b) => Number(a.lastAccessAt || a.createdAt || 0) - Number(b.lastAccessAt || b.createdAt || 0));
    const removed = [];
    for (const item of candidates) {
      if (total <= budget && free >= reserveTarget) break;
      await this.deleteStageCache(item.name).catch(() => {});
      total = Math.max(0, total - Number(item.bytes || 0));
      free += Number(item.bytes || 0);
      removed.push(item.name);
    }
    return { budgetBytes: budget, remainingBytes: total, removed, freeBytes: free, reserveTarget };
  }

  async deleteStageSession(sessionId) {
    if (!sessionId) return 0;
    const root = await this._getRoot();
    const prefix = `apply-stage-${sanitizeFileName(sessionId)}-`;
    let removed = 0;
    for await (const [name] of root.entries()) {
      if (!name.startsWith(prefix)) continue;
      await this.deleteStageCache(name).catch(() => {});
      removed += 1;
    }
    return removed;
  }


  async _storageWriteError(error, context = 'storage write') {
    if (error?.name !== 'QuotaExceededError' && error?.code !== 'QUOTA_EXCEEDED') return error;
    const usage = await this.getStorageUsage().catch(() => ({ usageBytes: null, quotaBytes: null }));
    const available = usage.quotaBytes == null || usage.usageBytes == null ? null : Math.max(0, usage.quotaBytes - usage.usageBytes);
    const wrapped = new Error(available == null
      ? `Local storage became full during ${context}`
      : `Local storage became full during ${context}: ${(available / 1073741824).toFixed(2)} GB remaining`);
    wrapped.name = 'QuotaExceededError';
    wrapped.code = 'INSUFFICIENT_STORAGE';
    wrapped.cause = error;
    wrapped.availableBytes = available;
    return wrapped;
  }

  /** Closes open writers and the IndexedDB connection. */
  async close() {
    // IndexedDB must remain alive until queued read-modify-write checkpoint
    // operations settle; closing it first makes shutdown race-dependent.
    await this._drainSessionMutations();
    await Promise.all([...this.activeWriters.values()].map(({ writable }) => writable.close().catch(() => {})));
    this.activeWriters.clear();
    this.db?.close();
    this.db = null;
  }
}

function sanitizeFileName(name) {
  return name.replace(/[^a-z0-9_.-]/gi, '-').replace(/-+/g, '-').slice(-120);
}
