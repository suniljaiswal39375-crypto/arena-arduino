'use client';

import dynamic from 'next/dynamic';
import { useEffect, useRef, useState } from 'react';
import { loader } from '@monaco-editor/react';
import { useLab } from '@/store/lab';
import { useI18n } from '@/lib/i18n/client';

loader.config({ paths: { vs: '/vendor/monaco/vs' } });

const MonacoEditor = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

/** Monaco is served locally; keep a plain editor if loading is blocked. */
const MONACO_TIMEOUT_MS = 7000;

export function CodePane() {
  const { t } = useI18n();
  const doc = useLab((s) => s.doc);
  const setFile = useLab((s) => s.setFile);
  const [file, setActiveFile] = useState('sketch.ino');
  const [monacoReady, setMonacoReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (monacoReady) {
      if (timer.current) clearTimeout(timer.current);
      return;
    }
    timer.current = setTimeout(() => setFallback(true), MONACO_TIMEOUT_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [monacoReady]);

  const fileNames = Object.keys(doc.files);
  const content = doc.files[file] ?? '';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-[var(--color-border)] px-2 py-1">
        {fileNames.map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setActiveFile(name)}
            className={
              'mono rounded px-2 py-1 text-[11.5px] ' +
              (file === name
                ? 'bg-[var(--color-surface-3)] text-[var(--color-text)]'
                : 'text-[var(--color-text-dim)] hover:text-[var(--color-text)]')
            }
          >
            {name}
          </button>
        ))}
        <span className="ml-auto pr-1 text-[10.5px] text-[var(--color-text-faint)]">
          {fallback ? t('editorOffline') : 'Monaco'}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        {fallback ? (
          <PlainEditor value={content} onChange={(v) => setFile(file, v)} />
        ) : (
          <MonacoEditor
            height="100%"
            theme="vs-dark"
            defaultLanguage="cpp"
            path={file}
            value={content}
            onMount={() => setMonacoReady(true)}
            onChange={(value: string | undefined) => setFile(file, value ?? '')}
            options={{
              fontSize: 13,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontFamily:
                "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
              tabSize: 2,
              renderLineHighlight: 'gutter',
              padding: { top: 10 },
              automaticLayout: true,
            }}
          />
        )}
      </div>
    </div>
  );
}

function PlainEditor({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const lines = value.split('\n').length;

  return (
    <div className="flex h-full overflow-hidden bg-[#0d1117]">
      <div
        aria-hidden
        className="mono select-none overflow-hidden border-r border-[var(--color-border)] px-2 py-2.5 text-right text-[12.5px] leading-[1.55] text-[var(--color-text-faint)]"
      >
        {Array.from({ length: lines }, (_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <textarea
        ref={ref}
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            e.preventDefault();
            const el = e.currentTarget;
            const start = el.selectionStart;
            const end = el.selectionEnd;
            const next = `${value.slice(0, start)}  ${value.slice(end)}`;
            onChange(next);
            requestAnimationFrame(() => {
              el.selectionStart = el.selectionEnd = start + 2;
            });
          }
        }}
        className="mono min-h-0 flex-1 resize-none bg-transparent px-3 py-2.5 text-[12.5px] leading-[1.55] text-[#e6edf3] outline-none"
        aria-label={t('sketchSource')}
      />
    </div>
  );
}

function EditorSkeleton() {
  const { t } = useI18n();
  return (
    <div className="flex h-full items-center justify-center text-[12px] text-[var(--color-text-faint)]">
      {t('editorLoading')}
    </div>
  );
}
