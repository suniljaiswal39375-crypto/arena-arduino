import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { BuilderShell, missionWorkspace } from './BuilderShell';
import { SchematicCanvas } from './SchematicCanvas';
import { Inspector } from './Inspector';
import { BottomDock } from './BottomDock';
import { StepTracker } from './StepTracker';
import { useLab, type DockTab } from '@/store/lab';
import { templateDoc, templates } from '@/lib/templates';
import { MISSIONS } from '@/lib/missions/missions';
import { SimEngine } from '@/lib/sim/engine';
import { ALL_PARTS } from '@/lib/parts';
import { makePart, makeWire } from '@/lib/doc/factory';
import type { ProjectDoc } from '@/lib/doc/types';

/**
 * The builder route is client-only (`ssr: false`), so without a browser its
 * render path never runs anywhere in CI. Rendering to a string executes every
 * component's render function against real store state, which catches the
 * class of bug that would otherwise ship as a blank screen.
 *
 * One trap: on the server, zustand answers `useSyncExternalStore` with the
 * store's *initial* state, not its current one. Without `render()` below every
 * test silently renders the first-run project no matter what was loaded.
 */
function render(ui: ReactElement): string {
  Object.assign(useLab.getInitialState(), useLab.getState());
  return renderToString(ui);
}

/** Run a document for a moment and return the live snapshot, as the worker would. */
function liveSnapshot(doc: ProjectDoc) {
  const engine = new SimEngine(doc);
  engine.load(doc, doc.files['sketch.ino'] ?? '');
  engine.start();
  for (let i = 0; i < 8; i++) engine.tick(150, 1);
  return engine.snapshot();
}

/** The same escaping React applies to text content. */
const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;');

/** How many part cards the canvas drew. */
const partCards = (html: string) => html.split('class="cursor-move"').length - 1;

describe('builder render smoke', () => {
  it('renders the first-run workspace', () => {
    const html = render(<BuilderShell />);
    expect(html).toContain('Arduino Uno');
    expect(html).toContain('LED');
    expect(partCards(html)).toBe(useLab.getState().doc.diagram.parts.length);
  });

  it('renders what was loaded, not the first-run project', () => {
    useLab.getState().loadDoc(templateDoc('dht-lcd')!);
    const html = render(<SchematicCanvas states={{}} />);
    expect(html).toContain('DHT11');
    expect(partCards(html)).toBe(useLab.getState().doc.diagram.parts.length);
  });

  it('shows a remote peer\'s selection as a named halo on the canvas', () => {
    useLab.getState().loadDoc(templateDoc('uno-blink')!);
    const peers = [{ clientId: 'p1', name: 'Asha', color: '#e63946', selectedPartId: 'led1', role: 'editor' as const, updatedAt: 0 }];
    const html = render(<SchematicCanvas states={{}} peers={peers} />);
    expect(html).toContain('Asha');
    expect(html).toContain('stroke="#e63946"');
    expect(render(<SchematicCanvas states={{}} peers={[]} />)).not.toContain('Asha');
  });

  it('shows open room comments as count badges on the canvas', () => {
    useLab.getState().loadDoc(templateDoc('uno-blink')!);
    const r1 = useLab.getState().doc.diagram.parts.find((p) => p.id === 'r1')!;
    const anchor = `translate(${r1.x + 130} ${r1.y - 2})`;
    const html = render(<SchematicCanvas states={{}} commentCounts={{ r1: 3 }} />);
    expect(html).toContain(anchor);
    expect(html).toContain('>3<');
    expect(render(<SchematicCanvas states={{}} commentCounts={{}} />)).not.toContain(anchor);
  });

  it('renders every template', () => {
    for (const t of templates()) {
      const doc = templateDoc(t.slug)!;
      useLab.getState().loadDoc(doc);
      const html = render(<BuilderShell />);
      expect(partCards(html), t.slug).toBe(doc.diagram.parts.length);
    }
  });

  it('renders every mission workspace with its step tracker', () => {
    for (const m of MISSIONS) {
      useLab.getState().loadDoc(missionWorkspace(m.slug));
      useLab.setState({ missionSlug: m.slug });
      const html = render(
        <StepTracker mission={m} confirmed={new Set()} onConfirm={() => {}} onReveal={() => {}} />,
      );
      expect(html, m.slug).toContain(m.title);
      expect(html, m.slug).toContain(escapeHtml(m.steps[0]!.instruction).slice(0, 24));
      expect(() => render(<BuilderShell />), m.slug).not.toThrow();
    }
    useLab.setState({ missionSlug: null });
  });
});

