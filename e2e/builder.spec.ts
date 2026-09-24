import { expect, test } from '@playwright/test';

import { disconnect } from './helpers';

test('mission link loads BOM and saved work survives a plain builder reload', async ({ page }) => {
  await page.goto('/builder?mission=traffic-light');
  await expect(page.getByRole('button', { name: 'Keyboard wiring & connections' })).toBeVisible();
  await page.getByRole('button', { name: 'Keyboard wiring & connections' }).click();
  await expect(page.getByText('Placed components', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Project name' }).fill('My saved traffic circuit');
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  const types = await page.evaluate(() => {
    const id = localStorage.getItem('sparklab:last-project');
    const doc = JSON.parse(localStorage.getItem(`sparklab:project:${id}`)!);
    return doc.diagram.parts.map((p: { type: string }) => p.type).sort();
  });
  expect(types).toEqual(['arduino-uno', 'led-rgb-module', 'pushbutton']);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('My saved traffic circuit');
  await page.goto('/builder');
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('My saved traffic circuit');
  await expect(page.getByRole('button', { name: 'Mission', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Templates', exact: true }).click();
  await page.getByRole('button', { name: /^Blink The hello world/ }).click();
  await expect(page.getByRole('button', { name: 'Mission', exact: true })).toHaveCount(0);
});

test('connect pins with native controls, then undo and redo', async ({ page }) => {
  await page.goto('/builder');
  await page.getByRole('button', { name: 'Keyboard wiring & connections' }).click();
  const from = page.getByLabel('From pin');
  const to = page.getByLabel('To pin');
  const choose = async (part: string, pin: string) => from.locator('option').evaluateAll((options, args) => {
    const found = options.find(option => {
      const value = (option as HTMLOptionElement).value;
      if (!value) return false;
      const ref = JSON.parse(value);
      return ref.part === args.part && ref.pin === args.pin;
    });
    return (found as HTMLOptionElement | undefined)?.value ?? '';
  }, { part, pin });
  await from.selectOption(await choose('uno', 'D12'));
  await to.selectOption(await choose('uno', 'D11'));
  await page.getByRole('button', { name: 'Connect pins' }).focus();
  await page.keyboard.press('Enter');
  const remove = page.getByRole('button', { name: 'Remove wire uno D12 to uno D11', exact: true });
  await expect(remove).toBeVisible();
  await page.getByRole('button', { name: /Undo/ }).click();
  await expect(remove).toHaveCount(0);
  await page.getByRole('button', { name: /Redo/ }).click();
  await expect(remove).toBeVisible();
});

test('cached builder opens and runs without a network connection', async ({ page, context }) => {
  await page.goto('/builder');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await disconnect(context);
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Project name' })).toBeVisible();
  await expect(page.getByText(/Offline —/)).toBeVisible();
  const clock = page.getByText(/^t=\d/);
  const firstTime = await clock.innerText();
  await expect.poll(() => clock.innerText()).not.toBe(firstTime);
  expect(await page.evaluate(() => fetch('/uncached-network-probe', { cache: 'no-store' }).then(() => false).catch(() => true))).toBe(true);
  await page.getByRole('button', { name: 'Keyboard wiring & connections' }).click();
  await expect(page.getByText('Placed components', { exact: true })).toBeVisible();
  await context.setOffline(false);
});


test('client-side page visits are cached as HTML and unknown pages have an offline fallback', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.getByRole('link', { name: 'Missions', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Missions', exact: true })).toBeVisible();
  await page.waitForFunction(async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('sparklab-offline-') && await (await caches.open(name)).match('/missions')) return true;
    }
    return false;
  });
  await disconnect(context);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Missions', exact: true })).toBeVisible();
  await page.goto('/parts/not-visited-before');
  await expect(page.getByRole('heading', { name: 'This page is not available offline yet' })).toBeVisible();
});
