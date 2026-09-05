import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read=(p)=>readFile(new URL(`../${p}`,import.meta.url),'utf8');

test('Android shell exposes file chooser, chunked MP4 MediaStore export, and keep-screen-on', async()=>{
  const [activity,bridge,server]=await Promise.all([
    read('android/app/src/main/java/com/barsa/shopi/MainActivity.java'),
    read('android/app/src/main/java/com/barsa/shopi/NativeBridge.java'),
    read('android/app/src/main/java/com/barsa/shopi/AssetServer.java'),
  ]);
  assert.match(activity,/onShowFileChooser/);
  assert.match(activity,/BarsaAndroid/);
  assert.match(bridge,/appendExportChunk/);
  assert.match(bridge,/MediaStore\.Video\.Media/);
  assert.match(bridge,/FLAG_KEEP_SCREEN_ON/);
  assert.match(server,/Cross-Origin-Embedder-Policy: require-corp/);
  assert.match(server,/Transfer-Encoding: chunked/);
});

test('Blur Studio provides a dedicated blur-only MP4 action', async()=>{
  const [ui,main]=await Promise.all([read('src/ui/EngineLabsUI.js'),read('src/main.js')]);
  assert.match(ui,/id="blur-render-only"/);
  assert.match(main,/startBlurOnlyProcessing/);
  assert.match(main,/runProcessingWithSettings\(settings,'blur-only'\)/);
});
