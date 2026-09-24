import type { ScenarioResult } from '@/lib/scenarios/types';

function xml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // XML 1.0 forbids most control characters, which serial output can contain.
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/**
 * A JUnit XML report, the format GitHub Actions, GitLab and Jenkins all read.
 * One testsuite per scenario file, one testcase per step, serial output in
 * system-out so a failing CI run shows what the sketch printed.
 */
export function junitReport(results: Array<{ file: string; result: ScenarioResult }>): string {
  const tests = results.reduce((n, r) => n + Math.max(1, r.result.steps.length), 0);
  const failures = results.reduce((n, r) => n + (r.result.passed ? 0 : 1), 0);
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', `<testsuites tests="${tests}" failures="${failures}">`];

  for (const { file, result } of results) {
    const seconds = (result.simulatedMs / 1000).toFixed(3);
    lines.push(
      `  <testsuite name="${xml(result.name)}" file="${xml(file)}" tests="${Math.max(1, result.steps.length)}" failures="${result.passed ? 0 : 1}" time="${seconds}">`,
    );
    if (result.error) {
      lines.push(`    <testcase name="load" classname="${xml(result.name)}">`);
      lines.push(`      <failure message="${xml(result.error)}"/>`);
      lines.push('    </testcase>');
    }
    for (const step of result.steps) {
      const name = `${step.index + 1}. ${step.step.kind}`;
      lines.push(`    <testcase name="${xml(name)}" classname="${xml(result.name)}" time="${(step.atMs / 1000).toFixed(3)}">`);
      if (!step.ok) lines.push(`      <failure message="${xml(step.message)}"/>`);
      lines.push('    </testcase>');
    }
    lines.push(`    <system-out>${xml(result.serial.join('\n'))}</system-out>`);
    lines.push('  </testsuite>');
  }
  lines.push('</testsuites>');
  return `${lines.join('\n')}\n`;
}
