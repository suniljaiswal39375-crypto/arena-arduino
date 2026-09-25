import { expect, test, type Page } from '@playwright/test';

/**
 * Remote code cursors across two live editors. Same setup as the selection
 * ghosts spec: local rooms ride on BroadcastChannel (one browser context),
 * the feature is opt-in at build time, and the probe skips flag-off builds.
 * Ghost carets only render in Monaco; the offline fallback textarea honestly
 * shows nothing, so this test requires the local Monaco bundle to load.
 */
async function join(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Co-Lab', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill(name);
  await page.getByRole('button', { name: 'Join room' }).click();
  await expect(page.getByText('Editing now')).toBeVisible();
}

test('a peer\'s code caret shows as a ghost cursor in the other editor', async ({ context, page }) => {
  await page.goto('/builder');
  const colabTab = page.getByRole('button', { name: 'Co-Lab', exact: true });
  test.skip((await colabTab.count()) === 0, 'Co-Lab is not enabled in this build');

  const other = await context.newPage();
  await other.goto('/builder');

  await join(page, 'Asha');
  await join(other, 'Ravi');

  // Both editors must be running Monaco (the fallback can't draw cursors).
  await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 15000 });
  await expect(other.locator('.monaco-editor')).toBeVisible({ timeout: 15000 });

  // Asha moves her caret in the sketch editor and types.
  await page.locator('.monaco-editor').first().click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' // Asha was here');

  // Ravi sees her ghost caret in his own editor.
  await expect(other.locator('.peer-cursor')).toBeVisible({ timeout: 5000 });

  await other.close();
});
