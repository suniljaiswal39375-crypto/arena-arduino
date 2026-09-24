import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, cpSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { expect, it } from 'vitest';

it('precache URLs match Next-encoded dynamic route chunks and escaped filenames', () => {
  const root = mkdtempSync(join(tmpdir(), 'sparklab-offline-'));
  try {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    mkdirSync(join(root, 'public'), { recursive: true });
    mkdirSync(join(root, '.next/static/chunks/app/missions/[slug]'), { recursive: true });
    mkdirSync(join(root, '.next/static/media'), { recursive: true });
    writeFileSync(join(root, '.next/static/chunks/app/missions/[slug]/page.js'), '');
    writeFileSync(join(root, '.next/static/media/font name.woff2'), '');
    writeFileSync(join(root, '.next/static/media/ignored.map'), '');
    writeFileSync(join(root, '.next/BUILD_ID'), 'fixture-build');
    cpSync('scripts/prepare-offline.mjs', join(root, 'scripts/prepare-offline.mjs'));
    cpSync('scripts/service-worker.js', join(root, 'scripts/service-worker.js'));
    execFileSync(process.execPath, [join(root, 'scripts/prepare-offline.mjs')]);
    const worker = readFileSync(join(root, 'public/sw.js'), 'utf8');
    expect(worker).toContain('/_next/static/chunks/app/missions/%5Bslug%5D/page.js');
    expect(worker).toContain('/_next/static/media/font%20name.woff2');
    expect(worker).not.toContain('/missions/[slug]/page.js');
    expect(worker).not.toContain('ignored.map');
    expect(worker).toContain('sparklab-offline-fixture-build');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
