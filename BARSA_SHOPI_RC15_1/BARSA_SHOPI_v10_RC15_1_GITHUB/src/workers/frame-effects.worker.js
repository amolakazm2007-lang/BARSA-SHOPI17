import { applyRealtimeEffects } from '../engine/RealtimePreviewEngine.js';
import { applyColorToImageData } from '../engine/ColorEngine.js';

self.onmessage = (event) => {
  const { id, width, height, buffer, effects, compiledColor } = event.data || {};
  try {
    const image = new ImageData(new Uint8ClampedArray(buffer), width, height);
    if (effects) applyRealtimeEffects(image, effects);
    if (compiledColor) applyColorToImageData(image, compiledColor);
    self.postMessage({ id, ok: true, buffer: image.data.buffer }, [image.data.buffer]);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
};
