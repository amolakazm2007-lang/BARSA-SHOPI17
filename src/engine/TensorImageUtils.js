// Lightweight pixel/tensor conversion helpers. This module deliberately has no
// ONNX/native-AI imports so VideoPipeline can use it without loading UpscaleEngine.
export function imageDataToChwFloat32(imageData, target = null) {
  const { width, height, data } = imageData;
  const chw = target || new Float32Array(3 * width * height);
  if (chw.length !== 3 * width * height) throw new RangeError('CHW target has the wrong length');
  const plane = width * height;
  for (let i = 0; i < plane; i++) {
    chw[i] = data[i * 4] / 255;
    chw[plane + i] = data[i * 4 + 1] / 255;
    chw[2 * plane + i] = data[i * 4 + 2] / 255;
  }
  return chw;
}

export function chwFloat32ToImageData(chw, width, height) {
  const plane = width * height;
  const data = new Uint8ClampedArray(4 * plane);
  for (let i = 0; i < plane; i++) {
    data[i * 4] = Math.round(chw[i] * 255);
    data[i * 4 + 1] = Math.round(chw[plane + i] * 255);
    data[i * 4 + 2] = Math.round(chw[2 * plane + i] * 255);
    data[i * 4 + 3] = 255;
  }
  return new ImageData(data, width, height);
}
