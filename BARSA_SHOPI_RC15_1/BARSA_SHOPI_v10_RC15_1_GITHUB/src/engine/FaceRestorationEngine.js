import { imageDataToChwFloat32, chwFloat32ToImageData } from './UpscaleEngine.js';
import { NativeAiClient } from '../platform/NativeAiClient.js';
import { createOrtSessionWithFallback } from './OrtSessionLoader.js';

export const FACE_MODEL_REGISTRY = {
  'gfpgan-1.4': {
    source: 'audited-onnx-conversion',
    sourcePage: 'https://github.com/TencentARC/GFPGAN',
    mirrorPage: 'https://github.com/clibdev/GFPGAN-onnxruntime-demo/releases/tag/1.0.0',
    license: 'Apache-2.0 (upstream GFPGAN)',
    version: '1.4',
    sha256: '497ff5b6d6008ec101b2714776ce39ce67a722a78720dfce84231e612e45053e',
    expectedSizeBytes: 340_254_218,
    format: 'onnx',
    inputSize: 512,
    colorRange: 'minus-one-to-one',
    label: 'GFPGAN 1.4 ONNX',
    downloadCandidates: [
      'https://github.com/clibdev/GFPGAN-onnxruntime-demo/releases/download/1.0.0/gfpgan-v1.4.onnx',
    ],
  },
  'codeformer': {
    source: 'audited-onnx-mirror',
    sourcePage: 'https://github.com/sczhou/CodeFormer',
    mirrorPage: 'https://huggingface.co/yuvraj108c/codeformer-onnx',
    license: 'NTU S-Lab License 1.0 / upstream terms apply',
    sha256: '94d96ea61122e2ffca09c0d895c84ff4d5e7dcab9d7dbf5f4dd9e553cf2e433a',
    expectedSizeBytes: 337_171_345,
    format: 'onnx',
    inputSize: 512,
    colorRange: 'minus-one-to-one',
    label: 'CodeFormer ONNX',
    downloadCandidates: [
      'https://huggingface.co/yuvraj108c/codeformer-onnx/resolve/main/codeformer.onnx?download=true',
      'https://huggingface.co/EmmaJohnson311/TensorRT-ONNX-collect/resolve/main/facerestore-onnx/codeformer.onnx?download=true',
    ],
  },
};

export class FaceRestorationEngine {
  constructor(modelManager, faceDetectorEngine = null) {
    this.modelManager = modelManager;
    this.faceDetectorEngine = faceDetectorEngine;
    this.sessions = new Map();
    this.ort = null;
    this.detector = null;
    this.trackedFaces = [];
    this.detectionFrame = 0;
    this.detectionInterval = 4;
    this.faceScratch = null;
    this.faceScratchContext = null;
    this.nativeAi = new NativeAiClient();
    this.nativePrepared = new Set();
    this.lastExecutionProvider = null;
  }

  async installCatalogModel(modelId, onProgress = null) {
    const config = FACE_MODEL_REGISTRY[modelId];
    if (!config?.remoteURL && !config?.downloadCandidates?.length) throw new Error('هذا النموذج يحتاج استيراد ONNX يدوياً');
    await this.modelManager.installFromCandidates(modelId, { ...config, role: 'face-restoration' }, onProgress);
    try { await this.runSelfTest(modelId); }
    catch (error) { await this.modelManager.markTestFailed(modelId, error).catch(() => {}); throw error; }
    return this.modelManager.getStatus(modelId);
  }

  async importModel(modelId, file, onProgress = null) {
    const config = FACE_MODEL_REGISTRY[modelId];
    if (!config) throw new Error(`Unknown face restoration model: ${modelId}`);
    const metadata = await this.modelManager.importModel(modelId, file, { ...config, role: 'face-restoration' }, onProgress);
    try { await this.runSelfTest(modelId); }
    catch (error) { await this.modelManager.markTestFailed(modelId, error).catch(() => {}); throw error; }
    return metadata;
  }

