import { readFileSync, writeFileSync } from 'node:fs';

const file = 'src/engine/VideoPipeline.js';
let source = readFileSync(file, 'utf8');
const marker = "import { ProgressWatchdog } from './CrashProofRuntime.js';";
if (source.includes(marker)) {
  console.log('VideoPipeline crash-proof integration already applied.');
  process.exit(0);
}

function replaceOnce(from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`Crash-proof patch ${label} expected exactly one match, found ${count}`);
  source = source.replace(from, to);
}
function replaceAllRequired(from, to, min, label) {
  const count = source.split(from).length - 1;
  if (count < min) throw new Error(`Crash-proof patch ${label} expected >=${min} matches, found ${count}`);
  source = source.split(from).join(to);
}

replaceOnce(
  "import { TypedArrayPool } from './TypedArrayPool.js';",
  "import { TypedArrayPool } from './TypedArrayPool.js';\nimport { ProgressWatchdog } from './CrashProofRuntime.js';\nimport { CrashProofFallbackPolicy } from './CrashProofFallbackPolicy.js';\nimport { crashProofUserMessage } from './CrashProofUserNotice.js';",
  'imports',
);

replaceOnce(
  '    const cpuFrameWorker = new CPUFrameWorker();\n    const stability = new RenderStabilityMonitor();',
  `    let watchdogError = null;\n    let renderWatchdog = null;\n    const crashFallback = new CrashProofFallbackPolicy();\n    const reportCrashProofFailure = (error, fallback = null) => {\n      console.error('[BARSA][crash-proof]', error);\n      this.manager.dispatchEvent(new CustomEvent('warning', { detail: { code: error?.code || 'RUNTIME_FAILURE', error, message: crashProofUserMessage(error, { fallback }) } }));\n    };\n    crashFallback.addEventListener('fallback', ({ detail }) => reportCrashProofFailure(detail.error, detail.to));\n    const cpuFrameWorker = new CPUFrameWorker({ onFailure: (error) => reportCrashProofFailure(error, 'Canvas2D/main-thread') });\n    const stability = new RenderStabilityMonitor();`,
  'runtime setup',
);

replaceOnce(
  "        try { webgl.init(webglCanvas, { performanceManager: performance }); webglReady = true; } catch {}",
  "        try { webgl.init(webglCanvas, { performanceManager: performance }); webglReady = true; } catch (error) { reportCrashProofFailure(error, 'Canvas2D'); }",
  'webgl init',
);
replaceOnce(
  "          gpu.onFatalLoss = () => { effectsBackend = webglReady ? 'webgl2' : 'canvas2d'; };\n        } catch {}",
  "          gpu.onFatalLoss = (error) => { const fallback = webglReady ? 'WebGL2' : 'Canvas2D'; effectsBackend = webglReady ? 'webgl2' : 'canvas2d'; reportCrashProofFailure(error, fallback); };\n        } catch (error) { reportCrashProofFailure(error, webglReady ? 'WebGL2' : 'Canvas2D'); }",
  'webgpu init/loss',
);

replaceOnce(
  '      const renderOutput = async ({ frame, timestamp }) => {\n        abortIfNeeded(signal);',
  "      const renderOutput = async ({ frame, timestamp }) => {\n        if (watchdogError) throw watchdogError;\n        abortIfNeeded(signal);",
  'render watchdog check',
);

replaceAllRequired(
  `          } catch {\n            resilience?.noteBackendFallback?.();\n            effectsBackend = webglReady ? 'webgl2' : 'canvas2d';\n          }`,
  `          } catch (error) {\n            resilience?.noteBackendFallback?.();\n            const fallback = webglReady ? 'WebGL2' : 'Canvas2D';\n            effectsBackend = webglReady ? 'webgl2' : 'canvas2d';\n            reportCrashProofFailure(error, fallback);\n          }`,
  2,
  'webgpu frame fallbacks',
);
replaceAllRequired(
  `          } catch {\n            resilience?.noteBackendFallback?.();\n            effectsBackend = 'canvas2d';\n          }`,
  `          } catch (error) {\n            resilience?.noteBackendFallback?.();\n            effectsBackend = 'canvas2d';\n            reportCrashProofFailure(error, 'Canvas2D');\n          }`,
  2,
  'webgl frame fallbacks',
);

replaceOnce(
  `          }).catch(() => null);`,
  `          }).catch((error) => {\n            reportCrashProofFailure(error, 'Canvas2D/main-thread');\n            return null;\n          });`,
  'worker fallback visibility',
);

replaceOnce(
  '      let encodedFrames = resuming ? resumeEncodedFrames : 0;\n      const encodedFramesAtResume = encodedFrames;',
  `      let encodedFrames = resuming ? resumeEncodedFrames : 0;\n      const encodedFramesAtResume = encodedFrames;\n      renderWatchdog = new ProgressWatchdog({\n        timeoutMs: Math.max(15_000, Math.round(8_000 + 4 * 1000 / Math.max(1, targetFps))),\n        pollMs: 500,\n        label: 'video render frame pipeline',\n        onStall: async (error) => {\n          watchdogError = error;\n          reportCrashProofFailure(error);\n          cpuFrameWorker.destroy(error);\n          try { gpu.destroy?.(); } catch (cleanupError) { console.error('[BARSA][watchdog][gpu-cleanup-failed]', cleanupError); }\n          try { webgl.destroy?.(); } catch (cleanupError) { console.error('[BARSA][watchdog][webgl-cleanup-failed]', cleanupError); }\n        },\n      }).start(encodedFrames);`,
  'watchdog start',
);

replaceAllRequired(
  '        encodedFrames++;\n        performance.recordFrame();',
  '        encodedFrames++;\n        renderWatchdog?.progress(encodedFrames);\n        performance.recordFrame();',
  1,
  'watchdog progress',
);

replaceOnce('      await codecs.flushEncoder();', '      await codecs.flushEncoder({ signal });', 'encoder flush signal');

replaceOnce(
  '      temporal.reset();\n      temporalReconstruction.destroy?.();',
  '      renderWatchdog?.stop();\n      temporal.reset();\n      temporalReconstruction.destroy?.();',
  'watchdog cleanup',
);

writeFileSync(file, source);
console.log('VideoPipeline crash-proof integration applied successfully.');
