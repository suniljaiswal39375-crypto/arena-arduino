/**
 * SparkLab for VS Code — drive SparkLab projects from an editor panel.
 *
 * The extension is a thin shell around two fully unit-tested modules from
 * the repository itself:
 *
 *   src/lib/cli/mcp-client.ts  — spawns `sparklab-cli mcp` (newline-delimited
 *                                JSON-RPC over stdio) and calls its tools;
 *   src/lib/cli/mcp-format.ts  — renders tool results for humans.
 *
 * Everything heavy (loading, ERC, simulation, scenarios, exports) runs in
 * the CLI's headless engine; VS Code shows the results. No telemetry, no
 * network: the MCP server is a local child process of your own editor, and
 * it refuses any path outside the workspace root.
 */
import * as vscode from 'vscode';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  McpError,
  McpStdioClient,
  defaultMcpServerLaunch,
} from '../../src/lib/cli/mcp-client';
import {
  escapeHtml,
  formatExportResult,
  formatLoadProject,
  formatRunResult,
  runResultHtml,
} from '../../src/lib/cli/mcp-format';

let client: McpStdioClient | null = null;
let output: vscode.OutputChannel;

function repoRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function settings(): {
  freeRunMs: number;
  scanPath: string;
  mcpCommand: string;
  mcpArgs: string[];
} {
  const cfg = vscode.workspace.getConfiguration('sparklab');
  return {
    freeRunMs: cfg.get<number>('freeRunMs', 3000),
    scanPath: cfg.get<string>('scanPath', ''),
    mcpCommand: cfg.get<string>('mcpCommand', ''),
    mcpArgs: cfg.get<string[]>('mcpArgs', []),
  };
}

async function getClient(): Promise<McpStdioClient> {
  if (client && client.running) return client;
  const root = repoRoot();
  if (!root) {
    throw new Error('Open the SparkLab repository folder in VS Code first.');
  }
  const { mcpCommand, mcpArgs } = settings();
  const defaults = defaultMcpServerLaunch(root);
  const launch =
    mcpCommand !== '' && mcpArgs.length > 0
      ? { command: mcpCommand, args: mcpArgs, cwd: root }
      : defaults;
  const next = new McpStdioClient({ ...launch, requestTimeoutMs: 120_000 });
  await next.start();
  const info = await next.initialize();
  output.appendLine(`[sparklab] MCP server ready: ${info.name} v${info.version} (root: ${root})`);
  client = next;
  return next;
}

async function withClient<T>(task: (c: McpStdioClient) => Promise<T>): Promise<T | undefined> {
  try {
    return await task(await getClient());
  } catch (err) {
    const message =
      err instanceof McpError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    output.appendLine(`[sparklab] error: ${message}`);
    const hint =
      err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT'
        ? ' Is the repository installed (npm install)?'
        : '';
    void vscode.window.showErrorMessage(`SparkLab: ${message}${hint}`);
    return undefined;
  }
}

/* ------------------------------------------------------------ tree view */

class ProjectNode extends vscode.TreeItem {
  constructor(readonly projectPath: string) {
    super(path.basename(path.dirname(projectPath)), vscode.TreeItemCollapsibleState.None);
    this.description = path.basename(projectPath);
    this.tooltip = projectPath;
    this.contextValue = 'sparklabProject';
    this.iconPath = new vscode.ThemeIcon('circuit-board');
  }
}

class ProjectsProvider implements vscode.TreeDataProvider<ProjectNode> {
  private readonly emitter = new vscode.EventEmitter<ProjectNode | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;
  private projects: string[] = [];
  private loadError: string | null = null;

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(element: ProjectNode): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: ProjectNode): Promise<ProjectNode[]> {
    if (element) return [];
    const list = await withClient(async (c) => {
      const scanPath = settings().scanPath;
      return c.listProjects(scanPath !== '' ? scanPath : undefined);
    });
    if (list === undefined) {
      this.loadError = 'Could not list projects — see the SparkLab output channel.';
      return [];
    }
    this.loadError = null;
    this.projects = list;
    return list.map((p) => new ProjectNode(p));
  }
}

/* -------------------------------------------------------------- helpers */

function projectDir(node: ProjectNode | undefined): string {
  // list_projects returns project *files*; the surrounding directory is what
  // load/run/export accept most naturally.
  return node ? path.dirname(node.projectPath) : '';
}

async function pickProject(): Promise<string | undefined> {
  const list = await withClient(async (c) => c.listProjects());
  if (!list || list.length === 0) return undefined;
  const picked = await vscode.window.showQuickPick(
    list.map((p) => ({ label: path.basename(path.dirname(p)), description: p })),
    { placeHolder: 'Choose a SparkLab project' },
  );
  return picked ? path.dirname(picked.description) : undefined;
}

