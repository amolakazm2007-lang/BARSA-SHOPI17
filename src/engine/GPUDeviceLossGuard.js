import { BarsaError } from './CrashProofRuntime.js';

export class GPUDeviceLossGuard extends EventTarget {
  constructor({ logger = console } = {}) {
    super();
    this.logger = logger;
    this.device = null;
    this.lost = false;
    this.generation = 0;
  }

  attach(device) {
    this.device = device;
    this.lost = false;
    const generation = ++this.generation;
    Promise.resolve(device?.lost).then((info = {}) => {
      if (generation !== this.generation) return;
      if (info.reason === 'destroyed') return;
      this.lost = true;
      const error = new BarsaError('GPU_DEVICE_LOST', `WebGPU device lost: ${info.message || info.reason || 'unknown reason'}`, {
        recoverable: true,
        details: { reason: info.reason || null, message: info.message || null },
      });
      this.logger.error?.('[BARSA][webgpu-device-lost]', error);
      this.dispatchEvent(new CustomEvent('lost', { detail: error }));
    }).catch((error) => {
      this.logger.error?.('[BARSA][webgpu-lost-handler-failed]', error);
    });
    return device;
  }

  assertAvailable() {
    if (this.lost) throw new BarsaError('GPU_DEVICE_LOST', 'WebGPU device is unavailable', { recoverable: true });
  }

  detach() {
    this.generation += 1;
    this.device = null;
    this.lost = false;
  }
}
