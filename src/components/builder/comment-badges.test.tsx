import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CommentBadges } from './comment-badges';
import { templateDoc } from '@/lib/templates';

const parts = templateDoc('uno-blink')!.diagram.parts;

describe('CommentBadges', () => {
  it('renders nothing when no part has open comments', () => {
    expect(renderToString(<CommentBadges parts={parts} counts={{}} />)).toBe('');
    expect(renderToString(<CommentBadges parts={parts} counts={{ ghost: 2 }} />)).toBe('');
  });

  it('shows the open count on the part that has comments', () => {
    const html = renderToString(<CommentBadges parts={parts} counts={{ led1: 2 }} />);
    expect(html).toContain('>2<');
    const led = parts.find((p) => p.id === 'led1')!;
    expect(html).toContain(`translate(${led.x + 130} ${led.y - 2})`);
  });

  it('caps the visible count at nine', () => {
    const html = renderToString(<CommentBadges parts={parts} counts={{ r1: 42 }} />);
    expect(html).toContain('>9<');
    expect(html).not.toContain('>42<');
  });
});
