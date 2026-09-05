// Real WGSL shaders — these are actual compute/fragment shaders that run
// on the GPU, not CSS filters relabeled as "WebGPU". Exported as strings
// because WGSL has no native module system for the browser yet.

export const VERTEX_SHADER = /* wgsl */ `
struct VSOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn main(@builtin(vertex_index) idx: u32) -> VSOut {
  // Fullscreen triangle — no vertex buffer needed.
  var positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 3.0, -1.0),
    vec2<f32>(-1.0,  3.0)
  );
  var out: VSOut;
  out.pos = vec4<f32>(positions[idx], 0.0, 1.0);
  out.uv = (positions[idx] * vec2<f32>(0.5, -0.5)) + vec2<f32>(0.5, 0.5);
  return out;
}
`;

// Combined fragment shader: color adjustments + threshold-aware unsharp
// sharpen + larger-radius "detail/clarity" enhancement + bilateral denoise
// + a real (non-AI) skin-tone-heuristic portrait smoothing pass, gated by
// uniforms so unused effects cost (almost) nothing.
//
// HONESTY NOTE on "portrait smoothing": this is NOT AI face detection —
// there is no face-landmark model here (that would need a real trained
// model + network access, same constraint as RIFE/Real-ESRGAN elsewhere
// in this project). It IS a real, documented technique: a per-pixel
// skin-color heuristic (RGB thresholds from Peer et al.'s classic
// skin-detection rule) combined with a Sobel-ish edge mask, so smoothing
// applies to skin-toned, low-edge regions and is suppressed at eyes/lips/
// hair/edges. It reacts to skin-colored pixels wherever they appear in
// frame — it does not know where a FACE is — which is why it's labeled
// "skin-tone smoothing" in the UI, not "face smoothing" or "AI portrait".
export const EFFECTS_FRAGMENT_SHADER = /* wgsl */ `
struct Params {
  brightness: f32,      // -1..1, additive
  contrast: f32,        // 0..2, 1 = neutral
  saturation: f32,      // 0..2, 1 = neutral
  vibrance: f32,        // -1..1, protects already-saturated colors
  gamma: f32,            // 0.1..3, 1 = neutral
  temperature: f32,      // -1..1, warm/cool shift
  sharpenAmount: f32,    // 0..2, 0 = off — fine-detail unsharp mask
  sharpenThreshold: f32, // 0..0.2 — differences below this are treated as noise, not sharpened (prevents grain amplification, matches Photoshop/AE's unsharp mask Threshold control)
  highPassAmount: f32,   // 0..2 — edge-only high-pass enhancement
  denoiseAmount: f32,    // 0..1, 0 = off — general bilateral noise reduction
  detailAmount: f32,     // 0..2, 0 = off — larger-radius local-contrast "clarity" boost, a separate scale from fine sharpen (matches Topaz Sharpen's multi-scale approach)
  portraitSmooth: f32,   // 0..1, 0 = off — skin-tone-heuristic smoothing, edge-gated
  exposure: f32,         // -2..2 EV
  highlights: f32,       // -1..1
  shadows: f32,          // -1..1
  whites: f32,           // -1..1
  blacks: f32,           // -1..1
  dehaze: f32,           // 0..1
  vignette: f32,         // 0..1
  grain: f32,            // 0..1
  deblockAmount: f32,    // 0..1, block-boundary selective smoothing
  debandAmount: f32,     // 0..1, flat-gradient smoothing + restrained dither
  artifactRemoval: f32,  // 0..1, compression mosquito-noise cleanup
  fineDetailRecovery: f32,
  textureRecovery: f32,
  edgeRecovery: f32,
  clarity: f32,
  localContrast: f32,
  dehalo: f32,
  antiRinging: f32,
  tint: f32,
  lift: f32,
  gain: f32,
  texelW: f32,
  texelH: f32,
  chromaDenoise: f32,
  detailFusion: f32,
  padding2: f32,
  padding3: f32,
  padding4: f32,
};

@group(0) @binding(0) var srcTex: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> p: Params;

fn luma(c: vec3<f32>) -> f32 {
  return dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
}

fn sampleAt(uv: vec2<f32>, dx: f32, dy: f32) -> vec3<f32> {
  let offsetUv = uv + vec2<f32>(dx * p.texelW, dy * p.texelH);
  return textureSample(srcTex, srcSampler, offsetUv).rgb;
}

// Classic RGB skin-color heuristic (Peer et al., "Human skin colour
// clustering for face detection", 2003) — a real, widely-used non-ML
// rule, not a made-up approximation. Works under normal lighting; will
// mis-detect under strong color casts, same caveat any non-ML heuristic
// has — which is exactly why it's exposed as a plain user-adjustable
// slider, not presented as a guaranteed face detector.
fn skinLikelihood(c: vec3<f32>) -> f32 {
  let r = c.r * 255.0; let g = c.g * 255.0; let b = c.b * 255.0;
  let maxc = max(r, max(g, b));
  let minc = min(r, min(g, b));
  let spread = maxc - minc;
  let cond =
    f32(r > 95.0) *
    f32(g > 40.0) *
    f32(b > 20.0) *
    f32(spread > 15.0) *
    f32(abs(r - g) > 15.0) *
    f32(r > g) *
    f32(r > b);
  return cond;
}

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  var color = textureSample(srcTex, srcSampler, uv).rgb;
  let original = color;

  // --- Denoise: 3x3 bilateral-ish blur, weighted by color similarity so
  // edges aren't smeared. Skipped entirely (branch, not just amount=0
  // multiply) when denoiseAmount is 0 to avoid the cost on the common path.
  if (p.denoiseAmount > 0.0) {
    var sum = vec3<f32>(0.0);
    var wsum = 0.0;
    for (var dy = -1; dy <= 1; dy = dy + 1) {
      for (var dx = -1; dx <= 1; dx = dx + 1) {
        let s = sampleAt(uv, f32(dx), f32(dy));
        let colorDist = distance(s, color);
        let w = exp(-colorDist * colorDist * 8.0);
        sum = sum + s * w;
        wsum = wsum + w;
      }
    }
    let denoised = sum / max(wsum, 0.0001);
    color = mix(color, denoised, p.denoiseAmount);
  }

  // V3 chroma denoise smooths color noise while restoring the original
  // luma, so fine luminance texture is preserved instead of waxed away.
  if (p.chromaDenoise > 0.0) {
    let avg = (sampleAt(uv,-1.0,0.0)+sampleAt(uv,1.0,0.0)+sampleAt(uv,0.0,-1.0)+sampleAt(uv,0.0,1.0)+color*4.0)/8.0;
    let preserveLuma = avg + vec3<f32>(luma(color) - luma(avg));
    let chromaDelta = distance(color - vec3<f32>(luma(color)), avg - vec3<f32>(luma(avg)));
    let gate = 1.0 - smoothstep(0.16, 0.42, chromaDelta);
    color = mix(color, preserveLuma, clamp(p.chromaDenoise * gate * 0.72, 0.0, 0.82));
  }

  // Codec-block cleanup only acts near an 8px grid and is range gated, so
  // genuine edges crossing a block boundary are retained.
  if (p.deblockAmount > 0.0) {
    let pixel = uv / vec2<f32>(p.texelW, p.texelH);
    let fx = min(fract(pixel.x / 8.0), 1.0 - fract(pixel.x / 8.0));
    let fy = min(fract(pixel.y / 8.0), 1.0 - fract(pixel.y / 8.0));
    let boundary = 1.0 - smoothstep(0.02, 0.18, min(fx, fy));
    let cross = (sampleAt(uv,-1.0,0.0)+sampleAt(uv,1.0,0.0)+sampleAt(uv,0.0,-1.0)+sampleAt(uv,0.0,1.0))*0.25;
    let rangeGate = 1.0 - smoothstep(0.035, 0.22, distance(cross, color));
    color = mix(color, cross, boundary * rangeGate * p.deblockAmount * 0.48);
  }

  // Compression artifact cleanup targets small high-frequency differences;
  // the edge gate prevents it from smearing strong structure.
  if (p.artifactRemoval > 0.0) {
    let cross = (sampleAt(uv,-1.0,0.0)+sampleAt(uv,1.0,0.0)+sampleAt(uv,0.0,-1.0)+sampleAt(uv,0.0,1.0))*0.25;
    let residual = distance(color, cross);
    let cleanupGate = 1.0 - smoothstep(0.08, 0.28, residual);
    color = mix(color, cross, p.artifactRemoval * cleanupGate * 0.34);
  }

  if (p.debandAmount > 0.0) {
    let farAverage = (sampleAt(uv,-2.0,0.0)+sampleAt(uv,2.0,0.0)+sampleAt(uv,0.0,-2.0)+sampleAt(uv,0.0,2.0))*0.25;
    let flatGate = 1.0 - smoothstep(0.012, 0.075, distance(color, farAverage));
    let pixel = uv / vec2<f32>(p.texelW, p.texelH);
    let dither = fract(sin(dot(pixel, vec2<f32>(12.9898, 78.233))) * 43758.5453) - 0.5;
    color = mix(color, farAverage, p.debandAmount * flatGate * 0.3) + vec3<f32>(dither * p.debandAmount / 1024.0);
  }

  // --- Skin-tone portrait smoothing: wider bilateral blur (5x5), applied
  // only where skinLikelihood is high AND local edge strength (a simple
  // luma-gradient magnitude) is low — so eyes, eyebrows, lips, hair, and
  // any real edges within a skin-toned region stay sharp, while smooth
  // skin area gets the blur. Runs BEFORE sharpen so sharpening doesn't
  // re-introduce texture the smoothing just removed.
  if (p.portraitSmooth > 0.0) {
    let skin = skinLikelihood(color);
    if (skin > 0.0) {
      let lN = luma(sampleAt(uv, 0.0, -1.0));
      let lS = luma(sampleAt(uv, 0.0, 1.0));
      let lE = luma(sampleAt(uv, 1.0, 0.0));
      let lW = luma(sampleAt(uv, -1.0, 0.0));
      let gx = lE - lW;
      let gy = lS - lN;
      let edgeStrength = sqrt(gx * gx + gy * gy);
      let edgeGate = 1.0 - smoothstep(0.05, 0.18, edgeStrength); // 1 = flat area, 0 = real edge

      var sum = vec3<f32>(0.0);
      var wsum = 0.0;
      for (var dy = -2; dy <= 2; dy = dy + 1) {
        for (var dx = -2; dx <= 2; dx = dx + 1) {
          let s = sampleAt(uv, f32(dx), f32(dy));
          let colorDist = distance(s, color);
          let w = exp(-colorDist * colorDist * 6.0);
          sum = sum + s * w;
          wsum = wsum + w;
        }
      }
      let smoothed = sum / max(wsum, 0.0001);
      color = mix(color, smoothed, p.portraitSmooth * edgeGate);
    }
  }

  // --- Detail/Clarity: larger-radius (5x5 box) local-contrast boost,
  // computed on luma only and applied uniformly to RGB to avoid color
  // fringing. Distinct from fine sharpen below — matches Topaz Sharpen's
  // separation of a fine detail pass from a coarser structure/clarity pass.
  if (p.detailAmount > 0.0) {
    var sum = 0.0;
    for (var dy = -2; dy <= 2; dy = dy + 1) {
      for (var dx = -2; dx <= 2; dx = dx + 1) {
        sum = sum + luma(sampleAt(uv, f32(dx), f32(dy)));
      }
    }
    let localAvgLuma = sum / 25.0;
    let currentLuma = luma(color);
    let detailDiff = currentLuma - localAvgLuma;
    color = color + vec3<f32>(detailDiff * p.detailAmount);
  }

  if (p.clarity > 0.0 || p.localContrast > 0.0) {
    let wide = (luma(sampleAt(uv,-3.0,0.0))+luma(sampleAt(uv,3.0,0.0))+luma(sampleAt(uv,0.0,-3.0))+luma(sampleAt(uv,0.0,3.0)))*0.25;
    let local = luma(color) - wide;
    color = color + vec3<f32>(local * (p.clarity * 0.38 + p.localContrast * 0.25));
  }

  if (p.fineDetailRecovery > 0.0 || p.textureRecovery > 0.0 || p.edgeRecovery > 0.0) {
    let cross = (sampleAt(uv,-1.0,0.0)+sampleAt(uv,1.0,0.0)+sampleAt(uv,0.0,-1.0)+sampleAt(uv,0.0,1.0))*0.25;
    let high = luma(color) - luma(cross);
    let textureGate = 1.0 - smoothstep(0.055, 0.22, abs(high));
    let edgeGate = smoothstep(0.018, 0.16, abs(high));
    let recovery = high * (p.fineDetailRecovery * 0.42 + p.textureRecovery * textureGate * 0.28 + p.edgeRecovery * edgeGate * 0.34);
    color = color + vec3<f32>(recovery);
  }

  // V3 multi-scale detail fusion combines micro texture and wider structure
  // with a noise gate. This is deliberately separate from sharpen.
  if (p.detailFusion > 0.0) {
    let cross = (sampleAt(uv,-1.0,0.0)+sampleAt(uv,1.0,0.0)+sampleAt(uv,0.0,-1.0)+sampleAt(uv,0.0,1.0))*0.25;
    let far = (sampleAt(uv,-3.0,0.0)+sampleAt(uv,3.0,0.0)+sampleAt(uv,0.0,-3.0)+sampleAt(uv,0.0,3.0))*0.25;
    let micro = luma(color) - luma(cross);
    let structure = luma(color) - luma(far);
    let noiseGate = smoothstep(0.006, 0.035, abs(micro));
    let limiter = 1.0 - smoothstep(0.18, 0.42, abs(micro));
    color = color + vec3<f32>((micro * 0.46 * noiseGate * limiter + structure * 0.22) * p.detailFusion);
  }

  // --- Sharpen: unsharp mask with a threshold gate — differences smaller
  // than sharpenThreshold are left alone rather than amplified, which is
  // what prevents fine sharpening from turning sensor noise into visible
  // grain (the real problem naive unsharp masking has, which Photoshop's
  // and AE's sharpen tools solve with a Threshold slider).
  if (p.sharpenAmount > 0.0) {
    let n  = sampleAt(uv,  0.0, -1.0);
    let s  = sampleAt(uv,  0.0,  1.0);
    let e  = sampleAt(uv,  1.0,  0.0);
    let w  = sampleAt(uv, -1.0,  0.0);
    let blurred = (n + s + e + w + color * 4.0) / 8.0;
    let diff = color - blurred;
    let diffMag = length(diff);
    let gated = diff * smoothstep(p.sharpenThreshold, p.sharpenThreshold + 0.02, diffMag);
    color = color + gated * p.sharpenAmount;
  }

  // --- High-pass: 8-neighbour Laplacian, luma-only to avoid colored halos.
  if (p.highPassAmount > 0.0) {
    var neighbourLuma = 0.0;
    for (var hy = -1; hy <= 1; hy = hy + 1) {
      for (var hx = -1; hx <= 1; hx = hx + 1) {
        if (hx != 0 || hy != 0) {
          neighbourLuma = neighbourLuma + luma(sampleAt(uv, f32(hx), f32(hy)));
        }
      }
    }
    let high = luma(color) * 8.0 - neighbourLuma;
    color = color + vec3<f32>(high * p.highPassAmount * 0.18);
  }

  // Clamp overshoot against the source neighbourhood. Dehalo is gradual;
  // anti-ringing is a stricter local extrema guard.
  if (p.dehalo > 0.0 || p.antiRinging > 0.0) {
    let n = sampleAt(uv,0.0,-1.0); let s = sampleAt(uv,0.0,1.0);
    let e = sampleAt(uv,1.0,0.0); let w = sampleAt(uv,-1.0,0.0);
    let localMin = min(original, min(n, min(s, min(e,w))));
    let localMax = max(original, max(n, max(s, max(e,w))));
    let softlyClamped = clamp(color, localMin - vec3<f32>(0.025), localMax + vec3<f32>(0.025));
    color = mix(color, softlyClamped, p.dehalo);
    color = mix(color, clamp(color, localMin, localMax), p.antiRinging);
  }

  // --- White balance / temperature shift (simple RGB channel skew).
  color = color + vec3<f32>(p.temperature * 0.08 + p.tint * 0.025 + p.lift, -p.tint * 0.05 + p.lift, -p.temperature * 0.08 + p.tint * 0.025 + p.lift);

  // --- Exposure and zone-aware tone recovery. Masks overlap smoothly so
  // edits do not create hard tonal bands or posterization.
  color = color * exp2(p.exposure);
  let toneLuma = luma(color);
  let shadowMask = pow(clamp(1.0 - toneLuma, 0.0, 1.0), 2.0);
  let highlightMask = pow(clamp(toneLuma, 0.0, 1.0), 2.0);
  color = color + vec3<f32>(p.shadows * shadowMask * 0.28 + p.highlights * highlightMask * 0.24);
  color = color + vec3<f32>(p.blacks * (1.0 - smoothstep(0.08, 0.38, toneLuma)) * 0.16);
  color = color + vec3<f32>(p.whites * smoothstep(0.62, 0.94, toneLuma) * 0.14);

  // Dehaze is a restrained luminance contrast + chroma restoration pass.
  if (p.dehaze > 0.0) {
    let hazeLuma = luma(color);
    color = (color - vec3<f32>(0.5)) * (1.0 + p.dehaze * 0.34) + vec3<f32>(0.5);
    color = mix(vec3<f32>(hazeLuma), color, 1.0 + p.dehaze * 0.18);
  }

  // --- Gamma.
  color = pow(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), vec3<f32>(1.0 / max(p.gamma, 0.05)));
  color = color * max(p.gain, 0.05);

  // --- Brightness / contrast.
  color = (color - 0.5) * p.contrast + 0.5 + p.brightness;

  // --- Saturation.
  let g = luma(color);
  color = mix(vec3<f32>(g, g, g), color, p.saturation);

  // --- Vibrance: preferentially lifts muted pixels and leaves already
  // saturated pixels closer to their original value.
  if (abs(p.vibrance) > 0.0001) {
    let maxChannel = max(color.r, max(color.g, color.b));
    let minChannel = min(color.r, min(color.g, color.b));
    let chroma = maxChannel - minChannel;
    let adaptive = p.vibrance * (1.0 - clamp(chroma, 0.0, 1.0));
    color = mix(vec3<f32>(g), color, 1.0 + adaptive);
  }

  // Optical finishing. Grain is deterministic per source pixel so it does
  // not shimmer during preview or frame encoding.
  if (p.vignette > 0.0) {
    let centered = uv * 2.0 - vec2<f32>(1.0);
    let radius = dot(centered, centered);
    color = color * (1.0 - smoothstep(0.28, 1.35, radius) * p.vignette * 0.58);
  }
  if (p.grain > 0.0) {
    let pixel = uv / vec2<f32>(p.texelW, p.texelH);
    let noise = fract(sin(dot(pixel, vec2<f32>(12.9898, 78.233))) * 43758.5453) - 0.5;
    color = color + vec3<f32>(noise * p.grain * 0.055);
  }

  return vec4<f32>(clamp(color, vec3<f32>(0.0), vec3<f32>(1.0)), 1.0);
}
`;
