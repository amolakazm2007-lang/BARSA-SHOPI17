const ASPECT_RATIOS = Object.freeze({
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
  '3:4': 3 / 4,
  '4:3': 4 / 3,
  '21:9': 21 / 9,
});

const SHORT_EDGE_PRESETS = Object.freeze({
  720: 720,
  1080: 1080,
  1440: 1440,
  2160: 2160,
  4320: 4320,
});

/**
 * Resolves an even-sized output canvas for landscape, portrait, square,
 * ultrawide, or arbitrary custom dimensions. Named resolution presets refer
 * to the short edge, so 1080 means 1920×1080 for 16:9 and 1080×1920 for 9:16.
 */
export function resolveOutputGeometry(sourceWidth, sourceHeight, settings = {}) {
  assertDimension(sourceWidth, 'sourceWidth');
  assertDimension(sourceHeight, 'sourceHeight');
  const resolution = String(settings.resolution || 'original');
  const requestedAspect = String(settings.aspectRatio || 'original');
  const sourceAspect = sourceWidth / sourceHeight;
  const aspect = requestedAspect === 'original'
    ? sourceAspect
    : ASPECT_RATIOS[requestedAspect] || customAspect(settings);

  let width;
  let height;
  if (resolution === 'custom') {
    width = Number(settings.customWidth);
    height = Number(settings.customHeight);
    assertDimension(width, 'customWidth');
    assertDimension(height, 'customHeight');
  } else if (resolution === 'original') {
    const shortEdge = Math.min(sourceWidth, sourceHeight);
    ({ width, height } = dimensionsFromShortEdge(shortEdge, aspect));
  } else {
    const shortEdge = SHORT_EDGE_PRESETS[resolution];
    if (!shortEdge) throw new RangeError(`Unsupported resolution preset: ${resolution}`);
    ({ width, height } = dimensionsFromShortEdge(shortEdge, aspect));
  }

  ({ width, height } = evenSize(width, height));
  if (width > 8192 || height > 8192) {
    throw new RangeError(`Output ${width}×${height} exceeds the safe browser limit of 8192 pixels per edge`);
  }
  const fitMode = ['contain', 'cover', 'stretch'].includes(settings.fitMode) ? settings.fitMode : 'contain';
  return {
    width,
    height,
    aspect: width / height,
    requestedAspect,
    fitMode,
    backgroundColor: normalizeColor(settings.backgroundColor),
    placement: calculatePlacement(sourceWidth, sourceHeight, width, height, fitMode),
  };
}

/** Returns crop/source and destination rectangles for Canvas rendering. */
export function calculatePlacement(sourceWidth, sourceHeight, outputWidth, outputHeight, fitMode = 'contain') {
  for (const [value, label] of [[sourceWidth, 'sourceWidth'], [sourceHeight, 'sourceHeight'], [outputWidth, 'outputWidth'], [outputHeight, 'outputHeight']]) {
    assertDimension(value, label);
  }
  if (fitMode === 'stretch') {
    return { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight, dx: 0, dy: 0, dw: outputWidth, dh: outputHeight };
  }
  const sourceAspect = sourceWidth / sourceHeight;
  const outputAspect = outputWidth / outputHeight;
  if (fitMode === 'cover') {
    let sx = 0; let sy = 0; let sw = sourceWidth; let sh = sourceHeight;
    if (sourceAspect > outputAspect) {
      sw = sourceHeight * outputAspect;
      sx = (sourceWidth - sw) / 2;
    } else {
      sh = sourceWidth / outputAspect;
      sy = (sourceHeight - sh) / 2;
    }
    return { sx, sy, sw, sh, dx: 0, dy: 0, dw: outputWidth, dh: outputHeight };
  }
  let dw = outputWidth; let dh = outputHeight;
  if (sourceAspect > outputAspect) dh = outputWidth / sourceAspect;
  else dw = outputHeight * sourceAspect;
  return {
    sx: 0,
    sy: 0,
    sw: sourceWidth,
    sh: sourceHeight,
    dx: (outputWidth - dw) / 2,
    dy: (outputHeight - dh) / 2,
    dw,
    dh,
  };
}

/** Draws a source without accidental aspect distortion. */
export function drawWithGeometry(source, context, geometry, sourceWidth = source.width, sourceHeight = source.height) {
  const placement = calculatePlacement(sourceWidth, sourceHeight, geometry.width, geometry.height, geometry.fitMode);
  context.save();
  context.fillStyle = geometry.backgroundColor || '#000000';
  context.fillRect(0, 0, geometry.width, geometry.height);
  context.drawImage(
    source,
    placement.sx,
    placement.sy,
    placement.sw,
    placement.sh,
    placement.dx,
    placement.dy,
    placement.dw,
    placement.dh,
  );
  context.restore();
  return placement;
}

/** FFmpeg equivalent of drawWithGeometry, using Lanczos scaling. */
export function buildFFmpegGeometryFilters(geometry) {
  const { width, height, fitMode } = geometry;
  if (fitMode === 'stretch') return [`scale=${width}:${height}:flags=lanczos`, 'setsar=1'];
  if (fitMode === 'cover') {
    return [
      `scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos`,
      `crop=${width}:${height}`,
      'setsar=1',
    ];
  }
  const color = String(geometry.backgroundColor || '#000000').replace('#', '0x');
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=${color}`,
    'setsar=1',
  ];
}

/**
 * Bounds fixed-scale ONNX intermediate canvases. This keeps a 4K→8K job from
 * accidentally allocating a 12K × 6K surface when a ×3 model is selected.
 */
export function resolveAIWorkingSize(sourceWidth, sourceHeight, modelScale, {
  maxOutputEdge = 8192,
  maxOutputPixels = 33_554_432,
} = {}) {
  assertDimension(sourceWidth, 'sourceWidth');
  assertDimension(sourceHeight, 'sourceHeight');
  if (!Number.isFinite(modelScale) || modelScale <= 1) throw new RangeError('modelScale must be greater than 1');
  const rawWidth = sourceWidth * modelScale;
  const rawHeight = sourceHeight * modelScale;
  const edgeScale = Math.min(1, maxOutputEdge / Math.max(rawWidth, rawHeight));
  const pixelScale = Math.min(1, Math.sqrt(maxOutputPixels / (rawWidth * rawHeight)));
  const scale = Math.min(edgeScale, pixelScale);
  const input = evenSize(sourceWidth * scale, sourceHeight * scale);
  return {
    inputWidth: input.width,
    inputHeight: input.height,
    outputWidth: input.width * modelScale,
    outputHeight: input.height * modelScale,
    downscaledInput: scale < 0.999,
  };
}

function dimensionsFromShortEdge(shortEdge, aspect) {
  if (aspect >= 1) return { width: shortEdge * aspect, height: shortEdge };
  return { width: shortEdge, height: shortEdge / aspect };
}

function customAspect(settings) {
  const width = Number(settings.customWidth);
  const height = Number(settings.customHeight);
  return width > 0 && height > 0 ? width / height : 16 / 9;
}

function normalizeColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#000000';
}

function evenSize(width, height) {
  return {
    width: Math.max(2, Math.round(width / 2) * 2),
    height: Math.max(2, Math.round(height / 2) * 2),
  };
}

function assertDimension(value, label) {
  if (!Number.isFinite(Number(value)) || Number(value) < 2) throw new RangeError(`${label} must be at least 2 pixels`);
}