  async isAvailable(modelId) {
    const status = await this.modelManager.getStatus(modelId);
    return { available: status.installed && status.verified && status.testPassed, status };
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
    if (this.sessions.has(modelId)) return this.sessions.get(modelId);
    const ort = await this._loadRuntime();
    const loaded = await createOrtSessionWithFallback({
      modelManager: this.modelManager, ort, modelId,
      webgpuOptions: [{ graphCapture: false, options: { executionProviders: ['webgpu'], graphOptimizationLevel: 'all' } }],
      wasmOptions: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' },
    });
    const session = loaded.session;
    this.executionProvider = loaded.executionProvider;
    this.modelSourceKind = loaded.sourceKind;
    for (const [otherId, otherSession] of this.sessions) {
      if (otherId === modelId) continue;
      otherSession.release?.();
      this.sessions.delete(otherId);
    }
    this.sessions.set(modelId, session);
    return session;
  }


  async _prepareNativeModel(modelId, config) {
    if (!this.nativeAi.available || this.nativeAi.disabledModels.has(modelId)) return false;
    if (this.nativePrepared.has(modelId)) return true;
    const ready = await this.nativeAi.ensureModelLazy(modelId, {
      bytes: config.expectedSizeBytes || 0,
      sha256: config.sha256 || '',
      load: () => (this.modelManager.openModelFile ? this.modelManager.openModelFile(modelId) : this.modelManager.loadModelBuffer(modelId)),
    });
    if (ready) this.nativePrepared.add(modelId);
    return ready;
  }

  async runSelfTest(modelId) {
    const config = FACE_MODEL_REGISTRY[modelId];
    const session = await this._loadSession(modelId);
    const signature = resolveFaceSignature(session, config);
    const size = signature.inputSize;
    const input = new Float32Array(3 * size * size);
    const result = await session.run(buildFaceFeeds(session, this.ort, signature, input, 0.5));
    const output = selectImageOutput(session, result, 3 * size * size);
    if (!output?.data || output.data.length !== input.length) {
      throw new Error(`Face model output shape is incompatible with a 3x${size}x${size} image`);
    }
    await this.modelManager.markTestPassed(modelId, {
      executionProvider: this.executionProvider,
      signature: {
        inputSize: size,
        imageInput: signature.imageInput,
        auxiliaryInputs: signature.auxiliaryInputs,
        output: output.name,
      },
    });
    return true;
  }

  async warmup(modelId) {
    const session = await this._loadSession(modelId);
    return {
      executionProvider: this.executionProvider,
      signature: resolveFaceSignature(session, FACE_MODEL_REGISTRY[modelId]),
    };
  }

  async detectFaces(source, { maxFaces = 4 } = {}) {
    const width = source.width || source.displayWidth || source.videoWidth;
    const height = source.height || source.displayHeight || source.videoHeight;
    if (this.trackedFaces.length && this.detectionFrame % this.detectionInterval !== 0) {
      this.detectionFrame++;
      return this.trackedFaces.slice(0, maxFaces).map(cloneFaceBox);
    }
    let boxes = [];
    const detectorStatus = this.faceDetectorEngine ? await this.faceDetectorEngine.isAvailable() : { available: false };
    if (detectorStatus.available) {
      const detections = await this.faceDetectorEngine.detect(source, { maxFaces });
      boxes = detections.map((box) => expandBox(box, width, height, 0.35));
    } else if ('FaceDetector' in globalThis) {
      this.detector ||= new FaceDetector({ fastMode: true, maxDetectedFaces: maxFaces });
      const detections = await this.detector.detect(source);
      boxes = detections.slice(0, maxFaces).map(({ boundingBox }) => expandBox(boundingBox, width, height, 0.35));
    } else {
      boxes = detectFacesBySkin(source, { maxFaces, width, height });
    }
    this.trackedFaces = stabilizeFaceBoxes(this.trackedFaces, boxes, 0.62).slice(0, maxFaces);
    this.detectionFrame++;
    return this.trackedFaces.map(cloneFaceBox);
  }

