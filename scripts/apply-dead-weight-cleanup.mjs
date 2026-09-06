import { access, readFile, rm, writeFile } from 'node:fs/promises';

const files = {
  manager: new URL('../src/engine/EngineManager.js', import.meta.url),
  pipeline: new URL('../src/engine/VideoPipeline.js', import.meta.url),
  main: new URL('../src/main.js', import.meta.url),
  html: new URL('../index.html', import.meta.url),
  nihui: new URL('../src/engine/NihuiModelBridge.js', import.meta.url),
};

function removeRequired(source, needle, label) {
  if (!source.includes(needle)) return source;
  return source.replace(needle, '');
}

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Dead-weight cleanup pattern missing: ${label}`);
  return source.replace(from, to);
}

function removeRegex(source, regex, label) {
  if (!regex.test(source)) return source;
  return source.replace(regex, '');
}

async function cleanupManager() {
  let source = await readFile(files.manager, 'utf8');
  for (const line of [
    "import { NihuiModelBridge } from './NihuiModelBridge.js';\n",
    "import { QualityMetricsEngine } from './QualityMetricsEngine.js';\n",
    "import { FullDeviceTestEngine } from './FullDeviceTestEngine.js';\n",
    '      nihui: new NihuiModelBridge(),\n',
    '      qualityMetrics: new QualityMetricsEngine(),\n',
  ]) source = removeRequired(source, line, line.trim());

  source = replaceRequired(
    source,
    '    this.deviceTest = new FullDeviceTestEngine(this);',
    '    this.deviceTest = createLazyDeviceTestHandle(this);',
    'lazy FullDeviceTestEngine handle',
  );

  if (!source.includes('function createLazyDeviceTestHandle(manager)')) {
    source += `\n\nfunction createLazyDeviceTestHandle(manager) {\n  let instancePromise = null;\n  const load = () => {\n    if (!instancePromise) {\n      instancePromise = import('./FullDeviceTestEngine.js')\n        .then(({ FullDeviceTestEngine }) => new FullDeviceTestEngine(manager))\n        .catch((error) => {\n          instancePromise = null;\n          throw error;\n        });\n    }\n    return instancePromise;\n  };\n  return Object.freeze({\n    run: (...args) => load().then((engine) => engine.run(...args)),\n    __peek: () => instancePromise,\n  });\n}\n`;
  }

  await writeFile(files.manager, source);
}

async function cleanupPipeline() {
  let source = await readFile(files.pipeline, 'utf8');
  source = source.replace(/^\s*qualityMetrics,\s*$/m, '');
  source = source.replace(/^\s*qualityMetrics\.sample\(outputCanvas,\s*encodedFrames\);\s*$/m, '');
  if (/\bqualityMetrics\b/.test(source)) {
    throw new Error('QualityMetrics still referenced by production VideoPipeline after cleanup');
  }
  await writeFile(files.pipeline, source);
}

async function cleanupMain() {
  let source = await readFile(files.main, 'utf8');
  source = removeRegex(
    source,
    /byId\('nihuiImportBtn'\)\.addEventListener\('click',\(\)=>byId\('nihuiModelInput'\)\.click\(\)\);byId\('nihuiModelInput'\)\.addEventListener\('change',e=>importNihuiPack\(e\.target\.files\)\);/g,
    'dead Nihui UI wiring',
  );
  if (/nihui/i.test(source)) throw new Error('Nihui reference remains in src/main.js');
  await writeFile(files.main, source);
}

async function cleanupHtml() {
  let source = await readFile(files.html, 'utf8');
  source = removeRegex(source, /\s*<article class="nihui-card">[\s\S]*?<\/article>/g, 'Nihui model card');
  source = removeRegex(source, /\s*<input id="nihuiModelInput"[^>]*>/g, 'Nihui hidden input');
  if (/nihui/i.test(source)) throw new Error('Nihui reference remains in index.html');
  await writeFile(files.html, source);
}

async function removeNihuiBridge() {
  try {
    await access(files.nihui);
    await rm(files.nihui);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

await cleanupManager();
await cleanupPipeline();
await cleanupMain();
await cleanupHtml();
await removeNihuiBridge();
console.log('BARSA dead-weight cleanup applied: Nihui removed, render metrics off hot path, device test lazy-loaded');
