import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';

/** Wire real native builder controls; do not inject a fake waveform/snapshot. */
test('wires the logic analyzer, captures blink and downloads its VCD without persisting the trace', async ({ page }) => {
  await page.goto('/builder');
  await page.getByRole('button', { name: 'Keyboard wiring & connections' }).click();
  const panel = page.getByRole('region', { name: 'Circuit commands and connections' });
  await panel.getByRole('combobox', { name: 'Component', exact: true }).selectOption('emu-logic-analyzer');
  await panel.getByRole('button', { name: 'Add component' }).click();
  await expect(panel.getByRole('status')).toContainText('Logic Analyzer');

  const from = panel.getByRole('combobox', { name: 'From pin' });
  const to = panel.getByRole('combobox', { name: 'To pin' });
  const choose = async (label: string, pin: string) => from.locator('option').evaluateAll((options, args) => {
    const option = options.find((item) => {
      if (!(item instanceof HTMLOptionElement) || !item.value) return false;
      const ref = JSON.parse(item.value) as { part: string; pin: string };
      return item.label.includes(args.label) && ref.pin === args.pin;
    });
    return (option as HTMLOptionElement | undefined)?.value ?? '';
  }, { label, pin });

  for (const [boardPin, probePin] of [['D13', 'D0'], ['GND', 'GND']] as const) {
    await from.selectOption(await choose('Arduino Uno', boardPin));
    await to.selectOption(await choose('Logic Analyzer', probePin));
    await panel.getByRole('button', { name: 'Connect pins' }).click();
    await expect(panel.getByRole('status')).toContainText('Wire connected');
  }

  await page.getByRole('button', { name: 'Logic', exact: true }).click();
  await expect(page.getByText('Latest observed changes')).toBeVisible();
  await expect(page.getByRole('cell', { name: '1', exact: true }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Export VCD' })).toBeEnabled();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export VCD' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.vcd$/);
  const vcd = await readFile((await download.path())!, 'utf8');
  expect(vcd).toContain('$timescale 1ns $end');
  expect(vcd).toContain('$var wire 1 ! D0 $end');
  expect(vcd).toMatch(/#[0-9]+\n1!/);
  expect(await page.evaluate(() => Object.values(localStorage).join('\n'))).not.toContain('logicAnalyzers');
});
