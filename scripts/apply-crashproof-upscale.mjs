import { readFileSync, writeFileSync } from 'node:fs';

const file = 'src/engine/UpscaleEngine.js';
let s = readFileSync(file, 'utf8');

if (s.includes("import { withHardTimeout } from './CrashProofRuntime.js';")) {
  console.log('Upscale crash-proof already applied');
  process.exit(0);
}

function one(a, b, label) {
  const n = s.split(a).length - 1;
  if (n !== 1) throw new Error(`${label}: expected 1, found ${n}`);
  s = s.replace(a, b);
}

one(
  "import { WebGpuTileCompositor } from './WebGpuTileCompositor.js';",
  "import { WebGpuTileCompositor } from './WebGpuTileCompositor.js';\nimport { withHardTimeout } from './CrashProofRuntime.js';",
  'import',
);

one(
  "    const loaded = await createOrtSessionWithFallback({\n      modelManager: this.modelManager, ort: this.ort, modelId, webgpuOptions,\n      wasmOptions: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' },\n    });",
  "    const loaded = await withHardTimeout(() => createOrtSessionWithFallback({\n      modelManager: this.modelManager, ort: this.ort, modelId, webgpuOptions,\n      wasmOptions: { executionProviders: ['wasm'], graphOptimizationLevel: 'all' },\n    }), { timeoutMs: 30000, label: `Upscale session load ${modelId}`, onTimeout: () => { this.session?.release?.(); this.session = null; this.sessionModelId = null; } });",
  'session',
);

one(
  "    const webStartedAt = performance.now();\n    const outputs = await session.run({ [inputName]: tensor });\n    const webElapsedMs = performance.now() - webStartedAt;",
  "    const webStartedAt = performance.now();\n    const outputs = await withHardTimeout(() => session.run({ [inputName]: tensor }), { timeoutMs: 30000, label: `Upscale self-test ${modelId}` });\n    const webElapsedMs = performance.now() - webStartedAt;",
  'selftest-context',
);

one(
  "          output = await this.gpuIoArena.run({ session, inputName, outputName, input: prepared, inputDims, outputDims, signal });",
  "          output = await withHardTimeout(() => this.gpuIoArena.run({ session, inputName, outputName, input: prepared, inputDims, outputDims, signal }), { timeoutMs: 30000, label: `Upscale WebGPU IO ${modelId}`, signal });",
  'gpu io',
);

one(
  "      if (!output) {\n        const tensor = new this.ort.Tensor('float32', prepared, inputDims);\n        const outputs = await session.run({ [inputName]: tensor });\n        output = outputs[outputName];",
  "      if (!output) {\n        const tensor = new this.ort.Tensor('float32', prepared, inputDims);\n        const outputs = await withHardTimeout(() => session.run({ [inputName]: tensor }), { timeoutMs: 30000, label: `Upscale ORT inference ${modelId}`, signal, onTimeout: () => { this.session?.release?.(); this.session = null; this.sessionModelId = null; } });\n        output = outputs[outputName];",
  'ort infer-context',
);

one(
  "            gpuOutput = await this.gpuIoArena.runGpu({\n              session,",
  "            gpuOutput = await withHardTimeout(() => this.gpuIoArena.runGpu({\n              session,",
  'runGpu start',
);

one(
  "              signal,\n            });\n            this.lastExecutionProvider = 'webgpu:iobinding+gpu-compositor';",
  "              signal,\n            }), { timeoutMs: 30000, label: `Upscale GPU tile ${modelId}`, signal });\n            this.lastExecutionProvider = 'webgpu:iobinding+gpu-compositor';",
  'runGpu end',
);

writeFileSync(file, s);
console.log('Upscale crash-proof timeouts applied');
