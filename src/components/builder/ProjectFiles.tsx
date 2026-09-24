'use client';

import { useRef, useState } from 'react';
import { useLab } from '@/store/lab';
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
  const doc = useLab((s) => s.doc);
  const loadDoc = useLab((s) => s.loadDoc);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'warn' | 'error'; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const base = slugify(doc.name);

  const exports: Array<{ label: string; hint: string; run: () => void }> = [
    {
      label: 'Wokwi project (.zip)',
      hint: 'diagram.json + sketch.ino + libraries.txt',
      run: () => {
        const { bytes, skipped } = wokwiZip(doc);
        download(`${base}-wokwi.zip`, bytes, 'application/zip');
        setNotice(
          skipped.length
            ? { tone: 'warn', text: `Wokwi has no model for ${skipped.join(', ')}, so ${skipped.length === 1 ? 'it was' : 'they were'} left out of the zip.` }
            : { tone: 'ok', text: 'Exported. Upload the zip on wokwi.com or run it with wokwi-cli.' },
        );
      },
    },
    {
      label: 'diagram.json',
      hint: 'Wokwi diagram only',
      run: () => download('diagram.json', `${JSON.stringify(toWokwiDiagram(doc).diagram, null, 2)}\n`, 'application/json'),
    },
    { label: 'sketch.ino', hint: 'Open in the Arduino IDE', run: () => download('sketch.ino', doc.files['sketch.ino'] ?? '', 'text/plain') },
    {
      label: 'SparkLab project (.json)',
      hint: 'Everything, losslessly',
      run: () => download(`${base}.sparklab.json`, JSON.stringify(doc, null, 2), 'application/json'),
    },
    { label: 'KiCad netlist (.net)', hint: 'For PCB layout', run: () => download(`${base}.net`, kicadNetlist(doc), 'text/plain') },
    { label: 'Bill of materials (.csv)', hint: 'For ordering parts', run: () => download(`${base}-bom.csv`, bomCsv(doc), 'text/csv') },
  ];

  const importFile = async (file: File): Promise<void> => {
    try {
      if (file.name.endsWith('.zip')) {
        const { doc: imported, unknownParts } = importWokwiZip(new Uint8Array(await file.arrayBuffer()), file.name.replace(/\.zip$/, ''));
        loadDoc(imported);
        setNotice(importNotice(unknownParts.map((p) => p.type)));
        return;
      }
      const text = await file.text();
      const parsed = JSON.parse(text) as { parts?: unknown; connections?: unknown; diagram?: unknown };
      if (Array.isArray(parsed.parts) && Array.isArray(parsed.connections)) {
        const { doc: imported, unknownParts } = fromWokwiDiagram(parsed as WokwiDiagram, undefined, file.name.replace(/\.json$/, ''));
        imported.files['sketch.ino'] = doc.files['sketch.ino'] ?? imported.files['sketch.ino'] ?? '';
        loadDoc(imported);
        setNotice(importNotice(unknownParts.map((p) => p.type), 'Your current sketch was kept.'));
        return;
      }
      const project = importProjectJSON(text);
      if (!project) throw new Error('This file is not a SparkLab project or a Wokwi diagram.');
      loadDoc(project);
      setNotice({ tone: 'ok', text: `Opened ${project.name}.` });
    } catch (err) {
      setNotice({ tone: 'error', text: (err as Error).message || 'Could not read that file.' });
    }
  };

  return (
    <div className="relative flex items-center gap-1.5">
      <button type="button" className="btn btn-sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <Download size={13} /> Export
      </button>
      <button type="button" className="btn btn-sm" onClick={() => fileInput.current?.click()}>
        <Upload size={13} /> Import
      </button>
      <input
        ref={fileInput}
        type="file"
        accept=".json,.zip,application/json,application/zip"
        className="sr-only"
        aria-label="Import a SparkLab project, a Wokwi diagram.json or a Wokwi project zip"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = '';
        }}
      />

      {open && (
        <div className="absolute right-0 top-9 z-30 w-72 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] p-1 shadow-xl">
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
              <span className="block text-[12.5px] font-medium">{x.label}</span>
              <span className="block text-[11px] text-[var(--color-text-dim)]">{x.hint}</span>
            </button>
          ))}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className={
            'absolute right-0 top-9 z-20 w-80 rounded-md border p-2.5 text-[12px] leading-relaxed shadow-xl ' +
            (notice.tone === 'error'
              ? 'border-[#55262c] bg-[#2a1418]'
              : notice.tone === 'warn'
                ? 'border-[#5c4405] bg-[#2a2109]'
                : 'border-[#1f4d3a] bg-[#10261c]')
          }
        >
          {notice.text}
          <button type="button" className="ml-2 underline" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}

function importNotice(unknown: string[], extra = ''): { tone: 'ok' | 'warn'; text: string } {
  if (unknown.length === 0) return { tone: 'ok', text: `Imported. ${extra}`.trim() };
  const names = [...new Set(unknown)].join(', ');
  return { tone: 'warn', text: `Imported, but SparkLab has no model for ${names}; those parts and their wires were skipped. ${extra}`.trim() };
}