describe('builder render with live simulator state', () => {
  it('draws every template mid-run and inspects every part in it', () => {
    for (const t of templates()) {
      const doc = templateDoc(t.slug)!;
      useLab.getState().loadDoc(doc);
      const snap = liveSnapshot(doc);
      const html = render(<SchematicCanvas states={snap.parts} />);
      expect(partCards(html), t.slug).toBe(doc.diagram.parts.length);
      for (const part of doc.diagram.parts) {
        useLab.setState({ selection: part.id });
        const inspector = render(<Inspector states={snap.parts} />);
        const def = ALL_PARTS.find((d) => d.id === part.type)!;
        expect(inspector, `${t.slug}/${part.type}`).toContain(escapeHtml(def.name));
      }
      useLab.setState({ selection: null });
    }
  });

  it('lights the LED glyph while the blink sketch has D13 high', () => {
    const doc = templateDoc('uno-blink')!;
    useLab.getState().loadDoc(doc);
    const engine = new SimEngine(doc);
    engine.load(doc, doc.files['sketch.ino'] ?? '');
    engine.start();
    engine.tick(250, 1);
    const lit = render(<SchematicCanvas states={engine.snapshot().parts} />);
    engine.tick(500, 1);
    const dark = render(<SchematicCanvas states={engine.snapshot().parts} />);
    expect(lit).not.toEqual(dark);
  });

  it('renders every dock tab against a real run', () => {
    const doc = templateDoc('ultrasonic-radar')!;
    useLab.getState().loadDoc(doc);
    const snap = liveSnapshot(doc);
    expect(snap.serial.length).toBeGreaterThan(0);

    const seen = new Set<string>();
    const tabs: DockTab[] = ['serial', 'plotter', 'scope', 'logic', 'multimeter', 'inputs', 'diagnostics', 'build'];
    for (const tab of tabs) {
      useLab.setState({ dock: tab });
      const html = render(<BottomDock snapshot={snap} onSend={() => {}} />);
      expect(html.length, tab).toBeGreaterThan(200);
      seen.add(html);
    }
    // Each tab really switched the panel, rather than re-rendering the same one.
    expect(seen.size).toBe(tabs.length);
    useLab.setState({ dock: 'serial' });
  });

  it('shows escaped, ephemeral SSE progress in the Build logs tab', () => {
    useLab.setState({ dock: 'build' });
    const html = render(<BottomDock snapshot={null} onSend={() => {}} buildEvents={[
      { type: 'status', text: 'Building AVR' },
      { type: 'error', text: '<script>bad</script>' },
    ]} />);
    expect(html).toContain('Building AVR');
    expect(html).toContain('&lt;script&gt;bad&lt;/script&gt;');
    expect(html).not.toContain('<script>bad</script>');
    useLab.setState({ dock: 'serial' });
  });

  it('renders a real captured wave, labelled net, and VCD export in the Logic tab', () => {
    const doc = templateDoc('uno-blink')!;
    const board = doc.diagram.parts.find((p) => p.type === 'arduino-uno')!;
    const probe = makePart('emu-logic-analyzer', 450, 100, { label: '<unsafe>' });
    doc.diagram.parts.push(probe);
    doc.diagram.connections.push(
      makeWire({ part: board.id, pin: 'D13' }, { part: probe.id, pin: 'D0' }),
      makeWire({ part: board.id, pin: 'GND' }, { part: probe.id, pin: 'GND' }),
    );
    useLab.getState().loadDoc(doc);
    const engine = new SimEngine(doc);
    engine.load(doc, doc.files['sketch.ino'] ?? '');
    engine.start();
    engine.tick(600);
    const snap = engine.snapshot();
    useLab.setState({ dock: 'logic', selection: probe.id });
    const html = render(<BottomDock snapshot={snap} onSend={() => {}} />);
    const inspector = render(<Inspector states={snap.parts} />);
    const glyph = render(<SchematicCanvas states={snap.parts} />);
    expect(html).toContain('Export VCD');
    expect(html).toContain('Latest observed changes');
    expect(html).toMatch(/D0<!-- -->: <!-- -->[01x]/);
    expect(html).toContain('Arduino Uno D13');
    expect(html).toContain('&lt;unsafe&gt;');
    expect(html).not.toContain('<unsafe>');
    expect(inspector).toContain('retained edges');
    expect(glyph).toContain('edges');
    useLab.setState({ dock: 'serial', selection: null });
  });

  it('renders oscilloscope screen reticle and auto-measurements in the Scope tab', () => {
    const doc = templateDoc('uno-blink')!;
    useLab.getState().loadDoc(doc);
    const snap = liveSnapshot(doc);
    useLab.setState({ dock: 'scope' });
    const html = render(<BottomDock snapshot={snap} onSend={() => {}} />);
    expect(html).toContain('Oscilloscope display reticle');
    expect(html).toContain('Auto-measurements');
    expect(html).toContain('CH1');
    expect(html).toContain('Timebase');
    expect(html).toContain('Trigger');
    useLab.setState({ dock: 'serial' });
  });

  it('renders digital multimeter face, LCD digits, and mode dial in the Multimeter tab', () => {
    const doc = templateDoc('uno-blink')!;
    useLab.getState().loadDoc(doc);
    const snap = liveSnapshot(doc);
    useLab.setState({ dock: 'multimeter' });
    const html = render(<BottomDock snapshot={snap} onSend={() => {}} />);
    expect(html).toContain('DC Voltage');
    expect(html).toContain('Resistance');
    expect(html).toContain('Continuity');
    expect(html).toContain('Probe A (+)');
    expect(html).toContain('Probe B (-)');
    useLab.setState({ dock: 'serial' });
  });

  it('shows the serial output of the run in the Serial tab', () => {
    const doc = templateDoc('ultrasonic-radar')!;
    useLab.getState().loadDoc(doc);
    const snap = liveSnapshot(doc);
    useLab.setState({ dock: 'serial' });
    const html = render(<BottomDock snapshot={snap} onSend={() => {}} />);
    const firstLine = snap.serial.map((l) => l.text).find((t) => t.trim().length > 0)!;
    expect(html).toContain(escapeHtml(firstLine.trim()).slice(0, 12));
  });

  it('draws a card for every part in the catalogue', () => {
    // One canvas holding the whole catalogue: any part whose glyph or pin
    // layout throws breaks this, whichever adapter it belongs to.
    const doc = templateDoc('uno-blink')!;
    doc.diagram.parts = ALL_PARTS.map((def, i) =>
      makePart(def.id, 40 + (i % 12) * 180, 40 + Math.floor(i / 12) * 220, {
        attrs: { ...(def.defaults ?? {}) } as never,
      }),
    );
    doc.diagram.connections = [];
    useLab.getState().loadDoc(doc);
    const html = render(<SchematicCanvas states={{}} />);
    expect(partCards(html)).toBe(ALL_PARTS.length);
  });
});

