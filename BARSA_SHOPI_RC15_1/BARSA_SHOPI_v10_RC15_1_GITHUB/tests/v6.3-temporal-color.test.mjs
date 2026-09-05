import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateMotionField } from '../src/engine/MotionFieldEngine.js';
import { compileColorSettings, applyColorToImageData } from '../src/engine/ColorEngine.js';

function shiftedPlane(width,height,dx,dy){
  const base=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)base[y*width+x]=(x*7+y*13+(x*y)%31)%256;
  const shifted=new Uint8Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const sx=Math.max(0,Math.min(width-1,x-dx)),sy=Math.max(0,Math.min(height-1,y-dy)); shifted[y*width+x]=base[sy*width+sx];
  }
  return {base,shifted};
}

test('MotionFieldEngine recovers bounded global translation',()=>{
  const width=96,height=54,{base,shifted}=shiftedPlane(width,height,2,-1);
  const r=estimateMotionField(base,shifted,width,height,{blockSize:8,searchRadius:3});
  assert.ok(r.vectors.length>20);
  assert.ok(Math.abs(r.globalDx-2)<=1,`dx=${r.globalDx}`);
  assert.ok(Math.abs(r.globalDy+1)<=1,`dy=${r.globalDy}`);
  assert.ok(r.confidence>0.2);
});

test('DaVinci Color V3 selective controls change pixels',()=>{
  const image={data:new Uint8ClampedArray([180,60,50,255,40,100,190,255,40,180,70,255]),width:3,height:1};
  const before=[...image.data];
  const compiled=compileColorSettings({offset:.04,hueRotate:25,shadowSat:.85,midSat:1.2,highlightSat:1.1,redSat:1.25,greenSat:.9,blueSat:1.15,rgbMixer:{},curves:{}});
  applyColorToImageData(image,compiled);
  assert.notDeepEqual([...image.data],before);
  assert.equal(image.data[3],255);
});
