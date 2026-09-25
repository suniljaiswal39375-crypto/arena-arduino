import { expect, test } from '@playwright/test';

/**
 * The accessible toolbar menus (WAI-ARIA menu-button pattern): keyboard
 * navigation, type-ahead, Escape dismissal with focus return, and pointer
 * outside-click dismissal. The navigation model itself is covered by
 * src/lib/ui/menu-model.test.ts; this spec proves it survives the DOM.
 */

const templatesMenu = () => {
  return {
    triggerName: 'Templates',
    firstItem: 'Blink',
    typeAheadTarget: 'Streetlight', // 's' skips past Blink/Button to Streetlight
    typeAheadKey: 's',
  };
};

test('toolbar menus support the full keyboard contract', async ({ page }) => {
  const m = templatesMenu();
  await page.goto('/builder');

  const trigger = page.getByRole('button', { name: m.triggerName, exact: true });
  await trigger.focus();

  // ArrowDown opens the menu and focuses the first item.
  await page.keyboard.press('ArrowDown');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  const firstItem = menu.getByRole('menuitem', { name: new RegExp(m.firstItem) });
  await expect(firstItem).toBeFocused();

  // ArrowDown moves to the next item; Home returns to the first.
  await page.keyboard.press('ArrowDown');
  const secondItem = menu.getByRole('menuitem', { name: 'Button and LED' });
  await expect(secondItem).toBeFocused();
  await page.keyboard.press('Home');
  await expect(firstItem).toBeFocused();

  // Escape dismisses and returns focus to the trigger.
  await page.keyboard.press('Escape');
  await expect(menu).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('type-ahead jumps to the matching template and Enter loads it', async ({ page }) => {
  const m = templatesMenu();
  await page.goto('/builder');

  const trigger = page.getByRole('button', { name: m.triggerName, exact: true });
  await trigger.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();

  await page.keyboard.press(m.typeAheadKey);
  const target = menu.getByRole('menuitem', { name: new RegExp(m.typeAheadTarget) });
  await expect(target).toBeFocused();

  // Enter activates: the menu closes and the template becomes the project.
  await page.keyboard.press('Enter');
  await expect(menu).not.toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue(m.typeAheadTarget);
});

test('clicking outside the menu dismisses it', async ({ page }) => {
  const m = templatesMenu();
  await page.goto('/builder');

  await page.getByRole('button', { name: m.triggerName, exact: true }).click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();

  // Click somewhere neutral on the canvas region.
  await page.mouse.click(720, 600);
  await expect(menu).not.toBeVisible();
});
