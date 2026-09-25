import { describe, expect, it } from 'vitest';
import type { ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { ChipStudio } from './ChipStudio';
import { PartPalette } from './PartPalette';
import { useLab } from '@/store/lab';
import { templateDoc } from '@/lib/templates';

/**
 * Chip Studio renders client-side, so the render path is exercised the same
 * way the rest of the builder is: server-render against real store state, so
 * a crash cannot ship as a blank screen. Composition logic is covered in
 * compose.test.ts; interactive behaviour runs in the browser job (e2e).
 */
function render(ui: ReactElement): string {
  Object.assign(useLab.getInitialState(), useLab.getState());
  return renderToString(ui);
}

describe('chip studio render', () => {
  it('renders the dialog with the three behaviour families and a disabled add', () => {
    useLab.getState().loadDoc(templateDoc('uno-blink')!);
    const html = render(<ChipStudio onClose={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Inverter');
    expect(html).toContain('Window comparator');
    expect(html).toContain('Pulse generator');
    // No name yet: the add button must not be enabled.
    expect(html).toMatch(/disabled/);
  });

  it('the palette offers the studio entry point', () => {
    useLab.getState().loadDoc(templateDoc('uno-blink')!);
    const html = render(<PartPalette />);
    expect(html).toContain('New chip');
  });
});
