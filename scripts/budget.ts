/**
 * Performance budget gate (spec §18): gzips the first-load JS of key routes
 * from the real build manifest and fails the build on a breach. Thin I/O over
 * the pure evaluator in src/lib/ci/budget.ts (which carries the tests).
 *
 *   npm run budget        (also runs automatically after `npm run build`)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateBudgets, manifestFileReader } from '../src/lib/ci/budget';

const root = fileURLToPath(new URL('../', import.meta.url));
const nextDir = join(root, '.next');
const manifestPath = join(nextDir, 'app-build-manifest.json');

if (!existsSync(manifestPath)) {
  process.stderr.write('budget: no .next/app-build-manifest.json — run `npm run build` first.\n');
  process.exit(2);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { pages: Record<string, string[]> };
const { results, passed } = evaluateBudgets(manifest, manifestFileReader(nextDir, root));

const out = process.stdout;
out.write('\nPerformance budgets (gzipped first-load JS, spec §18)\n');
for (const r of results) {
  if (r.missing) {
    out.write(`  ${r.route.padEnd(12)} MISSING from the build manifest — layout changed, fix the budget runner\n`);
    continue;
  }
  const mark = r.ok ? 'ok ' : 'OVER';
  out.write(`  ${r.route.padEnd(12)} ${String(r.gzipKb).padStart(6)} kB / ${r.maxGzipKb} kB  ${mark}  ${r.files.length} chunks\n`);
}
out.write('\n');

if (!passed) {
  process.stderr.write('budget: a performance budget was breached. Ship less JavaScript or split a chunk — do not raise the limit.\n');
  process.exit(1);
}
