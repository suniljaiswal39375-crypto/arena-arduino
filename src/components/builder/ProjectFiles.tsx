'use client';

import { useRef, useState } from 'react';
import { useLab } from '@/store/lab';
import { useI18n } from '@/lib/i18n/client';
import type { MessageKey } from '@/lib/i18n/messages';
import { importProjectJSON } from '@/lib/doc/persistence';
import { toWokwiDiagram, fromWokwiDiagram, type WokwiDiagram } from '@/lib/interop/wokwi';
import { wokwiZip, importWokwiZip } from '@/lib/interop/bundle';
import { bomCsv, kicadNetlist } from '@/lib/interop/exports';
import { Download, Upload } from 'lucide-react';

function slugify(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'project';
}

function download(name: string, content: string | Uint8Array, type: string): void {
  const part: BlobPart = typeof content === 'string' ? content : new Uint8Array(content);
  const url = URL.createObjectURL(new Blob([part], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Export and import, in every format the project can travel in. Anything that
 * cannot be carried (a part Wokwi has no model for) is named in a notice rather
 * than silently dropped.
 */
export function ProjectFiles() {
  const { t } = useI18n();
  const doc = useLab((s) => s.doc);
  const loadDoc = useLab((s) => s.loadDoc);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const base = slugify(doc.name);

  const exports: Array<{ label: MessageKey; hint: MessageKey; run: () => void }> = [
    {
      label: 'exportWokwiZip',
      hint: 'exportWokwiZipHint',
      run: () => {
        const { bytes, skipped } = wokwiZip(doc);
        download(`${base}-wokwi.zip`, bytes, 'application/zip');
        setNotice(
          skipped.length
            ? { tone: 'warn', text: t('exportWokwiSkipped', { parts: [...new Set(skipped)].join(', ') }) }
            : { tone: 'ok', text: t('exportWokwiDone') },
        );
      },
    },
    {
      label: 'exportDiagram',
      hint: 'exportDiagramHint',
      run: () => download('diagram.json', `${JSON.stringify(toWokwiDiagram(doc).diagram, null, 2)}\n`, 'application/json'),
    },
    { label: 'exportSketch', hint: 'exportSketchHint', run: () => download('sketch.ino', doc.files['sketch.ino'] ?? '', 'text/plain') },
    {
      label: 'exportSparklab',
      hint: 'exportSparklabHint',
      run: () => download(`${base}.sparklab.json`, JSON.stringify(doc, null, 2), 'application/json'),
    },
    { label: 'exportKicad', hint: 'exportKicadHint', run: () => download(`${base}.net`, kicadNetlist(doc), 'text/plain') },
    { label: 'exportBom', hint: 'exportBomHint', run: () => download(`${base}-bom.csv`, bomCsv(doc), 'text/csv') },
  ];

  const importFile = async (file: File): Promise<void> => {
    try {
      if (file.name.endsWith('.zip')) {
        const { doc: imported, unknownParts } = importWokwiZip(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.zip$/, ''));
        loadDoc(imported);
        setNotice(importNotice(t, unknownParts.map((p) => p.type)));
        return;
      }
      const text = await file.text();
      const parsed = JSON.parse(text) as { parts?: unknown; connections?: unknown; diagram?: unknown };
      if (Array.isArray(parsed.parts) && Array.isArray(parsed.connections)) {
        const { doc: imported, unknownParts } = fromWokwiDiagram(parsed as WokwiDiagram, undefined, file.name.replace(/\.json$/, ''));
        imported.files['sketch.ino'] = doc.files['sketch.ino'] ?? imported.files['sketch.ino'] ?? '';
        loadDoc(imported);
        setNotice(importNotice(t, unknownParts.map((p) => p.type), t('importKeptSketch')));
        return;
      }
      const project = importProjectJSON(text);
      if (!project) throw new Error(t('importBadFile'));
      loadDoc(project);
      setNotice({ tone: 'ok', text: t('importOpened', { name: project.name }) });
    } catch (err) {
      setNotice({ tone: 'error', text: (err as Error).message || t('importReadError') });
    }
  };

  return (
    <div className="relative flex items-center gap-1.5" onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setNotice(null); e.stopPropagation(); e.currentTarget.querySelector('button')?.focus(); } }}>
      <button type="button" className="btn btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Download size={13} /> {t('export')}
      </button>
      <button type="button" className="btn btn-sm" onClick={() => fileInput.current?.click()}>
        <Upload size={13} /> {t('import')}
      </button>
      <input
        ref={fileInput}
        type="file"
        tabIndex={-1}
        accept=".json,.zip,application/json,application/zip"
        className="sr-only"
        aria-label={t('importAria')}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = '';
        }}
      />

      {open && (
        <div className="fixed inset-x-2 top-28 z-30 max-h-[65dvh] overflow-y-auto sm:absolute sm:inset-x-auto sm:right-0 sm:top-9 sm:w-72 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] p-1 shadow-xl">
          {exports.map((x) => (
            <button
              key={x.label}
              type="button"
              className="block w-full rounded px-2 py-1.5 text-left hover:bg-[var(--color-surface-3)]"
              onClick={() => {
                x.run();
                setOpen(false);
              }}
            >
              <span className="block text-[12.5px] font-medium">{t(x.label)}</span>
              <span className="block text-[11px] text-[var(--color-text-dim)]">{t(x.hint)}</span>
            </button>
          ))}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className={
            'fixed inset-x-2 top-28 z-20 max-h-[65dvh] overflow-y-auto sm:absolute sm:inset-x-auto sm:right-0 sm:top-9 sm:w-80 rounded-md border p-2.5 text-[12px] leading-relaxed shadow-xl ' +
            (notice.tone === 'error'
              ? 'border-[#55262c] bg-[#2a1418]'
              : notice.tone === 'warn'
                ? 'border-[#5c4405] bg-[#2a2109]'
                : 'border-[#1f4d3a] bg-[#10261c]')
          }
        >
          {notice.text}
          <button type="button" className="ml-2 underline" onClick={() => setNotice(null)}>
            {t('dismiss')}
          </button>
        </div>
      )}
    </div>
  );
}

type Translator = (key: MessageKey, values?: Record<string, string | number>) => string;

function importNotice(t: Translator, unknown: string[], extra = ''): { tone: 'ok' | 'warn'; text: string } {
  if (unknown.length === 0) return { tone: 'ok', text: `${t('importDone')} ${extra}`.trim() };
  const names = [...new Set(unknown)].join(', ');
  return { tone: 'warn', text: `${t('importSkipped', { parts: names })} ${extra}`.trim() };
}
