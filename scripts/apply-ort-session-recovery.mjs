import { readFile, writeFile } from 'node:fs/promises';

async function patchFile(relativePath, transforms) {
  const url = new URL(`../${relativePath}`, import.meta.url);
  let source = await readFile(url, 'utf8');
  for (const { before, after, already, label } of transforms) {
    if (source.includes(already)) continue;
    if (!source.includes(before)) throw new Error(`ORT recovery anchor missing in ${relativePath}: ${label}`);
    source = source.replace(before, after);
  }
  await writeFile(url, source);
}

await patchFile('src/engine/FaceRestorationEngine.js', [
  {
    before: "import { withHardTimeout } from './CrashProofRuntime.js';\n",
    after: "import { withHardTimeout } from './CrashProofRuntime.js';\nimport { runOrtInferenceWithRecovery } from './OrtInferenceRecovery.js';\n",
    already: "import { runOrtInferenceWithRecovery } from './OrtInferenceRecovery.js';",
    label: 'import',
  },
  {
    before: "  async _loadSession(modelId) {\n",
    after: `  async _invalidateSession(modelId, session = null) {\n    const current = this.sessions.get(modelId);\n    if (session && current && current !== session) {\n      try { session.release?.(); } catch (error) { console.warn('[BARSA][Face][stale-session-release-failed]', { modelId, error }); }\n      return;\n    }\n    try { current?.release?.(); } catch (error) { console.warn('[BARSA][Face][session-release-failed]', { modelId, error }); }\n    this.sessions.delete(modelId);\n  }\n\n  async _loadSession(modelId) {\n`,
    already: 'async _invalidateSession(modelId, session = null)',
    label: 'invalidate helper',
  },
  {
    before: "        const output = await withHardTimeout(() => session.run(buildFaceFeeds(session, this.ort, signature, chw, strength)), { timeoutMs: 30000, label: `Face ORT inference ${modelId}`, signal, onTimeout: () => { session?.release?.(); this.sessions.delete(modelId); } });\n        const imageOutput = selectImageOutput(session, output, 3 * size * size);",
    after: `        const output = await runOrtInferenceWithRecovery({\n          modelId,\n          getSession: (id) => this._loadSession(id),\n          invalidateSession: (id, stuck) => this._invalidateSession(id, stuck),\n          run: (activeSession) => {\n            session = activeSession;\n            signature = resolveFaceSignature(activeSession, config);\n            return activeSession.run(buildFaceFeeds(activeSession, this.ort, signature, chw, strength));\n          },\n          timeoutMs: 30000,\n          label: \`Face ORT inference \${modelId}\`,\n          signal,\n        });\n        const imageOutput = selectImageOutput(session, output, 3 * size * size);`,
    already: 'return activeSession.run(buildFaceFeeds(activeSession, this.ort, signature, chw, strength));',
    label: 'runtime inference',
  },
]);

