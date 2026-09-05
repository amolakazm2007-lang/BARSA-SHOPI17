import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFFmpegGeometryFilters,
  calculatePlacement,
  resolveAIWorkingSize,
  resolveOutputGeometry,
} from '../src/engine/GeometryEngine.js';

test('resolution presets use the short edge for landscape and portrait', () => {
  const landscape = resolveOutputGeometry(3840, 2160, { resolution: '1080', aspectRatio: '16:9' });
  const portrait = resolveOutputGeometry(1080, 1920, { resolution: '1080', aspectRatio: '9:16' });
  assert.deepEqual([landscape.width, landscape.height], [1920, 1080]);
  assert.deepEqual([portrait.width, portrait.height], [1080, 1920]);
});

test('social aspect ratios and arbitrary custom dimensions stay encoder-even', () => {
  const post = resolveOutputGeometry(1920, 1080, { resolution: '1080', aspectRatio: '4:5' });
  const custom = resolveOutputGeometry(1920, 1080, {
    resolution: 'custom', customWidth: 1001, customHeight: 1777, fitMode: 'cover',
  });
  assert.deepEqual([post.width, post.height], [1080, 1350]);
  assert.deepEqual([custom.width, custom.height], [1002, 1778]);
  assert.equal(custom.fitMode, 'cover');
});

test('contain adds bars while cover crops without stretching', () => {
  const contain = calculatePlacement(1920, 1080, 1080, 1080, 'contain');
  const cover = calculatePlacement(1920, 1080, 1080, 1080, 'cover');
  assert.deepEqual([contain.dx, contain.dy, contain.dw, contain.dh], [0, 236.25, 1080, 607.5]);
  assert.deepEqual([cover.sx, cover.sy, cover.sw, cover.sh], [420, 0, 1080, 1080]);
});

test('FFmpeg geometry graph mirrors Canvas contain and cover behavior', () => {
  const contain = buildFFmpegGeometryFilters({ width: 1080, height: 1920, fitMode: 'contain', backgroundColor: '#000000' }).join(',');
  const cover = buildFFmpegGeometryFilters({ width: 1080, height: 1920, fitMode: 'cover' }).join(',');
  assert.match(contain, /force_original_aspect_ratio=decrease/);
  assert.match(contain, /pad=1080:1920/);
  assert.match(cover, /force_original_aspect_ratio=increase/);
  assert.match(cover, /crop=1080:1920/);
});

test('dimensions above the browser safety limit are rejected', () => {
  assert.throws(() => resolveOutputGeometry(1920, 1080, {
    resolution: 'custom', customWidth: 9000, customHeight: 1080,
  }), /safe browser limit/);
});

test('AI working canvas stays bounded for 4K source with a fixed x3 model', () => {
  const work = resolveAIWorkingSize(3840, 2160, 3);
  assert.ok(work.outputWidth <= 8192);
  assert.ok(work.outputHeight <= 8192);
  assert.ok(work.outputWidth * work.outputHeight <= 33_554_432);
  assert.equal(work.downscaledInput, true);
});
