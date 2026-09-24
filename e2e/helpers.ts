import type { BrowserContext } from '@playwright/test';

export async function disconnect(context: BrowserContext) {
  await context.setOffline(true);
  // CDP offline emulation can leave a service-worker target online.
  for (const worker of context.serviceWorkers()) await worker.evaluate(() => {
    globalThis.fetch = () => Promise.reject(new TypeError('Test network disconnected'));
  });
}
