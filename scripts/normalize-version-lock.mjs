import fs from 'node:fs';

const pkgPath = new URL('../package.json', import.meta.url);
const lockPath = new URL('../package-lock.json', import.meta.url);
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));

lock.version = pkg.version;
if (lock.packages?.['']) lock.packages[''].version = pkg.version;

fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
console.log(`package-lock metadata normalized to ${pkg.version}`);
