/**
 * Reusable ONNX Runtime WebGPU IO-binding arena.
 * Quality-neutral: tensor shapes/values/model math are unchanged.
 */
export class WebGpuIoArena {
  constructor(ort, { maxSlots = 6 } = {}) {
    this.ort = ort;
    this.maxSlots = Math.max(1, maxSlots | 0);
    this.slots = new Map();
    this.disabled = false;
    this.lastFailure = null;
    this.deviceLost = false;
    const initialDevice = this.device;
    initialDevice?.lost?.then?.((info) => {
      this.deviceLost = true;
      this.lastFailure = `device-lost:${info?.reason || 'unknown'}:${info?.message || ''}`;
      this.clear();
    }).catch?.(() => {});
  }

  get device() { return this.ort?.env?.webgpu?.device || null; }
  get available() {
    return !this.disabled && !this.deviceLost && Boolean(this.device)
      && typeof this.ort?.Tensor?.fromGpuBuffer === 'function'
      && typeof GPUBufferUsage !== 'undefined'
      && typeof GPUMapMode !== 'undefined';
  }

  _byteLength(dims) {
    const elements = dims.reduce((total, value) => total * Number(value), 1);
    if (!Number.isSafeInteger(elements) || elements <= 0) throw new RangeError('Invalid GPU tensor shape');
    return elements * 4;
  }
  _aligned(bytes) { return Math.ceil(bytes / 16) * 16; }
  _slotKey(feeds, outputDims) { return `${feeds.map((feed) => feed.dims.join('x')).join('+')}=>${outputDims.join('x')}`; }

  _destroySlot(slot) {
    for (const input of slot.inputs || []) { try { input.buffer?.destroy?.(); } catch {} }
    try { slot.outputBuffer?.destroy?.(); } catch {}
    try { slot.readbackBuffer?.destroy?.(); } catch {}
  }
  _evictIfNeeded() {
    while (this.slots.size >= this.maxSlots) {
      const candidate = [...this.slots.entries()].find(([, slot]) => !slot.busy);
      if (!candidate) return false;
      const [key, slot] = candidate;
      this.slots.delete(key);
      this._destroySlot(slot);
    }
    return true;
  }

  _getOrCreateSlot(feeds, outputDims) {
    const key = this._slotKey(feeds, outputDims);
    const cached = this.slots.get(key);
    if (cached && !cached.busy) {
      this.slots.delete(key); this.slots.set(key, cached);
      return cached;
    }
    const cacheable = this._evictIfNeeded();
    const device = this.device;
    if (!device) throw new Error('WebGPU device unavailable');
    const inputs = feeds.map((feed) => {
      const bytes = this._byteLength(feed.dims);
      const buffer = device.createBuffer({ size: this._aligned(bytes), usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE });
      const tensor = this.ort.Tensor.fromGpuBuffer(buffer, { dataType: 'float32', dims: feed.dims });
      return { bytes, buffer, tensor };
    });
    const outputBytes = this._byteLength(outputDims);
    const outputBuffer = device.createBuffer({
      size: this._aligned(outputBytes),
      usage: GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE,
    });
    const readbackBuffer = device.createBuffer({
      size: this._aligned(outputBytes),
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const outputTensor = this.ort.Tensor.fromGpuBuffer(outputBuffer, { dataType: 'float32', dims: outputDims });
    const slot = { key, inputs, outputBytes, outputBuffer, readbackBuffer, outputTensor, busy: false, ephemeral: !cacheable };
    if (cacheable) this.slots.set(key, slot);
    return slot;
  }

  async runGpu({ session, inputName, outputName, input, inputDims, outputDims, signal = null }) {
    if (!this.available) throw new Error('WebGPU IO binding unavailable');
    const feeds = [{ name: inputName, data: input, dims: inputDims }];
    const slot = this._getOrCreateSlot(feeds, outputDims);
    if (slot.busy) throw new Error('WebGPU IO slot is already in use');
    slot.busy = true;
    try {
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
      const target = slot.inputs[0];
      if (input.byteLength !== target.bytes) throw new RangeError('WebGPU input byte length mismatch');
      this.device.queue.writeBuffer(target.buffer, 0, input.buffer, input.byteOffset, input.byteLength);
      await session.run({ [inputName]: target.tensor }, { [outputName]: slot.outputTensor });
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
      let released = false;
      return {
        gpuBuffer: slot.outputBuffer, dims: [...outputDims], gpuIoBound: true,
        release: () => { if (!released) { released = true; slot.busy = false; if (slot.ephemeral) this._destroySlot(slot); } },
      };
    } catch (error) {
      slot.busy = false;
      if (slot.ephemeral) this._destroySlot(slot);
      this.lastFailure = error?.message || String(error);
      throw error;
    }
  }

  async run({ session, inputName, outputName, input, inputDims, outputDims, signal = null }) {
    return this.runMulti({
      session,
      gpuFeeds: [{ name: inputName, data: input, dims: inputDims }],
      cpuFeeds: {}, outputName, outputDims, signal,
    });
  }

  async runMulti({ session, gpuFeeds, cpuFeeds = {}, outputName, outputDims, signal = null }) {
    if (!this.available) throw new Error('WebGPU IO binding unavailable');
    if (!Array.isArray(gpuFeeds) || !gpuFeeds.length) throw new Error('At least one GPU feed is required');
    if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
    const slot = this._getOrCreateSlot(gpuFeeds, outputDims);
    if (slot.busy) throw new Error('WebGPU IO slot is already in use');
    slot.busy = true;
    try {
      const device = this.device;
      const feeds = { ...cpuFeeds };
      for (let i = 0; i < gpuFeeds.length; i++) {
        const source = gpuFeeds[i];
        const target = slot.inputs[i];
        if (source.data.byteLength !== target.bytes) throw new RangeError(`WebGPU input byte length mismatch for ${source.name}`);
        device.queue.writeBuffer(target.buffer, 0, source.data.buffer, source.data.byteOffset, source.data.byteLength);
        feeds[source.name] = target.tensor;
      }
      await session.run(feeds, { [outputName]: slot.outputTensor });
      if (signal?.aborted) throw signal.reason || new DOMException('Aborted', 'AbortError');
      const encoder = device.createCommandEncoder();
      encoder.copyBufferToBuffer(slot.outputBuffer, 0, slot.readbackBuffer, 0, slot.outputBytes);
      device.queue.submit([encoder.finish()]);
      await slot.readbackBuffer.mapAsync(GPUMapMode.READ, 0, slot.outputBytes);
      const mapped = slot.readbackBuffer.getMappedRange(0, slot.outputBytes);
      const data = new Float32Array(mapped.slice(0));
      slot.readbackBuffer.unmap();
      return { data, dims: [...outputDims], gpuIoBound: true };
    } catch (error) {
      try { if (slot.readbackBuffer?.mapState === 'mapped') slot.readbackBuffer.unmap(); } catch {}
      this.lastFailure = error?.message || String(error);
      throw error;
    } finally { slot.busy = false; if (slot.ephemeral) this._destroySlot(slot); }
  }

  disable(reason = 'disabled') { this.disabled = true; this.lastFailure = reason; this.clear(); }
  clear() { for (const slot of this.slots.values()) this._destroySlot(slot); this.slots.clear(); }
}
