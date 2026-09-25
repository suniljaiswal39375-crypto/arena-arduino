import { expect, test } from '@playwright/test';

/**
 * Exercise inspect-bench instruments (oscilloscope and multimeter) in the browser
 * and verify that transient waveform traces never leak into localStorage.
 */
test('navigates inspect bench instruments and verifies zero persistence leaks', async ({ page }) => {
  await page.goto('/builder');

  // 1. Open Scope tab
  const scopeTab = page.getByRole('button', { name: 'Scope', exact: true });
  await expect(scopeTab).toBeVisible();
  await scopeTab.click();

  await expect(page.getByRole('img', { name: 'Oscilloscope display reticle' })).toBeVisible();
  await expect(page.getByText('Auto-measurements')).toBeVisible();
  await expect(page.getByLabel('Channel 1 Probe')).toBeVisible();
  await expect(page.getByLabel('Timebase per division')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hold', exact: true })).toBeVisible();

  // 2. Open Multimeter tab
  const dmmTab = page.getByRole('button', { name: 'Multimeter', exact: true });
  await expect(dmmTab).toBeVisible();
  await dmmTab.click();

  await expect(page.getByLabel('Probe A positive node')).toBeVisible();
  await expect(page.getByLabel('Probe B negative node')).toBeVisible();
  // The dial button's accessible name carries its Ω symbol; anchoring it keeps
  // the palette's "…whose resistance rises…" description out of the match.
  const resistanceMode = page.getByRole('button', { name: /^ΩResistance$/ });
  await expect(resistanceMode).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continuity' })).toBeVisible();

  // Switch to Resistance mode
  await resistanceMode.click();
  await expect(resistanceMode).toHaveAttribute('aria-pressed', 'true');
  // The starter blink circuit has no conductive D13→GND path, so the solver
  // reports an honest open loop instead of the DC voltage shown before.
  await expect(page.getByText('O.L', { exact: true })).toBeVisible();

  // 3. Verify no trace memory leaked into localStorage
  const storageDump = await page.evaluate(() => Object.values(localStorage).join('\n'));
  expect(storageDump).not.toContain('samples');
  expect(storageDump).not.toContain('ch1VoltsPerDiv');
  expect(storageDump).not.toContain('ScopeTrace');
});
