import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TypedArrayPool } from '../src/engine/TypedArrayPool.js';
import { imageDataToChwFloat32, imageDataToLumaFloat32 } from '../src/engine/UpscaleEngine.js';
import { buildRifeFeeds } from '../src/engine/RIFEEngine.js';

test('TypedArrayPool reuses exact buffers without changing length or values', () => {
  const pool = new TypedArrayPool({ maxPerLength: 2, maxRetainedBytes: 1024 });
  const first = pool.acquire(Float32Array, 16);
  first[0] = 123.5;
  assert.equal(pool.release(first), true);
  const second = pool.acquire(Float32Array, 16);
  assert.equal(second, first);
  assert.equal(second.length, 16);
  assert.equal(second[0], 123.5);
  assert.equal(pool.stats().hits, 1);
});

test('pooled CHW and luma conversion is numerically identical to fresh allocation', () => {
  const image = { width: 2, height: 2, data: new Uint8ClampedArray([
    1,2,3,255, 20,30,40,255, 100,110,120,255, 250,240,230,255,
  ]) };
  const freshChw = imageDataToChwFloat32(image);
  const pooledChw = new Float32Array(freshChw.length);
  assert.equal(imageDataToChwFloat32(image, pooledChw), pooledChw);
  assert.deepEqual([...pooledChw], [...freshChw]);
  const freshLuma = imageDataToLumaFloat32(image);
  const pooledLuma = new Float32Array(freshLuma.length);
  assert.equal(imageDataToLumaFloat32(image, pooledLuma), pooledLuma);
  assert.deepEqual([...pooledLuma], [...freshLuma]);
});

test('RIFE concat feed can reuse a caller buffer without changing tensor content', () => {
  class Tensor { constructor(type, data, dims) { this.type = type; this.data = data; this.dims = dims; } }
  const ort = { Tensor };
  const session = { inputNames: ['frames'], inputMetadata: [{ dimensions: [1,6,2,2] }] };
  const signature = { convention: 'concat', frameInputs: ['frames'], timestepInput: null, scaleInput: null };
  const a = new Float32Array(12).fill(0.25);
  const b = new Float32Array(12).fill(0.75);
  const target = new Float32Array(24);
  const feeds = buildRifeFeeds(session, ort, signature, a, b, 2, 2, 0.5, target);
  assert.equal(feeds.frames.data, target);
  assert.deepEqual([...target.slice(0, 12)], [...a]);
  assert.deepEqual([...target.slice(12)], [...b]);
});

test('final render uses model-locked AI tile and does not skip RIFE for low motion', () => {
  const source = fs.readFileSync(new URL('../src/engine/VideoPipeline.js', import.meta.url), 'utf8');
  assert.match(source, /const qualityLockedTileSize = aiUpscaleActive/);
  assert.match(source, /tileSize: qualityLockedTileSize/);
  assert.doesNotMatch(source, /motion\.score <= 0\.0035/);
  assert.match(source, /qualityLockedRender: true/);
});

test('quality-locked final inference keeps graph capture disabled and retains regular WebGPU', () => {
  const source = fs.readFileSync(new URL('../src/engine/UpscaleEngine.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /enableGraphCapture: true/);
  assert.match(source, /graphCapture: false/);
  assert.match(source, /staticInputShape = Boolean/);
  assert.match(source, /executionProviders: \['webgpu'\], graphOptimizationLevel: 'all'/);
});

test('tile compositor no longer allocates a full alpha mask or canvas per tile', () => {
  const source = fs.readFileSync(new URL('../src/engine/TileProcessor.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /new ImageData\(new Uint8ClampedArray\(upscaledTile\.data\)/);
  assert.doesNotMatch(source, /const tileCanvas = new OffscreenCanvas\(tw, th\)/);
  assert.match(source, /const scratchCanvas = new OffscreenCanvas\(maxTileOutput, maxTileOutput\)/);
  assert.match(source, /buildAxisWeights/);
});
