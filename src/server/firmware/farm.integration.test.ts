/** Opt-in CI proof: actual Docker image, offline container, same-origin SSE,
 * compiled Arduino sketch and avr8js execution. Skipped without Docker/image. */
import { describe, expect, it } from 'vitest';
import { type AddressInfo } from 'node:net';
import { createFirmwareFarm } from './farm-http';
import { handleFirmwareCompile } from './http';
import { readSseBuild, type BuildMessage } from '@/lib/sim/firmware/build-events';
import { FirmwareEngine } from '@/lib/sim/firmware/engine';
import { blinkFixture } from '@/lib/sim/firmware/fixtures/blink';

const image = process.env.SPARKLAB_TEST_FARM_IMAGE;

describe.skipIf(!image)('real isolated AVR farm (opt-in Docker CI)', () => {
  it('streams a genuine arduino-cli build from a networkless container and runs its HEX', async () => {
    const token = 'ci-only-not-a-production-secret-00000000';
    const server = createFirmwareFarm({ token, image: image!, timeoutMs: 120_000 });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const origin = 'https://lab.example';
      const sketch = `void setup() { pinMode(13, OUTPUT); digitalWrite(13, HIGH); }\nvoid loop() {}\n`;
      const req = new Request(`${origin}/api/firmware-compile`, {
        method: 'POST', headers: { origin, 'content-type': 'application/json', accept: 'text/event-stream' },
        body: JSON.stringify({ boardFqbn: 'arduino:avr:uno', sketch, libraries: [] }),
      });
      const response = await handleFirmwareCompile(req, {
        origin, farm: { url, token }, cli: async () => { throw new Error('unexpected local fallback'); },
      });
      expect(response.status).toBe(200);
      const events: BuildMessage[] = [];
      const hex = await readSseBuild(response, 'arduino:avr:uno', (event) => events.push(event));
      expect(events.some((event) => event.type === 'status')).toBe(true);
      expect(events.some((event) => event.type === 'log')).toBe(true);
      expect(events.map((event) => event.text).join('')).not.toContain(token);
      const { doc, ledId } = blinkFixture();
      const firmware = new FirmwareEngine(doc);
      firmware.load(doc, hex, 'arduino-uno');
      firmware.start();
      for (let i = 0; i < 5; i++) firmware.run(20);
      expect(firmware.snapshot().parts[ledId]).toMatchObject({ kind: 'led', on: true });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 180_000);
});
