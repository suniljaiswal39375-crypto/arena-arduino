import { expect, test, type Page } from '@playwright/test';

/**
 * Remote selection ghosts across two live editors. Co-Lab local rooms ride
 * on BroadcastChannel, so both pages must share one browser context (same
 * origin, same localStorage project). The feature is opt-in
 * (NEXT_PUBLIC_FEATURE_MULTIPLAYER at build time); CI builds it on for the
 * e2e job, and the probe skips gracefully on flag-off builds.
 */
async function join(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Co-Lab', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill(name);
  await page.getByRole('button', { name: 'Join room' }).click();
  await expect(page.getByText('Editing now')).toBeVisible();
}

test('a peer\'s live selection shows as a named halo in the other editor', async ({ context, page }) => {
  await page.goto('/builder');
  const colabTab = page.getByRole('button', { name: 'Co-Lab', exact: true });
  test.skip((await colabTab.count()) === 0, 'Co-Lab is not enabled in this build');

  const other = await context.newPage();
  await other.goto('/builder');

  await join(page, 'Asha');
  await join(other, 'Ravi');

  // Each editor sees the other in the peer list.
  await expect(page.getByRole('listitem').filter({ hasText: 'Ravi' })).toBeVisible();
  await expect(other.getByRole('listitem').filter({ hasText: 'Asha' })).toBeVisible();

  // Asha selects a part; Ravi's canvas draws her halo + name tag.
  await page.locator('g.cursor-move').nth(2).click();
  const tag = other.locator('main svg text', { hasText: 'Asha' });
  await expect(tag).toBeVisible();

  // Deselecting removes the ghost.
  await page.locator('main svg').click({ position: { x: 8, y: 8 } });
  await expect(tag).toHaveCount(0);

  await other.close();
});
