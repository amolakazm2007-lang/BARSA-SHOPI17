import { access, readFile, rm, writeFile } from 'node:fs/promises';

const files = {
  manager: new URL('../src/engine/EngineManager.js', import.meta.url),
  pipeline: new URL('../src/engine/VideoPipeline.js', import.meta.url),
  main: new URL('../src/main.js', import.meta.url),
  html: new URL('../index.html', import.meta.url),
  nihui: new URL('../src/engine/NihuiModelBridge.js', import.meta.url),
  nihuiTest: new URL('../tests/NihuiModelBridge.test.mjs', import.meta.url),
  rc14Test: new URL('../tests/v10-rc14-professional-hardening.test.mjs', import.meta.url),
  qualityMetrics: new URL('../src/engine/QualityMetricsEngine.js', import.meta.url),
  qualityMetricsTest: new URL('../tests/QualityMetrics.test.mjs', import.meta.url),
};

function removeRequired(source, needle) {
  if (!source.includes(needle)) return source;
  return source.replace(needle, '');
}

function replaceRequired(source, from, to, label) {
  if (source.includes(to)) return source;
  if (!source.includes(from)) throw new Error(`Dead-weight cleanup pattern missing: ${label}`);
  return source.replace(from, to);
}

function removeRegex(source, regex) {
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
    '    this.engines.nihui.close();\n',
    '    this.engines.qualityMetrics.destroy();\n',
  ]) source = removeRequired(source, line);

  source = replaceRequired(
    source,
    '    this.deviceTest = new FullDeviceTestEngine(this);',
    '    this.deviceTest = createLazyDeviceTestHandle(this);',
    'lazy FullDeviceTestEngine handle',
  );

  if (!source.includes('function createLazyDeviceTestHandle(manager)')) {
    source += `\n\nfunction createLazyDeviceTestHandle(manager) {\n  let instancePromise = null;\n  const load = () => {\n    if (!instancePromise) {\n      instancePromise = import('./FullDeviceTestEngine.js')\n        .then(({ FullDeviceTestEngine }) => new FullDeviceTestEngine(manager))\n        .catch((error) => {\n          instancePromise = null;\n          throw error;\n        });\n    }\n    return instancePromise;\n  };\n  return Object.freeze({\n    run: (...args) => load().then((engine) => engine.run(...args)),\n    __peek: () => instancePromise,\n  });\n}\n`;
  }

  if (/NihuiModelBridge|\bnihui\b/i.test(source)) {
    throw new Error('Nihui still referenced by EngineManager after cleanup');
  }
  if (/QualityMetricsEngine|\bqualityMetrics\b/.test(source)) {
    throw new Error('QualityMetrics still referenced by EngineManager after cleanup');
  }

  await writeFile(files.manager, source);
}

async function cleanupPipeline() {
  let source = await readFile(files.pipeline, 'utf8');
  source = source.replace(/^\s*qualityMetrics,\s*$/m, '');
  source = source.replace(/^\s*qualityMetrics\.sample\(outputCanvas,\s*encodedFrames\);\s*$/m, '');
  source = source.replace('          qualityAudit: qualityMetrics.finalize(),', '          qualityAudit: null,');
  source = source.replace(/^\s*qualityMetrics\.reset\(\);\s*$/m, '');
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
  );
  source = removeRegex(
    source,
    /const packs=await manager\.engines\.nihui\.listPacks\(\)\.catch\(\(\)=>\[\]\);if\(packs\.length\)byId\('nihuiModelState'\)\.textContent=`\$\{packs\.length\} حزمة NCNN محفوظة محلياً · تحتاج ONNX للتنفيذ الحالي`;/g,
  );
  if (/\bnihui\b/i.test(source)) throw new Error('Nihui reference remains in src/main.js');
  await writeFile(files.main, source);
}

async function cleanupHtml() {
  let source = await readFile(files.html, 'utf8');
  source = removeRegex(source, /\s*<article class="nihui-card">[\s\S]*?<\/article>/g);
  source = removeRegex(source, /\s*<input id="nihuiModelInput"[^>]*>/g);
  if (/\bnihui\b/i.test(source)) throw new Error('Nihui reference remains in index.html');
  await writeFile(files.html, source);
}

async function cleanupObsoleteRegressionCoverage() {
  let source = await readFile(files.rc14Test, 'utf8');
  source = removeRegex(
    source,
    /\ntest\('RC14 Nihui pack import is size-bounded, sanitized and cleans OPFS if metadata commit fails',[\s\S]*?\n\}\);\n/,
  );
  if (/NihuiModelBridge/.test(source)) throw new Error('Obsolete Nihui regression coverage remains after cleanup');
  await writeFile(files.rc14Test, source);
}

async function removeIfPresent(file) {
  try {
    await access(file);
    await rm(file);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

await cleanupManager();
await cleanupPipeline();
await cleanupMain();
await cleanupHtml();
await cleanupObsoleteRegressionCoverage();
await Promise.all([
  removeIfPresent(files.nihui),
  removeIfPresent(files.nihuiTest),
  removeIfPresent(files.qualityMetrics),
  removeIfPresent(files.qualityMetricsTest),
]);
console.log('BARSA dead-weight cleanup applied: stored-only Nihui removed, diagnostic render metrics removed from production, device test kept module-lazy');
