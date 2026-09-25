import { describe, expect, it } from 'vitest';
import { remoteCursors } from './cursors';
import type { PeerInfo } from './session';

function peer(id: string, caret: PeerInfo['caret']): PeerInfo {
  return {
    clientId: id,
    name: `peer-${id}`,
    color: '#e63946',
    selectedPartId: null,
    role: 'editor',
    caret,
    updatedAt: Date.now(),
  };
}

describe('remoteCursors', () => {
  it('keeps only peers whose caret is in the given file', () => {
    const peers = [
      peer('a', { file: 'sketch.ino', offset: 12 }),
      peer('b', { file: 'notes.txt', offset: 3 }),
      peer('c', null),
      peer('d', undefined),
    ];
    const list = remoteCursors(peers, 'sketch.ino');
    expect(list.map((c) => c.clientId)).toEqual(['a']);
    expect(list[0]?.offset).toBe(12);
    expect(list[0]?.name).toBe('peer-a');
    expect(list[0]?.color).toBe('#e63946');
  });

  it('floors fractional offsets and drops negative ones', () => {
    const peers = [
      peer('a', { file: 'sketch.ino', offset: 10.9 }),
      peer('b', { file: 'sketch.ino', offset: -4 }),
    ];
    const list = remoteCursors(peers, 'sketch.ino');
    expect(list.map((c) => [c.clientId, c.offset])).toEqual([['a', 10]]);
  });

  it('preserves peer order for stable drawing', () => {
    const peers = [
      peer('z', { file: 'sketch.ino', offset: 1 }),
      peer('a', { file: 'sketch.ino', offset: 2 }),
      peer('m', { file: 'sketch.ino', offset: 3 }),
    ];
    expect(remoteCursors(peers, 'sketch.ino').map((c) => c.clientId)).toEqual(['z', 'a', 'm']);
  });
});
