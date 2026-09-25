import { describe, expect, it } from 'vitest';
import { useLab, starterDoc } from './lab';
import { makePart, makeWire } from '@/lib/doc/factory';
import { getPart } from '@/lib/parts';
import type { ProjectDoc } from '@/lib/doc/types';

const lab = () => useLab.getState();

/** A remote projection: what a Co-Lab session would hand the store. */
function remoteDoc(): ProjectDoc {
  const doc = starterDoc();
  doc.name = 'From another tab';
  const led = makePart('led', 300, 80);
  doc.diagram.parts.push(led);
  const board = doc.diagram.parts[0]!;
  doc.diagram.connections.push(
    makeWire({ part: board.id, pin: 'D13' }, { part: led.id, pin: 'A' }, 'green'),
  );
  return doc;
}

describe('applyRemoteDoc (Co-Lab remote changes)', () => {
  it('applies the remote document and recomputes diagnostics', () => {
    lab().loadDoc(starterDoc());
    lab().applyRemoteDoc(remoteDoc());
    expect(lab().doc.name).toBe('From another tab');
    expect(lab().doc.diagram.parts.some((p) => p.type === 'led')).toBe(true);
    expect(Array.isArray(lab().diagnostics)).toBe(true);
  });

  it('never touches the local undo history: undo still reverts only local edits', () => {
    lab().loadDoc(starterDoc());
    // A local edit the user can undo.
    const local = makePart('buzzer-active', 200, 200);
    lab().apply({ t: 'addPart', part: local });
    expect(lab().doc.diagram.parts.some((p) => p.id === local.id)).toBe(true);
    const historyBefore = lab().past.length;

    // A remote change lands.
    lab().applyRemoteDoc(remoteDoc());
    expect(lab().past.length).toBe(historyBefore);
    expect(lab().future.length).toBe(0);

    // Undo reverts the LOCAL add-part. The remote document is the base the
    // inverse patches apply to; remote content is not undone by local undo.
    lab().undo();
    expect(lab().doc.diagram.parts.some((p) => p.id === local.id)).toBe(false);
    expect(lab().doc.name).toBe('From another tab');
  });

  it('drops a selection that the remote change removed', () => {
    lab().loadDoc(starterDoc());
    const part = makePart('led', 320, 60);
    lab().apply({ t: 'addPart', part: part });
    lab().select(part.id);
    expect(lab().selection).toBe(part.id);
    lab().applyRemoteDoc(remoteDoc());
    expect(lab().selection).toBeNull();
  });

  it('registers authored chips carried by a remote document', () => {
    lab().loadDoc(starterDoc());
    const doc = remoteDoc();
    doc.chips = [
      {
        id: 'user-chip-remote-test',
        name: 'remote-test',
        author: 'Peer',
        description: 'chip that arrives over collab',
        pins: 'IN:digital:l GND:ground:l OUT:digital:r VCC:power:r',
        controls: [],
        logic: { kind: 'not', input: 'IN', output: 'OUT' },
        teaches: [],
        wiring: [],
        exampleSketch: '',
        source: '',
      },
    ];
    lab().applyRemoteDoc(doc);
    expect(lab().doc.chips?.[0]?.id).toBe('user-chip-remote-test');
    // The registry learned the type, so the palette/ERC can resolve it.
    expect(getPart('user-chip-remote-test')).toBeDefined();
  });
});
