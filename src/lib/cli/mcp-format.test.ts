import { describe, expect, it } from 'vitest';
import {
  escapeHtml,
  formatExportResult,
  formatLoadProject,
  formatRunResult,
  runResultHtml,
} from './mcp-format';

describe('mcp-format (editor-facing rendering of tool results)', () => {
  it('renders a load summary with parts, wires and ERC findings', () => {
    const text = formatLoadProject({
      name: 'Blink',
      board: 'arduino-uno',
      engine: 'functional',
      parts: [{ id: 'p1', type: 'led' }, { id: 'p2', type: 'resistor-220' }],
      wireCount: 3,
      warnings: [],
      erc: { clean: false, errors: [{ code: 'E-01', title: 'Floating pin', severity: 'error' }] },
    });
    expect(text).toContain('Project: Blink');
    expect(text).toContain('Board:   arduino-uno');
    expect(text).toContain('- led');
    expect(text).toContain('Wires:   3');
    expect(text).toContain('[error] E-01 — Floating pin');
  });

  it('renders a passing free-run with serial and part states', () => {
    const text = formatRunResult({
      mode: 'free-run',
      passed: true,
      serial: ['hello', 'world'],
      parts: { led1: { on: true }, board: {} },
    });
    expect(text).toContain('Result:  PASS');
    expect(text).toContain('  hello');
    expect(text).toContain('led1: on=true');
  });

  it('renders a failing scenario step', () => {
    const text = formatRunResult({
      mode: 'scenario',
      name: 'Blink timing',
      passed: false,
      simulatedMs: 1200,
      failure: { step: 3, message: 'expected HIGH' },
    });
    expect(text).toContain('Scenario: Blink timing');
    expect(text).toContain('FAIL');
    expect(text).toContain('step 3 — expected HIGH');
  });

  it('renders export summaries and truncation-safe inputs', () => {
    const text = formatExportResult({
      format: 'wokwi',
      files: [{ name: 'diagram.json', content: '{}' }],
      skipped: ['scope (scope-1)'],
    });
    expect(text).toContain('Export: wokwi');
    expect(text).toContain('diagram.json (2 chars)');
    expect(text).toContain('skipped: scope (scope-1)');
    // Garbage in, graceful text out.
    expect(() => formatLoadProject({})).not.toThrow();
    expect(() => formatRunResult({ parts: 'nonsense' })).not.toThrow();
  });

  it('escapes HTML in webview output', () => {
    expect(escapeHtml('<script>"a&b"</script>')).toBe(
      '&lt;script&gt;&quot;a&amp;b&quot;&lt;/script&gt;',
    );
    const html = runResultHtml({
      mode: 'scenario',
      name: '<b>X</b>',
      passed: false,
      error: 'boom <script>',
      serial: ['line&1'],
    });
    expect(html).toContain('&lt;b&gt;X&lt;/b&gt;');
    expect(html).toContain('boom &lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});
