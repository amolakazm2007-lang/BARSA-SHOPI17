import test from 'node:test';import assert from 'node:assert/strict';import{AutoFixEngine}from'../src/engine/AutoFixEngine.js';
function frame(w,h,p){const data=new Uint8ClampedArray(w*h*4);for(let i=0;i<data.length;i+=4){const[r,g,b]=p(i/4);data.set([r,g,b,255],i)}return{width:w,height:h,data}}
test('auto-fix raises dark frames',()=>{const r=new AutoFixEngine().analyze(frame(64,64,i=>[25+i%4,22,20]));assert.ok(r.metrics.exposure<.2);assert.ok(r.effects.brightness>0);assert.match(r.summary,/الإضاءة/)});
test('auto-fix detects portrait pixels',()=>{const r=new AutoFixEngine().analyze(frame(64,64,i=>[205+i%7,145+i%5,108]));assert.ok(r.metrics.skinPresence>.8);assert.ok(r.effects.portraitSmooth>0)});
