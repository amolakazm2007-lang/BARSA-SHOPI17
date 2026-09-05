import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('v10 thermal guard never resumes a user-paused render',async()=>{
  const thermal=await fs.readFile(new URL('../src/engine/ThermalGuard.js',import.meta.url),'utf8');
  const main=await fs.readFile(new URL('../src/main.js',import.meta.url),'utf8');
  assert.match(thermal,/(?:const|let) paused(?:=false;try\{paused)?=pause\?\.\(\)===true/);
  assert.match(thermal,/if\(paused\)\{this\.autoPaused=true/);
  assert.match(thermal,/(?:const|let) resumed(?:=false;try\{resumed)?=resume\?\.\(\)===true/);
  assert.match(main,/if\(j\?\.state!=='running'\)return false/);
  assert.match(main,/if\(j\?\.state!=='paused'\)return false/);
});
