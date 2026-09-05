import { rm, mkdir, cp, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
const root=process.cwd(), dist=path.join(root,'dist'), target=path.join(root,'android/app/src/main/assets/www');
if(!existsSync(dist)) throw new Error('dist/ is missing. Run npm run build first.');
await rm(target,{recursive:true,force:true}); await mkdir(target,{recursive:true}); await cp(dist,target,{recursive:true});
await writeFile(path.join(target,'android-runtime.json'),JSON.stringify({shell:'native',version:'7.0.0',syncedAt:new Date().toISOString()}));
console.log('Android assets synchronized:',target);
