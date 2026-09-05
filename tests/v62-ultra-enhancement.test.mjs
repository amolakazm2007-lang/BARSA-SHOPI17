import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateTranslation } from '../src/engine/StabilizationEngine.js';
import { compileColorSettings, applyColorToImageData } from '../src/engine/ColorEngine.js';
import { resolveQualityEffects } from '../src/engine/QualityEngine.js';

test('global motion estimator detects translated sample', () => {
  const w=24,h=16, a=new Uint8Array(w*h), b=new Uint8Array(w*h);
  for(let y=3;y<13;y++) for(let x=4;x<19;x++) a[y*w+x]=(x*13+y*7)%255;
  const dx=2,dy=-1;
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const sx=x-dx, sy=y-dy;
    if(sx>=0&&sx<w&&sy>=0&&sy<h) b[y*w+x]=a[sy*w+sx];
  }
  const r=estimateTranslation(a,b,w,h,3);
  assert.equal(r.dx, dx);
  assert.equal(r.dy, dy);
  assert.ok(r.normalizedError < 0.05);
});

test('RGB mixer changes channels with real matrix math', () => {
  const compiled=compileColorSettings({rgbMixer:{rr:1,rg:.5,rb:0,gr:0,gg:1,gb:0,br:0,bg:0,bb:1}});
  const image={data:new Uint8ClampedArray([100,100,100,255]),width:1,height:1};
  applyColorToImageData(image,compiled);
  assert.ok(image.data[0] > 100);
  assert.equal(image.data[1],100);
  assert.equal(image.data[2],100);
});

test('Quality V2 exposes micro texture and structure recovery as real effects', () => {
  const effects=resolveQualityEffects({}, {stages:{microTexture:{enabled:true,strength:.7},structureRecovery:{enabled:true,strength:.8}}});
  assert.equal(effects.microTexture,.7);
  assert.equal(effects.structureRecovery,.8);
});
