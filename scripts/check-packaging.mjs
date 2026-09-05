import fs from 'node:fs';
import { APP_VERSION, APP_VERSION_CODE } from '../src/version.js';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const gradle = read('android/app/build.gradle');
const workflow = read('.github/workflows/build-apk.yml');
const failures = [];

if (pkg.version !== APP_VERSION) failures.push(`package.json version ${pkg.version} != ${APP_VERSION}`);
if (lock.version !== APP_VERSION || lock.packages?.['']?.version !== APP_VERSION) failures.push('package-lock root version is inconsistent');
if (!gradle.includes(`versionCode ${APP_VERSION_CODE}`)) failures.push('Android versionCode is inconsistent');
if (!gradle.includes(`versionName '${APP_VERSION}'`)) failures.push('Android versionName is inconsistent');

const expectedInstallable = 'BARSA-SHOPI-v10-RC15.1-FINAL-installable.apk';
const expectedUnsignedRelease = 'BARSA-SHOPI-v10-RC15.1-release-unsigned.apk';
const expectedBundle = 'BARSA-SHOPI-v10-RC15.1-FINAL';

if (!workflow.includes(expectedInstallable)) failures.push(`final installable APK name is missing: ${expectedInstallable}`);
if (!workflow.includes(expectedUnsignedRelease)) failures.push(`unsigned release APK name is missing: ${expectedUnsignedRelease}`);
if (!workflow.includes(`name: ${expectedBundle}`)) failures.push(`final artifact bundle name is missing: ${expectedBundle}`);
if (/BARSA-SHOPI-v9\.8\.1/.test(workflow)) failures.push('legacy v9.8.1 artifact naming remains');
if (/BARSA-SHOPI-v10-RC15\.1-debug\.apk/.test(workflow)) failures.push('legacy RC15.1 debug artifact naming remains');

if (failures.length) {
  console.error('PACKAGING AUDIT: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log(`PACKAGING AUDIT: PASS (${APP_VERSION}, versionCode ${APP_VERSION_CODE})`);
console.log(`Final installable: ${expectedInstallable}`);
console.log(`Unsigned release: ${expectedUnsignedRelease}`);
console.log(`Artifact bundle: ${expectedBundle}`);
