import { mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handleMcpLine, runMcpServer } from './mcp';
import { runCli, type CliIO } from './cli';
import { templateDoc } from '@/lib/templates';
import { toWokwiDiagram } from '@/lib/interop/wokwi';

/**
 * The MCP surface (spec §12.7): a pure line handler plus a stdio loop. Tests
 * drive both — the handler directly for protocol semantics, and through
 * runCli('mcp') for the wiring — against a real project on disk.
 */

const PRINTER = `void setup() { Serial.begin(9600); Serial.println("booted"); }
void loop() { Serial.println("tick"); delay(100); }`;

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sparklab-mcp-'));
  const doc = templateDoc('uno-blink')!;
  writeFileSync(join(dir, 'diagram.json'), JSON.stringify(toWokwiDiagram(doc).diagram));
  writeFileSync(join(dir, 'sketch.ino'), PRINTER);
  return dir;
}

function call(method: string, params?: unknown, id: number | string = 1): string | null {
  return handleMcpLine(JSON.stringify({ jsonrpc: '2.0', id, method, params }), tmpdir());
}

function resultOf(line: string | null): Record<string, unknown> {
  expect(line).toBeTruthy();
  const parsed = JSON.parse(line!) as { result?: Record<string, unknown>; error?: unknown };
  expect(parsed.error).toBeUndefined();
  return parsed.result ?? {};
}

function callTool(name: string, args: Record<string, unknown>): string | null {
  return call('tools/call', { name, arguments: args });
}

function toolPayload(line: string | null): Record<string, unknown> {
  const result = resultOf(line);
  const content = result.content as Array<{ type: string; text: string }>;
  expect(content[0]?.type).toBe('text');
  return JSON.parse(content[0]!.text) as Record<string, unknown>;
}

describe('MCP protocol', () => {
  it('answers initialize with protocol, capabilities and server info', () => {
    const result = resultOf(call('initialize', { protocolVersion: '2024-11-05' }));
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.capabilities).toEqual({ tools: {} });
    const info = result.serverInfo as { name: string; version: string };
    expect(info.name).toBe('sparklab-cli');
    expect(info.version).toBeTruthy();
  });

  it('stays silent on notifications and empty lines', () => {
    expect(call('notifications/initialized')).toBeNull();
    expect(handleMcpLine('', tmpdir())).toBeNull();
    expect(handleMcpLine('   ', tmpdir())).toBeNull();
  });

  it('lists its tools with input schemas', () => {
    const { tools } = resultOf(call('tools/list')) as { tools: Array<{ name: string; inputSchema: Record<string, unknown> }> };
    expect(tools.map((t) => t.name)).toEqual(['list_projects', 'load_project', 'run_simulation', 'export_diagram']);
    for (const tool of tools) expect(tool.inputSchema.type).toBe('object');
  });

  it('rejects garbage, bad frames and unknown methods', () => {
    expect(handleMcpLine('not json', tmpdir())).toContain('-32700');
    expect(handleMcpLine('42', tmpdir())).toContain('-32600');
    expect(JSON.parse(call('some/method', undefined, 7)!)).toMatchObject({ id: 7, error: { code: -32601 } });
    // An unknown *notification* (no id) stays silent.
    expect(handleMcpLine(JSON.stringify({ jsonrpc: '2.0', method: 'some/notification' }), tmpdir())).toBeNull();
  });
});