function showPanel(title: string, html: string): void {
  const panel = vscode.window.createWebviewPanel('sparklabResult', title, vscode.ViewColumn.Beside, {});
  panel.webview.html = html;
}

function preHtml(title: string, text: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  body { font-family: var(--vscode-font-family, sans-serif); padding: 12px; }
  pre { background: rgba(127,127,127,.12); padding: 8px; overflow: auto; }
</style></head><body><h1>${escapeHtml(title)}</h1><pre>${escapeHtml(text)}</pre></body></html>`;
}

async function runOnProject(
  node: ProjectNode | undefined,
  run: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = node ? projectDir(node) : await pickProject();
  if (!dir) return;
  await run(dir);
}

async function writeNextTo(dir: string, name: string, content: string): Promise<string> {
  const target = path.join(dir, name);
  await fs.writeFile(target, content, 'utf8');
  return target;
}

/* ------------------------------------------------------------ activation */

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('SparkLab');
  context.subscriptions.push(output);

  const provider = new ProjectsProvider();
  const tree = vscode.window.createTreeView('sparklabProjects', { treeDataProvider: provider });
  context.subscriptions.push(tree);

  const register = (id: string, fn: (node?: ProjectNode) => Promise<void> | void): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, (node?: ProjectNode) => fn(node)));
  };

  register('sparklab.refreshProjects', () => provider.refresh());

  register('sparklab.inspectProject', async (node) => {
    await runOnProject(node, async (dir) => {
      const summary = await withClient((c) => c.loadProject(dir));
      if (!summary) return;
      const text = formatLoadProject(summary);
      output.appendLine(text);
      showPanel(`SparkLab: ${path.basename(dir)}`, preHtml(path.basename(dir), text));
    });
  });

  register('sparklab.runFreeRun', async (node) => {
    await runOnProject(node, async (dir) => {
      const ms = settings().freeRunMs;
      const result = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Simulating ${ms} ms…` },
        () => withClient((c) => c.runSimulation({ path: dir, ms })),
      );
      if (!result) return;
      output.appendLine(formatRunResult(result));
      showPanel(`SparkLab run: ${path.basename(dir)}`, runResultHtml(result));
    });
  });

  register('sparklab.runScenarioFile', async (node) => {
    const dir = node ? projectDir(node) : await pickProject();
    if (!dir) return;
    const files = await vscode.workspace.findFiles('**/*.test.yaml', '**/node_modules/**', 50);
    if (files.length === 0) {
      void vscode.window.showInformationMessage('No *.test.yaml scenario files found in the workspace.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      files.map((f) => ({ label: path.basename(f.fsPath), description: f.fsPath })),
      { placeHolder: 'Choose a scenario to run' },
    );
    if (!picked) return;
    const yaml = await fs.readFile(picked.description, 'utf8');
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `Running ${picked.label}…` },
      () => withClient((c) => c.runSimulation({ path: dir, scenarioYaml: yaml })),
    );
    if (!result) return;
    output.appendLine(formatRunResult(result));
    showPanel(`SparkLab scenario: ${picked.label}`, runResultHtml(result));
  });

  register('sparklab.exportWokwi', async (node) => {
    await runOnProject(node, async (dir) => {
      const result = await withClient((c) => c.exportDiagram(dir, 'wokwi'));
      if (!result) return;
      const files = (result.files as Array<{ name: string; content: string }> | undefined) ?? [];
      for (const file of files) await writeNextTo(dir, file.name, file.content);
      output.appendLine(formatExportResult(result));
      void vscode.window.showInformationMessage(
        `SparkLab: wrote ${files.map((f) => f.name).join(', ')} next to the project.`,
      );
    });
  });

  const exportText = (format: 'kicad' | 'bom-csv', fileName: string) => async (node?: ProjectNode) => {
    await runOnProject(node, async (dir) => {
      const result = await withClient((c) => c.exportDiagram(dir, format));
      if (!result || typeof result.text !== 'string') return;
      const target = await writeNextTo(dir, fileName, result.text);
      output.appendLine(formatExportResult(result));
      void vscode.window.showInformationMessage(`SparkLab: wrote ${target}`);
      const doc = await vscode.workspace.openTextDocument(target);
      await vscode.window.showTextDocument(doc, { preview: true });
    });
  };
  register('sparklab.exportKicad', exportText('kicad', 'netlist.kicad_s'));
  register('sparklab.exportBom', exportText('bom-csv', 'bom.csv'));
}

export function deactivate(): void {
  client?.close();
  client = null;
}
