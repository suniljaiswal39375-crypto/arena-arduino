/**
 * Headless keyboard navigation for popup menus, implementing the WAI-ARIA
 * menu pattern (APG "Menu Button"): ArrowUp/Down with wrap, Home/End,
 * Enter/Space activation, Escape/Tab dismissal and character type-ahead.
 *
 * Pure by design: the React wrapper (`components/ui/Menu.tsx`) only manages
 * DOM focus and open state; every navigation decision is made here, so the
 * whole interaction model is unit-testable in a node environment.
 */

export interface MenuItemModel {
  id: string;
  label: string;
  disabled?: boolean;
}

export interface MenuNavState {
  /** Index of the focused item, or -1 when nothing is focused. */
  activeIndex: number;
  /** Accumulated type-ahead buffer (lower-cased). */
  buffer: string;
  /** Timestamp (ms) of the last type-ahead character. */
  bufferAt: number;
}

export const menuNavInitial: MenuNavState = { activeIndex: -1, buffer: '', bufferAt: 0 };

/** Type-ahead resets after this much silence between keystrokes. */
export const TYPEAHEAD_RESET_MS = 500;

export type MenuKeyAction =
  | { kind: 'move'; index: number }
  | { kind: 'select'; index: number }
  | { kind: 'close' }
  | { kind: 'none' };

export interface MenuKeyOutcome {
  action: MenuKeyAction;
  state: MenuNavState;
}

function isEnabled(item: MenuItemModel | undefined): item is MenuItemModel {
  return item !== undefined && !item.disabled;
}

/**
 * Which item receives focus when the menu opens: the first enabled item, or
 * the last one when opened via ArrowUp / Shift+F10, per the APG.
 */
export function menuInitialIndex(items: readonly MenuItemModel[], openKey?: string): number {
  const backwards = openKey === 'ArrowUp' || openKey === 'Shift+F10';
  for (let i = 0; i < items.length; i += 1) {
    const index = backwards ? items.length - 1 - i : i;
    if (isEnabled(items[index])) return index;
  }
  return -1;
}

/**
 * Apply one key event to the navigation state. Never throws; unknown keys
 * and moves across an all-disabled list answer `{ kind: 'none' }`.
 */
export function menuKeyNav(
  items: readonly MenuItemModel[],
  state: MenuNavState,
  key: string,
  now: number = Date.now(),
): MenuKeyOutcome {
  const count = items.length;
  const none: MenuKeyOutcome = { action: { kind: 'none' }, state };
  const move = (index: number, next: MenuNavState = state): MenuKeyOutcome => ({
    action: { kind: 'move', index },
    state: { ...next, activeIndex: index },
  });

  if (key === 'Escape' || key === 'Tab') {
    return { action: { kind: 'close' }, state };
  }

  if (key === 'ArrowDown' || key === 'ArrowUp') {
    if (count === 0) return none;
    const dir = key === 'ArrowDown' ? 1 : -1;
    // With nothing focused yet, ArrowDown starts at the top, ArrowUp at the bottom.
    const start = state.activeIndex < 0 ? (dir === 1 ? -1 : 0) : state.activeIndex;
    for (let step = 1; step <= count; step += 1) {
      const candidate = (((start + dir * step) % count) + count) % count;
      if (isEnabled(items[candidate])) return move(candidate);
    }
    return none;
  }

  if (key === 'Home' || key === 'End') {
    for (let i = 0; i < count; i += 1) {
      const candidate = key === 'Home' ? i : count - 1 - i;
      if (isEnabled(items[candidate])) return move(candidate);
    }
    return none;
  }

  if (key === 'Enter' || key === ' ') {
    const index = state.activeIndex;
    if (index >= 0 && index < count && isEnabled(items[index])) {
      return { action: { kind: 'select', index }, state };
    }
    return none;
  }

  // Type-ahead: a single printable character. Space is activation, handled
  // above; control keys report longer names and never reach here.
  if (key.length === 1 && !/\s/.test(key)) {
    const expired = now - state.bufferAt > TYPEAHEAD_RESET_MS;
    const buffer = (expired ? '' : state.buffer) + key.toLowerCase();
    const next: MenuNavState = { ...state, buffer, bufferAt: now };
    const start = state.activeIndex < 0 ? -1 : state.activeIndex;
    for (let step = 1; step <= count; step += 1) {
      const candidate = (((start + step) % count) + count) % count;
      const item = items[candidate];
      if (isEnabled(item) && item.label.toLowerCase().startsWith(buffer)) {
        return move(candidate, next);
      }
    }
    // No match: keep the buffer so the next keystroke can extend it.
    return { action: { kind: 'none' }, state: next };
  }

  return none;
}
