// Lightweight render metadata used by startup/runtime planning.
// Keep inference implementations out of this module so importing VideoPipeline
// never pulls ONNX/FFmpeg engine code into the startup chunk.
export const UPSCALE_RENDER_CATALOG = Object.freeze({
  'realesr-general-x4v3-turbo': Object.freeze({ scale: 4, tileSize: 192, overlap: 12 }),
  'onnx-model-zoo-sr-x3': Object.freeze({ scale: 3, tileSize: 224, overlap: 12 }),
  'real-esrgan-compatible-x4': Object.freeze({ scale: 4, tileSize: 256, overlap: 16 }),
  'real-esrgan-x4plus': Object.freeze({ scale: 4, tileSize: 128, overlap: 12 }),
  'real-esrgan-x8-facefusion': Object.freeze({ scale: 8, tileSize: 256, overlap: 12 }),
  'real-cugan-x2-fp16': Object.freeze({ scale: 2, tileSize: 256, overlap: 12 }),
});

export const QUALITY_PRESETS = Object.freeze({
  LOW: Object.freeze({ codec: 'libx264', crf: 28, preset: 'veryfast', audioBitrateK: 96, bitsPerPixel: 0.065 }),
  BALANCED: Object.freeze({ codec: 'libx264', crf: 21, preset: 'fast', audioBitrateK: 160, bitsPerPixel: 0.11 }),
  HIGH: Object.freeze({ codec: 'libx264', crf: 17, preset: 'medium', audioBitrateK: 224, bitsPerPixel: 0.18 }),
  ULTRA: Object.freeze({ codec: 'libx264', crf: 13, preset: 'slow', audioBitrateK: 320, bitsPerPixel: 0.28 }),
});

export function getUpscaleRenderConfig(modelId) {
  return UPSCALE_RENDER_CATALOG[modelId] || null;
}
