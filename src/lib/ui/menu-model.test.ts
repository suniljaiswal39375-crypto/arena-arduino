import { describe, expect, it } from 'vitest';
import {
  TYPEAHEAD_RESET_MS,
  menuInitialIndex,
  menuKeyNav,
  menuNavInitial,
  type MenuItemModel,
  type MenuNavState,
} from './menu-model';

const ITEMS: MenuItemModel[] = [
  { id: 'a', label: 'Blink' },
  { id: 'b', label: 'Button', disabled: true },
  { id: 'c', label: 'Traffic light' },
  { id: 'd', label: 'Buzzer alarm' },
];

function at(activeIndex: number, patch: Partial<MenuNavState> = {}): MenuNavState {
  return { ...menuNavInitial, activeIndex, ...patch };
}

describe('menuInitialIndex', () => {
  it('opens on the first enabled item, skipping disabled ones', () => {
    expect(menuInitialIndex(ITEMS)).toBe(0);
    expect(menuInitialIndex([{ id: 'x', label: 'X', disabled: true }, ...ITEMS])).toBe(1);
  });

  it('opens on the last enabled item for ArrowUp / Shift+F10', () => {
    expect(menuInitialIndex(ITEMS, 'ArrowUp')).toBe(3);
    expect(menuInitialIndex(ITEMS, 'Shift+F10')).toBe(3);
    expect(menuInitialIndex([ ...ITEMS, { id: 'e', label: 'End', disabled: true }], 'ArrowUp')).toBe(3);
  });

  it('answers -1 when nothing can take focus', () => {
    expect(menuInitialIndex([])).toBe(-1);
    expect(menuInitialIndex([{ id: 'x', label: 'X', disabled: true }])).toBe(-1);
  });
});

describe('menuKeyNav: arrow keys', () => {
  it('ArrowDown moves forward with wrap, skipping disabled items', () => {
    const one = menuKeyNav(ITEMS, at(0), 'ArrowDown');
    expect(one.action).toEqual({ kind: 'move', index: 2 }); // skips disabled 'Button'
    const two = menuKeyNav(ITEMS, one.state, 'ArrowDown');
    expect(two.action).toEqual({ kind: 'move', index: 3 });
    const wrap = menuKeyNav(ITEMS, two.state, 'ArrowDown');
    expect(wrap.action).toEqual({ kind: 'move', index: 0 });
  });

  it('ArrowUp moves backward with wrap, skipping disabled items', () => {
    const one = menuKeyNav(ITEMS, at(3), 'ArrowUp');
    expect(one.action).toEqual({ kind: 'move', index: 2 });
    const two = menuKeyNav(ITEMS, one.state, 'ArrowUp');
    expect(two.action).toEqual({ kind: 'move', index: 0 }); // skips disabled 'Button'
    const wrap = menuKeyNav(ITEMS, two.state, 'ArrowUp');
    expect(wrap.action).toEqual({ kind: 'move', index: 3 });
  });

  it('with nothing focused, ArrowDown starts at the top and ArrowUp at the bottom', () => {
    expect(menuKeyNav(ITEMS, at(-1), 'ArrowDown').action).toEqual({ kind: 'move', index: 0 });
    expect(menuKeyNav(ITEMS, at(-1), 'ArrowUp').action).toEqual({ kind: 'move', index: 3 });
  });

  it('an all-disabled list never moves', () => {
    const disabled = [{ id: 'x', label: 'X', disabled: true }];
    expect(menuKeyNav(disabled, at(-1), 'ArrowDown').action.kind).toBe('none');
    expect(menuKeyNav([], at(-1), 'ArrowDown').action.kind).toBe('none');
  });
});

describe('menuKeyNav: Home / End / activation / dismissal', () => {
  it('Home and End land on the first/last enabled item', () => {
    expect(menuKeyNav(ITEMS, at(2), 'Home').action).toEqual({ kind: 'move', index: 0 });
    expect(menuKeyNav(ITEMS, at(0), 'End').action).toEqual({ kind: 'move', index: 3 });
    expect(menuKeyNav(ITEMS, at(-1), 'End').action).toEqual({ kind: 'move', index: 3 });
  });

  it('Enter and Space select the focused enabled item only', () => {
    expect(menuKeyNav(ITEMS, at(2), 'Enter').action).toEqual({ kind: 'select', index: 2 });
    expect(menuKeyNav(ITEMS, at(2), ' ').action).toEqual({ kind: 'select', index: 2 });
    expect(menuKeyNav(ITEMS, at(1), 'Enter').action.kind).toBe('none'); // disabled
    expect(menuKeyNav(ITEMS, at(-1), 'Enter').action.kind).toBe('none'); // nothing focused
  });

  it('Escape and Tab dismiss the menu', () => {
    expect(menuKeyNav(ITEMS, at(0), 'Escape').action.kind).toBe('close');
    expect(menuKeyNav(ITEMS, at(0), 'Tab').action.kind).toBe('close');
  });

  it('unknown keys are no-ops that preserve state', () => {
    const outcome = menuKeyNav(ITEMS, at(2), 'F5');
    expect(outcome.action.kind).toBe('none');
    expect(outcome.state).toEqual(at(2));
  });
});

describe('menuKeyNav: type-ahead', () => {
  const NOW = 10_000;

  it('jumps to the next item whose label starts with the typed letter', () => {
    const outcome = menuKeyNav(ITEMS, at(0), 't', NOW);
    expect(outcome.action).toEqual({ kind: 'move', index: 2 }); // 'Traffic light'
  });

  it('is case-insensitive and wraps around the current item', () => {
    const outcome = menuKeyNav(ITEMS, at(0), 'b', NOW);
    // 'Button' is disabled, so the next enabled B-label is 'Buzzer alarm'.
    expect(outcome.action).toEqual({ kind: 'move', index: 3 });
  });

  it('accumulates characters within the reset window', () => {
    const first = menuKeyNav(ITEMS, at(-1), 'b', NOW);
    const second = menuKeyNav(ITEMS, first.state, 'u', NOW + 100);
    expect(second.action).toEqual({ kind: 'move', index: 3 }); // 'Bu…' → Buzzer
    expect(second.state.buffer).toBe('bu');
  });

  it('starts a fresh buffer after the reset window expires', () => {
    const first = menuKeyNav(ITEMS, at(3), 'b', NOW);
    const later = menuKeyNav(ITEMS, first.state, 't', NOW + TYPEAHEAD_RESET_MS + 1);
    expect(later.state.buffer).toBe('t');
    expect(later.action).toEqual({ kind: 'move', index: 2 }); // 'Traffic light'
  });

  it('keeps the buffer on no match so the next keystroke can extend it', () => {
    const miss = menuKeyNav(ITEMS, at(-1), 'z', NOW);
    expect(miss.action.kind).toBe('none');
    expect(miss.state.buffer).toBe('z');
  });

  it('never type-ahead-matches a disabled item or a whitespace key', () => {
    const onlyDisabled = [{ id: 'x', label: 'Zebra', disabled: true }];
    expect(menuKeyNav(onlyDisabled, at(-1), 'z', NOW).action.kind).toBe('none');
    // Space is activation, not type-ahead (and with nothing focused: no-op).
    expect(menuKeyNav(ITEMS, at(-1), ' ', NOW).action.kind).toBe('none');
  });
});
