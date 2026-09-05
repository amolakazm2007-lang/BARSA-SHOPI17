import { createOrtSessionWithFallback } from './OrtSessionLoader.js';
export const DEFAULT_FACE_DETECTOR_MODEL = 'yunet-2026may';
export const FACE_DETECTOR_FALLBACK_CHAIN = Object.freeze(['yunet-2026may', 'yunet-2023mar']);

export const FACE_DETECTOR_REGISTRY = {
  'yunet-2026may': {
    label: 'OpenCV YuNet 2026 · Dynamic',
    format: 'onnx',
    inputSize: 320,
    expectedSizeBytes: 229_738,
    sha256: 'ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0',
    remoteURL: 'https://huggingface.co/pollen-robotics/face_detection_yunet_2026may/resolve/main/face_detection_yunet_2026may.onnx?download=true',
    downloadCandidates: [
      'https://huggingface.co/pollen-robotics/face_detection_yunet_2026may/resolve/main/face_detection_yunet_2026may.onnx?download=true',
      'https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2026may.onnx',
    ],
    sourcePage: 'https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet',
    mirrorPage: 'https://huggingface.co/pollen-robotics/face_detection_yunet_2026may',
    license: 'MIT',
  },
  'yunet-2023mar': {
    label: 'OpenCV YuNet 2023 · 320px',
    format: 'onnx',
    inputSize: 320,
    expectedSizeBytes: 232_589,
    sha256: '8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4',
    remoteURL: 'https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx?download=true',
    downloadCandidates: [
      'https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx?download=true',
      'https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx',
    ],
    sourcePage: 'https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet',
    license: 'MIT',
  },
};

/** Optional ONNX face detector used before GFPGAN/CodeFormer restoration. */
export class FaceDetectorEngine {
  constructor(modelManager) {
    this.modelManager = modelManager;
    this.session = null;
    this.sessionModelId = null;
    this.ort = null;
    this.canvas = null;
    this.context = null;
    this.available = null;
  }

  async isAvailable(modelId = DEFAULT_FACE_DETECTOR_MODEL) {
    if (this.available === true && modelId === this.sessionModelId) return { available: true };
    const status = await this.modelManager.getStatus(modelId);
    const available = Boolean(status.installed && status.verified && status.testPassed);
    if (available) this.available = true;
    return { available, status };
  }

  async importModel(modelId, file, onProgress = null) {
    const config = FACE_DETECTOR_REGISTRY[modelId];
    if (!config) throw new Error(`Unknown face detector: ${modelId}`);
    await this.modelManager.importModel(modelId, file, { ...config, role: 'face-detection' }, onProgress);
    try { await this.runSelfTest(modelId); }
    catch (error) { await this.modelManager.markTestFailed(modelId, error).catch(() => {}); throw error; }
    this.available = true;
    return this.modelManager.getStatus(modelId);
  }

  async installCatalogModel(modelId = DEFAULT_FACE_DETECTOR_MODEL, onProgress = null) {
    const config = FACE_DETECTOR_REGISTRY[modelId];
    if (!config?.remoteURL && !config?.downloadCandidates?.length) throw new Error('No audited download is configured for this detector');
    if (config.downloadCandidates?.length) await this.modelManager.installFromCandidates(modelId, { ...config, role: 'face-detection' }, onProgress);
    else await this.modelManager.installFromURL(modelId, config.remoteURL, { ...config, role: 'face-detection' }, onProgress);
    try { await this.runSelfTest(modelId); }
    catch (error) { await this.modelManager.markTestFailed(modelId, error).catch(() => {}); throw error; }
    this.available = true;
    return this.modelManager.getStatus(modelId);
  }


