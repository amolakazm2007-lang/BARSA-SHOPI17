import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const pkg = JSON.parse(read('package.json'));
const gradle = read('android/app/build.gradle');
const manifest = read('android/app/src/main/AndroidManifest.xml');
const theme = read('android/app/src/main/res/values/themes.xml');
const activity = read('android/app/src/main/java/com/barsa/shopi/MainActivity.java');
const vault = read('src/engine/AutoModelVault.js');
const fabric = read('src/engine/DynamicRenderFabric.js');
const mobileCss = read('public/rc16-mobile.css');
const smoke = read('tests/e2e-mobile-smoke.mjs');
const workflow = read('.github/workflows/build-apk.yml');

const failures = [];
const requireText = (text, needle, label) => { if (!text.includes(needle)) failures.push(label); };
const forbidText = (text, needle, label) => { if (text.includes(needle)) failures.push(label); };

if (pkg.version !== '10.0.0') failures.push(`package version must be 10.0.0, got ${pkg.version}`);
requireText(gradle, "versionName '10.0.0'", 'Android versionName must be 10.0.0');
requireText(gradle, 'versionCode 1002000', 'Android versionCode must be 1002000');
if (!/compileSdk\s+3[5-9]/.test(gradle)) failures.push('compileSdk must remain API 35+');
if (!/targetSdk\s+3[5-9]/.test(gradle)) failures.push('targetSdk must remain API 35+');
requireText(gradle, "androidx.core:core:1.19.0", 'WindowInsetsCompat dependency must be pinned');

requireText(manifest, 'android.permission.INTERNET', 'INTERNET permission is required for explicit model downloads');
forbidText(manifest, 'WRITE_EXTERNAL_STORAGE', 'legacy WRITE_EXTERNAL_STORAGE permission must not be reintroduced');
requireText(manifest, 'android:usesCleartextTraffic="false"', 'cleartext traffic must stay disabled');
requireText(theme, 'android:windowLayoutInDisplayCutoutMode">shortEdges', 'display cutout shortEdges support is required');

requireText(activity, 'WindowCompat.setDecorFitsSystemWindows(getWindow(), false)', 'edge-to-edge must use WindowCompat');
requireText(activity, 'WindowInsetsCompat.Type.systemBars()', 'systemBars inset handling is required');
requireText(activity, 'WindowInsetsCompat.Type.ime()', 'IME inset handling is required');
requireText(activity, 'WindowInsetsCompat.Type.displayCutout()', 'display cutout inset handling is required');
requireText(activity, 'removeJavascriptInterface("BarsaAndroid")', 'WebView bridge must be removed on untrusted navigation/destruction');
requireText(activity, 'isTrustedAppUri', 'WebView native bridge must remain origin-restricted');

requireText(vault, 'user-action-required', 'AI model network provisioning must require user activation');
requireText(vault, 'cooperativeUiYield', 'heavy model provisioning must cooperatively yield UI time');
requireText(fabric, 'qualityLocked: true', 'final render plan must declare quality lock');
requireText(fabric, 'previewMaxFps', 'preview load must remain independently adaptive');
requireText(fabric, 'previewLongEdge', 'preview resolution must remain independently adaptive');

requireText(mobileCss, '@media(max-width:350px)', 'mobile CSS must cover sub-360px phones');
requireText(smoke, 'width: 320', 'mobile smoke must cover 320px width');
requireText(smoke, 'Unexpected startup/catalog network requests', 'mobile smoke must reject hidden network startup');

for (const token of [
  ':app:lintDebug', ':app:lintRelease', ':app:testDebugUnitTest',
  ':app:assembleDebug', ':app:assembleRelease', 'zipalign', 'apksigner', 'aapt',
  'BARSA-SHOPI-v10.0.0-FINAL-installable.apk', 'BARSA-SHOPI-v10.0.0-FINAL.zip',
]) requireText(workflow, token, `CI release gate missing: ${token}`);

if (failures.length) {
  console.error('RELEASE INVARIANTS: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('RELEASE INVARIANTS: PASS');
console.log('Android edge-to-edge, WebView origin isolation, offline startup, quality lock, compact-mobile coverage, and APK verification gates are present.');
