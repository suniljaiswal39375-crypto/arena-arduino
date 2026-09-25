import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Performance budgets as a gate (spec §18/§21): the *built* first-load
 * JavaScript of key routes is gzipped and measured against the spec's
 * numbers, and the build fails when a budget is breached. Measured from the
 * real `app-build-manifest.json`, not estimated — a budget you do not
 * enforce is a wish.
 */

export interface BudgetRule {
  /** Next route, e.g. `/builder` (the manifest key is `<route>/page`). */
  route: string;
  /** Maximum gzipped first-load JS, in KiB. */
  maxGzipKb: number;
  label: string;
}

/** Spec §18 budgets. The builder number is the hard one; others are generous. */
export const PERF_BUDGETS: BudgetRule[] = [
  { route: '/builder', maxGzipKb: 250, label: 'builder first-load JS' },
  { route: '/', maxGzipKb: 250, label: 'landing first-load JS' },
  { route: '/missions', maxGzipKb: 250, label: 'missions first-load JS' },
];

export interface BudgetFile {
  name: string;
  gzipKb: number;
}

export interface BudgetResult {
  route: string;
  label: string;
  gzipKb: number;
  maxGzipKb: number;
  ok: boolean;
  files: BudgetFile[];
  /** The route had no manifest entry — the build layout changed. */
  missing: boolean;
}

export interface BudgetManifest {
  pages: Record<string, string[]>;
}

/**
 * Evaluate every rule against a build manifest. `readBytes` resolves a
 * manifest file path to its bytes and `compress` returns the gzipped size
 * (both injected so tests need no filesystem or real compression; the CLI
 * script passes the defaults).
 */
export function evaluateBudgets(
  manifest: BudgetManifest,
  readBytes: (file: string) => Buffer,
  rules: BudgetRule[] = PERF_BUDGETS,
  compress: (buf: Buffer) => number = (buf) => gzipSync(buf).length,
): { results: BudgetResult[]; passed: boolean } {
  const results = rules.map((rule) => {
    // The landing route's manifest key is '/page', not '//page'.
    const wanted = rule.route === '/' ? '/page' : `${rule.route}/page`;
    const key = Object.keys(manifest.pages).find((k) => k === wanted);
    if (!key) {
      return { route: rule.route, label: rule.label, gzipKb: 0, maxGzipKb: rule.maxGzipKb, ok: false, files: [], missing: true };
    }
    const files: BudgetFile[] = manifest.pages[key]!
      .filter((f) => f.endsWith('.js'))
      .map((f) => ({
        name: f,
        gzipKb: Math.round((compress(readBytes(f)) / 1024) * 10) / 10,
      }));
    const gzipKb = Math.round(files.reduce((sum, f) => sum + f.gzipKb, 0) * 10) / 10;
    return {
      route: rule.route,
      label: rule.label,
      gzipKb,
      maxGzipKb: rule.maxGzipKb,
      ok: gzipKb <= rule.maxGzipKb,
      files,
      missing: false,
    };
  });
  return { results, passed: results.every((r) => r.ok) };
}

/**
 * Read a file listed in the build manifest. Manifest paths are absolute from
 * the project root in newer Next versions and `.next`-relative in older ones;
 * try both.
 */
export function manifestFileReader(nextDir: string, rootDir: string): (file: string) => Buffer {
  return (file: string): Buffer => {
    const candidates = file.startsWith('/') ? [join(rootDir, file), join(nextDir, file)] : [join(nextDir, file), join(rootDir, file)];
    for (const path of candidates) {
      try {
        return readFileSync(path);
      } catch {
        // try the next candidate
      }
    }
    throw new Error(`budget: cannot read manifest file ${file}`);
  };
}