  async resolveWorkingModel({ install = false, onProgress = null, retries = 2 } = {}) {
    for (const modelId of FACE_DETECTOR_FALLBACK_CHAIN) {
      const status = await this.isAvailable(modelId).catch(() => ({ available: false }));
      if (status.available) return modelId;
      if (!install) continue;
      const attempts = Math.max(1, Math.min(3, Number(retries) || 1));
      for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
          onProgress?.({ modelId, stage: 'trying', attempt, attempts });
          await this.installCatalogModel(modelId, (event) => onProgress?.({ modelId, attempt, attempts, ...event }));
          const verified = await this.isAvailable(modelId);
          if (verified.available) return modelId;
        } catch (error) {
          onProgress?.({ modelId, stage: 'retry-wait', attempt, attempts, error });
          if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        }
      }
      // Continue to the audited fallback only after the preferred model has
      // exhausted its bounded retry budget.
    }
    return null;
  }

  async _loadRuntime() {
    if (!this.ort) {
      this.ort = await import('onnxruntime-web/webgpu');
      this.ort.env.wasm.numThreads = crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
      this.ort.env.wasm.wasmPaths = new URL('./vendor/ort-wasm/', document.baseURI).href;
    }
    return this.ort;
  }

  async _loadSession(modelId) {
    if (this.session && this.sessionModelId === modelId) return this.session;
    this.session?.release?.();
    const ort = await this._loadRuntime();
    const loaded = await createOrtSessionWithFallback({
      modelManager: this.modelManager, ort, modelId,
      webgpuOptions: [{ graphCapture: false, options: { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' } }],
      wasmOptions: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' },
    });
    this.session = loaded.session;
    this.executionProvider = loaded.executionProvider;
    this.modelSourceKind = loaded.sourceKind;
    this.sessionModelId = modelId;
    return this.session;
  }

  async runSelfTest(modelId = DEFAULT_FACE_DETECTOR_MODEL) {
    const session = await this._loadSession(modelId);
    const signature = resolveYuNetSignature(session, FACE_DETECTOR_REGISTRY[modelId]);
    const pixels = new Float32Array(3 * signature.width * signature.height);
    const outputs = await session.run({ [signature.inputName]: new this.ort.Tensor('float32', pixels, [1, 3, signature.height, signature.width]) });
    validateYuNetOutputs(outputs);
    decodeYuNetOutputs(outputs, signature.width, signature.height, { scoreThreshold: 0.99, maxFaces: 1 });
    await this.modelManager.markTestPassed(modelId, {
      executionProvider: this.executionProvider,
      signature: { input: signature.inputName, width: signature.width, height: signature.height, outputs: session.outputNames },
    });
    return true;
  }

  async detect(source, { modelId = DEFAULT_FACE_DETECTOR_MODEL, scoreThreshold = 0.72, nmsThreshold = 0.3, maxFaces = 4 } = {}) {
    const status = await this.isAvailable(modelId);
    if (!status.available) return [];
    const session = await this._loadSession(modelId);
    const signature = resolveYuNetSignature(session, FACE_DETECTOR_REGISTRY[modelId]);
    const sourceWidth = source.width || source.displayWidth || source.videoWidth;
    const sourceHeight = source.height || source.displayHeight || source.videoHeight;
    if (!sourceWidth || !sourceHeight) throw new Error('Face detector received an empty frame');
    this.canvas ||= new OffscreenCanvas(signature.width, signature.height);
    if (this.canvas.width !== signature.width || this.canvas.height !== signature.height) {
      this.canvas.width = signature.width;
      this.canvas.height = signature.height;
      this.context = null;
    }
    this.context ||= this.canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    this.context.fillStyle = '#000';
    this.context.fillRect(0, 0, signature.width, signature.height);
    const scale = Math.min(signature.width / sourceWidth, signature.height / sourceHeight);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const offsetX = (signature.width - drawWidth) / 2;
    const offsetY = (signature.height - drawHeight) / 2;
    this.context.drawImage(source, offsetX, offsetY, drawWidth, drawHeight);
    const input = rgbaToBgrChw(this.context.getImageData(0, 0, signature.width, signature.height));
    const outputs = await session.run({ [signature.inputName]: new this.ort.Tensor('float32', input, [1, 3, signature.height, signature.width]) });
    return decodeYuNetOutputs(outputs, signature.width, signature.height, { scoreThreshold, nmsThreshold, maxFaces })
      .map((face) => ({
        x: clamp((face.x - offsetX) / scale, 0, sourceWidth - 1),
        y: clamp((face.y - offsetY) / scale, 0, sourceHeight - 1),
        width: clamp(face.width / scale, 1, sourceWidth),
        height: clamp(face.height / scale, 1, sourceHeight),
        score: face.score,
        landmarks: face.landmarks.map(([x, y]) => [(x - offsetX) / scale, (y - offsetY) / scale]),
      }))
      .filter((face) => face.x + face.width > 0 && face.y + face.height > 0)
      .map((face) => ({ ...face, width: Math.min(face.width, sourceWidth - face.x), height: Math.min(face.height, sourceHeight - face.y) }));
  }

  destroy() {
    this.session?.release?.();
    this.session = null;
    this.sessionModelId = null;
    this.available = null;
    if (this.canvas) { this.canvas.width = 1; this.canvas.height = 1; }
    this.canvas = null;
    this.context = null;
  }
}

export function resolveYuNetSignature(session, config = {}) {
  const inputName = session.inputNames?.[0];
  if (!inputName) throw new Error('YuNet model has no input tensor');
  const metadata = Array.isArray(session.inputMetadata) ? session.inputMetadata[0] : session.inputMetadata?.[inputName] || session.inputMetadata?.[0];
  const dimensions = metadata?.dimensions || metadata?.shape || [];
  const channels = Number(dimensions[1]);
  if (channels > 0 && channels !== 3) throw new Error(`YuNet input must be NCHW RGB/BGR; received ${channels} channels`);
  const height = positiveDimension(dimensions[2]) || config.inputSize || 320;
  const width = positiveDimension(dimensions[3]) || config.inputSize || 320;
  if (width % 32 || height % 32) throw new Error(`YuNet input ${width}x${height} must be divisible by 32`);
  return { inputName, width, height };
}

export function decodeYuNetOutputs(outputs, inputWidth, inputHeight, { scoreThreshold = 0.72, nmsThreshold = 0.3, maxFaces = 4 } = {}) {
  validateYuNetOutputs(outputs);
  const faces = [];
  for (const stride of [8, 16, 32]) {
    const columns = Math.floor(inputWidth / stride);
    const rows = Math.floor(inputHeight / stride);
    const cls = outputs[`cls_${stride}`].data;
    const obj = outputs[`obj_${stride}`].data;
    const bbox = outputs[`bbox_${stride}`].data;
    const kps = outputs[`kps_${stride}`].data;
    const count = rows * columns;
    if (cls.length < count || obj.length < count || bbox.length < count * 4 || kps.length < count * 10) throw new Error(`YuNet stride ${stride} output shape is incompatible with ${inputWidth}x${inputHeight}`);
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const index = row * columns + column;
        const score = Math.sqrt(clamp(cls[index], 0, 1) * clamp(obj[index], 0, 1));
        if (score < scoreThreshold) continue;
        const centerX = (column + bbox[index * 4]) * stride;
        const centerY = (row + bbox[index * 4 + 1]) * stride;
        const width = Math.exp(clamp(bbox[index * 4 + 2], -10, 10)) * stride;
        const height = Math.exp(clamp(bbox[index * 4 + 3], -10, 10)) * stride;
        const landmarks = [];
        for (let point = 0; point < 5; point++) landmarks.push([
          (kps[index * 10 + point * 2] + column) * stride,
          (kps[index * 10 + point * 2 + 1] + row) * stride,
        ]);
        faces.push({ x: centerX - width / 2, y: centerY - height / 2, width, height, landmarks, score });
      }
    }
  }
  return nonMaximumSuppression(faces, nmsThreshold, maxFaces);
}

