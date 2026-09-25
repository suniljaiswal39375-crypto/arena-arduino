import { readdirSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { PRODUCT_NAME, PRODUCT_VERSION } from '@/lib/brand';
import { runERC } from '@/lib/erc/diagnostics';
import { SimEngine } from '@/lib/sim/engine';
import { parseScenario } from '@/lib/scenarios/parse';
import { runScenario } from '@/lib/scenarios/runner';
import { wokwiProjectFiles } from '@/lib/interop/bundle';
import { bomCsv, kicadNetlist } from '@/lib/interop/exports';
import { loadProject } from './project-dir';

/**
 * The Model Context Protocol surface (spec §12.7, §17): `sparklab-cli mcp`
 * speaks newline-delimited JSON-RPC 2.0 on stdio so an agent — VS Code, a CLI
 * copilot, a CI bot — can drive the same headless surface the CLI exposes:
 * find projects, load and lint them, run a sketch or an automation scenario,
 * and export diagrams. The server is a pure message handler wrapped around a
 * line transport, so the whole protocol is testable without a process.
 *
 * A local stdio server needs no token: the agent's host spawned it. That is
 * the zero-config rule; hosted/remote MCP comes later, with auth.
 */

export interface McpIO {
  /** Write one response line to the transport (the transport appends \n). */
  out: (line: string) => void;
  cwd: string;
}

/* --------------------------------------------------------------- json rpc */

interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: unknown;
}

const PROTOCOL_VERSION = '2024-11-05';

function ok(id: RpcRequest['id'], result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function err(id: RpcRequest['id'], code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

/* ------------------------------------------------------------------- tools */

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (args: Record<string, unknown>, cwd: string) => unknown;
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' ? v : undefined;
}

/** Every project file under `root`, shallowly (depth 3), deterministically. */
function findProjectFiles(root: string): string[] {
  const hits: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > 3 || hits.length >= 50) return;
    let entries: string[] = [];
    try {
      entries = readdirSync(dir).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(dir, name);
      let st: ReturnType<typeof statSync>;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(p, depth + 1);
      else if (name.endsWith('.sparklab.json') || name === 'project.json' || name === 'diagram.json') hits.push(p);
      if (hits.length >= 50) return;
    }
  };
  walk(resolve(root), 0);
  return hits;
}

function ercSummary(path: string): { clean: boolean; errors: Array<{ code: string; title: string; severity: string }> } {
  const { doc } = loadProject(path);
  const findings = runERC(doc).filter((d) => d.severity !== 'info');
  return {
    clean: findings.length === 0,
    errors: findings.slice(0, 20).map((d) => ({ code: d.code, title: d.title, severity: d.severity })),
  };
}

const TOOLS: ToolDef[] = [
  {
    name: 'list_projects',
    description:
      'Find SparkLab or Wokwi projects under a directory (*.sparklab.json, project.json, or diagram.json). Returns absolute paths the other tools accept.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory to search. Defaults to the server working directory.' } },
      additionalProperties: false,
    },
    run: (args, cwd) => ({ projects: findProjectFiles(str(args, 'path') ?? cwd) }),
  },
  {
    name: 'load_project',
    description:
      'Load a SparkLab project file or Wokwi project directory and summarise it: board, parts, wiring, warnings and the electrical rule check.',
    inputSchema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Project directory, *.sparklab.json file, or diagram.json file.' } },
      required: ['path'],
      additionalProperties: false,
    },
    run: (args) => {
      const path = str(args, 'path') ?? '';
      const { doc, source, warnings } = loadProject(path);
      return {
        name: doc.name,
        source,
        board: doc.board,
        engine: doc.engine,
        parts: doc.diagram.parts.map((p) => ({ id: p.id, type: p.type })),
        wireCount: doc.diagram.connections.length,
        warnings,
        erc: ercSummary(path),
      };
    },
  },
  {
    name: 'run_simulation',
    description:
      'Run a project headless on the simulator. Either free-run for `ms` of virtual time and return the serial output plus final part states, or run an automation `scenarioYaml` (delay/set-control/expect-pin/expect-text/…) and return its verdict.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project directory or file, as with load_project.' },
        ms: { type: 'number', description: 'Free-run length in simulated ms (50–30000, default 3000). Ignored when scenarioYaml is given.' },
        scenarioYaml: { type: 'string', description: 'A scenario in YAML to run instead of free-running.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    run: (args) => {
      const path = str(args, 'path') ?? '';
      const { doc } = loadProject(path);
      const scenarioYaml = str(args, 'scenarioYaml');
      if (scenarioYaml !== undefined) {
        const scenario = parseScenario(scenarioYaml);
        // The loaded doc already carries sketch.ino; `source` here is where
        // the project came from, not code.
        const result = runScenario(doc, scenario);
        return {
          mode: 'scenario',
          name: result.name,
          passed: result.passed,
          failure: result.failure ? { step: result.failure.step, message: result.failure.message } : undefined,
          serial: result.serial.slice(-200),
          simulatedMs: result.simulatedMs,
          error: result.error,
        };
      }
      const raw = typeof args.ms === 'number' ? args.ms : 3000;
      const ms = Math.max(50, Math.min(30_000, Math.round(raw)));
      const engine = new SimEngine(doc);
      engine.load(doc, doc.files['sketch.ino'] ?? '');
      engine.start();
      for (let t = 0; t < ms && !engine.error; t += 50) engine.tick(50, 1);
      const snap = engine.snapshot();
      return {
        mode: 'free-run',
        passed: engine.error === null,
        serial: snap.serial.map((l) => l.text.replace(/\r?\n$/, '')).slice(-200),
        parts: snap.parts,
        erc: ercSummary(path),
        error: engine.error?.message,
      };
    },
  },
  {
    name: 'export_diagram',
    description: 'Export a project: `wokwi` (diagram.json + sketch + libraries, plus custom-chip files when chips are on the canvas), `kicad` (S-expression netlist) or `bom-csv` (bill of materials).',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Project directory or file.' },
        format: { type: 'string', enum: ['wokwi', 'kicad', 'bom-csv'] },
      },
      required: ['path', 'format'],
      additionalProperties: false,
    },
    run: (args) => {
      const path = str(args, 'path') ?? '';
      const { doc } = loadProject(path);
      const format = str(args, 'format') ?? 'wokwi';
      if (format === 'kicad') return { format, text: kicadNetlist(doc) };
      if (format === 'bom-csv') return { format, text: bomCsv(doc) };
      const { files, skipped } = wokwiProjectFiles(doc);
      return {
        format,
        files,
        skipped: skipped.map((s) => `${s.name} (${s.id})`),
      };
    },
  },
];

