import fs from 'node:fs';

function patchFile(path, transforms) {
  let source = fs.readFileSync(path, 'utf8');
  let changed = false;
  for (const { from, to, label } of transforms) {
    if (source.includes(to)) continue;
    if (!source.includes(from)) {
      throw new Error(`Cannot apply ${label}: expected source marker missing in ${path}`);
    }
    source = source.replace(from, to);
    changed = true;
  }
  if (changed) fs.writeFileSync(path, source);
  console.log(changed ? `Patched ${path}` : `${path} already patched`);
}

patchFile('src/engine/VideoPipeline.js', [
  {
    label: 'RIFE workspace lifetime declaration',
    from: '    let renderWatchdog = null;\n    const crashFallback = new CrashProofFallbackPolicy();',
    to: '    let renderWatchdog = null;\n    let rifeWorkspace = null;\n    const crashFallback = new CrashProofFallbackPolicy();',
  },
  {
    label: 'RIFE workspace assignment visible to finally cleanup',
    from: '      const rifeWorkspace = rifeActive ? new RifeFrameWorkspace(nativeWidth, nativeHeight) : null;',
    to: '      rifeWorkspace = rifeActive ? new RifeFrameWorkspace(nativeWidth, nativeHeight) : null;',
  },
  {
    label: 'browser monotonic clock avoids performance engine shadowing on write start',
    from: '            const writeStartedAt = performance.now();',
    to: '            const writeStartedAt = globalThis.performance?.now?.() ?? Date.now();',
  },
  {
    label: 'browser monotonic clock avoids performance engine shadowing on write finish',
    from: '              const elapsedMs = Math.max(0, performance.now() - writeStartedAt);',
    to: '              const elapsedMs = Math.max(0, (globalThis.performance?.now?.() ?? Date.now()) - writeStartedAt);',
  },
  {
    label: 'progress clock uses browser performance API rather than performance engine',
    from: "        const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();",
    to: '        const now = globalThis.performance?.now?.() ?? Date.now();',
  },
  {
    label: 'source VideoFrame ownership begins explicit try/finally scope',
    from: '        const frameSource = sourceFrame.source;\n        if (resuming && currentSourceIndex < resumeSourceFrameIndex) {',
    to: '        const frameSource = sourceFrame.source;\n        let processedFrame = null;\n        let processedFrameOwnedBySequencer = false;\n        try {\n        if (resuming && currentSourceIndex < resumeSourceFrameIndex) {',
  },
  {
    label: 'remove duplicate processed frame declaration after ownership scope',
    from: '        frameIntegrity.observeDecoded(timestamp, sourceDuration);\n        let processedFrame;\n\n        // Re-sample once per source second.',
    to: '        frameIntegrity.observeDecoded(timestamp, sourceDuration);\n\n        // Re-sample once per source second.',
  },
  {
    label: 'GPU cleanup keeps source ownership in pipeline finally',
    from: '            gpu.renderFrame(frameSource, activeCleanupEffects, { width: nativeWidth, height: nativeHeight }, { releaseSource: true });',
    to: '            gpu.renderFrame(frameSource, activeCleanupEffects, { width: nativeWidth, height: nativeHeight }, { releaseSource: false });',
  },
  {
    label: 'sequencer ownership transfer is explicit after successful push',
    from: '        await sequencer.push(processedFrame, { timestamp, duration: sourceDuration });\n        for (const item of await sequencer.drainPair(interpolate)) {',
    to: '        await sequencer.push(processedFrame, { timestamp, duration: sourceDuration });\n        processedFrameOwnedBySequencer = true;\n        processedFrame = null;\n        for (const item of await sequencer.drainPair(interpolate)) {',
  },
  {
    label: 'source and unqueued processed frames close on every iteration exit',
    from: '        currentSourceIndex++;\n      }\n      for (const item of await sequencer.flush(interpolate)) {',
    to: "        currentSourceIndex++;\n        } finally {\n          if (!processedFrameOwnedBySequencer) {\n            try { processedFrame?.close?.(); } catch (cleanupError) { console.error('[BARSA][frame-cleanup][processed-failed]', cleanupError); }\n          }\n          try { frameSource?.close?.(); } catch (cleanupError) { console.error('[BARSA][frame-cleanup][source-failed]', cleanupError); }\n        }\n      }\n      for (const item of await sequencer.flush(interpolate)) {",
  },
]);

patchFile('src/engine/WebGL2Engine.js', [
  {
    label: 'GLSL reserved flat identifier',
    from: 'float flat=1.-smoothstep(.012,.075,distance(c,far));c=mix(c,far,u_deband*flat*.3)',
    to: 'float flatRegion=1.-smoothstep(.012,.075,distance(c,far));c=mix(c,far,u_deband*flatRegion*.3)',
  },
]);
