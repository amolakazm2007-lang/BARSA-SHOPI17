import fs from 'node:fs';
const html=fs.readFileSync('index.html','utf8');
const labs=fs.readFileSync('src/ui/EngineLabsUI.js','utf8');
const combined=html+'\n'+labs;
const js=fs.readFileSync('src/main.js','utf8');
const required=[...js.matchAll(/byId\(['"`]([^'"`]+)['"`]\)/g)].map(m=>m[1]).filter(id=>!id.includes('${'));
const unique=[...new Set(required)];
const missing=unique.filter(id=>!new RegExp(`id=["']${id}["']`).test(combined));
const htmlIds=[...html.matchAll(/id=["']([^"']+)["']/g)].map(m=>m[1]);
const duplicate=htmlIds.filter((id,i,a)=>a.indexOf(id)!==i);
if(missing.length||duplicate.length){console.error('UI AUDIT FAIL',{missing,duplicate:[...new Set(duplicate)]});process.exit(1)}
console.log(`UI AUDIT PASS · ${unique.length} statically referenced IDs resolved · no duplicate static HTML IDs`);
