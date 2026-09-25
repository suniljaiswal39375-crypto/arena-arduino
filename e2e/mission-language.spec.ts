import { expect, test } from '@playwright/test';
import { disconnect } from './helpers';

test('mission search accepts either language and preserves the active level filter', async ({ page }) => {
  await page.goto('/missions');
  await page.getByLabel('Language / भाषा').selectOption('hi');
  await expect(page.getByRole('heading', { name: 'अभ्यास', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'अभ्यास खोजें', exact: true }).fill('स्ट्रीटलाइट');
  await expect(page.locator('main h2')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'स्मार्ट स्ट्रीटलाइट' })).toBeVisible();
  await page.getByRole('button', { name: 'उन्नत', exact: true }).click();
  await expect(page.locator('main h2')).toHaveCount(0);
  await page.getByRole('button', { name: 'शुरुआती', exact: true }).click();
  await expect(page.locator('main h2')).toHaveCount(1);
  await page.getByLabel('Language / भाषा').selectOption('en');
  await expect(page.getByRole('textbox', { name: 'Search missions', exact: true })).toHaveValue('स्ट्रीटलाइट');
  await expect(page.getByRole('heading', { name: 'Smart Streetlight' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search missions', exact: true }).fill('STREETLIGHT');
  await expect(page.locator('main h2')).toHaveCount(1);
});

test('Hindi lesson displays instructions, hints, goals, curriculum and canonical start link', async ({ page }) => {
  await page.goto('/missions/traffic-light');
  await page.getByLabel('Language / भाषा').selectOption('hi');
  await expect(page.getByRole('heading', { name: 'ट्रैफिक लाइट का क्रम' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'आप क्या सीखेंगे' })).toBeVisible();
  await expect(page.getByText('R को D9, G को D10, B को D11 और मॉड्यूल GND को GND से जोड़ें।')).toBeVisible();
  const details = page.locator('main details').first();
  await details.locator('summary').click();
  await expect(details.getByText('चार पिन वाला RGB मॉड्यूल Actuator श्रेणी में है।')).toBeVisible();
  await page.getByLabel('Language / भाषा').selectOption('en');
  await expect(details.getByText('The RGB module is an Actuator with four pins.')).toBeVisible();
  await page.getByLabel('Language / भाषा').selectOption('hi');
  await expect(details).toHaveAttribute('open', '');
  await expect(page.getByText('कक्षा 10, अध्याय 12: विद्युत — विद्युत परिपथ और परिपथ आरेख')).toBeVisible();
  await expect(page.getByRole('link', { name: 'अभ्यास शुरू करें' })).toHaveAttribute('href', '/builder?mission=traffic-light');
  await page.getByRole('link', { name: /तीन मोड वाला लैम्प/ }).click();
  await expect(page.getByRole('heading', { name: 'तीन मोड वाला लैम्प' })).toBeVisible();
  await expect(page.locator('main')).toHaveAttribute('lang', 'hi');
});

test('switching lesson language preserves hint state, code and canonical confirmation keys', async ({ page }) => {
  await page.goto('/builder?mission=smart-streetlight');
  const rail = page.getByRole('complementary', { name: 'Guidance & inspector' });
  await rail.getByRole('button', { name: 'Hint', exact: true }).first().click();
  await page.getByLabel('Language / भाषा').selectOption('hi');
  const hindiRail = page.getByRole('complementary', { name: 'मार्गदर्शन और निरीक्षक' });
  await expect(hindiRail.getByRole('heading', { name: 'स्मार्ट स्ट्रीटलाइट' })).toBeVisible();
  await expect(hindiRail.getByRole('button', { name: 'संकेत', exact: true }).first()).toHaveAttribute('aria-expanded', 'true');
  await expect(hindiRail.getByText('घटक सूची की Microcontroller श्रेणी में Arduino Uno चुनें।')).toBeVisible();
  await hindiRail.getByRole('button', { name: 'मैंने जांच लिया' }).click();
  await expect(page.getByText('इस ब्राउज़र में सहेजा गया', { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => {
    const id = localStorage.getItem('sparklab:last-project');
    return JSON.parse(localStorage.getItem(`sparklab:project:${id}`)!);
  });
  expect(saved.provenance.confirmedSteps).toEqual(['I saw the lamp switch on when the light level dropped.']);
  await page.getByLabel('Language / भाषा').selectOption('en');
  await expect(rail.getByRole('heading', { name: 'Smart Streetlight' })).toBeVisible();
  await expect(rail.getByRole('button', { name: 'Confirm myself' })).toHaveCount(0);
  await page.reload();
  await expect(rail.getByRole('button', { name: 'Confirm myself' })).toHaveCount(0);
  const restored = await page.evaluate(() => {
    const id = localStorage.getItem('sparklab:last-project');
    return JSON.parse(localStorage.getItem(`sparklab:project:${id}`)!);
  });
  expect(restored.files).toEqual(saved.files);
  expect(restored.diagram).toEqual(saved.diagram);
  expect(restored.provenance).toEqual(saved.provenance);
});

test('cached Hindi lesson and its hints open offline', async ({ page, context }) => {
  await page.goto('/missions/thermostat-hysteresis');
  await page.getByLabel('Language / भाषा').selectOption('hi');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(async () => {
    if (!navigator.serviceWorker.controller) return false;
    for (const key of await caches.keys()) {
      if (key.startsWith('sparklab-offline-') && await (await caches.open(key)).match('/missions/thermostat-hysteresis')) return true;
    }
    return false;
  });
  await disconnect(context);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'हिस्टेरेसिस वाला थर्मोस्टैट' })).toBeVisible();
  const hint = page.locator('main details').nth(3);
  await hint.locator('summary').click();
  await expect(hint.getByText('दोनों सीमाओं के बीच के अंतर को dead band कहते हैं।')).toBeVisible();
});

test('Hindi mission selection on a phone loads the same canonical workspace', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/builder');
  await page.getByLabel('Language / भाषा').selectOption('hi');
  await page.getByRole('button', { name: 'अभ्यास', exact: true }).click();
  await page.getByRole('menuitem', { name: /ट्रैफिक लाइट का क्रम/ }).click();
  await page.getByRole('button', { name: 'मार्गदर्शन और निरीक्षक', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'ट्रैफिक लाइट का क्रम' })).toBeVisible();
  await page.getByRole('button', { name: 'संकेत', exact: true }).first().click();
  await expect(page.getByText('चार पिन वाला RGB मॉड्यूल Actuator श्रेणी में है।')).toBeVisible();
  const provenance = await page.evaluate(() => {
    const id = localStorage.getItem('sparklab:last-project');
    return JSON.parse(localStorage.getItem(`sparklab:project:${id}`)!).provenance;
  });
  expect(provenance.mission).toBe('traffic-light');
});

test('long code hints wrap inside phone lesson and tracker panels', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/missions/interrupt-counter');
  await page.getByLabel('Language / भाषा').selectOption('hi');
  const hint = page.locator('main details').nth(3);
  await hint.locator('summary').click();
  await expect(hint).toHaveAttribute('open', '');
  expect(await hint.locator('p').first().evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.getByRole('link', { name: 'अभ्यास शुरू करें' }).click();
  await page.getByRole('button', { name: 'मार्गदर्शन और निरीक्षक', exact: true }).click();
  await page.getByRole('button', { name: 'संकेत', exact: true }).nth(3).click();
  const code = page.getByText('attachInterrupt(digitalPinToInterrupt(buttonPin), onPress, FALLING);', { exact: true });
  await expect(code).toBeVisible();
  expect(await code.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
