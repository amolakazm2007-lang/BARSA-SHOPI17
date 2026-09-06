import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const videoPipeline = fs.readFileSync(new URL('../src/engine/VideoPipeline.js', import.meta.url), 'utf8');
const webgl = fs.readFileSync(new URL('../src/engine/WebGL2Engine.js', import.meta.url), 'utf8');

test('P0 RIFE workspace survives try/finally cleanup scope', () => {
  assert.match(videoPipeline, /let rifeWorkspace = null;/);
  assert.match(videoPipeline, /rifeWorkspace = rifeActive \? new RifeFrameWorkspace\(/);
  assert.doesNotMatch(videoPipeline, /const rifeWorkspace = rifeActive/);
  assert.match(videoPipeline, /rifeWorkspace\?\.destroy\(\);/);
});

test('P0 WebGL2 shader avoids reserved flat identifier', () => {
  assert.doesNotMatch(webgl, /float\s+flat\s*=/);
  assert.match(webgl, /float flatRegion=/);
  assert.match(webgl, /u_deband\*flatRegion/);
});

test('P0 VideoPipeline monotonic timing cannot be shadowed by performance engine', () => {
  assert.doesNotMatch(videoPipeline, /\bperformance\.now\(\)/);
  assert.match(videoPipeline, /globalThis\.performance\?\.now\?\.\(\) \?\? Date\.now\(\)/);
});

test('P0 source VideoFrames have explicit finally cleanup and deterministic ownership transfer', () => {
  assert.match(videoPipeline, /let processedFrameOwnedBySequencer = false;/);
  assert.match(videoPipeline, /processedFrameOwnedBySequencer = true;\s*processedFrame = null;/);
  assert.match(videoPipeline, /if \(!processedFrameOwnedBySequencer\)[\s\S]*processedFrame\?\.close\?\.\(\)/);
  assert.match(videoPipeline, /frameSource\?\.close\?\.\(\)/);
  assert.match(videoPipeline, /releaseSource: false/);
});