describe('MCP tools', () => {
  it('list_projects finds a project directory under a controlled root', () => {
    const root = mkdtempSync(join(tmpdir(), 'sparklab-mcp-root-'));
    const dir = tempProject();
    // Move the project under the root so the scan is deterministic.
    const renamed = join(root, 'my-project');
    renameSync(dir, renamed);
    const payload = toolPayload(callTool('list_projects', { path: root }));
    const projects = payload.projects as string[];
    expect(projects).toEqual([join(renamed, 'diagram.json')]);
  });

  it('load_project summarises parts, wiring and a clean ERC', () => {
    const dir = tempProject();
    const payload = toolPayload(callTool('load_project', { path: dir }));
    expect(payload.board).toBe('arduino-uno');
    expect((payload.parts as Array<{ type: string }>).map((p) => p.type)).toContain('arduino-uno');
    expect(payload.wireCount).toBeGreaterThan(0);
    expect((payload.erc as { clean: boolean }).clean).toBe(true);
  });

  it('run_simulation free-runs and returns serial output', () => {
    const dir = tempProject();
    const payload = toolPayload(callTool('run_simulation', { path: dir, ms: 1000 }));
    expect(payload.mode).toBe('free-run');
    expect(payload.passed).toBe(true);
    expect(payload.serial as string[]).toContain('booted');
  });

  it('run_simulation executes a scenario YAML and reports the verdict', () => {
    const dir = tempProject();
    // A sketch whose D13 is HIGH at the 250 ms mark of the scenario.
    writeFileSync(join(dir, 'sketch.ino'), 'void setup() { pinMode(13, OUTPUT); }\nvoid loop() { digitalWrite(13, HIGH); delay(100); digitalWrite(13, LOW); delay(100); }');
    const yaml = 'name: blinks\nsteps:\n  - delay: 250ms\n  - expect-pin: { part-id: uno, pin: 13, expected: 1 }\n';
    const payload = toolPayload(callTool('run_simulation', { path: dir, scenarioYaml: yaml }));
    expect(payload.mode).toBe('scenario');
    expect(payload.passed).toBe(true);
  });

  it('run_simulation reports compile errors as a failed run, not a crash', () => {
    const dir = tempProject();
    writeFileSync(join(dir, 'sketch.ino'), 'void setup() {\n  int x = ;\n}\nvoid loop() {}');
    const payload = toolPayload(callTool('run_simulation', { path: dir, ms: 500 }));
    expect(payload.passed).toBe(false);
    expect(payload.error).toBeTruthy();
  });

  it('export_diagram produces Wokwi, KiCad and BOM output', () => {
    const dir = tempProject();
    const wokwi = toolPayload(callTool('export_diagram', { path: dir, format: 'wokwi' }));
    expect((wokwi.files as Array<{ name: string }>).map((f) => f.name)).toEqual(['diagram.json', 'sketch.ino', 'libraries.txt']);
    const kicad = toolPayload(callTool('export_diagram', { path: dir, format: 'kicad' })) as { text: string };
    expect(kicad.text.startsWith('(export')).toBe(true);
    const bom = toolPayload(callTool('export_diagram', { path: dir, format: 'bom-csv' })) as { text: string };
    expect(bom.text).toContain('Quantity');
  });

  it('reports bad paths and unknown tools as tool errors, not protocol errors', () => {
    // Paths outside the sandbox root (the handler cwd) are refused outright.
    const bad = JSON.parse(call('tools/call', { name: 'load_project', arguments: { path: '/no/such/dir' } })!);
    expect(bad.result.isError).toBe(true);
    expect(JSON.parse(bad.result.content[0].text).error).toMatch(/escapes the project root/);
    // Inside the root but missing → the loader's own readable error.
    const insideRoot = mkdtempSync(join(tmpdir(), 'sparklab-mcp-empty-'));
    const missing = JSON.parse(call('tools/call', { name: 'load_project', arguments: { path: join(insideRoot, 'nope') } })!);
    expect(missing.result.isError).toBe(true);
    expect(JSON.parse(missing.result.content[0].text).error).toMatch(/No such file/);
    expect(JSON.parse(call('tools/call', { name: 'nope', arguments: {} }, 2)!)).toMatchObject({ id: 2, error: { code: -32602 } });
  });
});

describe('sparklab-cli mcp over stdio', () => {
  it('serves the protocol end to end through runCli', async () => {
    const dir = tempProject();
    const lines = [
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'load_project', arguments: { path: dir } } }),
    ];
    const out: string[] = [];
    const err: string[] = [];
    async function* input(): AsyncGenerator<string> {
      for (const line of lines) yield line;
    }
    const io: CliIO = { out: (l) => out.push(l), err: (l) => err.push(l), cwd: dir, input: input() };
    const code = await runCli(['mcp'], io);
    expect(code).toBe(0);
    expect(err.join('\n')).toBe('');
    expect(out).toHaveLength(3); // the notification produced no response
    const init = JSON.parse(out[0]!) as { result: { serverInfo: { name: string } } };
    expect(init.result.serverInfo.name).toBe('sparklab-cli');
    const tools = JSON.parse(out[1]!) as { result: { tools: Array<{ name: string }> } };
    expect(tools.result.tools).toHaveLength(4);
    const load = JSON.parse(out[2]!) as { result: { content: Array<{ text: string }> } };
    const summary = JSON.parse(load.result.content[0]!.text) as { board: string };
    expect(summary.board).toBe('arduino-uno');
  });

  it('explains itself when stdin is missing', async () => {
    const out: string[] = [];
    const err: string[] = [];
    const io: CliIO = { out: (l) => out.push(l), err: (l) => err.push(l), cwd: tmpdir() };
    expect(await runCli(['mcp'], io)).toBe(2);
    expect(err.join('\n')).toMatch(/stdin/);
  });

;
});
