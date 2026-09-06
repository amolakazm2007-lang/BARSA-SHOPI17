import { readFile, writeFile } from 'node:fs/promises';

const files = {
  manager: new URL('../src/engine/EngineManager.js', import.meta.url),
  pipeline: new URL('../src/engine/VideoPipeline.js', import.meta.url),
};

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Lazy-loading migration pattern missing: ${label}`);
  return source.replace(from, to);
}

async function migrateManager() {
  let source = await readFile(files.manager, 'utf8');
  for (const line of [
    "import { RIFEEngine } from './RIFEEngine.js';\n",
    "import { UpscaleEngine } from './UpscaleEngine.js';\n",
    "import { FaceRestorationEngine } from './FaceRestorationEngine.js';\n",
    "import { FFmpegEngine } from './FFmpegEngine.js';\n",
    "import { FaceDetectorEngine } from './FaceDetectorEngine.js';\n",
  ]) source = source.replace(line, '');

  source = replaceRequired(
    source,
    "import { RuntimeFaultReporter } from './RuntimeFaultReporter.js';\n",
    "import { RuntimeFaultReporter } from './RuntimeFaultReporter.js';\nimport { createModuleLazyEngine } from './LazyEngineFacade.js';\n",
    'EngineManager LazyEngineFacade import',
  );

  const oldFactories = `    const rife = createLazyEngineHandle('rife', () => new RIFEEngine(models));\n    const upscale = createLazyEngineHandle('upscale', () => new UpscaleEngine(models));\n    const faceDetector = createLazyEngineHandle('faceDetector', () => new FaceDetectorEngine(models));\n    const face = createLazyEngineHandle('face', () => new FaceRestorationEngine(models, faceDetector));`;
  const newFactories = `    const rife = createModuleLazyEngine('rife', async () => {\n      const { RIFEEngine } = await import('./RIFEEngine.js');\n      return new RIFEEngine(models);\n    });\n    const upscale = createModuleLazyEngine('upscale', async () => {\n      const { UpscaleEngine } = await import('./UpscaleEngine.js');\n      return new UpscaleEngine(models);\n    });\n    const faceDetector = createModuleLazyEngine('faceDetector', async () => {\n      const { FaceDetectorEngine } = await import('./FaceDetectorEngine.js');\n      return new FaceDetectorEngine(models);\n    });\n    const face = createModuleLazyEngine('face', async () => {\n      const { FaceRestorationEngine } = await import('./FaceRestorationEngine.js');\n      return new FaceRestorationEngine(models, faceDetector);\n    });\n    const ffmpeg = createModuleLazyEngine('ffmpeg', async () => {\n      const { FFmpegEngine } = await import('./FFmpegEngine.js');\n      return new FFmpegEngine();\n    });`;
  source = replaceRequired(source, oldFactories, newFactories, 'heavy engine factories');
  source = replaceRequired(source, '      ffmpeg: new FFmpegEngine(),', '      ffmpeg,', 'FFmpeg engine slot');

  const reporterAnchor = `    this.faultReporter = new RuntimeFaultReporter({\n      ledger: this.faultLedger,\n      eventTarget: this,\n      source: 'EngineManager',\n      getActiveJobId: () => this.activeJobId,\n    });`;
  const reporterBound = `${reporterAnchor}\n    this.engines.gpu.setFaultReporter?.(this.faultReporter);\n    for (const key of ['rife', 'upscale', 'faceDetector', 'face', 'ffmpeg']) {\n      this.engines[key].setFaultReporter?.(this.faultReporter);\n    }`;
  source = replaceRequired(source, reporterAnchor, reporterBound, 'lazy engine fault reporter binding');

  await writeFile(files.manager, source);
}

async function migratePipeline() {
  let source = await readFile(files.pipeline, 'utf8');
  source = replaceRequired(
    source,
    "import { QUALITY_PRESETS } from './FFmpegEngine.js';\nimport { MODEL_REGISTRY, imageDataToChwFloat32, chwFloat32ToImageData } from './UpscaleEngine.js';",
    "import { QUALITY_PRESETS, UPSCALE_RENDER_CATALOG as MODEL_REGISTRY } from './RenderCatalog.js';\nimport { imageDataToChwFloat32, chwFloat32ToImageData } from './TensorImageUtils.js';",
    'VideoPipeline lightweight metadata imports',
  );
  await writeFile(files.pipeline, source);
}

await migrateManager();
await migratePipeline();
console.log('BARSA phase 3 module lazy-loading migration applied');
