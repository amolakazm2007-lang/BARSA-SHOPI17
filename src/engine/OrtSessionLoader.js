/**
 * Creates ONNX Runtime Web sessions while avoiding an unconditional full
 * OPFS -> ArrayBuffer copy in JS heap. Blob URL loading is attempted first
 * when a verified OPFS File is available; the legacy ArrayBuffer path remains
 * an automatic compatibility fallback. Model bytes and inference math are
 * identical on both paths.
 */
export async function createOrtSessionWithFallback({ modelManager, ort, modelId, webgpuOptions = [], wasmOptions = null }) {
  const errors = [];
  const sources = [];
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof modelManager?.openModelFile === 'function') {
    sources.push({
      kind: 'opfs-blob-url',
      async open() {
        const file = await modelManager.openModelFile(modelId);
        const url = URL.createObjectURL(file);
        return { value: url, close: () => URL.revokeObjectURL(url) };
      },
    });
  }
  sources.push({
    kind: 'array-buffer',
    async open() { return { value: await modelManager.loadModelBuffer(modelId), close: () => {} }; },
  });

  for (const source of sources) {
    let opened;
    try {
      opened = await source.open();
      for (const attempt of webgpuOptions) {
        try {
          const session = await ort.InferenceSession.create(opened.value, attempt.options);
          return { session, executionProvider: 'webgpu', sourceKind: source.kind, graphCaptureEnabled: Boolean(attempt.graphCapture) };
        } catch (error) {
          errors.push(`${source.kind}:webgpu${attempt.graphCapture ? ':graph' : ''}:${error?.message || error}`);
        }
      }
      if (wasmOptions) {
        try {
          const session = await ort.InferenceSession.create(opened.value, wasmOptions);
          return { session, executionProvider: 'wasm', sourceKind: source.kind, graphCaptureEnabled: false };
        } catch (error) {
          errors.push(`${source.kind}:wasm:${error?.message || error}`);
        }
      }
    } catch (error) {
      errors.push(`${source.kind}:source:${error?.message || error}`);
    } finally {
      try { opened?.close?.(); } catch {}
    }
  }
  throw new Error(`ONNX session creation failed for ${modelId}: ${errors.slice(-4).join(' | ')}`);
}
