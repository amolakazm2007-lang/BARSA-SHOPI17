import { readFile, writeFile } from 'node:fs/promises';

async function patch(relativePath, transforms) {
  const path = new URL(`../${relativePath}`, import.meta.url);
  let source = await readFile(path, 'utf8');
  for (const { before, after, already, label } of transforms) {
    if (source.includes(already)) continue;
    if (!source.includes(before)) throw new Error(`Fault-ledger anchor missing in ${relativePath}: ${label}`);
    source = source.replace(before, after);
  }
  await writeFile(path, source);
}

await patch('src/engine/EngineManager.js', [
  {
    before: "import { ResourceScope } from './ResourceScope.js';\n",
    after: "import { ResourceScope } from './ResourceScope.js';\nimport { RuntimeFaultLedger } from './RuntimeFaultLedger.js';\n",
    already: "import { RuntimeFaultLedger } from './RuntimeFaultLedger.js';",
    label: 'import',
  },
  {
    before: "    this.jobs = new Map();\n    this.activeJobId = null;\n    this.deviceTest = new FullDeviceTestEngine(this);",
    after: "    this.jobs = new Map();\n    this.activeJobId = null;\n    this.faultLedger = new RuntimeFaultLedger({ maxEntries: 240, maxGroups: 96 });\n    this.deviceTest = new FullDeviceTestEngine(this);",
    already: 'this.faultLedger = new RuntimeFaultLedger({ maxEntries: 240, maxGroups: 96 });',
    label: 'constructor',
  },
  {
    before: "  _emit(type, detail) {\n    this.dispatchEvent(new CustomEvent(type, { detail }));\n  }",
    after: `  _emit(type, detail) {\n    if ((type === 'warning' || type === 'error') && this.faultLedger) {\n      const code = detail?.code || (type === 'error' ? 'RUNTIME_ERROR' : 'RUNTIME_WARNING');\n      this.faultLedger.record({\n        code,\n        subsystem: detail?.subsystem || inferFaultSubsystem(code),\n        severity: type === 'error' ? 'error' : detail?.severity || 'warning',\n        jobId: detail?.jobId || this.activeJobId || null,\n        recoverable: detail?.recoverable ?? detail?.error?.recoverable ?? null,\n        message: detail?.message || detail?.error?.message || detail?.label || code,\n        details: detail,\n        source: 'EngineManager',\n      });\n    }\n    this.dispatchEvent(new CustomEvent(type, { detail }));\n  }`,
    already: "source: 'EngineManager'",
    label: 'event capture',
  },
  {
    before: "function serializeError(error) {\n",
    after: `function inferFaultSubsystem(code) {\n  const value = String(code || '').toUpperCase();\n  if (value.includes('GPU') || value.includes('WEBGL')) return 'gpu';\n  if (value.includes('CODEC') || value.includes('ENCODER') || value.includes('DECODER')) return 'webcodecs';\n  if (value.includes('FFMPEG') || value.includes('REMUX')) return 'ffmpeg';\n  if (value.includes('MODEL') || value.includes('ORT') || value.includes('ONNX') || value.includes('AI_')) return 'ai';\n  if (value.includes('STORAGE') || value.includes('OPFS') || value.includes('CHECKPOINT')) return 'storage';\n  if (value.includes('MEMORY') || value.includes('THERMAL') || value.includes('PRESSURE')) return 'resources';\n  if (value.includes('WORKER')) return 'worker';\n  return 'runtime';\n}\n\nfunction serializeError(error) {\n`,
    already: 'function inferFaultSubsystem(code)',
    label: 'subsystem classifier',
  },
]);

await patch('src/engine/BarsaDoctor.js', [
  {
    before: "      const failCount = Object.values(checks).filter(v => v.status === 'FAIL').length;",
    after: `      await capture('runtime-fault-ledger', async () => {\n        const snapshot = this.manager.faultLedger?.snapshot?.({ recentLimit: 24 }) || { totalEvents: 0, activeGroups: 0, errorGroups: 0, groups: [], recent: [] };\n        if (snapshot.errorGroups > 0) issues.push(issue('runtime-fault-history', 'medium', \`Runtime fault ledger contains \${snapshot.errorGroups} active error group(s); inspect the grouped evidence before release.\`));\n        return snapshot;\n      });\n\n      const failCount = Object.values(checks).filter(v => v.status === 'FAIL').length;`,
    already: "capture('runtime-fault-ledger'",
    label: 'doctor check',
  },
  {
    before: "        devicePassport: this.manager.performancePassport?.snapshot?.() || null,\n        safeRepairCount:",
    after: "        devicePassport: this.manager.performancePassport?.snapshot?.() || null,\n        runtimeFaults: this.manager.faultLedger?.snapshot?.({ recentLimit: 24 }) || null,\n        safeRepairCount:",
    already: 'runtimeFaults: this.manager.faultLedger?.snapshot?.({ recentLimit: 24 }) || null,',
    label: 'report evidence',
  },
]);

console.log('Runtime fault ledger integrated with EngineManager and BARSA Doctor.');
