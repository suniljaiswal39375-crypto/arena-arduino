/** Regenerate examples/ from the seed data: npm run examples */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { exampleFiles } from '../src/lib/cli/examples';

const root = join(__dirname, '..');
rmSync(join(root, 'examples'), { recursive: true, force: true });
const files = exampleFiles();
for (const f of files) {
  const full = join(root, f.path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, f.content);
}
process.stdout.write(`Wrote ${files.length} files to examples/\n`);