  async restoreFrame(modelId, sourceCanvas, destinationContext, {
    strength = 0.75,
    faceDetail = 0,
    skinCleanup = 0,
    skinSmoothing = 0,
    microContrast = 0,
    skinToneProtect = 0.55,
    eyeDetail = 0,
    hairDetail = 0,
    maxFaces = 4,
    boxes = null,
    signal = null,
  } = {}) {
    const status = await this.isAvailable(modelId);
    if (!status.available) throw new Error(`Face model ${modelId} has not passed validation`);
    const config = FACE_MODEL_REGISTRY[modelId];
    const size = config.inputSize || 512;
    let session = null;
    let signature = null;
    let useNative = false;
    if (this.nativeAi.available) {
      try { useNative = await this._prepareNativeModel(modelId, config); }
      catch (error) { console.warn(`Native face model ${modelId} unavailable; using WebGPU/WASM:`, error?.message || error); }
    }
    if (!useNative) {
      session = await this._loadSession(modelId);
      signature = resolveFaceSignature(session, config);
    }
    const faces = boxes || await this.detectFaces(sourceCanvas, { maxFaces });
    destinationContext.drawImage(sourceCanvas, 0, 0);

    for (const box of faces) {
      if (signal?.aborted) throw signal.reason || new DOMException('Face restoration cancelled', 'AbortError');
      const { canvas: crop, context: cropContext } = this._getFaceScratch(size);
      cropContext.setTransform(1, 0, 0, 1, 0, 0);
      cropContext.globalAlpha = 1;
      cropContext.globalCompositeOperation = 'source-over';
      cropContext.clearRect(0, 0, size, size);
      const roll = faceRollRadians(box.landmarks);
      drawAlignedFaceCrop(cropContext, sourceCanvas, box, size, roll);
      const pixels = cropContext.getImageData(0, 0, size, size);
      const chw = normalizeInput(imageDataToChwFloat32(pixels), config.colorRange);
      let restoredData = null;
      if (useNative) {
        try {
          const native = await this.nativeAi.infer(modelId, chw, { channels: 3, width: size, height: size, scale: 1, fidelity: strength, signal });
          if (native.width !== size || native.height !== size || native.channels !== 3) throw new Error(`Native face output is ${native.width}x${native.height}x${native.channels}, expected ${size}x${size}x3`);
          restoredData = native.data;
          this.lastExecutionProvider = `android-native:${native.provider}`;
        } catch (error) {
          console.warn(`Native face inference failed for ${modelId}; switching to WebGPU/WASM:`, error?.message || error);
          this.nativeAi.disableModel(modelId);
          this.nativePrepared.delete(modelId);
          useNative = false;
          session = await this._loadSession(modelId);
          signature = resolveFaceSignature(session, config);
        }
      }
      if (!restoredData) {
        const output = await session.run(buildFaceFeeds(session, this.ort, signature, chw, strength));
        const imageOutput = selectImageOutput(session, output, 3 * size * size);
        if (!imageOutput?.data) throw new Error('Face model did not return a compatible RGB image tensor');
        restoredData = imageOutput.data;
        this.lastExecutionProvider = this.executionProvider || 'wasm';
      }
      const restored = denormalizeOutput(restoredData, config.colorRange);
      cropContext.putImageData(chwFloat32ToImageData(restored, size, size), 0, 0);
      if (faceDetail > 0 || skinCleanup > 0 || skinSmoothing > 0 || microContrast > 0 || skinToneProtect > 0) {
        applyFaceFinishing(cropContext, size, { faceDetail, skinCleanup, skinSmoothing, microContrast, skinToneProtect, eyeDetail, hairDetail });
      }
      applyFeatherMask(cropContext, size);
      destinationContext.save();
      destinationContext.globalAlpha = Math.max(0, Math.min(1, strength));
      drawAlignedFaceResult(destinationContext, crop, box, size, roll);
      destinationContext.restore();
    }
    return { faces: faces.length };
  }

