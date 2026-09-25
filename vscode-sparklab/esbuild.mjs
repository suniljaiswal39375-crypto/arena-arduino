/**
 * Bundle the SparkLab VS Code extension into a single CommonJS file.
 * `vscode` stays external (the editor provides it); the repository's tested
 * MCP client + formatters are bundled in from ../src/lib/cli.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [join(here, 'src', 'extension.ts')],
  bundle: true,
  outfile: join(here, 'dist', 'extension.js'),
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
});
