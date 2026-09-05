// SkinSmoothAlgorithm.test.mjs — validates the LOGIC of the skin-tone
// smoothing + edge-preservation algorithm used in shaders.wgsl.js, by
// reimplementing the identical math in plain JS and running it against a
// synthetic test image: `node tests/SkinSmoothAlgorithm.test.mjs`
//
// WHY THIS TEST EXISTS INSTEAD OF A LIVE WEBGPU PIXEL TEST: this project's
// development sandbox has a documented, real WebGPU instability under
// SwiftShader software rendering (see ENGINE_TEST_REPORT.md — the same
// "external Instance" device-loss pattern that has also been reported on
// real Android Chrome). Attempting a live GPU pixel-readback test for this
// specific feature hit that same instability on EVERY attempt, including
// single, isolated renders with no prior GPU work — confirmed directly,
// not assumed. Rather than ship an untested algorithm, this test verifies
// the algorithm itself is mathematically sound by running the identical
// per-pixel logic in JS. It does NOT prove the WGSL compiles/runs
// correctly on any given GPU — that still needs verification on real,
// stable hardware. It DOES prove the smoothing/edge-detection/skin-
// detection math produces the intended result when executed correctly.

const W = 32, H = 32;

function skinLikelihood(r, g, b) {
  const maxc = Math.max(r, g, b), minc = Math.min(r, g, b);
  const spread = maxc - minc;
  return (r > 95 && g > 40 && b > 20 && spread > 15 && Math.abs(r - g) > 15 && r > g && r > b) ? 1 : 0;
}

function luma(r, g, b) { return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

function buildTestImage() {
  const img = new Float64Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      const n = ((x * 13 + y * 7) % 40) - 20;
      img[i] = 210 + n; img[i + 1] = 150 + n; img[i + 2] = 120 + n;
    }
  }
  for (let x = 5; x < W - 5; x++) {
    const i = (15 * W + x) * 3;
    img[i] = 30; img[i + 1] = 20; img[i + 2] = 15;
  }
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const i = (y * W + x) * 3;
      img[i] = 40; img[i + 1] = 60; img[i + 2] = 200;
    }
  }
  return img;
}

function get(img, x, y, c) {
  const cx = Math.max(0, Math.min(W - 1, x));
  const cy = Math.max(0, Math.min(H - 1, y));
  return img[(cy * W + cx) * 3 + c];
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Exact port of the WGSL portrait-smoothing branch in shaders.wgsl.js. */
function applySkinSmoothing(img, portraitSmoothAmount) {
  const out = new Float64Array(img.length);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = get(img, x, y, 0), g = get(img, x, y, 1), b = get(img, x, y, 2);
      const idx = (y * W + x) * 3;
      const skin = skinLikelihood(r, g, b);
      if (skin === 0 || portraitSmoothAmount <= 0) {
        out[idx] = r; out[idx + 1] = g; out[idx + 2] = b;
        continue;
      }
      const lN = luma(get(img, x, y - 1, 0), get(img, x, y - 1, 1), get(img, x, y - 1, 2));
      const lS = luma(get(img, x, y + 1, 0), get(img, x, y + 1, 1), get(img, x, y + 1, 2));
      const lE = luma(get(img, x + 1, y, 0), get(img, x + 1, y, 1), get(img, x + 1, y, 2));
      const lW = luma(get(img, x - 1, y, 0), get(img, x - 1, y, 1), get(img, x - 1, y, 2));
      const gx = (lE - lW) / 255, gy = (lS - lN) / 255;
      const edgeStrength = Math.sqrt(gx * gx + gy * gy);
      const edgeGate = 1 - smoothstep(0.05, 0.18, edgeStrength);

      let sumR = 0, sumG = 0, sumB = 0, wsum = 0;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const sr = get(img, x + dx, y + dy, 0), sg = get(img, x + dx, y + dy, 1), sb = get(img, x + dx, y + dy, 2);
          const dist = Math.sqrt(((sr - r) / 255) ** 2 + ((sg - g) / 255) ** 2 + ((sb - b) / 255) ** 2);
          const w = Math.exp(-dist * dist * 6);
          sumR += sr * w; sumG += sg * w; sumB += sb * w; wsum += w;
        }
      }
      const smR = sumR / wsum, smG = sumG / wsum, smB = sumB / wsum;
      const mixAmt = portraitSmoothAmount * edgeGate;
      out[idx] = r + (smR - r) * mixAmt;
      out[idx + 1] = g + (smG - g) * mixAmt;
      out[idx + 2] = b + (smB - b) * mixAmt;
    }
  }
  return out;
}

function variance(img, x0, y0, w, h, c) {
  let sum = 0, sumSq = 0, n = 0;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const v = img[(y * W + x) * 3 + c];
      sum += v; sumSq += v * v; n++;
    }
  }
  const mean = sum / n;
  return sumSq / n - mean * mean;
}

let failures = 0;
function assert(cond, label) {
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${label}`);
  if (!cond) failures++;
}

const original = buildTestImage();
const smoothed = applySkinSmoothing(original, 1.0);

console.log('Skin-tone smoothing algorithm validation (pure-JS port of the WGSL logic):');

const skinVarBefore = variance(original, 8, 20, 16, 8, 0);
const skinVarAfter = variance(smoothed, 8, 20, 16, 8, 0);
assert(skinVarAfter < skinVarBefore * 0.5, `noise variance in skin area drops significantly (${skinVarBefore.toFixed(1)} -> ${skinVarAfter.toFixed(1)})`);

const blueVarBefore = variance(original, 1, 1, 6, 6, 2);
const blueVarAfter = variance(smoothed, 1, 1, 6, 6, 2);
assert(Math.abs(blueVarAfter - blueVarBefore) < 1, `non-skin (blue) area is untouched (${blueVarBefore.toFixed(2)} -> ${blueVarAfter.toFixed(2)})`);

const edgeIdx = (15 * W + 16) * 3;
assert(smoothed[edgeIdx] < 100, `eyebrow edge line stays dark/sharp after smoothing (R=${smoothed[edgeIdx].toFixed(1)}, was ${original[edgeIdx]})`);

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
console.log('\nNOTE: this validates the ALGORITHM. The WGSL shader itself still needs');
console.log('live-GPU verification on stable hardware -- this sandbox\'s WebGPU is too');
console.log('unstable (documented, real device-loss issue) to trust a pixel readback here.');
process.exit(failures === 0 ? 0 : 1);