function validateYuNetOutputs(outputs) {
  for (const stride of [8, 16, 32]) for (const prefix of ['cls', 'obj', 'bbox', 'kps']) {
    const name = `${prefix}_${stride}`;
    if (!outputs[name]?.data) throw new Error(`YuNet output is missing ${name}`);
  }
}

function nonMaximumSuppression(faces, threshold, maximum) {
  const candidates = [...faces].sort((a, b) => b.score - a.score);
  const selected = [];
  while (candidates.length && selected.length < maximum) {
    const face = candidates.shift();
    selected.push(face);
    for (let index = candidates.length - 1; index >= 0; index--) if (iou(face, candidates[index]) >= threshold) candidates.splice(index, 1);
  }
  return selected;
}

function iou(a, b) {
  const left = Math.max(a.x, b.x), top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  return intersection / Math.max(1e-6, a.width * a.height + b.width * b.height - intersection);
}

function rgbaToBgrChw(imageData) {
  const pixels = imageData.width * imageData.height;
  const output = new Float32Array(pixels * 3);
  for (let pixel = 0; pixel < pixels; pixel++) {
    const offset = pixel * 4;
    output[pixel] = imageData.data[offset + 2];
    output[pixels + pixel] = imageData.data[offset + 1];
    output[pixels * 2 + pixel] = imageData.data[offset];
  }
  return output;
}

function positiveDimension(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
