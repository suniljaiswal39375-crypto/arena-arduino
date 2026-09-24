import { describe, expect, it } from 'vitest';
import { ALL_PARTS } from '@/lib/parts';
import { parsePins } from '@/lib/parts/types';
import { pinOffset, PART_WIDTH } from './geometry';

describe('catalogue pin layout', () => {
  it('normalizes compact side names', () => {
    expect(parsePins('A:digital:l B:digital:r C:digital:t D:digital:b').map(p => p.side))
      .toEqual(['left', 'right', 'top', 'bottom']);
  });
  it('gives every pin its own position on every part', () => {
    for (const part of ALL_PARTS) {
      const offsets = part.pins.map(pin => pinOffset(part, pin.name));
      expect(offsets.every(Boolean), part.id).toBe(true);
      expect(new Set(offsets.map(p => JSON.stringify(p))).size, part.id).toBe(part.pins.length);
      for (const pin of part.pins) {
        const offset = pinOffset(part, pin.name)!;
        if (pin.side === 'left') expect(offset.dx).toBe(0);
        if (pin.side === 'right') expect(offset.dx).toBe(PART_WIDTH);
      }
    }
  });
  it('does not draw a phantom pin for an invalid name', () => {
    expect(pinOffset(ALL_PARTS[0]!, 'no-such-pin')).toBeNull();
  });
});
