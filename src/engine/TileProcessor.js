// TileProcessor — real tile splitting + overlap-blended reassembly.
// This is the mechanical piece of "Tile Processing" that was previously
// only described in comments. It is inference-agnostic: you hand it a
// `runInference(tileImageData) => Promise<upscaledTileImageData>` callback,
// and it handles splitting the source frame, calling that callback per
// tile, and reassembling the result with linear-ramp blending across
// overlaps so tile seams don't show up as visible edges.
//
// Correctness of the split/reassemble math is verified directly (Node,
// no browser/network needed) in TileProcessor.test.mjs — a solid-color
// input run through an identity "inference" must come back solid-color
// with no seam artifacts. Real neural-network correctness (does the
// actual model produce good upscaled pixels) still requires a real model
// and cannot be tested without network access to fetch one.

/**
 * Computes tile positions covering a WxH image with the given tile size
 * and overlap. Tiles at the right/bottom edge are shrunk to fit rather
 * than padded, so no tile ever reads outside the source image.
 */
export function computeTileLayout(width, height, tileSize, overlap) {
  const stride = tileSize - overlap;
  if (stride <= 0) throw new Error(`overlap (${overlap}) must be smaller than tileSize (${tileSize})`);

  const tiles = [];
  for (let y = 0; y < height; y += stride) {
    const th = Math.min(tileSize, height - y);
    if (th <= 0) break;
    for (let x = 0; x < width; x += stride) {
      const tw = Math.min(tileSize, width - x);
      if (tw <= 0) break;
      tiles.push({ x, y, width: tw, height: th });
      if (x + tw >= width) break; // last tile in row reached the edge — don't add a redundant one
    }
    if (y + th >= height) break;
  }
  return tiles;
}

/** Extracts one tile as ImageData from a full-frame ImageData (or canvas-like source via ctx). */
export function extractTile(ctx, tile) {
  return ctx.getImageData(tile.x, tile.y, tile.width, tile.height);
}

/**
 * Runs every tile through `runInference` (may run sequentially or with
 * limited concurrency — caller controls via `concurrency`) and composites
 * the results into a full output canvas at `scale`x the source size, with
 * linear-ramp blending across overlapping regions.
 *
 * @param {CanvasRenderingContext2D} srcCtx - source frame, already drawn
 * @param {number} width - source width
 * @param {number} height - source height
 * @param {number} scale - upscale factor (e.g. 4)
 * @param {number} tileSize
 * @param {number} overlap
 * @param {(tileImageData: ImageData) => Promise<ImageData>} runInference
 * @param {number} concurrency - how many tiles to process in parallel (default 1 — sequential, safest for memory on mobile)
 * @returns {Promise<{ compose: (destCtx: CanvasRenderingContext2D) => void }>}
 *   Returns a compose function rather than a raw ImageData so the caller
 *   controls exactly when the (potentially large) output canvas is touched.
 */
