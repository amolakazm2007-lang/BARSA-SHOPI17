import { readFile, writeFile } from 'node:fs/promises';

const path = new URL('../src/engine/EngineManager.js', import.meta.url);
let source = await readFile(path, 'utf8');

function ensureReplace(before, after, alreadyToken, label) {
  if (source.includes(alreadyToken)) return;
  if (!source.includes(before)) throw new Error(`Doctor control-plane integration anchor missing: ${label}`);
  source = source.replace(before, after);
}

ensureReplace(
  "import { BarsaDoctor } from './BarsaDoctor.js';\n",
  "import { BarsaDoctor } from './BarsaDoctor.js';\nimport { DoctorControlPlane } from './DoctorControlPlane.js';\n",
  "import { DoctorControlPlane } from './DoctorControlPlane.js';",
  'import',
);

ensureReplace(
  `    this.runtimeGuard = new RuntimeHealthGuard({\n      memoryGovernor: this.memoryGovernor,\n      performance: this.engines.performance,\n      storageGovernor: this.storageGovernor,\n    });\n    this.jobs = new Map();`,
  `    this.runtimeGuard = new RuntimeHealthGuard({\n      memoryGovernor: this.memoryGovernor,\n      performance: this.engines.performance,\n      storageGovernor: this.storageGovernor,\n    });\n    this.doctorControlPlane = new DoctorControlPlane({\n      runtimeGuard: this.runtimeGuard,\n      performance: this.engines.performance,\n      storage: this.engines.storage,\n      passport: this.performancePassport,\n    });\n    this.jobs = new Map();`,
  'this.doctorControlPlane = new DoctorControlPlane({',
  'constructor',
);

ensureReplace(
  `    const runtimeDecision = this.runtimeGuard.evaluate({ capabilities: this.capabilities || {}, workloadMB, heavyAi });\n    const resourceScope = new ResourceScope(\`job:\${jobId}\`);`,
  `    const doctorDecision = this.doctorControlPlane.assessRuntime({ capabilities: this.capabilities || {}, workloadMB, heavyAi, jobId });\n    const runtimeDecision = doctorDecision.runtimeDecision;\n    const resourceScope = new ResourceScope(\`job:\${jobId}\`);`,
  'const doctorDecision = this.doctorControlPlane.assessRuntime({',
  'runJob decision',
);

ensureReplace(
  `      runtimeGuard: this.runtimeGuard,\n      runtimeDecision,\n      resources: resourceScope,`,
  `      runtimeGuard: this.runtimeGuard,\n      runtimeDecision,\n      doctorDecision,\n      doctorControlPlane: this.doctorControlPlane,\n      resources: resourceScope,`,
  'doctorControlPlane: this.doctorControlPlane,',
  'processor context',
);

await writeFile(path, source);
console.log('BARSA Doctor control-plane integration applied.');
