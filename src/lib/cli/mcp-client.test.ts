import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpError, McpStdioClient, defaultMcpServerLaunch } from './mcp-client';

/**
 * Integration tests for the MCP stdio client against the REAL server: one
 * `sparklab-cli mcp` child process for the whole file, exercised through
 * every tool. This is the same engine the VS Code extension bundles.
 */

const repoRoot = process.cwd();
const blinkDir = join(repoRoot, 'examples', 'blink-timing');
const blinkScenario = join(blinkDir, 'blink-timing.test.yaml');

let client: McpStdioClient;
let serverInfo: { name: string; version: string };

beforeAll(async () => {
  client = new McpStdioClient({ ...defaultMcpServerLaunch(repoRoot), requestTimeoutMs: 30_000 });
  await client.start();
  serverInfo = await client.initialize();
}, 30_000);

afterAll(() => {
  client?.close();
});

describe('McpStdioClient against the real sparklab-cli mcp server', () => {
  it('completes the MCP handshake with the expected server identity', () => {
    expect(serverInfo.name).toBe('sparklab-cli');
    expect(serverInfo.version.length).toBeGreaterThan(0);
  });

  it('lists the four shipped tools', async () => {
    const tools = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(['export_diagram', 'list_projects', 'load_project', 'run_simulation']);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.inputSchema.type).toBe('object');
    }
  });

  it('finds projects under the examples tree', async () => {
    const projects = await client.listProjects('examples');
    expect(projects.length).toBeGreaterThan(5);
    expect(projects.some((p) => p.includes('blink-timing'))).toBe(true);
  });

  it('loads and summarises a project with its electrical rule check', async () => {
    const summary = await client.loadProject(blinkDir);
    expect(typeof summary.name).toBe('string');
    expect(Array.isArray(summary.parts)).toBe(true);
    expect((summary.parts as unknown[]).length).toBeGreaterThan(0);
    expect(summary.erc).toMatchObject({ clean: expect.any(Boolean) });
  });

  it('free-runs the simulator and reports serial + part states', async () => {
    const result = await client.runSimulation({ path: blinkDir, ms: 1000 });
    expect(result.mode).toBe('free-run');
    expect(result.passed).toBe(true);
    expect(Array.isArray(result.serial)).toBe(true);
    expect(result.parts).toBeTruthy();
  });

  it('runs a scenario file and reports its verdict', async () => {
    const yaml = readFileSync(blinkScenario, 'utf8');
    const result = await client.runSimulation({ path: blinkDir, scenarioYaml: yaml });
    expect(result.mode).toBe('scenario');
    expect(result.passed).toBe(true);
    expect(typeof result.simulatedMs).toBe('number');
  });

  it('exports Wokwi interchange files', async () => {
    const result = await client.exportDiagram(blinkDir, 'wokwi');
    const files = result.files as Array<{ name: string; content: string }>;
    expect(Array.isArray(files)).toBe(true);
    const names = files.map((f) => f.name);
    expect(names).toContain('diagram.json');
    expect(names).toContain('libraries.txt');
    JSON.parse(files.find((f) => f.name === 'diagram.json')!.content);
  });

  it('surfaces unknown tools as JSON-RPC errors', async () => {
    await expect(client.callTool('definitely-not-a-tool')).rejects.toMatchObject({
      name: 'McpError',
      code: -32602,
    });
  });

  it('refuses paths that escape the sandbox root', async () => {
    await expect(client.loadProject('../../outside')).rejects.toBeInstanceOf(McpError);
  });

  it('rejects after close instead of hanging', async () => {
    const temporary = new McpStdioClient(defaultMcpServerLaunch(repoRoot));
    temporary.close();
    await expect(temporary.listTools()).rejects.toBeInstanceOf(McpError);
  });
});