import { ChaosPanel } from './ChaosPanel';
import { ProjectFiles } from './ProjectFiles';
import { CHAOS_CHALLENGES, brokenProject } from '@/lib/chaos/chaos';
import { SHOWCASE, showcaseDoc } from '@/lib/showcase';

describe('new builder surfaces render', () => {
  it('renders every showcase project on the canvas', () => {
    for (const p of SHOWCASE) {
      const doc = showcaseDoc(p);
      useLab.getState().loadDoc(doc);
      const html = render(<SchematicCanvas states={{}} />);
      expect(partCards(html), p.slug).toBe(doc.diagram.parts.length);
    }
  });

  it('renders the Chaos Lab panel for every challenge, brief first and no answer', () => {
    for (const c of CHAOS_CHALLENGES) {
      useLab.getState().loadDoc(brokenProject(c));
      const html = render(<ChaosPanel challenge={c} onRestart={() => {}} />);
      expect(html, c.slug).toContain(escapeHtml(c.brief).slice(0, 40));
      expect(html, c.slug).toContain('Check my fix');
      // Hints and the answer stay hidden until asked for.
      expect(html, c.slug).not.toContain(escapeHtml(c.hints[0]).slice(0, 30));
      expect(html, c.slug).not.toContain(escapeHtml(c.answer).slice(0, 30));
    }
  });

  it('renders the export and import controls', () => {
    const html = render(<ProjectFiles />);
    expect(html).toContain('Export');
    expect(html).toContain('Import');
  });

  it('renders the whole builder for a showcase deep link', () => {
    expect(() => render(<BuilderShell initialShowcaseSlug="line-following-rover" />)).not.toThrow();
    expect(() => render(<BuilderShell initialChaosSlug="the-dark-streetlight" />)).not.toThrow();
  });
});

import { ConnectionsPanel } from './ConnectionsPanel';
describe('keyboard circuit alternative', () => {
  it('exposes native pin controls and a connection table', () => {
    useLab.getState().loadDoc(templateDoc('uno-blink')!);
    const html = render(<ConnectionsPanel />);
    expect(html).toContain('From pin');
    expect(html).toContain('To pin');
    expect(html).toContain('Connect pins');
    expect(html).toContain('<caption');
    expect(html).toContain('Remove wire uno D13 to r1 1');
    expect(html).toContain('role="status"');
  });
});
