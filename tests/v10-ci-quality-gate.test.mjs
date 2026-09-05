import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('v10 Android CI blocks APK on tests, runtime verification, lint and both APK builds',async()=>{
  const workflow=await fs.readFile(new URL('../.github/workflows/build-apk.yml',import.meta.url),'utf8');
  assert.match(workflow,/npm run verify:runtime/);
  assert.match(workflow,/npm test/);
  assert.match(workflow,/:app:lintDebug :app:lintRelease/);
  assert.match(workflow,/:app:assembleDebug :app:assembleRelease/);
  assert.match(workflow,/apksigner/);
  assert.match(workflow,/zipalign/);
  assert.match(workflow,/aapt" dump badging/);
  assert.match(workflow,/npm audit --omit=dev --audit-level=critical/);
});
