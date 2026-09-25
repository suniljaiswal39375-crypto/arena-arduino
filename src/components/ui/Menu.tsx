/**
 * The accessible popup menu primitive (WAI-ARIA menu-button pattern).
 *
 * All navigation decisions come from the pure model in `lib/ui/menu-model`;
 * this component only owns DOM concerns: open state, roving focus, outside
 * dismissal and focus return to the trigger. No dependencies.
 *
 * Guarantees the e2e suite pins: ArrowUp/Down/Home/End/character type-ahead
 * move focus inside the menu, Enter/Space activate, Escape dismisses and
 * returns focus to the trigger, clicking outside dismisses.
 */
'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MutableRefObject,
} from 'react';
import {
  menuInitialIndex,
  menuKeyNav,
  menuNavInitial,
  type MenuItemModel,
  type MenuNavState,
} from '@/lib/ui/menu-model';
import { cn } from '@/lib/cn';

export interface MenuItemSpec extends MenuItemModel {
  /** Second line under the label. */
  description?: string;
  /** Language attribute for the item text (labels are English in places). */
  lang?: string;
  onSelect: () => void;
}

export interface MenuPanelProps {
  id: string;
  items: readonly MenuItemSpec[];
  activeIndex: number;
  className?: string;
  ariaLabel?: string;
  itemRefs?: MutableRefObject<Array<HTMLElement | null>>;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  onItemActivate?: (index: number) => void;
}

export const MENU_PANEL_CLASS =
  'absolute left-0 top-9 z-30 max-h-[65dvh] w-64 overflow-y-auto rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] p-1 shadow-xl';

/** The popup list, rendered separately so its structure is testable in SSR. */
export function MenuPanel({
  id,
  items,
  activeIndex,
  className,
  ariaLabel,
  itemRefs,
  onKeyDown,
  onItemActivate,
}: MenuPanelProps) {
  return (
    <div
      role="menu"
      id={id}
      aria-orientation="vertical"
      aria-label={ariaLabel}
      className={cn(MENU_PANEL_CLASS, className)}
      onKeyDown={onKeyDown}
    >
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="menuitem"
          lang={item.lang}
          ref={(el) => {
            if (itemRefs) itemRefs.current[index] = el;
          }}
          tabIndex={index === activeIndex ? 0 : -1}
          aria-disabled={item.disabled ? true : undefined}
          data-active={index === activeIndex ? '' : undefined}
          className={cn(
            'block w-full rounded px-2 py-1.5 text-left',
            item.disabled
              ? 'cursor-not-allowed opacity-50'
              : 'hover:bg-[var(--color-surface-3)]',
            index === activeIndex && 'bg-[var(--color-surface-3)]',
          )}
          onClick={() => {
            if (!item.disabled) onItemActivate?.(index);
          }}
        >
          <span className="block text-[12.5px] font-medium">{item.label}</span>
          {item.description ? (
            <span className="block text-[11px] text-[var(--color-text-dim)]">
              {item.description}
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

export interface MenuProps {
  /** Trigger button text (already localised by the caller). */
  label: string;
  items: readonly MenuItemSpec[];
  /** Overrides for the popup placement (default: below the trigger). */
  panelClassName?: string;
  triggerClassName?: string;
  ariaLabel?: string;
}

export function Menu({ label, items, panelClassName, triggerClassName, ariaLabel }: MenuProps) {
  const [open, setOpen] = useState(false);
  const [nav, setNav] = useState<MenuNavState>(menuNavInitial);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLElement | null>>([]);
  const menuId = useId();

  // Roving focus: the active item owns DOM focus while the menu is open.
  useEffect(() => {
    if (!open || nav.activeIndex < 0) return;
    itemRefs.current[nav.activeIndex]?.focus();
  }, [open, nav.activeIndex]);

  // Clicking/tapping outside dismisses without stealing focus.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setNav(menuNavInitial);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const openMenu = (openKey?: string) => {
    itemRefs.current = [];
    setNav({ ...menuNavInitial, activeIndex: menuInitialIndex(items, openKey) });
    setOpen(true);
  };

  const closeMenu = (returnFocus: boolean) => {
    setOpen(false);
    setNav(menuNavInitial);
    if (returnFocus) triggerRef.current?.focus();
  };

  const activate = (index: number, viaKeyboard: boolean) => {
    const item = items[index];
    if (!item || item.disabled) return;
    setOpen(false);
    setNav(menuNavInitial);
    item.onSelect();
    // Keyboard activation dismisses to the trigger (APG); pointer activation
    // leaves focus where the click naturally put it.
    if (viaKeyboard) triggerRef.current?.focus();
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const outcome = menuKeyNav(items, nav, event.key);
    if (outcome.action.kind === 'none') return;
    event.preventDefault();
    event.stopPropagation();
    if (outcome.action.kind === 'move') {
      setNav(outcome.state);
      return;
    }
    if (outcome.action.kind === 'close') {
      closeMenu(true);
      return;
    }
    activate(outcome.action.index, true);
  };

  const onTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (open) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openMenu(event.key);
    }
    // Enter/Space fire the native click, which toggles the menu open.
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        ref={triggerRef}
        className={cn('btn', triggerClassName)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
      >
        {label}
      </button>
      {open && (
        <MenuPanel
          id={menuId}
          items={items}
          activeIndex={nav.activeIndex}
          ariaLabel={ariaLabel ?? label}
          className={panelClassName}
          itemRefs={itemRefs}
          onKeyDown={onPanelKeyDown}
          onItemActivate={(index) => activate(index, false)}
        />
      )}
    </div>
  );
}