  _getFaceScratch(size) {
    if (!this.faceScratch || this.faceScratch.width !== size || this.faceScratch.height !== size) {
      if (this.faceScratch) { this.faceScratch.width = 1; this.faceScratch.height = 1; }
      this.faceScratch = new OffscreenCanvas(size, size);
      this.faceScratchContext = this.faceScratch.getContext('2d', { willReadFrequently: true, alpha: true });
    }
    return { canvas: this.faceScratch, context: this.faceScratchContext };
  }

  destroy() {
    for (const session of this.sessions.values()) session.release?.();
    this.sessions.clear();
    this.detector = null;
    if (this.faceScratch) { this.faceScratch.width = 1; this.faceScratch.height = 1; }
    this.faceScratch = null; this.faceScratchContext = null;
    for (const modelId of this.nativePrepared) this.nativeAi.releaseSession?.(modelId).catch?.(() => {});
    this.nativePrepared.clear();
    this.lastExecutionProvider = null;
    this.resetTracking();
  }

  resetTracking() {
    this.trackedFaces = [];
    this.detectionFrame = 0;
    this.nativeAi = new NativeAiClient();
    this.nativePrepared = new Set();
    this.lastExecutionProvider = null;
  }
}

/** Face-local finishing; never touches pixels outside the detected crop. */
export function applyFaceFinishing(context, size, {
  faceDetail = 0,
  skinCleanup = 0,
  skinSmoothing = 0,
  microContrast = 0,
  skinToneProtect = 0.55,
  eyeDetail = 0,
  hairDetail = 0,
} = {}) {
  const image = context.getImageData(0, 0, size, size);
  const source = new Uint8ClampedArray(image.data);
  const detail = clamp01(faceDetail);
  const cleanup = clamp01(skinCleanup);
  const smoothing = clamp01(skinSmoothing);
  const micro = clamp01(microContrast);
  const toneProtect = clamp01(skinToneProtect);
  const eyes = clamp01(eyeDetail);
  const hair = clamp01(hairDetail);
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const index = (y * size + x) * 4;
      const centerR = source[index], centerG = source[index + 1], centerB = source[index + 2];
      const neighbours = [index - 4, index + 4, index - size * 4, index + size * 4];
      let averageR = 0, averageG = 0, averageB = 0;
      for (const offset of neighbours) { averageR += source[offset]; averageG += source[offset + 1]; averageB += source[offset + 2]; }
      averageR *= .25; averageG *= .25; averageB *= .25;
      const edge = Math.abs(centerR - averageR) + Math.abs(centerG - averageG) + Math.abs(centerB - averageB);
      const skin = isSkinPixel(centerR, centerG, centerB) ? 1 : 0;
      const normalizedX = (x / (size - 1) - .5) / .5, normalizedY = (y / (size - 1) - .5) / .5;
      const faceGate = clamp01(1 - Math.max(0, normalizedX * normalizedX + normalizedY * normalizedY - .42) / .58);
      const flatGate = clamp01(1 - edge / 115);
      const smoothLoad = skin * faceGate * flatGate * (cleanup * .22 + smoothing * .48);
      const detailGate = faceGate * clamp01((edge - 8) / 52);
      const detailLoad = detail * detailGate * .38;
      const eyeZone = clamp01(1 - Math.abs(normalizedY + .16) * 8) * clamp01((Math.abs(normalizedX) - .08) / .18) * clamp01((.72 - Math.abs(normalizedX)) / .22);
      const hairZone = clamp01((-normalizedY - .18) / .48) * clamp01((.92 - Math.abs(normalizedX)) / .22);
      const microLoad = micro * detailGate * .22 + eyes * eyeZone * detailGate * .26 + hair * hairZone * detailGate * .22;
      const protect = skin * toneProtect;
      const nr = centerR + (averageR - centerR) * smoothLoad + (centerR - averageR) * (detailLoad + microLoad);
      const ng = centerG + (averageG - centerG) * smoothLoad + (centerG - averageG) * (detailLoad + microLoad);
      const nb = centerB + (averageB - centerB) * smoothLoad + (centerB - averageB) * (detailLoad + microLoad);
      image.data[index] = byte(nr * (1 - protect * .18) + centerR * protect * .18);
      image.data[index + 1] = byte(ng * (1 - protect * .18) + centerG * protect * .18);
      image.data[index + 2] = byte(nb * (1 - protect * .18) + centerB * protect * .18);
    }
  }
  context.putImageData(image, 0, 0);
}

