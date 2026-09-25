import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateBudgets, manifestFileReader, PERF_BUDGETS, type BudgetManifest, type BudgetRule } from './budget';

/**
 * The budget gate must measure the real build output and fail loudly — but
 * the evaluation logic is pure, so these tests feed synthetic manifests and
 * an in-memory "filesystem".
 */

function bytesOf(kb: number): Buffer {
  return Buffer.alloc(kb * 1024, 1);
}

describe('evaluateBudgets', () => {
  it('sums the gzipped first-load JS of a route and compares against the limit', () => {
    const manifest: BudgetManifest = {
      pages: {
        '/builder/page': ['/static/chunks/a.js', '/static/chunks/b.js', '/static/css/x.css'],
      },
    };
    const onlyBuilder = PERF_BUDGETS.filter((r) => r.route === '/builder');
    const { results, passed } = evaluateBudgets(manifest, (file) => bytesOf(file.includes('a.js') ? 100 : 30), onlyBuilder, (buf) => buf.length);
    expect(passed).toBe(true);
    const builder = results.find((r) => r.route === '/builder')!;
    expect(builder.gzipKb).toBe(130); // css excluded, both js chunks summed
    expect(builder.files.map((f) => f.name)).toEqual(['/static/chunks/a.js', '/static/chunks/b.js']);
    expect(builder.ok).toBe(true);
  });

  it('fails when a route exceeds its budget', () => {
    const manifest: BudgetManifest = { pages: { '/builder/page': ['/static/chunks/a.js'] } };
    const onlyBuilder: BudgetRule[] = PERF_BUDGETS.filter((r) => r.route === '/builder');
    const { results, passed } = evaluateBudgets(manifest, () => bytesOf(300), onlyBuilder, (buf) => buf.length);
    expect(passed).toBe(false);
    expect(results.find((r) => r.route === '/builder')!.ok).toBe(false);
  });

  it('flags a missing route instead of silently passing it', () => {
    const { results, passed } = evaluateBudgets({ pages: {} }, () => bytesOf(1), PERF_BUDGETS, (buf) => buf.length);
    expect(passed).toBe(false);
    expect(results.every((r) => r.missing)).toBe(true);
  });

  it('covers the spec routes with the spec numbers', () => {
    expect(PERF_BUDGETS.map((r) => r.route)).toEqual(['/builder', '/', '/missions']);
    expect(PERF_BUDGETS.every((r) => r.maxGzipKb === 250)).toBe(true);
  });

  it('the manifest reader resolves both path conventions', () => {
    const dir = mkdtempSync(join(tmpdir(), 'budget-'));
    const nextDir = join(dir, '.next');
    mkdirSync(join(nextDir, 'static', 'chunks'), { recursive: true });
    writeFileSync(join(nextDir, 'static', 'chunks', 'a.js'), 'hello');
    const reader = manifestFileReader(nextDir, dir);
    expect(reader('/static/chunks/a.js').toString()).toBe('hello');
    expect(() => reader('/static/chunks/missing.js')).toThrow(/cannot read/);
  });
});
