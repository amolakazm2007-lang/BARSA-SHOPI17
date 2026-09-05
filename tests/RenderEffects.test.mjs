import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFFmpegVideoFilter } from '../src/engine/VideoPipeline.js';

test('FFmpeg render fallback maps every visible effect family', () => {
  const filter = buildFFmpegVideoFilter({ effects: {
    brightness: .1, exposure: .3, contrast: 1.1, saturation: 1.2, vibrance: .2,
    highlights: -.2, shadows: .2, whites: .1, blacks: -.1, dehaze: .2,
    denoiseAmount: .3, sharpenAmount: .5, highPassAmount: .2, detailAmount: .3,
    deblockAmount: .2, debandAmount: .2, artifactRemoval: .2,
    fineDetailRecovery: .2, textureRecovery: .2, edgeRecovery: .2,
    clarity: .2, localContrast: .2, dehalo: .2, antiRinging: .2,
    antiFlicker: .2, temporalDetailStability: .2, temperature: .15, tint: .1,
    lift: .02, gain: 1.05, vignette: .2, grain: .1,
  } }, { width: 1920, height: 1080 }, 30);
  for (const stage of ['scale=1920:1080', 'fps=30', 'eq=', 'hqdn3d=', 'deblock=', 'deband=', 'unsharp=', 'colorbalance=', 'colorlevels=', 'deflicker=', 'tmix=', 'vignette=', 'noise=']) assert.match(filter, new RegExp(stage.replace(/[=]/g, '\\=')));
  assert.doesNotMatch(filter, /portraitSmooth|smartblur/);
});
