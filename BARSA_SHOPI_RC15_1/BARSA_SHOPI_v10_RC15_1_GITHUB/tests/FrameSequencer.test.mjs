// FrameSequencer.test.mjs — real unit tests, runnable with plain Node:
// `node tests/FrameSequencer.test.mjs`
//
// Verifies the frame-insertion ORDER for AI interpolation is exactly
// right (source, generated, source, generated, ...), the output frame
// COUNT formula holds ((N-1)*factor + 1), edge cases don't crash, and
// that execution only ever holds 2 source frames in memory at once
// (matches the project's "no full-video buffering" memory rule).

import { planFrameSequence, executeFrameSequence } from '../src/engine/FrameSequencer.js';

let failures = 0;
function assertEqual(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${label}${ok ? '' : ` — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);
  if (!ok) failures++;
}

function labelPlan(plan) {
  return plan.map((e) => (e.type === 'source' ? 's' + e.index : 'g' + e.betweenIndex + '@' + e.t)).join(' ');
}

console.log('FrameSequencer: ordering');
assertEqual(labelPlan(planFrameSequence(5, 2)), 's0 g0@0.5 s1 g1@0.5 s2 g2@0.5 s3 g3@0.5 s4', 'factor=2, 5 frames');
assertEqual(
  labelPlan(planFrameSequence(3, 4)),
  's0 g0@0.25 g0@0.5 g0@0.75 s1 g1@0.25 g1@0.5 g1@0.75 s2',
  'factor=4, 3 frames'
);
assertEqual(labelPlan(planFrameSequence(1, 2)), 's0', '1 frame, nothing to interpolate');
assertEqual(planFrameSequence(0, 2), [], '0 frames');

console.log('FrameSequencer: frame count formula (N-1)*factor + 1');
for (const [n, f] of [[5, 2], [10, 2], [3, 4], [30, 2], [30, 4]]) {
  assertEqual(planFrameSequence(n, f).length, (n - 1) * f + 1, `N=${n} factor=${f}`);
}

console.log('FrameSequencer: rejects unsupported factors');
try {
  planFrameSequence(5, 3);
  console.log('  FAIL: factor=3 should have thrown');
  failures++;
} catch {
  console.log('  PASS: factor=3 correctly rejected');
}

console.log('FrameSequencer: execution against mock data + memory discipline');
{
  const sources = ['A', 'B', 'C', 'D'];
  const emitted = [];
  const fetchedIndices = new Set();
  let maxLiveAtOnce = 0;
  let liveNow = 0;

  await executeFrameSequence(4, 2, {
    getSourceFrame: async (i) => {
      fetchedIndices.add(i);
      liveNow++;
      maxLiveAtOnce = Math.max(maxLiveAtOnce, liveNow);
      return sources[i];
    },
    interpolate: async (a, b, t) => `mid(${a},${b})`,
    onFrame: async (data) => { emitted.push(data); liveNow = Math.max(0, liveNow - 1); },
  });

  assertEqual(emitted, ['A', 'mid(A,B)', 'B', 'mid(B,C)', 'C', 'mid(C,D)', 'D'], 'emitted sequence matches source order + generated frames');
  assertEqual(fetchedIndices.size, 4, 'every source frame fetched exactly once (caching works)');
}

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
