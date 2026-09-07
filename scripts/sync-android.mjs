import { rm, mkdir, cp, writeFile, appendFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const root=process.cwd(), dist=path.join(root,'dist'), target=path.join(root,'android/app/src/main/assets/www');
if(!existsSync(dist)) throw new Error('dist/ is missing. Run npm run build first.');

await rm(target,{recursive:true,force:true});
await mkdir(target,{recursive:true});
await cp(dist,target,{recursive:true});

// Android WebView touch hardening.
// The mobile UI previously stacked multiple sticky navigation layers at the same
// top edge while the controls panel used layout/paint containment. On Android
// WebView that combination can leave an overlapping composited layer consuming
// taps/drag gestures, making sliders, tabs and buttons appear unresponsive.
// Keep the desktop/web design untouched and patch only the packaged Android CSS.
const androidTouchPatch=`\n/* BARSA Android touch-control hardening */
html.native-android,html.native-android body{touch-action:pan-y pinch-zoom;overscroll-behavior-y:auto!important}
html.native-android body{overflow-y:auto!important;-webkit-overflow-scrolling:touch}
@media(max-width:900px){
 html.native-android .controls-panel,html.native-android .stage-panel{contain:none!important}
 html.native-android .master-tabs,html.native-android .workflow-strip,html.native-android .lab-nav{position:static!important;top:auto!important;inset:auto!important}
 html.native-android .controls-panel button,html.native-android .controls-panel select,html.native-android .controls-panel input,html.native-android .controls-panel label,html.native-android .master-tabs button,html.native-android .lab-nav button{pointer-events:auto!important;touch-action:manipulation}
 html.native-android input[type="range"]{pointer-events:auto!important;touch-action:pan-x}
 html.native-android .controls-panel{overflow:visible!important;max-height:none!important}
}
`;

async function collectCssFiles(dir){
  const entries=await readdir(dir,{withFileTypes:true});
  const out=[];
  for(const entry of entries){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory()) out.push(...await collectCssFiles(full));
    else if(entry.isFile()&&entry.name.endsWith('.css')) out.push(full);
  }
  return out;
}

const cssFiles=await collectCssFiles(target);
if(cssFiles.length===0) throw new Error('Android sync produced no CSS assets; touch hardening cannot be applied.');
for(const cssFile of cssFiles) await appendFile(cssFile,androidTouchPatch,'utf8');

await writeFile(path.join(target,'android-runtime.json'),JSON.stringify({shell:'native',version:'7.0.1',syncedAt:new Date().toISOString()}));
console.log('Android assets synchronized:',target);
console.log('Android touch-control hardening applied to CSS assets:',cssFiles.length);
