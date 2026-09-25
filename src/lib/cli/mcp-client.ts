/**
 * A tiny Model Context Protocol *client* for the SparkLab stdio server
 * (`sparklab-cli mcp`): newline-delimited JSON-RPC 2.0 over a child process.
 *
 * This is the engine behind the VS Code extension (vscode-sparklab/) and any
 * other editor/agent integration: spawn the server once, then `listProjects`,
 * `loadProject`, `runSimulation`, `exportDiagram`. Pure Node builtins only —
 * no `@/` imports — so the extension can bundle it verbatim.
 *
 * Zero-config rule inherited from the server: the local stdio transport needs
 * no token because the host process spawned it; the sandbox root is the
 * server's working directory.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';

export class McpError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
    this.name = 'McpError';
  }
}

export interface McpStdioClientOptions {
  /** Executable that runs the MCP server, e.g. `node_modules/.bin/vite-node`. */
  command: string;
  /** Arguments ending in the `mcp` subcommand, e.g. `['--config', 'vitest.config.ts', 'scripts/sparklab-cli.ts', '--', 'mcp']`. */
  args: string[];
  /** Working directory = the server's project sandbox root. */
  cwd: string;
  /** Per-request timeout. Default 60 s (long scenarios need headroom). */
  requestTimeoutMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolCallResult {
  isError: boolean;
  /** The first text content block, verbatim. */
  text: string;
  /** The text block parsed as JSON, or null when it is not JSON. */
  json: unknown;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const PROTOCOL_VERSION = '2024-11-05';

export class McpStdioClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private closed = false;
  private exitError: Error | null = null;

  constructor(private readonly opts: McpStdioClientOptions) {}

  get running(): boolean {
    return this.child !== null && !this.closed;
  }

  /** Spawn the server and wait until its stdout produces a line. */
  async start(): Promise<void> {
    if (this.child) return;
    const child = spawn(this.opts.command, this.opts.args, {
      cwd: this.opts.cwd,
      env: this.opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    child.on('error', (err: Error) => {
      this.exitError = err;
      this.failAll(new McpError(`MCP server failed to start: ${err.message}`, -32000));
    });
    child.on('close', (code) => {
      if (!this.closed) {
        this.exitError = new McpError(`MCP server exited (code ${code ?? '?'})`, -32000);
        this.failAll(this.exitError);
      }
      this.child = null;
    });
    const rl = createInterface({ input: child.stdout, terminal: false });
    rl.on('line', (line) => this.receive(line));
  }

  /** `initialize` + `notifications/initialized`, per the MCP handshake. */
  async initialize(): Promise<{ name: string; version: string }> {
    const result = (await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'sparklab-client', version: '0.1.0' },
    })) as { serverInfo?: { name?: string; version?: string } };
    this.notify('notifications/initialized');
    return {
      name: result.serverInfo?.name ?? 'unknown',
      version: result.serverInfo?.version ?? '0.0.0',
    };
  }

  async listTools(): Promise<McpToolInfo[]> {
    const result = (await this.request('tools/list')) as { tools?: McpToolInfo[] };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolCallResult> {
    const result = (await this.request('tools/call', { name, arguments: args })) as {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };
    const text = result.content?.find((c) => c.type === 'text')?.text ?? '';
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { isError: result.isError === true, text, json };
  }

  /* ------------------------------------------------- typed conveniences */

  async listProjects(path?: string): Promise<string[]> {
    const result = await this.callTool('list_projects', path !== undefined ? { path } : {});
    this.throwIfToolError(result);
    const json = result.json as { projects?: string[] } | null;
    return json?.projects ?? [];
  }

  async loadProject(path: string): Promise<Record<string, unknown>> {
    const result = await this.callTool('load_project', { path });
    this.throwIfToolError(result);
    return (result.json as Record<string, unknown> | null) ?? {};
  }

  async runSimulation(opts: {
    path: string;
    ms?: number;
    scenarioYaml?: string;
  }): Promise<Record<string, unknown>> {
    const args: Record<string, unknown> = { path: opts.path };
    if (opts.ms !== undefined) args.ms = opts.ms;
    if (opts.scenarioYaml !== undefined) args.scenarioYaml = opts.scenarioYaml;
    const result = await this.callTool('run_simulation', args);
    this.throwIfToolError(result);
    return (result.json as Record<string, unknown> | null) ?? {};
  }

  async exportDiagram(
    path: string,
    format: 'wokwi' | 'kicad' | 'bom-csv',
  ): Promise<Record<string, unknown>> {
    const result = await this.callTool('export_diagram', { path, format });
    this.throwIfToolError(result);
    return (result.json as Record<string, unknown> | null) ?? {};
  }

  /** Stop the server; pending requests reject. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.failAll(new McpError('client closed', -32000));
    const child = this.child;
    this.child = null;
    if (child) {
      try {
        child.stdin.end();
        child.kill();
      } catch {
        // Already gone.
      }
    }
  }

  /* ------------------------------------------------------------ plumbing */

  private throwIfToolError(result: McpToolCallResult): void {
    if (!result.isError) return;
    const json = result.json as { error?: string } | null;
    throw new McpError(json?.error ?? result.text ?? 'tool failed', -32001);
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    if (this.exitError) return Promise.reject(this.exitError);
    if (!this.child) return Promise.reject(new McpError('client not started', -32000));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const timeout = this.opts.requestTimeoutMs ?? 60_000;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new McpError(`request ${method} timed out after ${timeout} ms`, -32002));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      const line = JSON.stringify({ jsonrpc: '2.0', id, method, params });
      try {
        this.child?.stdin.write(`${line}\n`);
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private notify(method: string): void {
    if (!this.child) return;
    try {
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
    } catch {
      // Notifications are fire-and-forget.
    }
  }

  private receive(line: string): void {
    if (line.trim() === '') return;
    let msg: { id?: number | string | null; result?: unknown; error?: { code?: number; message?: string } };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      return; // Non-JSON noise on stdout: ignore, never crash.
    }
    const id = typeof msg.id === 'number' ? msg.id : null;
    if (id === null) return; // A notification from the server: nothing to match.
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (msg.error) {
      pending.reject(new McpError(msg.error.message ?? 'RPC error', msg.error.code ?? -32000));
      return;
    }
    pending.resolve(msg.result);
  }

  private failAll(err: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pending.delete(id);
    }
  }
}

/**
 * The default way this repository runs its MCP server. Editors resolve the
 * repo root (their workspace) and spawn this; overridable wherever used.
 */
export function defaultMcpServerLaunch(repoRoot: string): { command: string; args: string[]; cwd: string } {
  const isWin = process.platform === 'win32';
  return {
    command: `${repoRoot}/node_modules/.bin/vite-node${isWin ? '.cmd' : ''}`,
    args: ['--config', 'vitest.config.ts', 'scripts/sparklab-cli.ts', '--', 'mcp'],
    cwd: repoRoot,
  };
}
