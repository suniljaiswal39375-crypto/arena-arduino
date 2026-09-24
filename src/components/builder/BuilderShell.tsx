'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLab } from '@/store/lab';
import { SimClient } from '@/lib/sim/client';
import type { SimSnapshot } from '@/lib/sim/engine';
import { lastProjectId, loadProject } from '@/lib/doc/persistence';
import { missionWorkspace } from '@/lib/missions/workspace';
import { missionBySlug } from '@/lib/missions/missions';
import { Toolbar } from './Toolbar';
import { PartPalette } from './PartPalette';
import { SchematicCanvas } from './SchematicCanvas';
import { Inspector } from './Inspector';
import { CodePane } from './CodePane';
import { BottomDock } from './BottomDock';
import { StepTracker } from './StepTracker';
import { ConnectionsPanel } from './ConnectionsPanel';
import { ChaosPanel } from './ChaosPanel';
import { cn } from '@/lib/cn';
import { chaosBySlug, brokenProject } from '@/lib/chaos/chaos';
import { showcaseBySlug, showcaseDoc } from '@/lib/showcase';
import { Flame, Layers, Wrench } from 'lucide-react';

export function BuilderShell({
  initialMissionSlug,
  initialShowcaseSlug,
  initialChaosSlug,
}: { initialMissionSlug?: string; initialShowcaseSlug?: string; initialChaosSlug?: string } = {}) {
  const doc = useLab((s) => s.doc);
  const missionSlug = useLab((s) => s.missionSlug);
  const loadDoc = useLab((s) => s.loadDoc);
  const setFile = useLab((s) => s.setFile);

  const [textCircuit, setTextCircuit] = useState(false);
  const [snapshot, setSnapshot] = useState<SimSnapshot | null>(null);
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [rail, setRail] = useState<'inspector' | 'mission' | 'chaos'>('inspector');
  const origin = doc.provenance.forkedFrom;
  const challenge = origin?.startsWith('chaos:') ? chaosBySlug(origin.slice(6)) : undefined;
  const confirmed = useMemo(() => new Set(doc.provenance.confirmedSteps ?? []), [doc.provenance.confirmedSteps]);
  const initializedLink = useRef<string | null>(null);
  const clientRef = useRef<SimClient | null>(null);

  const source = doc.files['sketch.ino'] ?? '';
  const mission = missionSlug ? missionBySlug(missionSlug) : undefined;

  useEffect(() => {
    const flush = () => useLab.getState().flushSave();
    const onHidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      flush();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHidden);
    };
  }, []);

  /* ------------------------------------------------------- sim lifecycle */

  // Restore whatever the student had open before this refresh, unless a deep
  // link asks for something specific.
  useEffect(() => {
    const link = JSON.stringify([initialMissionSlug, initialShowcaseSlug, initialChaosSlug]);
    if (initializedLink.current === link) return;
    initializedLink.current = link;
    const showcase = initialShowcaseSlug ? showcaseBySlug(initialShowcaseSlug) : undefined;
    const chaos = initialChaosSlug ? chaosBySlug(initialChaosSlug) : undefined;
    if (showcase) {
      useLab.getState().loadDoc(showcaseDoc(showcase));
      useLab.getState().setMission(null);
    } else if (chaos) {
      useLab.getState().loadDoc(brokenProject(chaos));
      useLab.getState().setMission(null);
      setRail('chaos');
    } else if (initialMissionSlug && missionBySlug(initialMissionSlug)) {
      const id = lastProjectId();
      const saved = id ? loadProject(id) : null;
      useLab.getState().loadDoc(saved?.provenance.mission === initialMissionSlug ? saved : missionWorkspace(initialMissionSlug));
    } else {
      useLab.getState().hydrate();
    }
  }, [initialShowcaseSlug, initialChaosSlug, initialMissionSlug]);

  useEffect(() => {
    const client = new SimClient();
    client.onState = (s) => setSnapshot(s);
    clientRef.current = client;
    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, []);

  // Recompile whenever the sketch text changes.
  useEffect(() => {
    const client = clientRef.current;
    if (!client) return;
    client.setSpeed(speed);
    client.load(doc, source);
    setRunning(true);
    // The document is intentionally read fresh here rather than tracked: only
    // the sketch text should trigger a recompile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, doc.id]);

  // Wiring and input changes are pushed without restarting the sketch.
  const diagramKey = JSON.stringify({
    parts: doc.diagram.parts.map((p) => [p.id, p.type, p.x, p.y, p.rotate, p.attrs]),
    wires: doc.diagram.connections,
    inputs: doc.sim.inputs,
    engine: doc.engine,
  });
  useEffect(() => {
    clientRef.current?.update(doc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagramKey]);

  useEffect(() => {
    clientRef.current?.setSpeed(speed);
  }, [speed]);

  /* --------------------------------------------------------- mission load */

  const confirmStep = useCallback((note: string) => {
    useLab.getState().apply({ t: 'confirmStep', note });
  }, []);

  // A restored mission already contains the student's work. Never replace it
  // with a starter document just because the active mission changed.
  useEffect(() => {
    setRail(mission ? 'mission' : challenge ? 'chaos' : 'inspector');
  }, [mission, challenge]);

  const revealReference = useCallback(() => {
    if (!mission) return;
    setFile('sketch.ino', mission.referenceSketch);
  }, [mission, setFile]);

  /* ------------------------------------------------------------- render */

  const onRun = useCallback(() => {
    clientRef.current?.load(doc, source);
    clientRef.current?.start();
    setRunning(true);
  }, [doc, source]);

  const onStop = useCallback(() => {
    clientRef.current?.stop();
    setRunning(false);
  }, []);

  // Ctrl/Cmd + Enter runs from anywhere in the builder, including the editor.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onRun();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onRun]);

  const onReset = useCallback(() => {
    clientRef.current?.reset();
    setRunning(true);
  }, []);

  const onSend = useCallback((text: string) => {
    clientRef.current?.sendSerial(text);
  }, []);

  const states = snapshot?.parts ?? {};

  const error = snapshot?.error;

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <Toolbar
        running={running}
        snapshot={snapshot}
        onRun={onRun}
        onStop={onStop}
        onReset={onReset}
        onSpeed={setSpeed}
        speed={speed}
      />

      {error && (
        <div className="border-b border-[#55262c] bg-[#2a1418] px-3 py-2 text-[12.5px]">
          <span className="font-semibold text-[var(--color-fault)]">
            {error.kind === 'compile' ? 'Compile error' : 'Runtime error'}
          </span>
          {error.line > 0 && <span className="mono ml-2 text-[var(--color-text-dim)]">line {error.line}</span>}
          <span className="ml-2">{error.message}</span>
        </div>
      )}

      {snapshot && snapshot.unsupported.length > 0 && (
        <div className="border-b border-[#5c4405] bg-[#2a2109] px-3 py-1.5 text-[11.5px] text-[var(--color-text-dim)]">
          The functional runtime does not model: {snapshot.unsupported.join(', ')}. Switch the engine
          to Firmware Emulation when that is available.
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <aside className="hidden w-[286px] shrink-0 border-r border-[var(--color-border)] lg:block">
          <PartPalette />
        </aside>

        <main id="main" className="flex min-w-0 flex-1 flex-col">
          <button type="button" className="btn btn-sm self-start" aria-pressed={textCircuit} onClick={() => setTextCircuit(v => !v)}>
            {textCircuit ? 'Show schematic' : 'Keyboard wiring & connections'}
          </button>
          <div className="min-h-0 flex-[1.35]">
            {textCircuit ? <ConnectionsPanel /> : <SchematicCanvas states={states} />}
          </div>
          <div className="h-[30%] min-h-[160px] border-t border-[var(--color-border)]">
            <CodePane />
          </div>
          <div className="h-[24%] min-h-[150px] border-t border-[var(--color-border)]">
            <BottomDock snapshot={snapshot} onSend={onSend} />
          </div>
        </main>

        <aside className="hidden w-[330px] shrink-0 border-l border-[var(--color-border)] xl:flex xl:flex-col">
          <div className="flex border-b border-[var(--color-border)]">
            <RailTab
              active={rail === 'inspector'}
              onClick={() => setRail('inspector')}
              icon={<Wrench size={13} />}
              label="Inspector"
            />
            {mission && (
              <RailTab
                active={rail === 'mission'}
                onClick={() => setRail('mission')}
                icon={<Layers size={13} />}
                label="Mission"
              />
            )}
            {challenge && (
              <RailTab
                active={rail === 'chaos'}
                onClick={() => setRail('chaos')}
                icon={<Flame size={13} />}
                label="Chaos Lab"
              />
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {rail === 'chaos' && challenge ? (
              <ChaosPanel key={`${doc.id}:${challenge.slug}`} challenge={challenge} onRestart={() => loadDoc(brokenProject(challenge))} />
            ) : rail === 'mission' && mission ? (
              <StepTracker
                key={`${doc.id}:${mission.slug}`}
                mission={mission}
                confirmed={confirmed}
                onConfirm={confirmStep}
                onReveal={revealReference}
              />
            ) : (
              <Inspector states={states} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function RailTab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 px-3 py-2 text-[12.5px] font-medium',
        active
          ? 'border-b-2 border-[var(--color-accent)] text-[var(--color-accent)]'
          : 'border-b-2 border-transparent text-[var(--color-text-dim)] hover:text-[var(--color-text)]',
      )}
    >
      {icon} {label}
    </button>
  );
}

export { missionWorkspace } from '@/lib/missions/workspace';
