import fs from 'node:fs';

function patchFile(path, transforms) {
  let source = fs.readFileSync(path, 'utf8');
  let changed = false;
  for (const { from, to, label } of transforms) {
    if (source.includes(to)) continue;
    if (!source.includes(from)) {
      throw new Error(`Cannot apply ${label}: expected source marker missing in ${path}`);
    }
    source = source.replace(from, to);
    changed = true;
  }
  if (changed) fs.writeFileSync(path, source);
  console.log(changed ? `Patched ${path}` : `${path} already patched`);
}

patchFile('src/engine/VideoPipeline.js', [
  {
    label: 'RIFE workspace lifetime declaration',
    from: '    let renderWatchdog = null;\n    const crashFallback = new CrashProofFallbackPolicy();',
    to: '    let renderWatchdog = null;\n    let rifeWorkspace = null;\n    const crashFallback = new CrashProofFallbackPolicy();',
  },
  {
    label: 'RIFE workspace assignment visible to finally cleanup',
    from: '      const rifeWorkspace = rifeActive ? new RifeFrameWorkspace(nativeWidth, nativeHeight) : null;',
    to: '      rifeWorkspace = rifeActive ? new RifeFrameWorkspace(nativeWidth, nativeHeight) : null;',
  },
]);

patchFile('src/engine/WebGL2Engine.js', [
  {
    label: 'GLSL reserved flat identifier',
    from: 'float flat=1.-smoothstep(.012,.075,distance(c,far));c=mix(c,far,u_deband*flat*.3)',
    to: 'float flatRegion=1.-smoothstep(.012,.075,distance(c,far));c=mix(c,far,u_deband*flatRegion*.3)',
  },
]);