function toolResult(payload: unknown, isError = false): { content: Array<{ type: string; text: string }>; isError?: boolean } {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }], ...(isError ? { isError: true } : {}) };
}

/* --------------------------------------------------------------- dispatch */

/**
 * Resolve a client-supplied path inside the sandbox root. The hosted
 * transport serves whoever holds the token, and that principal only gets the
 * project tree under the root — never the machine. The local stdio server
 * keeps the plain working directory (it was spawned by the user's own host).
 */
export function sandboxPath(root: string, requested: string | undefined): string {
  const base = resolve(root);
  const target = resolve(base, requested && requested.trim() !== '' ? requested : '.');
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`path escapes the project root: ${requested}`);
  }
  return target;
}

/**
 * Handle one parsed JSON-RPC message. Returns the response line, or null
 * when the message was a notification that must not be answered.
 */
export function handleMcpMessage(msg: unknown, cwd: string): string | null {
  if (typeof msg !== 'object' || msg === null) return err(null, -32600, 'Invalid Request');
  const req = msg as RpcRequest;
  if (typeof req.method !== 'string') return err(req.id ?? null, -32600, 'Invalid Request');

  switch (req.method) {
    case 'initialize':
      return ok(req.id ?? null, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'sparklab-cli', title: PRODUCT_NAME, version: PRODUCT_VERSION },
        instructions:
          'Drive SparkLab headless: list_projects to find projects, load_project to inspect one, run_simulation to execute it (free-run or scenario YAML), export_diagram for Wokwi/KiCad/BOM output.',
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return ok(req.id ?? null, {});
    case 'tools/list':
      return ok(req.id ?? null, {
        tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
      });
    case 'tools/call': {
      const params = (typeof req.params === 'object' && req.params !== null ? req.params : {}) as {
        name?: unknown;
        arguments?: unknown;
      };
      const tool = TOOLS.find((t) => t.name === params.name);
      if (!tool) return err(req.id ?? null, -32602, `Unknown tool: ${String(params.name)}`);
      const rawArgs = (typeof params.arguments === 'object' && params.arguments !== null ? params.arguments : {}) as Record<string, unknown>;
      // Every path argument is resolved inside the sandbox root up front, so
      // no tool can wander outside it even if a future tool forgets to care.
      const args: Record<string, unknown> = { ...rawArgs };
      try {
        for (const key of ['path', 'root'] as const) {
          if (typeof args[key] === 'string') args[key] = sandboxPath(cwd, args[key] as string);
        }
      } catch (cause) {
        return ok(req.id ?? null, toolResult({ error: cause instanceof Error ? cause.message : String(cause) }, true));
      }
      try {
        return ok(req.id ?? null, toolResult(tool.run(args, cwd)));
      } catch (cause) {
        return ok(req.id ?? null, toolResult({ error: cause instanceof Error ? cause.message : String(cause) }, true));
      }
    }
    default:
      if (req.id === undefined || req.id === null) return null; // unknown notification
      return err(req.id, -32601, `Method not found: ${req.method}`);
  }
}

/**
 * Handle one transport line. Returns the response line, or null when the
 * message was a notification or unparseable noise that must not be answered.
 */
export function handleMcpLine(line: string, cwd: string): string | null {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return line.trim() === '' ? null : err(null, -32700, 'Parse error');
  }
  return handleMcpMessage(msg, cwd);
}

/** The stdio server: one response line per request line, until EOF. */
export async function runMcpServer(input: AsyncIterable<string>, io: McpIO): Promise<number> {
  for await (const line of input) {
    const response = handleMcpLine(line, io.cwd);
    if (response !== null) io.out(response);
  }
  return 0;
}