function isSkinPixel(r, g, b) {
  const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b);
  return r > 80 && g > 30 && b > 15 && maximum - minimum > 12 && r > g * .92 && r > b;
}

function clamp01(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }
function byte(value) { return Math.max(0, Math.min(255, Math.round(value))); }

/** Inspects GFPGAN and CodeFormer exports without assuming input order. */
export function resolveFaceSignature(session, config = {}) {
  const names = session.inputNames || [];
  const candidates = names.map((name, index) => ({ name, dimensions: metadataDimensions(session, name, index) }));
  const image = candidates.find((item) => item.dimensions.length >= 4 && (Number(item.dimensions[1]) === 3 || Number(item.dimensions[3]) === 3)) || candidates[0];
  if (!image) throw new Error('Face model has no input tensor');
  const channelsFirst = Number(image.dimensions[1]) === 3 || Number(image.dimensions[3]) !== 3;
  if (!channelsFirst) throw new Error('NHWC face models are not supported; export the model as NCHW [1,3,H,W]');
  const height = positiveDimension(image.dimensions[2]);
  const width = positiveDimension(image.dimensions[3]);
  if (height && width && height !== width) throw new Error(`Face model input must be square; received ${width}x${height}`);
  const inputSize = height || width || config.inputSize || 512;
  const auxiliaryInputs = candidates.filter((item) => item.name !== image.name).map((item) => item.name);
  for (const name of auxiliaryInputs) {
    if (!/(w|weight|fidelity|strength)/i.test(name)) throw new Error(`Unsupported face-model auxiliary input: ${name}`);
  }
  return { imageInput: image.name, inputSize, auxiliaryInputs };
}

export function buildFaceFeeds(session, ort, signature, image, fidelity = 0.5) {
  const size = signature.inputSize;
  const feeds = { [signature.imageInput]: new ort.Tensor('float32', image, [1, 3, size, size]) };
  for (const name of signature.auxiliaryInputs) {
    const index = session.inputNames.indexOf(name);
    const dimensions = metadataDimensions(session, name, index).map((value) => positiveDimension(value) || 1);
    const shape = dimensions.length ? dimensions : [];
    const count = Math.max(1, shape.reduce((total, value) => total * value, 1));
    feeds[name] = new ort.Tensor('float32', new Float32Array(count).fill(Math.max(0, Math.min(1, fidelity))), shape);
  }
  return feeds;
}

function selectImageOutput(session, results, expectedLength) {
  for (const name of session.outputNames || Object.keys(results)) {
    const tensor = results[name];
    if (tensor?.data?.length === expectedLength) return { data: tensor.data, dims: tensor.dims, name };
  }
  return null;
}

function metadataDimensions(session, name, index) {
  const metadata = session.inputMetadata;
  const item = Array.isArray(metadata) ? metadata[index] : metadata?.[name] || metadata?.[index];
  return item?.dimensions || item?.shape || [];
}

function positiveDimension(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function expandBox(box, maxWidth, maxHeight, ratio) {
  const growX = box.width * ratio / 2;
  const growY = box.height * ratio / 2;
  const x = Math.max(0, Math.floor(box.x - growX));
  const y = Math.max(0, Math.floor(box.y - growY));
  const right = Math.min(maxWidth, Math.ceil(box.x + box.width + growX));
  const bottom = Math.min(maxHeight, Math.ceil(box.y + box.height + growY));
  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
    ...(Array.isArray(box.landmarks) ? { landmarks: box.landmarks.map(([pointX, pointY]) => [pointX, pointY]) } : {}),
    ...(Number.isFinite(box.score) ? { score: box.score } : {}),
  };
}

