import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { PeerGhosts } from './peer-ghosts';
import { templateDoc } from '@/lib/templates';
import type { PeerInfo } from '@/lib/collab/session';

const parts = templateDoc('uno-blink')!.diagram.parts; // uno, r1, led1

const peer = (over: Partial<PeerInfo>): PeerInfo => ({
  clientId: 'peer-1',
  name: 'Asha',
  color: '#e63946',
  selectedPartId: null,
  updatedAt: 0,
  ...over,
});

describe('PeerGhosts', () => {
  it('renders nothing when nobody is here or nobody has a selection', () => {
    expect(renderToString(<PeerGhosts parts={parts} peers={[]} />)).toBe('');
    expect(
      renderToString(<PeerGhosts parts={parts} peers={[peer({ selectedPartId: null })]} />),
    ).toBe('');
  });

  it('draws a halo and a name tag in the peer colour for their selection', () => {
    const html = renderToString(<PeerGhosts parts={parts} peers={[peer({ selectedPartId: 'led1' })]} />);
    expect(html).toContain('stroke="#e63946"');
    expect(html).toContain('Asha');
    expect(html).toContain('pointer-events="none"');
    // The halo is anchored on the selected part's coordinates.
    const led = parts.find((p) => p.id === 'led1')!;
    expect(html).toContain(`translate(${led.x} ${led.y})`);
    // Peers with no selection add nothing.
    expect(html).not.toContain('translate(0 0)');
  });

  it('stacks rings and tags when several peers select the same part', () => {
    const html = renderToString(
      <PeerGhosts
        parts={parts}
        peers={[peer({ selectedPartId: 'uno' }), peer({ clientId: 'peer-2', name: 'Ravi', color: '#2a9d8f', selectedPartId: 'uno' })]}
      />,
    );
    expect(html).toContain('Asha');
    expect(html).toContain('Ravi');
    expect(html).toContain('stroke="#e63946"');
    expect(html).toContain('stroke="#2a9d8f"');
    // Second ring is larger so both stay visible.
    expect(html.match(/stroke-dasharray="4 4"/g)).toHaveLength(2);
  });

  it('ignores selections of parts that no longer exist', () => {
    const html = renderToString(<PeerGhosts parts={parts} peers={[peer({ selectedPartId: 'ghost' })]} />);
    expect(html).toBe('');
  });
});