await patchFile('src/engine/RIFEEngine.js', [
  {
    before: "import { withHardTimeout, BarsaError } from './CrashProofRuntime.js';\n",
    after: "import { withHardTimeout, BarsaError } from './CrashProofRuntime.js';\nimport { runOrtInferenceWithRecovery } from './OrtInferenceRecovery.js';\n",
    already: "import { runOrtInferenceWithRecovery } from './OrtInferenceRecovery.js';",
    label: 'import',
  },
  {
    before: "  async _loadSession(modelId) {\n",
    after: `  async _invalidateSession(modelId, session = null) {\n    const current = this.session;\n    if (session && current && current !== session) {\n      try { session.release?.(); } catch (error) { console.warn('[BARSA][RIFE][stale-session-release-failed]', { modelId, error }); }\n      return;\n    }\n    try { current?.release?.(); } catch (error) { console.warn('[BARSA][RIFE][session-release-failed]', { modelId, error }); }\n    this.session = null;\n    this.sessionModelId = null;\n    this.signature = null;\n  }\n\n  async _loadSession(modelId) {\n`,
    already: 'async _invalidateSession(modelId, session = null)',
    label: 'invalidate helper',
  },
  {
    before: "    const session = await this._loadSession(modelId);\n    const signature = this.signature || inspectRifeSignature(session);\n    assertDynamicOrMatchingSize(signature, width, height);",
    after: "    let session = await this._loadSession(modelId);\n    let signature = this.signature || inspectRifeSignature(session);\n    assertDynamicOrMatchingSize(signature, width, height);",
    already: 'let signature = this.signature || inspectRifeSignature(session);',
    label: 'mutable recovered session',
  },
  {
    before: "      const feeds = buildRifeFeeds(session, this.ort, signature, frame0Chw, frame1Chw, width, height, timestep, concatLease);\n      const outputs = await withHardTimeout(() => session.run(feeds), { timeoutMs: 30000, label: `RIFE ORT inference ${modelId}`, onTimeout: () => { this.session?.release?.(); this.session=null; this.sessionModelId=null; this.signature=null; } });\n      const output = selectRifeOutput(session, outputs, 3 * width * height);",
    after: `      const outputs = await runOrtInferenceWithRecovery({\n        modelId,\n        getSession: (id) => this._loadSession(id),\n        invalidateSession: (id, stuck) => this._invalidateSession(id, stuck),\n        run: (activeSession) => {\n          session = activeSession;\n          signature = this.signature || inspectRifeSignature(activeSession);\n          assertDynamicOrMatchingSize(signature, width, height);\n          const feeds = buildRifeFeeds(activeSession, this.ort, signature, frame0Chw, frame1Chw, width, height, timestep, concatLease);\n          return activeSession.run(feeds);\n        },\n        timeoutMs: 30000,\n        label: \`RIFE ORT inference \${modelId}\`,\n      });\n      const output = selectRifeOutput(session, outputs, 3 * width * height);`,
    already: 'return activeSession.run(feeds);',
    label: 'runtime inference',
  },
]);

await patchFile('src/engine/UpscaleEngine.js', [
  {
    before: "import { withHardTimeout } from './CrashProofRuntime.js';\n",
    after: "import { withHardTimeout } from './CrashProofRuntime.js';\nimport { runOrtInferenceWithRecovery } from './OrtInferenceRecovery.js';\n",
    already: "import { runOrtInferenceWithRecovery } from './OrtInferenceRecovery.js';",
    label: 'import',
  },
  {
    before: "  async _loadSession(modelId) {\n",
    after: `  async _invalidateSession(modelId, session = null) {\n    const current = this.session;\n    if (session && current && current !== session) {\n      try { session.release?.(); } catch (error) { console.warn('[BARSA][Upscale][stale-session-release-failed]', { modelId, error }); }\n      return;\n    }\n    try { current?.release?.(); } catch (error) { console.warn('[BARSA][Upscale][session-release-failed]', { modelId, error }); }\n    this.session = null;\n    this.sessionModelId = null;\n  }\n\n  async _loadSession(modelId) {\n`,
    already: 'async _invalidateSession(modelId, session = null)',
    label: 'invalidate helper',
  },
  {
    before: "        const tensor = new this.ort.Tensor('float32', prepared, inputDims);\n        const outputs = await withHardTimeout(() => session.run({ [inputName]: tensor }), { timeoutMs: 30000, label: `Upscale ORT inference ${modelId}`, signal, onTimeout: () => { this.session?.release?.(); this.session = null; this.sessionModelId = null; } });\n        output = outputs[outputName];",
    after: `        const outputs = await runOrtInferenceWithRecovery({\n          modelId,\n          getSession: (id) => this._loadSession(id),\n          invalidateSession: (id, stuck) => this._invalidateSession(id, stuck),\n          run: (activeSession) => {\n            const activeInputName = activeSession.inputNames[0];\n            const tensor = new this.ort.Tensor('float32', prepared, inputDims);\n            return activeSession.run({ [activeInputName]: tensor });\n          },\n          timeoutMs: 30000,\n          label: \`Upscale ORT inference \${modelId}\`,\n          signal,\n        });\n        output = outputs[outputName];`,
    already: 'return activeSession.run({ [activeInputName]: tensor });',
    label: 'runtime inference',
  },
]);

console.log('Same-model ONNX inference recovery applied to Face, RIFE, and Upscale engines.');
