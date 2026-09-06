import { BarsaError, withHardTimeout } from './CrashProofRuntime.js';

export class PeriodicResumeVerifier {
  constructor({ storage, sessionId, everyFrames = 10, timeoutMs = 10000, logger = console } = {}) {
    if (!storage) throw new TypeError('storage is required');
    if (!sessionId) throw new TypeError('sessionId is required');
    this.storage = storage;
    this.sessionId = sessionId;
    this.everyFrames = Math.max(1, Number(everyFrames) || 10);
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 10000);
    this.logger = logger;
    this.lastVerifiedFrame = -1;
  }

  shouldVerify(frameCount) {
    const count = Math.max(0, Number(frameCount) || 0);
    return count > 0 && count % this.everyFrames === 0 && count !== this.lastVerifiedFrame;
  }

  async verify(frameCount) {
    const count = Math.max(0, Number(frameCount) || 0);
    if (!this.shouldVerify(count)) return { skipped: true, frameCount: count };
    const checkpoint = await withHardTimeout(() => this.storage.getCheckpoint(this.sessionId), {
      timeoutMs: this.timeoutMs,
      label: 'checkpoint integrity verification',
    });
    if (!checkpoint) {
      throw new BarsaError('CHECKPOINT_MISSING', `Checkpoint missing at frame ${count}`, { recoverable: false, details: { sessionId: this.sessionId, frameCount: count } });
    }
    const durableFrames = Number(checkpoint.durableEncodedFrames ?? checkpoint.framesWritten ?? 0) || 0;
    if (durableFrames < count) {
      throw new BarsaError('CHECKPOINT_NOT_DURABLE', `Checkpoint durable frame count ${durableFrames} trails processed frame ${count}`, {
        recoverable: true,
        details: { sessionId: this.sessionId, frameCount: count, durableFrames },
      });
    }
    if (typeof this.storage.verifySessionIntegrity === 'function') {
      const integrity = await withHardTimeout(() => this.storage.verifySessionIntegrity(this.sessionId), {
        timeoutMs: this.timeoutMs,
        label: 'resume file integrity verification',
      });
      if (integrity === false || integrity?.ok === false) {
        throw new BarsaError('CHECKPOINT_CORRUPT', `Resume integrity verification failed at frame ${count}`, {
          recoverable: false,
          details: { sessionId: this.sessionId, frameCount: count, integrity },
        });
      }
    }
    this.lastVerifiedFrame = count;
    this.logger.info?.('[BARSA][resume-verified]', { sessionId: this.sessionId, frameCount: count, durableFrames });
    return { skipped: false, frameCount: count, durableFrames };
  }
}
