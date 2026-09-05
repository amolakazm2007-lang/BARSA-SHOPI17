import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
const sourceRoot = new URL('../src/', import.meta.url);
const failures = [];

async function walk(url) {
  for (const entry of await readdir(url, { withFileTypes: true })) {
    const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url);
    if (entry.isDirectory()) await walk(child);
    else if (entry.name.endsWith('.js')) {
      const text = await readFile(child, 'utf8');
      const remoteURLs = text.match(/https?:\/\/[^'"`\s]+/g) || [];
      const auditedCatalogFile = ['/engine/UpscaleEngine.js', '/engine/RIFEEngine.js', '/engine/FaceRestorationEngine.js', '/engine/FaceDetectorEngine.js'].some((suffix) => child.pathname.endsWith(suffix));
      const auditedModelCatalog = auditedCatalogFile && remoteURLs.every((value) => {
        try { return ['huggingface.co', 'github.com'].includes(new URL(value).hostname); } catch { return false; }
      });
      if (remoteURLs.length && !auditedModelCatalog) failures.push(`${child.pathname}: unapproved remote runtime URL`);
      if (/\bTODO\b|placeholder|not implemented/i.test(text)) failures.push(`${child.pathname}: unfinished marker`);
    }
  }
}

await walk(sourceRoot);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Source policy check passed for ${join(fileURLToPath(root), 'src')}.`);

function fileURLToPath(url) {
  return decodeURIComponent(url.pathname);
}
