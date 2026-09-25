# SparkLab for VS Code

Drive SparkLab Arduino projects from an editor panel: find them, inspect them,
run the electrical rule check, simulate (free-run or scenario YAML), and
export Wokwi / KiCad / BOM — without leaving the editor.

This is a **thin shell**. All the real work happens in the repository's
headless engine through the shipped MCP server (`sparklab-cli mcp`,
newline-delimited JSON-RPC over stdio). The extension spawns that server as a
local child process and calls its tools; results are rendered by the same
tested formatters the CLI uses. There is no second implementation to drift,
no network access and no telemetry.

## What you get

- **SparkLab Projects** view (Explorer): every `*.sparklab.json` /
  `project.json` / `diagram.json` under the workspace (or `sparklab.scanPath`).
- **Inspect Project** — board, engine, parts, wire count, warnings and the
  electrical rule check (ERC) findings.
- **Run Simulation (free-run)** — `sparklab.freeRunMs` of virtual time; the
  result panel shows PASS/FAIL, serial output and final part states.
- **Run Scenario File…** — pick any `*.test.yaml` automation scenario and get
  its verdict (which step failed and why).
- **Export Wokwi / KiCad / BOM** — writes `diagram.json` + `sketch.ino` +
  `libraries.txt`, a KiCad netlist, or a BOM CSV next to the project.

Right-click a project in the view for all actions, or run them from the
command palette and pick a project.

## Requirements & setup

The extension talks to the **repository's own CLI**, so open the SparkLab
repo folder in VS Code and install it first:

```bash
npm install          # in the repository root
```

No API key, account or configuration is required. Optionally tune:

| Setting             | Default                              | Meaning                                   |
| ------------------- | ------------------------------------ | ----------------------------------------- |
| `sparklab.freeRunMs`| `3000`                               | Virtual milliseconds for a free-run.      |
| `sparklab.scanPath` | `""` (whole workspace)               | Where to look for projects.               |
| `sparklab.mcpCommand` / `sparklab.mcpArgs` | repo default | Override how the MCP server is launched.  |

## Development

```bash
npm run ext:check    # typecheck the extension (vscode + node types)
npm run ext:build    # bundle dist/extension.js with esbuild
```

Then press **F5** in VS Code (Run → Start Debugging, "Extension Development
Host") after creating a `.vscode/launch.json` such as:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Run SparkLab Extension",
      "type": "extensionHost",
      "request": "launch",
      "args": ["--extensionDevelopmentPath=${workspaceFolder}/vscode-sparklab"],
      "outFiles": ["${workspaceFolder}/vscode-sparklab/dist/**/*.js"],
      "preLaunchTask": "npm: ext:build"
    }
  ]
}
```

The editor-facing logic (`mcp-client.ts`, `mcp-format.ts`) is unit-tested in
the main suite (`src/lib/cli/mcp-client.test.ts`, `mcp-format.test.ts`)
against the real MCP server, so the shell itself stays small.

## Packaging

From the repository root, `npm run ext:package` typechecks the extension,
bundles `dist/extension.js` and produces an installable
`vscode-sparklab/sparklab-vscode.vsix` with `@vscode/vsce`. Install it with
`code --install-extension vscode-sparklab/sparklab-vscode.vsix`. The `.vsix`
is a local build artifact (git-ignored): the extension is distributed from
this repository, not from the VS Code marketplace, so nothing requires an
account or a publisher token. The manifest itself is kept honest by
`src/lib/cli/extension-manifest.test.ts` (main path, menu→command wiring,
referenced icons, and that the shell only imports `vscode`, node builtins or
the tested lib).

## Honesty

The extension runs the same engines as the builder with the same limits:
virtual-time simulation, the functional/electrical engines, and the ERC rules
documented in `DECISIONS.md`. It reports what those engines produce and
nothing more. Paths are sandboxed to the workspace root by the MCP server.
