import { MODEL_REGISTRY } from './UpscaleEngine.js';
import { RIFE_MODEL_REGISTRY } from './RIFEEngine.js';
import { FACE_MODEL_REGISTRY } from './FaceRestorationEngine.js';

/**
 * Requirement-driven model selection. It never pretends to detect visual
 * content it has not analysed; decisions are based on requested geometry,
 * FPS, face mode, device profile and verified installation state.
 */
export class ModelAutoSelector {
  constructor({ models, upscale, rife, face } = {}) {
    this.models = models;
    this.upscale = upscale;
    this.rife = rife;
    this.face = face;
  }

  async select({ source = {}, output = {}, targetFps = null, wantsFace = false, deviceProfile = null } = {}) {
    const sourcePixels = Math.max(1, Number(source.width || 0) * Number(source.height || 0));
    const outputPixels = Math.max(1, Number(output.width || source.width || 0) * Number(output.height || source.height || 0));
    const upscaleNeeded = outputPixels > sourcePixels * 1.08;
    const sourceFps = Math.max(1, Number(source.fps || 30));
    const fps = Math.max(1, Number(targetFps || sourceFps));
    const rifeNeeded = fps > sourceFps + 0.01;
    const mobileFirst = deviceProfile?.id === 'poco-f6' || deviceProfile?.recommendedMode === 'poco-f6';

    const result = {
      upscaleModelId: null,
      rifeModelId: null,
      faceModelId: null,
      reasons: [],
    };

    if (upscaleNeeded) {
      const preferred = mobileFirst
        ? ['realesr-general-x4v3-turbo', 'onnx-model-zoo-sr-x3', 'real-esrgan-x4plus']
        : ['real-esrgan-x4plus', 'realesr-general-x4v3-turbo', 'onnx-model-zoo-sr-x3'];
      result.upscaleModelId = await this._firstReady(preferred, this.upscale, MODEL_REGISTRY);
      if (!result.upscaleModelId) result.upscaleModelId = preferred[0];
      result.reasons.push(`upscale:${result.upscaleModelId}`);
    }

    if (rifeNeeded) {
      const preferred = ['rife-tensorstack', 'rife47-emmajohnson311'];
      result.rifeModelId = await this._firstReady(preferred, this.rife, RIFE_MODEL_REGISTRY) || preferred[0];
      result.reasons.push(`rife:${result.rifeModelId}`);
    }

    if (wantsFace) {
      const preferred = mobileFirst ? ['gfpgan-1.4', 'codeformer'] : ['codeformer', 'gfpgan-1.4'];
      result.faceModelId = await this._firstReady(preferred, this.face, FACE_MODEL_REGISTRY) || preferred[0];
      result.reasons.push(`face:${result.faceModelId}`);
    }
    return result;
  }

  async _firstReady(ids, engine, registry) {
    for (const id of ids) {
      if (!registry[id]) continue;
      try {
        const status = await engine?.isAvailable?.(id);
        if (status?.available) return id;
      } catch {}
    }
    return null;
  }
}
