import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { Menu, MenuPanel } from './Menu';
import type { MenuItemSpec } from './Menu';

/**
 * Structure tests for the accessible menu primitive. Keyboard behaviour is
 * covered by the pure model tests (lib/ui/menu-model) and the browser job
 * (e2e/menus.spec.ts); here we pin the ARIA contract that cannot regress
 * silently.
 */

const ITEMS: MenuItemSpec[] = [
  { id: 'blink', label: 'Blink', description: 'The classic first circuit', lang: 'en', onSelect: () => {} },
  { id: 'disabled-one', label: 'Locked', disabled: true, onSelect: () => {} },
  { id: 'traffic', label: 'Traffic light', lang: 'hi', onSelect: () => {} },
];

describe('Menu trigger', () => {
  it('renders a menu-button with collapsed state and no dangling controls', () => {
    const html = renderToString(<Menu label="Templates" items={ITEMS} />);
    expect(html).toContain('aria-haspopup="menu"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('aria-controls');
    // Closed: no menu in the tree.
    expect(html).not.toContain('role="menu"');
  });

  it('passes through an explicit aria-label', () => {
    const html = renderToString(<Menu label="T" ariaLabel="Project templates" items={ITEMS} />);
    expect(html).toContain('aria-label="Project templates"');
  });
});

describe('MenuPanel structure', () => {
  it('exposes one vertical menu with menuitem children', () => {
    const html = renderToString(
      <MenuPanel id="m1" items={ITEMS} activeIndex={0} ariaLabel="Templates" />,
    );
    expect(html).toContain('role="menu"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-label="Templates"');
    expect(html.match(/role="menuitem"/g)?.length).toBe(3);
  });

  it('gives the active item the roving tab stop and marks disabled items', () => {
    const html = renderToString(<MenuPanel id="m1" items={ITEMS} activeIndex={0} />);
    expect(html).toContain('tabindex="0"');
    expect(html.match(/tabindex="-1"/g)?.length).toBe(2);
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('data-active=""');
  });

  it('renders labels, descriptions and per-item language attributes', () => {
    const html = renderToString(<MenuPanel id="m1" items={ITEMS} activeIndex={-1} />);
    expect(html).toContain('Blink');
    expect(html).toContain('The classic first circuit');
    expect(html).toContain('lang="en"');
    expect(html).toContain('lang="hi"');
  });

  it('with nothing active, no item takes the tab stop', () => {
    const html = renderToString(<MenuPanel id="m1" items={ITEMS} activeIndex={-1} />);
    expect(html).not.toContain('tabindex="0"');
    expect(html.match(/tabindex="-1"/g)?.length).toBe(3);
  });
});
