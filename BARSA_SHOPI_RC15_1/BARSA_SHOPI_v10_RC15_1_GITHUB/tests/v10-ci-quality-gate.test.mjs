import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('v10 Android CI blocks APK on lint, tests, web E2E and runtime verification',async()=>{
  const debug=await fs.readFile(new URL('../.github/workflows/android-build.yml',import.meta.url),'utf8');
  const release=await fs.readFile(new URL('../.github/workflows/android-release.yml',import.meta.url),'utf8');
  assert.match(debug,/- 'tests\/\*\*'/);
  assert.match(debug,/:app:lintDebug :app:testDebugUnitTest :app:assembleDebug/);
  assert.match(release,/:app:lintRelease :app:testDebugUnitTest :app:assembleRelease/);
  for(const source of [debug,release]){
    assert.match(source,/npm run verify:runtime/);
    assert.match(source,/npm test/);
    assert.match(source,/playwright/);
    assert.match(source,/test:browser/);
  }
});
