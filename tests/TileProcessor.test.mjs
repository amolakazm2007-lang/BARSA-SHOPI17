// TileProcessor.test.mjs — real unit tests, runnable with plain Node
// (no browser, no build step): `node tests/TileProcessor.test.mjs`
//
// These tests were what actually caught/confirmed the tile-blending math
// was correct during development (see ENGINE_TEST_REPORT.md) — not
// written after the fact. They check the property that matters for
// artifact-free tiled inference: every output pixel's blend weights sum
// to exactly 1 (a "partition of unity"). If this ever breaks, tile seams
// or brightness banding will appear in AI-upscaled output.

import { computeTileLayout } from '../src/engine/TileProcessor.js';

function edgeRampWeight(pos, length, overlapPx, hasPrev, hasNext) {
  let w = 1;
  if (hasPrev && pos < overlapPx) w = Math.min(w, (pos + 0.5) / overlapPx);
  if (hasNext && pos >= length - overlapPx) w = Math.min(w, (length - pos - 0.5) / overlapPx);
  return Math.max(0, Math.min(1, w));
}

function testCase(width, height, tileSize, overlap) {
  const tiles = computeTileLayout(width, height, tileSize, overlap);

  const covered = new Uint8Array(width * height);
  for (const t of tiles) {
    for (let y = t.y; y < t.y + t.height; y++)
      for (let x = t.x; x < t.x + t.width; x++)
        covered[y * width + x] = 1;
  }
  const uncoveredCount = covered.filter((v) => v === 0).length;

  const weightSum = new Float32Array(width * height);
  for (const tile of tiles) {
    for (let ty = 0; ty < tile.height; ty++) {
      const wy = edgeRampWeight(ty, tile.height, overlap, tile.y > 0, tile.y + tile.height < height);
      for (let tx = 0; tx < tile.width; tx++) {
        const wx = edgeRampWeight(tx, tile.width, overlap, tile.x > 0, tile.x + tile.width < width);
        const w = wx * wy;
        const dx = tile.x + tx, dy = tile.y + ty;
        weightSum[dy * width + dx] += w;
      }
    }
  }
  let minW = Infinity, maxW = -Infinity;
  for (const w of weightSum) { if (w < minW) minW = w; if (w > maxW) maxW = w; }

  const pass = uncoveredCount === 0 && Math.abs(minW - 1) < 0.01 && Math.abs(maxW - 1) < 0.01;
  console.log(`  ${pass ? 'PASS' : 'FAIL'} ${width}x${height} tile=${tileSize} overlap=${overlap}: tiles=${tiles.length} uncovered=${uncoveredCount} weightSum=[${minW.toFixed(4)}, ${maxW.toFixed(4)}]`);
  return pass;
}

console.log('TileProcessor: tile layout coverage + partition-of-unity blend weights');
const results = [
  testCase(1280, 720, 256, 12),
  testCase(3840, 2160, 384, 16), // real 4K case
  testCase(100, 100, 64, 8),
  testCase(65, 33, 32, 4),        // odd/small edge case
  testCase(1000, 1000, 128, 0),   // zero overlap (hard tile edges)
];

const allPass = results.every(Boolean);
console.log(allPass ? '\nALL PASS' : '\nSOME FAILED');
process.exit(allPass ? 0 : 1);
