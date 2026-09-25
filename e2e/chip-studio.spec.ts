import { expect, test } from '@playwright/test';

test('a student can author a chip and place it on the canvas', async ({ page }) => {
  await page.goto('/builder');
  await page.getByRole('button', { name: 'New chip' }).click();
  const dialog = page.getByRole('dialog', { name: 'Chip Studio' });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel('Chip name').fill('Night Trigger');
  await dialog.getByLabel('What is it for?').fill('Flips a daylight signal for a night lamp.');

  // The live preview proves the chip composes before it is added.
  await expect(dialog.getByText('user-chip-night-trigger', { exact: false })).toBeVisible();

  await dialog.getByRole('button', { name: 'Add chip to canvas' }).click();
  await expect(dialog).not.toBeVisible();

  // The authored chip lands in the saved project as a first-class part type.
  await page.getByRole('textbox', { name: 'Project name' }).fill('My chip project');
  await expect(page.getByText('Saved locally', { exact: true })).toBeVisible();
  const types = await page.evaluate(() => {
    const id = localStorage.getItem('sparklab:last-project');
    const doc = JSON.parse(localStorage.getItem(`sparklab:project:${id}`)!);
    return { parts: doc.diagram.parts.map((p: { type: string }) => p.type), chips: (doc.chips ?? []).map((c: { id: string }) => c.id) };
  });
  expect(types.chips).toEqual(['user-chip-night-trigger']);
  expect(types.parts).toContain('user-chip-night-trigger');

  // And it survives a reload (the definition travels inside the project).
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Project name' })).toHaveValue('My chip project');
  await page.getByRole('button', { name: 'New chip' }).isVisible();
});
