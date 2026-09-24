import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const staticDir = join(root, '.next/static');
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
const assets = files(staticDir).filter(p => /\.(js|css|woff2?)$/.test(p))
  .map(p => '/_next/static/' + relative(staticDir, p).split(/[\\/]/).map(encodeURIComponent).join('/'));
const version = readFileSync(join(root, '.next/BUILD_ID'), 'utf8').trim();
const template = readFileSync(join(root, 'scripts/service-worker.js'), 'utf8');
writeFileSync(join(root, 'public/sw.js'), template
  .replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(['/offline.html', '/', '/builder', ...assets])));
console.log(`Prepared offline worker for ${assets.length} app assets. Monaco is cached on use.`);
