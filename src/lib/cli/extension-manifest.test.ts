import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = join(__dirname, '..', '..', '..');
const EXT = join(REPO, 'vscode-sparklab');

interface ExtManifest {
  name: string;
  main: string;
  engines: { vscode: string };
  icon?: string;
  contributes: {
    views: Record<string, Array<{ id: string; icon?: string }>>;
    commands: Array<{ command: string; icon?: string }>;
    menus: Record<string, Array<{ command: string; when?: string }>>;
    configuration?: { properties: Record<string, { type: string }> };
  };
}

function manifest(): ExtManifest {
  return JSON.parse(readFileSync(join(EXT, 'package.json'), 'utf8')) as ExtManifest;
}

describe('vscode extension manifest', () => {
  it('points main at the esbuild output and targets a VS Code engine', () => {
    const m = manifest();
    expect(m.main).toBe('./dist/extension.js');
    expect(m.engines.vscode).toMatch(/^\^?1\.\d+\.\d+$/);
  });

  it('every menu entry references a declared command', () => {
    const m = manifest();
    const declared = new Set(m.contributes.commands.map((c) => c.command));
    for (const [menu, items] of Object.entries(m.contributes.menus)) {
      for (const item of items) {
        expect(declared.has(item.command), `${menu} -> ${item.command}`).toBe(true);
      }
    }
  });

  it('view/item/context menus only activate on the project view item', () => {
    const m = manifest();
    for (const item of m.contributes.menus['view/item/context'] ?? []) {
      expect(item.when, item.command).toContain('viewItem == sparklabProject');
    }
  });

  it('ships the icons and media the manifest references', () => {
    const m = manifest();
    expect(m.icon, 'marketplace icon').toBeDefined();
    expect(existsSync(join(EXT, m.icon!)), m.icon).toBe(true);
    for (const view of Object.values(m.contributes.views).flat()) {
      if (view.icon) expect(existsSync(join(EXT, view.icon)), view.icon).toBe(true);
    }
  });

  it('extension source imports only bundled or external modules', () => {
    const source = readFileSync(join(EXT, 'src', 'extension.ts'), 'utf8');
    // `vscode` is external, node builtins are fine; everything else must come
    // from the tested lib (via the @/ alias or a relative path into src/lib).
    const imports = [...source.matchAll(/from '([^']+)'/g)].map((m) => m[1]!);
    for (const spec of imports) {
      const allowed =
        spec === 'vscode' || spec.startsWith('node:') || spec.startsWith('@/lib/') || /src\/lib\//.test(spec);
      expect(allowed, spec).toBe(true);
    }
  });
});
