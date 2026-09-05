import fs from 'node:fs';
import { APP_VERSION, APP_VERSION_CODE } from '../src/version.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const gradle = read('android/app/build.gradle');
const debug = read('.github/workflows/android-build.yml');
const release = read('.github/workflows/android-release.yml');
const failures = [];

if (pkg.version !== APP_VERSION) failures.push(`package.json version ${pkg.version} != ${APP_VERSION}`);
if (lock.version !== APP_VERSION || lock.packages?.['']?.version !== APP_VERSION) failures.push('package-lock root version is inconsistent');
if (!gradle.includes(`versionCode ${APP_VERSION_CODE}`)) failures.push('Android versionCode is inconsistent');
if (!gradle.includes(`versionName '${APP_VERSION}'`)) failures.push('Android versionName is inconsistent');
if (!debug.includes('BARSA-SHOPI-v10-RC15.1-debug')) failures.push('debug artifact name is stale');
if (!release.includes('BARSA-SHOPI-v10-RC15.1-release')) failures.push('release artifact name is stale');
if (/BARSA-SHOPI-v9\.8\.1/.test(debug + release)) failures.push('legacy v9.8.1 artifact naming remains');

if (failures.length) {
  console.error('PACKAGING AUDIT: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`PACKAGING AUDIT: PASS (${APP_VERSION}, versionCode ${APP_VERSION_CODE})`);
