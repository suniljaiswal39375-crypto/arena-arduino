import { expect, test } from '@playwright/test';
import { disconnect } from './helpers';

test('Hindi controls persist while the saved project and sketch stay unchanged', async ({ page }) => {
  await page.goto('/builder');
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  const readProject = () => page.evaluate(() => {
    const id = localStorage.getItem('sparklab:last-project');
    return JSON.parse(localStorage.getItem(`sparklab:project:${id}`)!);
  });
  const original = await readProject();
  await page.getByLabel('Language / भाषा').selectOption('hi');
  await expect(page.getByRole('textbox', { name: 'परियोजना का नाम' })).toHaveValue(original.name);
  await expect(page.getByText('मुख्य नियंत्रण हिंदी में हैं।', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'कीबोर्ड से तार जोड़ें' }).click();
  await expect(page.getByRole('button', { name: 'पिन जोड़ें' })).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('lang', 'hi');
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'परियोजना का नाम' })).toHaveValue(original.name);
  const restored = await readProject();
  expect(restored.files).toEqual(original.files);
  expect(restored.diagram).toEqual(original.diagram);
  await page.getByLabel('Language / भाषा').selectOption('en');
  await expect(page.getByRole('textbox', { name: 'Project name' })).toBeVisible();
});

test('language switching works with blocked browser storage', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } });
  });
  await page.goto('/builder');
  await page.getByLabel('Language / भाषा').selectOption('hi');
  await expect(page.getByRole('textbox', { name: 'परियोजना का नाम' })).toBeVisible();
  await expect(page.getByText('ब्राउज़र का संग्रहण उपलब्ध नहीं है', { exact: false })).toBeVisible();
  await page.getByLabel('Language / भाषा').selectOption('en');
  await expect(page.getByRole('textbox', { name: 'Project name' })).toBeVisible();
});

test('site navigation language persists across a full page navigation', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Language / भाषा').selectOption('hi');
  await expect(page.getByRole('navigation', { name: 'मुख्य नेविगेशन' })).toBeVisible();
  await page.getByRole('link', { name: 'अभ्यास', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Missions', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'मुख्य नेविगेशन' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('header')).toHaveAttribute('lang', 'hi');
});

for (const viewport of [{ width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1024, height: 768 }]) {
  test(`mission guidance and wiring are reachable at ${viewport.width}px`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto('/builder?mission=traffic-light');
    const toggle = page.getByRole('button', { name: 'Guidance & inspector', exact: true });
    await toggle.click();
    const panel = page.getByRole('complementary', { name: 'Guidance & inspector' });
    await expect(panel).toBeFocused();
    await expect(panel.getByRole('heading', { name: 'Traffic Light Sequencer' })).toBeVisible();
    await panel.getByRole('button', { name: 'Hint', exact: true }).first().click();
    await expect(panel.getByRole('button', { name: 'Hint', exact: true }).first()).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(toggle).toBeFocused();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await page.getByRole('button', { name: 'Keyboard wiring & connections' }).click();
    await expect(page.getByLabel('From pin')).toBeVisible();
    await page.getByLabel('Language / भाषा').selectOption('hi');
    await page.getByRole('button', { name: 'मार्गदर्शन और निरीक्षक' }).click();
    await expect(page.getByRole('button', { name: 'संकेत', exact: true }).first()).toBeVisible();
    const toolbar = page.getByRole('region', { name: 'लैब नियंत्रण' });
    for (const button of await toolbar.getByRole('button').all()) {
      const bounds = await button.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
    const panelBounds = await page.getByRole('complementary', { name: 'मार्गदर्शन और निरीक्षक' }).boundingBox();
    expect(panelBounds?.width).toBeLessThanOrEqual(viewport.width);
    expect(panelBounds!.y + panelBounds!.height).toBeLessThanOrEqual(viewport.height + 1);
  });
}


test('language changes synchronize between tabs', async ({ page, context }) => {
  await page.goto('/');
  const other = await context.newPage();
  await other.goto('/');
  await page.getByLabel('Language / भाषा').selectOption('hi');
  await expect(other.getByRole('navigation', { name: 'मुख्य नेविगेशन' })).toBeVisible();
  await other.getByLabel('Language / भाषा').selectOption('en');
  await expect(page.getByRole('navigation', { name: 'Main', exact: true })).toBeVisible();
});

test('Hindi controls and bundled Devanagari font remain available offline', async ({ page, context }) => {
  await page.goto('/builder');
  await page.getByLabel('Language / भाषा').selectOption('hi');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await disconnect(context);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'परियोजना का नाम' })).toBeVisible();
  await page.getByRole('button', { name: 'कीबोर्ड से तार जोड़ें' }).click();
  await expect(page.getByRole('button', { name: 'पिन जोड़ें' })).toBeVisible();
  const fontReady = await page.evaluate(async () => {
    const faces = await document.fonts.load('400 16px "Noto Sans Devanagari"', 'हिंदी');
    return faces.length > 0 && faces.every(f => f.status === 'loaded');
  });
  expect(fontReady).toBe(true);
});


test('phone export and mission menus stay on screen and close with Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/builder');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const exportItem = page.getByRole('button', { name: /^Wokwi project/ });
  await expect(exportItem).toBeVisible();
  const bounds = await exportItem.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  await exportItem.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Export', exact: true })).toBeFocused();
  await expect(exportItem).toHaveCount(0);
  await page.getByRole('button', { name: 'Missions', exact: true }).click();
  const firstMission = page.getByRole('button', { name: /Smart Streetlight/ }).first();
  await expect(firstMission).toBeVisible();
  await firstMission.focus();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Missions', exact: true })).toBeFocused();
});
