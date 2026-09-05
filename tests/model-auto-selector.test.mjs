import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelAutoSelector } from '../src/engine/ModelAutoSelector.js';

const ready = (ids=[]) => ({ isAvailable: async id => ({ available: ids.includes(id) }) });

test('auto selector picks verified Real-ESRGAN when upscale is required', async () => {
  const selector = new ModelAutoSelector({ upscale: ready(['real-esrgan-x4plus']), rife: ready([]), face: ready([]) });
  const result = await selector.select({source:{width:1280,height:720,fps:30},output:{width:3840,height:2160},targetFps:30,deviceProfile:{id:'poco-f6'}});
  assert.equal(result.upscaleModelId,'real-esrgan-x4plus');
  assert.equal(result.rifeModelId,null);
});

test('auto selector requests RIFE only when real FPS increase is needed', async () => {
  const selector = new ModelAutoSelector({ upscale: ready([]), rife: ready(['rife-tensorstack']), face: ready([]) });
  const result = await selector.select({source:{width:1920,height:1080,fps:30},output:{width:1920,height:1080},targetFps:60});
  assert.equal(result.upscaleModelId,null);
  assert.equal(result.rifeModelId,'rife-tensorstack');
});

test('auto selector uses face model only when face restoration is requested', async () => {
  const selector = new ModelAutoSelector({ upscale: ready([]), rife: ready([]), face: ready(['gfpgan-1.4']) });
  const result = await selector.select({source:{width:1920,height:1080,fps:30},output:{width:1920,height:1080},targetFps:30,wantsFace:true,deviceProfile:{id:'poco-f6'}});
  assert.equal(result.faceModelId,'gfpgan-1.4');
});
