import { expect, test } from '@playwright/test';

test('the 3D workbench opens over the builder and closes cleanly', async ({ page }) => {
  await page.goto('/builder');
  // The scene loads lazily; the dialog must appear with the canvas inside.
  await page.getByRole('button', { name: '3D', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '3D workbench' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('canvas')).toBeVisible();
  // The honesty note ships with the view.
  await expect(dialog.getByText(/viewing aid/i)).toBeVisible();
  await page.getByRole('button', { name: 'Close the 3D view' }).click();
  await expect(dialog).not.toBeVisible();
});

test('photo trace adds a session-only underlay with honest wording', async ({ page }) => {
  await page.goto('/builder');
  // The file input itself is visually hidden behind its label, so the test
  // targets it through the label association Playwright resolves for files.
  await page.getByLabel('Photo trace').setInputFiles({
    name: 'bench.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    ),
  });
  await expect(page.getByText(/nothing is recognized/i)).toBeVisible();
  await page.getByRole('button', { name: 'Remove photo' }).click();
  await expect(page.getByText(/nothing is recognized/i)).not.toBeVisible();
});
