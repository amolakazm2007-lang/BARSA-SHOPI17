import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { NativeAiClient } from '../src/platform/NativeAiClient.js';
import { UpscaleEngine } from '../src/engine/UpscaleEngine.js';

test('NativeAiClient registers model and returns binary Float32 tensor', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  const originalLocation = global.location;
  global.location = { origin: 'http://127.0.0.1:12345' };
  global.fetch = async (url, options={}) => {
    calls.push([String(url), options]);
    if (String(url).includes('/native-ai/model')) return new Response(JSON.stringify({ ready:false, bytes:0 }), { status:200, headers:{'Content-Type':'application/json'} });
    if (String(url).includes('/register')) return new Response(JSON.stringify({ registered:true, bytes:8 }), { status:200, headers:{'Content-Type':'application/json'} });
    const values = new Float32Array([.1,.2,.3,.4]);
    return new Response(values.buffer, { status:200, headers:{'X-Barsa-Width':'2','X-Barsa-Height':'2','X-Barsa-Channels':'1','X-Barsa-Provider':'nnapi/cpu-fallback'} });
  };
  try {
    const api = { getNativeAiInfo: () => JSON.stringify({ available:true, binaryTileApi:true }), getNativeAiToken: () => '0123456789abcdef0123456789abcdef' };
    const client = new NativeAiClient({ api, origin:'http://127.0.0.1:12345' });
    assert.equal(client.available, true);
    await client.ensureModel('m', new ArrayBuffer(8));
    const out = await client.infer('m', new Float32Array([.5]), { channels:1,width:1,height:1,scale:2 });
    assert.equal(out.native, true);
    assert.equal(out.provider, 'nnapi/cpu-fallback');
    assert.deepEqual([...out.data], [...new Float32Array([.1,.2,.3,.4])]);
    assert.equal(calls.length, 3);
    assert.ok(calls[1][1].body instanceof ArrayBuffer);
  } finally { global.fetch = originalFetch; if (originalLocation === undefined) delete global.location; else global.location = originalLocation; }
});


test('NativeAiClient streams OPFS Blob/File model bodies without ArrayBuffer duplication', async () => {
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options={}) => {
    calls.push([String(url), options]);
    if (String(url).includes('/native-ai/model')) return new Response(JSON.stringify({ ready:false, bytes:0 }), { status:200, headers:{'Content-Type':'application/json'} });
    if (String(url).includes('/native-ai/register')) return new Response(JSON.stringify({ registered:true, bytes:6 }), { status:200, headers:{'Content-Type':'application/json'} });
    throw new Error('unexpected fetch');
  };
  try {
    const api = { getNativeAiInfo: () => JSON.stringify({ available:true, binaryTileApi:true }), getNativeAiToken: () => '0123456789abcdef0123456789abcdef' };
    const client = new NativeAiClient({ api, origin:'http://127.0.0.1:12345' });
    const model = new Blob([new Uint8Array([1,2,3,4,5,6])], { type:'application/octet-stream' });
    await client.ensureModel('blob-model', model, { sha256:'abc' });
    assert.equal(calls.length, 2);
    assert.equal(calls[1][1].body, model);
    assert.equal(calls[1][1].headers['X-Barsa-Model-Bytes'], '6');
  } finally { global.fetch = originalFetch; }
});

test('UpscaleEngine prefers native Android tile and falls back safely', async () => {
  const manager = { loadModelBuffer: async () => new ArrayBuffer(16), getStatus: async()=>({installed:true,verified:true,testPassed:true}) };
  const engine = new UpscaleEngine(manager);
  let registrations = 0, inferences = 0;
  engine.nativeAi = {
    available:true, disabledModels:new Set(),
    ensureModel: async()=>{registrations++; return true;},
    infer: async(id,input,opts)=>{inferences++; return {data:new Float32Array(opts.width*opts.height*9),width:opts.width*3,height:opts.height*3,channels:1,provider:'nnapi',native:true};},
    disableModel(id){this.disabledModels.add(id)}
  };
  const input = new Float32Array(4).fill(.5);
  const a = await engine.upscaleTile('onnx-model-zoo-sr-x3', input, 2, 2);
  const b = await engine.upscaleTile('onnx-model-zoo-sr-x3', input, 2, 2);
  assert.equal(a.data.length, 36); assert.equal(b.data.length,36);
  assert.equal(registrations,1); assert.equal(inferences,2);
  assert.match(engine.lastExecutionProvider,/android-native:nnapi/);
});

test('Android native source exposes binary register/infer routes and shared runtime', async () => {
  const server = await fs.readFile(new URL('../android/app/src/main/java/com/barsa/shopi/AssetServer.java', import.meta.url),'utf8');
  const activity = await fs.readFile(new URL('../android/app/src/main/java/com/barsa/shopi/MainActivity.java', import.meta.url),'utf8');
  const runtime = await fs.readFile(new URL('../android/app/src/main/java/com/barsa/shopi/NativeAiRuntime.java', import.meta.url),'utf8');
  assert.match(server,/\/native-ai\/register/); assert.match(server,/\/native-ai\/infer/); assert.match(server,/modelMatches/);
  assert.match(server,/LITTLE_ENDIAN/); assert.match(server,/MAX_TENSOR_BYTES/);
  assert.match(activity,/new AssetServer\(getAssets\(\), nativeAi, getCacheDir\(\), nativeApiToken\)/);
  assert.match(runtime,/onnxruntime-android/); assert.match(runtime,/padChwEdge/); assert.match(runtime,/getFloatBuffer/);
});