/** Smooths matched detections to prevent face crops from vibrating per frame. */
export function stabilizeFaceBoxes(previous = [], current = [], smoothing = 0.62) {
  const remaining = [...current];
  const output = [];
  for (const oldBox of previous) {
    let bestIndex = -1;
    let bestScore = 0;
    for (let index = 0; index < remaining.length; index++) {
      const score = intersectionOverUnion(oldBox, remaining[index]);
      if (score > bestScore) { bestScore = score; bestIndex = index; }
    }
    if (bestIndex < 0 || bestScore < 0.08) continue;
    const next = remaining.splice(bestIndex, 1)[0];
    output.push({
      x: Math.round(oldBox.x * smoothing + next.x * (1 - smoothing)),
      y: Math.round(oldBox.y * smoothing + next.y * (1 - smoothing)),
      width: Math.round(oldBox.width * smoothing + next.width * (1 - smoothing)),
      height: Math.round(oldBox.height * smoothing + next.height * (1 - smoothing)),
      ...(canBlendLandmarks(oldBox, next) ? {
        landmarks: next.landmarks.map(([pointX, pointY], point) => [
          oldBox.landmarks[point][0] * smoothing + pointX * (1 - smoothing),
          oldBox.landmarks[point][1] * smoothing + pointY * (1 - smoothing),
        ]),
      } : Array.isArray(next.landmarks) ? { landmarks: next.landmarks.map(([pointX, pointY]) => [pointX, pointY]) } : {}),
      ...(Number.isFinite(next.score) ? { score: next.score } : {}),
    });
  }
  return output.concat(remaining);
}

/** Returns a bounded in-plane face rotation from YuNet eye landmarks. */
export function faceRollRadians(landmarks, maximumDegrees = 35) {
  if (!Array.isArray(landmarks) || landmarks.length < 2) return 0;
  const [firstEye, secondEye] = landmarks;
  if (!firstEye?.every(Number.isFinite) || !secondEye?.every(Number.isFinite)) return 0;
  const dx = secondEye[0] - firstEye[0], dy = secondEye[1] - firstEye[1];
  if (Math.hypot(dx, dy) < 2) return 0;
  const maximum = maximumDegrees * Math.PI / 180;
  return Math.max(-maximum, Math.min(maximum, Math.atan2(dy, dx)));
}

function drawAlignedFaceCrop(context, source, box, size, roll) {
  const centerX = box.x + box.width / 2, centerY = box.y + box.height / 2;
  context.save();
  context.translate(size / 2, size / 2);
  context.scale(size / box.width, size / box.height);
  context.rotate(-roll);
  context.translate(-centerX, -centerY);
  context.drawImage(source, 0, 0);
  context.restore();
}

function drawAlignedFaceResult(context, crop, box, size, roll) {
  const centerX = box.x + box.width / 2, centerY = box.y + box.height / 2;
  context.translate(centerX, centerY);
  context.rotate(roll);
  context.scale(box.width / size, box.height / size);
  context.drawImage(crop, -size / 2, -size / 2);
}

function canBlendLandmarks(previous, current) {
  return Array.isArray(previous.landmarks) && Array.isArray(current.landmarks)
    && previous.landmarks.length === current.landmarks.length
    && previous.landmarks.every((point) => Array.isArray(point) && point.length >= 2)
    && current.landmarks.every((point) => Array.isArray(point) && point.length >= 2);
}

function cloneFaceBox(face) {
  return {
    x: face.x,
    y: face.y,
    width: face.width,
    height: face.height,
    ...(Array.isArray(face.landmarks) ? { landmarks: face.landmarks.map(([x, y]) => [x, y]) } : {}),
    ...(Number.isFinite(face.score) ? { score: face.score } : {}),
  };
}

function intersectionOverUnion(a, b) {
  const left = Math.max(a.x, b.x), top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  return intersection / Math.max(1, a.width * a.height + b.width * b.height - intersection);
}

