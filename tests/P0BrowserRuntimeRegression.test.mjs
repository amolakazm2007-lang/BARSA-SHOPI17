import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const videoPipeline = fs.readFileSync(new URL('../src/engine/VideoPipeline.js', import.meta.url), 'utf8');
const webgl = fs.readFileSync(new URL('../src/engine/WebGL2Engine.js', import.meta.url), 'utf8');

test('P0 RIFE workspace survives try/finally cleanup scope', () => {
  assert.match(videoPipeline, /let rifeWorkspace = null;/);
  assert.match(videoPipeline, /rifeWorkspace = rifeActive \? new RifeFrameWorkspace\(/);
  assert.doesNotMatch(videoPipeline, /const rifeWorkspace = rifeActive/);
  assert.match(videoPipeline, /rifeWorkspace\?\.destroy\(\);/);
});

test('P0 WebGL2 shader avoids reserved flat identifier', () => {
  assert.doesNotMatch(webgl, /float\s+flat\s*=/);
  assert.match(webgl, /float flatRegion=/);
  assert.match(webgl, /u_deband\*flatRegion/);
});