export async function processTiled({
  srcCtx,
  destCtx = null,
  width,
  height,
  scale,
  tileSize,
  overlap,
  runInference,
  concurrency = 1,
  signal = null,
  onProgress = null,
}) {
  const tiles = computeTileLayout(width, height, tileSize, overlap);
  const outW = width * scale, outH = height * scale;
  const ownsCanvas = !destCtx;
  const outputCanvas = ownsCanvas ? new OffscreenCanvas(outW, outH) : destCtx.canvas;
  const output = destCtx || outputCanvas.getContext('2d', { alpha: false });
  output.save();
  output.clearRect(0, 0, outW, outH);
  output.globalCompositeOperation = 'lighter';
  let completed = 0;
  // Keep only 1D edge weights and one reusable scratch canvas. The old
  // compositor allocated a full WxH alpha mask plus a fresh OffscreenCanvas
  // for every tile, causing avoidable GC/VRAM churn. RGB values and the exact
  // blend equation are unchanged.
  const axisWeightCache = new Map();
  const maxTileOutput = Math.max(1, tileSize * scale);
  const scratchCanvas = new OffscreenCanvas(maxTileOutput, maxTileOutput);
  const scratchContext = scratchCanvas.getContext('2d', { alpha: true });

  async function processOne(tile) {
    if (signal?.aborted) throw signal.reason || new DOMException('Tile processing cancelled', 'AbortError');
    const tileImg = extractTile(srcCtx, tile);
    const upscaledTile = await runInference(tileImg);
    const tw = tile.width * scale, th = tile.height * scale;
    if (upscaledTile.width !== tw || upscaledTile.height !== th) {
      throw new Error(`Inference callback returned ${upscaledTile.width}x${upscaledTile.height}, expected ${tw}x${th} for a ${scale}x scale on a ${tile.width}x${tile.height} tile.`);
    }
    const destX = tile.x * scale, destY = tile.y * scale;
    const weighted = upscaledTile; // safe to reuse: this ImageData is tile-local and discarded after compositing
    const hasTop = tile.y > 0, hasBottom = tile.y + tile.height < height, hasLeft = tile.x > 0, hasRight = tile.x + tile.width < width;
    const overlapPx = overlap * scale;
    const xKey = `x:${tw}:${overlapPx}:${+hasLeft}${+hasRight}`;
    const yKey = `y:${th}:${overlapPx}:${+hasTop}${+hasBottom}`;
    let xWeights = axisWeightCache.get(xKey);
    let yWeights = axisWeightCache.get(yKey);
    if (!xWeights) { xWeights = buildAxisWeights(tw, overlapPx, hasLeft, hasRight); axisWeightCache.set(xKey, xWeights); }
    if (!yWeights) { yWeights = buildAxisWeights(th, overlapPx, hasTop, hasBottom); axisWeightCache.set(yKey, yWeights); }
    let p = 3;
    for (let y = 0; y < th; y++) {
      const wy = yWeights[y];
      for (let x = 0; x < tw; x++, p += 4) weighted.data[p] = Math.round(255 * xWeights[x] * wy);
    }
    scratchContext.clearRect(0, 0, tw, th);
    scratchContext.putImageData(weighted, 0, 0);
    output.drawImage(scratchCanvas, 0, 0, tw, th, destX, destY, tw, th);
    completed++;
    onProgress?.({ completed, total: tiles.length, progress: completed / tiles.length });
  }

  // Sequential by default (concurrency=1) — deliberate: running many tiles
  // through a GPU model in parallel is exactly the kind of memory pressure
  // implicated in real Android WebGPU device-loss reports (see
  // ENGINE_TEST_REPORT.md). Callers on higher PerformanceManager tiers can
  // raise concurrency explicitly.
  try {
    let batchIndex = 0;
    for (let i = 0; i < tiles.length; i += concurrency) {
      const batch = tiles.slice(i, i + concurrency);
      await Promise.all(batch.map(processOne));
      batchIndex++;
      if (batchIndex % 4 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
  } finally {
    // Cancellation/inference failure must not leak canvas state or retain a
    // max-sized scratch backing store into the next frame.
    output.restore();
    scratchCanvas.width = 1;
    scratchCanvas.height = 1;
  }

  return {
    compose(targetContext) {
      if (targetContext !== output) targetContext.drawImage(outputCanvas, 0, 0);
    },
    width: outW,
    height: outH,
    release() {
      if (ownsCanvas) {
        outputCanvas.width = 1;
        outputCanvas.height = 1;
      }
    },
  };
}

export class TileProcessor {
  constructor({ tileSize = 256, overlap = 16, batchSize = 1 } = {}) {
    this.tileSize = tileSize;
    this.overlap = overlap;
    this.batchSize = batchSize;
  }

  configure({ tileSize, overlap, batchSize } = {}) {
    if (tileSize != null) this.tileSize = Math.max(64, Math.floor(tileSize));
    if (overlap != null) this.overlap = Math.max(0, Math.floor(overlap));
    if (batchSize != null) this.batchSize = Math.max(1, Math.floor(batchSize));
    if (this.overlap >= this.tileSize) this.overlap = Math.floor(this.tileSize / 8);
  }

  async process(options) {
    return processTiled({
      tileSize: this.tileSize,
      overlap: this.overlap,
      concurrency: this.batchSize,
      ...options,
    });
  }

  estimatePeakBytes(width, height, scale = 1) {
    const sourceTile = this.tileSize * this.tileSize * 4;
    const outputTile = sourceTile * scale * scale;
    const destination = width * height * scale * scale * 4;
    return destination + (sourceTile + outputTile) * this.batchSize;
  }
}

/**
 * Linear ramp from 0 to 1 across the overlap region at an edge that
 * actually borders another tile (hasPrev/hasNext), full weight (1) in the
 * interior and at edges that border the image boundary (no neighboring
 * tile to blend with there).
 */
function buildAxisWeights(length, overlapPx, hasPrev, hasNext) {
  const weights = new Float32Array(length);
  for (let i = 0; i < length; i++) weights[i] = edgeRampWeight(i, length, overlapPx, hasPrev, hasNext);
  return weights;
}

function edgeRampWeight(pos, length, overlapPx, hasPrev, hasNext) {
  let w = 1;
  if (hasPrev && pos < overlapPx) w = Math.min(w, (pos + 0.5) / overlapPx);
  if (hasNext && pos >= length - overlapPx) w = Math.min(w, (length - pos - 0.5) / overlapPx);
  return Math.max(0, Math.min(1, w));
}
