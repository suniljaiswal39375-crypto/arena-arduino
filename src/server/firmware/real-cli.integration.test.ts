/**
 * Opt-in integration test for the OFFICIAL arduino-cli plus Arduino AVR core.
 * Ordinary zero-config/offline tests deliberately skip this: running against
 * a fake executable is not proof that the real compile service works.
 * CI installs both dependencies before setting SPARKLAB_REAL_ARDUINO_CLI.
 */
import { describe, expect, it } from 'vitest';
import { blinkFixture } from '@/lib/sim/firmware/fixtures/blink';
import { FirmwareEngine } from '@/lib/sim/firmware/engine';
import { parseIntelHex } from '@/lib/sim/firmware/avr';
import { compileSketch, discoverLocalCli } from './compile-service';

const cliPath = process.env.SPARKLAB_REAL_ARDUINO_CLI;

describe.skipIf(!cliPath)('real arduino-cli + Arduino AVR core (opt-in)', () => {
  it('compiles a genuine Uno sketch and executes its output on avr8js', async () => {
    const cli = await discoverLocalCli();
    expect(cli.path).toBe(cliPath);
    expect(cli.version).toMatch(/^1\./);

    const sketch = `void setup() {
      pinMode(13, OUTPUT);
      digitalWrite(13, HIGH);
    }
    void loop() { }
    `;
    const result = await compileSketch({ boardFqbn: 'arduino:avr:uno', sketch, libraries: [] }, cli, 'real-cli');
    expect(result.hex).toMatch(/^:/);
    expect(parseIntelHex(result.hex).addressSpace).toBeGreaterThan(0);
    expect(result.toolchain?.version).toBe(cli.version);

    const { doc, ledId } = blinkFixture();
    const engine = new FirmwareEngine(doc);
    engine.load(doc, result.hex, 'arduino-uno');
    engine.start();
    for (let i = 0; i < 5; i++) engine.run(20);
    expect(engine.snapshot().parts[ledId]).toMatchObject({ kind: 'led', on: true });
  }, 120_000);
});
