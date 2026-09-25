import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { LanguageProvider } from '@/lib/i18n/client';
import { BuilderShell } from './BuilderShell';
import { MentorPanel } from './MentorPanel';
import { ChaosGeneratorCard } from './ChaosGeneratorCard';
import { useLab } from '@/store/lab';
import { templateDoc } from '@/lib/templates';
import type { ProjectDoc } from '@/lib/doc/types';
import type { SimSnapshot } from '@/lib/sim/engine';

/**
 * The mentor and generator are client-only, so their render path is exercised
 * the same way the rest of the builder is: render to a string against real
 * store state, so a crash cannot ship as a blank screen.
 */
function render(ui: ReactElement): string {
  Object.assign(useLab.getInitialState(), useLab.getState());
  return renderToString(ui);
}

function snapshotWith(serial: Array<{ at: number; text: string }> = []): SimSnapshot {
  return {
    running: false,
    clockUs: 1_500_000,
    parts: {},
    serial,
    plot: [],
    plotLabels: [],
    logicAnalyzers: [],
    scope: null,
    multimeter: null,
    error: null,
    unsupported: [],
  };
}

describe('mentor panel render', () => {
  it('renders the intro, composer and AI label on a fresh session', () => {
    useLab.getState().loadDoc(templateDoc('uno-blink')!);
    const html = render(<MentorPanel snapshot={snapshotWith()} />);
    expect(html).toContain('aria-live="polite"'); // live transcript region
    expect(html).toContain('AI-generated');
    expect(html).toContain('Inspect last run');
    expect(html).toContain('Ask the mentor');
  });

  it('renders with a Hindi locale without crashing', () => {
    useLab.getState().loadDoc(templateDoc('uno-blink')!);
    const html = render(
      <LanguageProvider initialLocale="hi">
        <MentorPanel snapshot={snapshotWith()} />
      </LanguageProvider>,
    );
    expect(html).toContain('AI-निर्मित');
    expect(html).toContain('आख़िरी रन की जाँच');
  });

  it('renders the empty-inspect state when no snapshot exists', () => {
    useLab.getState().loadDoc(templateDoc('uno-blink')!);
    const html = render(<MentorPanel snapshot={null} />);
    expect(html).toContain('Inspect last run');
    // The inspect button is disabled without a snapshot.
    expect(html).toMatch(/disabled/);
  });
});

describe('chaos generator card render', () => {
  it('offers the break button on a clean project', () => {
    useLab.getState().loadDoc(templateDoc('uno-blink')!);
    const html = render(<ChaosGeneratorCard onChallenge={() => {}} />);
    expect(html).toContain('Break this project');
  });
});

describe('builder shell integration', () => {
  it('renders the full shell with the mentor tab present', () => {
    useLab.getState().loadDoc(templateDoc('uno-blink')!);
    const html = render(<BuilderShell />);
    expect(html).toContain('Mentor');
    expect(html).toContain('Break this project');
  });

  it('survives a doc that would trip the inspector (no selection)', () => {
    const doc: ProjectDoc = templateDoc('dht-lcd')!;
    useLab.getState().loadDoc(doc);
    const html = render(<BuilderShell />);
    expect(html).toContain('DHT11');
    expect(html).toContain('Mentor');
  });
});