/** Lightweight offline fallback when the experimental Shape Detection API is absent. */
function detectFacesBySkin(source, { maxFaces, width, height }) {
  const sampleWidth = 120;
  const sampleHeight = Math.max(64, Math.round(sampleWidth * height / width));
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(sampleWidth, sampleHeight) : document.createElement('canvas');
  canvas.width = sampleWidth; canvas.height = sampleHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(source, 0, 0, sampleWidth, sampleHeight);
  const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
  const cell = 6, columns = Math.ceil(sampleWidth / cell), rows = Math.ceil(sampleHeight / cell);
  const mask = new Uint8Array(columns * rows);
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < columns; cx++) {
    let skin = 0, count = 0;
    for (let y = cy * cell; y < Math.min(sampleHeight, (cy + 1) * cell); y += 2) for (let x = cx * cell; x < Math.min(sampleWidth, (cx + 1) * cell); x += 2) {
      const index = (y * sampleWidth + x) * 4;
      if (isProbableSkin(pixels[index], pixels[index + 1], pixels[index + 2])) skin++;
      count++;
    }
    if (skin / Math.max(1, count) > 0.34) mask[cy * columns + cx] = 1;
  }
  const components = connectedComponents(mask, columns, rows)
    .filter((item) => item.cells >= 3 && item.maxX - item.minX >= 1 && item.maxY - item.minY >= 1)
    .map((item) => {
      const x = item.minX * cell / sampleWidth * width;
      const y = item.minY * cell / sampleHeight * height;
      const boxWidth = (item.maxX - item.minX + 1) * cell / sampleWidth * width;
      const boxHeight = (item.maxY - item.minY + 1) * cell / sampleHeight * height;
      const side = Math.max(boxWidth, boxHeight * 0.82) * 1.65;
      return expandBox({ x: x + boxWidth / 2 - side / 2, y: y + boxHeight / 2 - side * 0.48, width: side, height: side }, width, height, 0);
    })
    .filter((box) => box.width >= width * 0.08 && box.height >= height * 0.08)
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .slice(0, maxFaces);
  canvas.width = 1; canvas.height = 1;
  return components;
}

function connectedComponents(mask, width, height) {
  const visited = new Uint8Array(mask.length), components = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || visited[start]) continue;
    const queue = [start]; visited[start] = 1;
    const component = { minX: width, minY: height, maxX: 0, maxY: 0, cells: 0 };
    while (queue.length) {
      const index = queue.pop(), x = index % width, y = Math.floor(index / width);
      component.minX = Math.min(component.minX, x); component.maxX = Math.max(component.maxX, x);
      component.minY = Math.min(component.minY, y); component.maxY = Math.max(component.maxY, y); component.cells++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[next] && !visited[next]) { visited[next] = 1; queue.push(next); }
      }
    }
    components.push(component);
  }
  return components;
}

function isProbableSkin(r, g, b) {
  const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
  const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
  return r + g + b > 90 && cb >= 72 && cb <= 138 && cr >= 126 && cr <= 184;
}

function applyFeatherMask(context, size) {
  context.save();
  context.globalCompositeOperation = 'destination-in';
  const gradient = context.createRadialGradient(size / 2, size / 2, size * 0.36, size / 2, size / 2, size * 0.7);
  gradient.addColorStop(0, 'rgba(0,0,0,1)');
  gradient.addColorStop(0.78, 'rgba(0,0,0,0.96)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  context.restore();
}

function normalizeInput(values, range) {
  if (range !== 'minus-one-to-one') return values;
  for (let index = 0; index < values.length; index++) values[index] = values[index] * 2 - 1;
  return values;
}

function denormalizeOutput(values, range) {
  const output = new Float32Array(values.length);
  if (range === 'minus-one-to-one') {
    for (let index = 0; index < values.length; index++) output[index] = Math.max(0, Math.min(1, (values[index] + 1) / 2));
  } else {
    for (let index = 0; index < values.length; index++) output[index] = Math.max(0, Math.min(1, values[index]));
  }
  return output;
}
