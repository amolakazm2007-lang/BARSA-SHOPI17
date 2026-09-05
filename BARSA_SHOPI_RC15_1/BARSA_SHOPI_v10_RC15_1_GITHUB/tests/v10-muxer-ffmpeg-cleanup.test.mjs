import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const ffmpeg = fs.readFileSync(new URL('../src/engine/FFmpegEngine.js', import.meta.url), 'utf8');
const muxer = fs.readFileSync(new URL('../src/engine/NativeMP4Muxer.js', import.meta.url), 'utf8');

test('FFmpeg remux preserves the exact Uint8Array view instead of exposing its backing buffer', () => {
  assert.match(ffmpeg, /const exact = data instanceof Uint8Array \? data : new Uint8Array\(data\)/);
  assert.match(ffmpeg, /new Blob\(\[exact\]/);
  assert.doesNotMatch(ffmpeg, /new Blob\(\[data\.buffer\]/);
});

test('FFmpeg cancellation discards the terminated instance', () => {
  assert.match(ffmpeg, /this\.ffmpeg\?\.terminate\(\);[\s\S]*this\.ffmpeg = null;[\s\S]*this\.loaded = false;[\s\S]*this\.coreMode = null;/);
});

test('native MP4 initialization failure cleans output resources', () => {
  assert.match(muxer, /async initialize\(\)[\s\S]*catch \(error\)[\s\S]*this\.output\.cancel\(\)[\s\S]*releaseOutputFile\(\)/);
});

test('native MP4 finalize failure cleans output resources', () => {
  assert.match(muxer, /async finalize\(\)[\s\S]*catch \(error\)[\s\S]*this\.output\.cancel\(\)[\s\S]*releaseOutputFile\(\)/);
});
