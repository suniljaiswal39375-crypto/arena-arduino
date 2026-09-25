/**
 * Human-readable rendering of MCP tool results (load / run / export).
 *
 * Shared by the VS Code extension's output channel and webview; pure
 * functions over the server's JSON so they are fully unit-testable without
 * any editor host.
 */

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function bool(v: unknown): boolean {
  return v === true;
}

function arrayOf(v: unknown): Array<Record<string, unknown>> {
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
}

export function formatLoadProject(result: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`Project: ${str(result.name, '(unnamed)')}`);
  if (typeof result.board === 'string') lines.push(`Board:   ${result.board}`);
  if (typeof result.engine === 'string') lines.push(`Engine:  ${result.engine}`);
  const parts = arrayOf(result.parts);
  lines.push(`Parts:   ${parts.length}`);
  for (const part of parts.slice(0, 24)) {
    lines.push(`  - ${str(part.type, '?')}  (${str(part.id, '?')})`);
  }
  if (parts.length > 24) lines.push(`  … and ${parts.length - 24} more`);
  if (typeof result.wireCount === 'number') lines.push(`Wires:   ${result.wireCount}`);
  const warnings = arrayOf(result.warnings as unknown);
  for (const w of warnings) lines.push(`warning: ${String((w as Record<string, unknown>).message ?? w)}`);
  const erc = result.erc as Record<string, unknown> | undefined;
  if (erc) {
    lines.push(bool(erc.clean) ? 'ERC:     clean' : 'ERC:     issues found');
    for (const finding of arrayOf(erc.errors).slice(0, 10)) {
      lines.push(`  [${str(finding.severity, '?')}] ${str(finding.code, '?')} — ${str(finding.title, '')}`);
    }
  }
  return lines.join('\n');
}

export function formatRunResult(result: Record<string, unknown>): string {
  const lines: string[] = [];
  const mode = str(result.mode, 'run');
  const passed = bool(result.passed);
  lines.push(mode === 'scenario' ? `Scenario: ${str(result.name, '(unnamed)')}` : 'Free-run simulation');
  lines.push(`Result:  ${passed ? 'PASS' : 'FAIL'}`);
  if (typeof result.simulatedMs === 'number') lines.push(`Simulated: ${result.simulatedMs} ms`);
  const failure = result.failure as Record<string, unknown> | undefined;
  if (failure) lines.push(`Failure: step ${String(failure.step ?? '?')} — ${str(failure.message)}`);
  if (typeof result.error === 'string' && result.error !== '') lines.push(`Error:   ${result.error}`);
  const serial = arrayOf(result.serial as unknown).map((l) => String(l));
  if (serial.length > 0) {
    lines.push('Serial:');
    for (const lineText of serial.slice(-12)) lines.push(`  ${lineText}`);
  }
  const parts = result.parts as Record<string, unknown> | undefined;
  if (parts && typeof parts === 'object') {
    const ids = Object.keys(parts).slice(0, 12);
    if (ids.length > 0) {
      lines.push('Final part states:');
      for (const id of ids) {
        const state = parts[id] as Record<string, unknown>;
        const highlights = Object.entries(state ?? {})
          .filter(([key]) => ['on', 'level', 'value', 'angle', 'text', 'error'].includes(key))
          .map(([key, value]) => `${key}=${String(value)}`)
          .join(' ');
        lines.push(`  ${id}: ${highlights || '(no notable state)'}`);
      }
    }
  }
  return lines.join('\n');
}

export function formatExportResult(result: Record<string, unknown>): string {
  const lines: string[] = [];
  const format = str(result.format, 'export');
  lines.push(`Export: ${format}`);
  const files = arrayOf(result.files);
  for (const file of files) {
    const content = str(file.content);
    lines.push(`  ${str(file.name, '?')} (${content.length} chars)`);
  }
  if (typeof result.text === 'string') lines.push(`  (${result.text.length} chars of ${format} output)`);
  const skipped = arrayOf(result.skipped as unknown);
  for (const s of skipped) lines.push(`  skipped: ${String(s)}`);
  return lines.join('\n');
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A small self-contained webview body for a run result. */
export function runResultHtml(result: Record<string, unknown>): string {
  const passed = bool(result.passed);
  const title =
    str(result.mode) === 'scenario'
      ? `Scenario: ${str(result.name, '(unnamed)')}`
      : 'Free-run simulation';
  const serial = arrayOf(result.serial as unknown).map((l) => String(l)).slice(-40);
  const body: string[] = [];
  body.push(`<h1>${escapeHtml(title)}</h1>`);
  body.push(
    `<p class="verdict ${passed ? 'pass' : 'fail'}">${passed ? 'PASS' : 'FAIL'}</p>`,
  );
  if (typeof result.error === 'string' && result.error !== '') {
    body.push(`<p class="error">${escapeHtml(result.error)}</p>`);
  }
  const failure = result.failure as Record<string, unknown> | undefined;
  if (failure) {
    body.push(
      `<p class="error">Step ${escapeHtml(String(failure.step ?? '?'))}: ${escapeHtml(str(failure.message))}</p>`,
    );
  }
  if (serial.length > 0) {
    body.push(`<h2>Serial monitor</h2><pre>${escapeHtml(serial.join('\n'))}</pre>`);
  }
  return `<!doctype html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 12px; }
  .verdict { font-weight: 700; font-size: 1.2em; }
  .pass { color: #2e7d32; } .fail { color: #c62828; }
  .error { color: #c62828; }
  pre { background: rgba(127,127,127,.12); padding: 8px; overflow: auto; }
</style></head>
<body>${body.join('\n')}</body>
</html>`;
}
