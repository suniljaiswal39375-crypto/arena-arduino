import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/**
 * Accessibility audit per route (spec §21 quality gates, WCAG 2.2 AA).
 *
 * Gating policy, deliberately staged: **critical** violations fail the route.
 * Serious and moderate violations are printed to the CI log with their impact
 * and selector so they are visible and countable, but they do not fail the
 * run yet — the audit exists to drive them to zero, not to pretend they are
 * already gone. When the list is empty on every route, flip the gate.
 */

const ROUTES = ['/', '/builder', '/missions', '/docs', '/accessibility'];

interface AxeViolation {
  id: string;
  impact: string | undefined;
  nodes: Array<{ target: string[] }>;
}

function impactOf(violations: AxeViolation[]): string {
  return violations
    .map((v) => `  [${v.impact ?? 'unknown'}] ${v.id}: ${v.nodes.length} node(s), e.g. ${v.nodes[0]?.target.join(' ') ?? '?'}`)
    .join('\n');
}

for (const route of ROUTES) {
  test(`no critical accessibility violations on ${route}`, async ({ page }) => {
    await page.goto(route);
    const results = await new AxeBuilder({ page }).analyze();
    const violations = results.violations as AxeViolation[];
    const critical = violations.filter((v) => v.impact === 'critical');
    if (critical.length > 0) {
      console.error(`axe: ${route} has ${critical.length} critical violation(s):\n${impactOf(critical)}`);
    }
    const nonCritical = violations.filter((v) => v.impact !== 'critical');
    if (nonCritical.length > 0) {
      // Visible in CI logs; not gating yet (see header).
      console.warn(`axe: ${route} — ${nonCritical.length} non-critical violation kind(s):\n${impactOf(nonCritical)}`);
    }
    expect(critical, `critical a11y violations on ${route}:\n${impactOf(critical)}`).toHaveLength(0);
  });
}

test('the web app manifest is served and installable in principle', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.ok()).toBe(true);
  const manifest = (await res.json()) as { name: string; display: string; icons: Array<{ src: string }> };
  expect(manifest.display).toBe('standalone');
  expect(manifest.icons.length).toBeGreaterThan(0);
  const icon = await request.get(manifest.icons[0]!.src);
  expect(icon.ok()).toBe(true);
});
