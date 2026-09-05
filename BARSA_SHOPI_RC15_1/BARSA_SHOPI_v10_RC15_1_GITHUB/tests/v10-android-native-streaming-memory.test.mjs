import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('Android native AI request path streams Float32 tensors without full-body byte[] duplication', () => {
  const source = fs.readFileSync(new URL('../android/app/src/main/java/com/barsa/shopi/AssetServer.java', import.meta.url), 'utf8');
  assert.match(source, /readFloatArrayExactly\(in, \(int\)frameFloats\)/);
  assert.match(source, /readFloatArrayExactly\(in, \(int\)\(length \/ 4L\)\)/);
  assert.match(source, /writeFloatResponse\(out,result\.data,extra\)/);
  assert.doesNotMatch(source, /ByteBuffer\.allocate\(result\.data\.length\*4\)/);
  assert.doesNotMatch(source, /byte\[\] bytes = readExactly\(in, \(int\)length\)/);
});

test('Native RIFE reuses concat scratch within a session instead of allocating every inference', () => {
  const source = fs.readFileSync(new URL('../android/app/src/main/java/com/barsa/shopi/NativeAiRuntime.java', import.meta.url), 'utf8');
  assert.match(source, /private float\[\] concatScratch/);
  assert.match(source, /holder\.concatScratch\(total\)/);
  assert.doesNotMatch(source, /float\[\] both=new float\[a\.length\+b\.length\]/);
});
