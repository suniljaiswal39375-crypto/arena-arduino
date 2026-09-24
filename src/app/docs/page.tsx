import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { ALL_PARTS } from '@/lib/parts';
import { MISSIONS } from '@/lib/missions/missions';

const SHORTCUTS: Array<[string, string]> = [
  ['Click a pin, then a target pin', 'Draw a wire'],
  ['Escape', 'Cancel the wire you are drawing'],
  ['R', 'Rotate the selected part'],
  ['Delete / Backspace', 'Remove the selection'],
  ['Space + drag', 'Pan the canvas'],
  ['Wheel', 'Zoom'],
  ['0-9, C, L, M, P, Y', 'Set the wire colour for the next wire'],
  ['Ctrl/Cmd + Z', 'Undo'],
  ['Ctrl/Cmd + Shift + Z', 'Redo'],
  ['Ctrl/Cmd + Enter', 'Run the simulation'],
];

const SUPPORTED = [
  'setup() and loop(), and your own functions',
  'int, long, float, char, bool, byte, unsigned types, arrays and String',
  'if / else, switch, for, while, do-while, break, continue, return',
  'pinMode, digitalWrite, digitalRead, analogRead, analogWrite',
  'millis, micros, delay, delayMicroseconds, pulseIn',
  'tone and noTone',
  'map, constrain, min, max, abs, pow, sqrt, random, randomSeed',
  'Serial.print, println, write, available, read, peek, readString, readStringUntil, parseInt, parseFloat, and HEX/DEC/OCT/BIN formatting',
  'String methods: length, trim, indexOf, substring, charAt, toUpperCase, toLowerCase, toInt, toFloat, startsWith, equals and more',
  'C arithmetic: integer division truncates, assignment converts to the declared type, floats print with two decimals',
  'Servo, LiquidCrystal_I2C, Adafruit_SSD1306, Stepper and DHT libraries',
  'attachInterrupt with RISING, FALLING or CHANGE, fired by button presses and sensor edges, even during delay()',
];

const NOT_SUPPORTED = [
  'FreeRTOS tasks, threads and ISRs on a real scheduler',
  'Direct register manipulation such as PORTB or TCCR0A',
  'Real I2C and SPI bus timing (the models work at the API level)',
  'Pointers, malloc, new and delete',
  'Classes you define yourself',
  'AVR cycle-accurate timing (use the firmware emulator for that)',
];

export default function DocsPage() {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main id="main" className="mx-auto max-w-[900px] px-5 py-10">
        <h1 className="text-2xl font-semibold tracking-tight">Documentation</h1>
        <p className="mt-1.5 text-[13.5px] text-[var(--color-text-dim)]">
          Everything you need to build, run and understand a circuit.
        </p>

        <nav aria-label="On this page" className="panel mt-6 p-4">
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5 text-[13px]">
            {[
              ['getting-started', 'Getting started'],
              ['engines', 'The two engines'],
              ['language', 'What the runtime supports'],
              ['diagnostics', 'Diagnostics and findings'],
              ['shortcuts', 'Keyboard shortcuts'],
              ['formats', 'File formats and Wokwi'],
              ['scenarios', 'Automation scenarios'],
              ['cli', 'Command line and CI'],
              ['chips', 'Custom chips'],
              ['chaos', 'Chaos Lab'],
            ].map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="text-[var(--color-accent)] hover:underline">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <section id="getting-started" className="mt-10">
          <h2 className="text-[18px] font-semibold">Getting started</h2>
          <ol className="mt-3 space-y-2 text-[13.5px] leading-relaxed text-[var(--color-text-dim)]">
            <li>
              <strong className="text-[var(--color-text)]">1. Open the builder</strong> and drop an
              Arduino Uno on the canvas from the palette on the left.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">2. Add a part</strong> - an LED, a sensor
              or a relay - and wire it by clicking one pin and then another.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">3. Press Run.</strong> The sketch compiles
              and the simulation starts. Watch the Serial, Plotter and Inputs panels at the bottom.
            </li>
            <li>
              <strong className="text-[var(--color-text)]">4. Start a mission</strong> if you would
              rather be guided:{' '}
              <Link href="/missions" className="text-[var(--color-accent)] hover:underline">
                there are {MISSIONS.length}
              </Link>
              , and their steps check themselves against your circuit.
            </li>
          </ol>
        </section>

        <section id="engines" className="mt-10">
          <h2 className="text-[18px] font-semibold">The two engines</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="panel p-4">
              <h3 className="text-[14px] font-semibold">Functional runtime</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-text-dim)]">
                A real tokenizer, parser and interpreter for an Arduino C++ subset, running with a
                virtual clock. It starts instantly and covers every one of the {ALL_PARTS.length}{' '}
                parts. It does not model cycle timing.
              </p>
            </div>
            <div className="panel p-4">
              <h3 className="text-[14px] font-semibold">Firmware emulation</h3>
              <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-text-dim)]">
                Your sketch is compiled with a real toolchain and executed instruction by instruction
                on an emulated core. This is the engine for exact timing, real bus protocols and
                debugging.
              </p>
            </div>
          </div>
          <p className="mt-3 text-[13px] text-[var(--color-text-dim)]">
            Every part carries a badge: <span className="chip fid-exact">EXACT</span>{' '}
            <span className="chip fid-model">MODEL</span>{' '}
            <span className="chip fid-visual">VISUAL</span>{' '}
            <span className="chip fid-export">EXPORT</span>. The badge never lies about what is
            being simulated.
          </p>
        </section>

        <section id="language" className="mt-10">
          <h2 className="text-[18px] font-semibold">What the runtime supports</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div className="panel p-4">
              <h3 className="text-[13.5px] font-semibold text-[var(--color-ok)]">Supported</h3>
              <ul className="mt-2 space-y-1 text-[13px] text-[var(--color-text-dim)]">
                {SUPPORTED.map((s) => (
                  <li key={s}>— {s}</li>
                ))}
              </ul>
            </div>
            <div className="panel p-4">
              <h3 className="text-[13.5px] font-semibold text-[var(--color-warn)]">
                Not supported yet
              </h3>
              <ul className="mt-2 space-y-1 text-[13px] text-[var(--color-text-dim)]">
                {NOT_SUPPORTED.map((s) => (
                  <li key={s}>— {s}</li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-3 text-[13px] text-[var(--color-text-dim)]">
            Anything unsupported produces a clear message naming the feature, rather than silently
            doing nothing.
          </p>
        </section>

        <section id="diagnostics" className="mt-10">
          <h2 className="text-[18px] font-semibold">Diagnostics and findings</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--color-text-dim)]">
            The electrical rule check runs continuously as you wire. Each finding gives you a
            one-sentence explanation, the physics behind it, a concrete fix, and where relevant the
            curriculum topic it teaches.
          </p>
          <div className="panel mt-3 overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[11.5px] uppercase tracking-wide text-[var(--color-text-faint)]">
                  <th className="px-3 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Meaning</th>
                </tr>
              </thead>
              <tbody className="text-[var(--color-text-dim)]">
                {[
                  ['no-board', 'Nothing is running your sketch yet'],
                  ['unwired-part', 'A part is on the canvas but no wires touch it'],
                  ['missing-required-pin', 'Power or ground is missing from a module'],
                  ['missing-signal-pin', 'The data line never reaches the board'],
                  ['missing-return-path', 'An output has no route back to ground'],
                  ['floating-net', 'A pin is connected to nothing'],
                  ['reverse-polarity', 'An LED or module is wired backwards'],
                  ['short-circuit', 'Power and ground are joined on one net'],
                  ['missing-pull-up', 'An input may float when nothing drives it'],
                  ['pin-conflict', 'Two board pins are tied to the same net'],
                  ['power-budget-exceeded', 'The 5 V rail is asked for more than it can give'],
                  ['thermal-overload', 'Too much current for an LED, a pin or a part'],
                  ['level-mismatch', 'A 3.3 V part is on a 5 V rail'],
                  ['unsupported-part-in-engine', 'This part needs the firmware emulator'],
                ].map(([code, meaning]) => (
                  <tr key={code} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="mono px-3 py-1.5 text-[var(--color-text)]">{code}</td>
                    <td className="px-3 py-1.5">{meaning}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="shortcuts" className="mt-10">
          <h2 className="text-[18px] font-semibold">Keyboard shortcuts</h2>
          <div className="panel mt-3 overflow-hidden">
            <table className="w-full text-[13px]">
              <tbody>
                {SHORTCUTS.map(([key, action]) => (
                  <tr key={key} className="border-b border-[var(--color-border)] last:border-0">
                    <td className="mono w-[45%] px-3 py-1.5 text-[var(--color-text)]">{key}</td>
                    <td className="px-3 py-1.5 text-[var(--color-text-dim)]">{action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="formats" className="mt-10">
          <h2 className="text-[18px] font-semibold">File formats and Wokwi</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--color-text-dim)]">
            Use <strong>Export</strong> in the builder. Nothing is locked in, and anything a format cannot
            carry is named, never silently dropped.
          </p>
          <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[13px] text-[var(--color-text-dim)]">
            <li>
              <strong>Wokwi project (.zip)</strong>: <code className="mono">diagram.json</code>,{' '}
              <code className="mono">sketch.ino</code> and <code className="mono">libraries.txt</code>, the
              layout wokwi.com and <code className="mono">wokwi-cli</code> expect. Pin names are translated
              to Wokwi&apos;s (<code className="mono">D13</code> becomes <code className="mono">13</code>, an
              LED&apos;s <code className="mono">K</code> becomes <code className="mono">C</code>). Parts Wokwi
              has no model for are listed when you export.
            </li>
            <li>
              <strong>SparkLab project (.json)</strong>: everything, losslessly, including virtual inputs and
              mission progress.
            </li>
            <li>
              <strong>KiCad netlist (.net)</strong> for PCB layout, and a <strong>bill of materials (.csv)</strong>{' '}
              for ordering parts.
            </li>
          </ul>
          <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--color-text-dim)]">
            <strong>Import</strong> accepts all three of SparkLab&apos;s own project files, a Wokwi{' '}
            <code className="mono">diagram.json</code> and a Wokwi project zip. Every seed project that uses only
            parts Wokwi can model (28 of 41) is checked to survive the trip to Wokwi and back with every
            wire intact.
          </p>
        </section>

        <section id="scenarios" className="mt-10">
          <h2 className="text-[18px] font-semibold">Automation scenarios</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--color-text-dim)]">
            A scenario is a YAML file that drives the simulation and checks what happens. The steps are
            Wokwi&apos;s, so a scenario written for Wokwi CI runs here unchanged. Time is simulated: a
            30-second scenario finishes in well under a second.
          </p>
          <pre className="mono mt-3 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[#0d1117] p-3 text-[12px] leading-relaxed">
            {`name: Button press
version: 1
steps:
  - set-control:
      part-id: btn
      control: pressed
      value: 1
  - delay: 50ms
  - expect-pin:
      part-id: led1
      pin: A
      expected: 1
  - wait-serial:
      text: pressed
      timeout: 1s`}
          </pre>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-[12.5px]">
              <thead className="text-[var(--color-text-faint)]">
                <tr>
                  <th className="py-1.5 pr-4 font-medium">Step</th>
                  <th className="py-1.5 font-medium">What it does</th>
                </tr>
              </thead>
              <tbody className="text-[var(--color-text-dim)]">
                {[
                  ['delay: 500ms', 'Let simulated time pass. Units are required.'],
                  ['set-control', 'Press a button, move a slider or set a sensor. Wokwi names such as pressed and position work.'],
                  ['wait-serial', 'Wait until a serial line contains some text; fail after the timeout (default 10 s).'],
                  ['expect-pin', 'Assert the digital level on any pin, e.g. uno pin 13.'],
                  ['write-serial', 'Type into the serial monitor, as text or as an array of bytes.'],
                  ['assert-serial-regex', 'Extension: wait for a line matching a regular expression.'],
                  ['set-virtual-input', 'Extension: set a named virtual input directly.'],
                  ['assert-no-diagnostic', 'Extension: fail if the electrical rule check reports a code.'],
                  ['repeat', 'Extension: run a list of steps several times.'],
                ].map(([step, what]) => (
                  <tr key={step} className="border-t border-[var(--color-border)]">
                    <td className="mono py-1.5 pr-4 text-[var(--color-text)]">{step}</td>
                    <td className="py-1.5">{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section id="cli" className="mt-10">
          <h2 className="text-[18px] font-semibold">Command line and CI</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--color-text-dim)]">
            <code className="mono">sparklab-cli</code> runs any project headless: a SparkLab project file or a
            Wokwi project folder. Exit code 42 means the expected text never arrived, matching wokwi-cli.
          </p>
          <pre className="mono mt-3 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[#0d1117] p-3 text-[12px] leading-relaxed">
            {`npm run cli -- init my-project
npm run cli -- my-project --expect-text "ready" --timeout 5000
npm run cli -- my-project --scenario blink.test.yaml --junit-report junit.xml
npm run cli -- lint my-project
npm run cli -- test examples --recursive
npm run cli -- diagram export my-project --wokwi --out diagram.json`}
          </pre>
          <p className="mt-3 text-[13.5px] leading-relaxed text-[var(--color-text-dim)]">
            In GitHub Actions, the repository&apos;s reusable action runs every scenario and uploads a JUnit
            report:
          </p>
          <pre className="mono mt-3 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[#0d1117] p-3 text-[12px] leading-relaxed">
            {`- uses: ./.github/actions/simulate
  with:
    path: examples
    junit-report: scenario-results.xml`}
          </pre>
        </section>

        <section id="chips" className="mt-10">
          <h2 className="text-[18px] font-semibold">Custom chips</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--color-text-dim)]">
            Three custom chips ship in the Custom category of the palette: a NOT gate, a window comparator and
            a heartbeat pulse generator. Each is a normal part on the canvas and in the rule check, with logic
            the functional runtime evaluates (badged MODEL), plus a Wokwi-compatible{' '}
            <code className="mono">chip.json</code> and a C implementation against the Wokwi Chips API so it
            can run on the firmware emulator too.
          </p>
        </section>

        <section id="chaos" className="mt-10">
          <h2 className="text-[18px] font-semibold">Chaos Lab</h2>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--color-text-dim)]">
            Eight working projects, each broken in one specific way. The brief describes the symptom, never
            the cause, and three hints go from a nudge to nearly the answer. <em>Check my fix</em> runs the
            electrical rule check <strong>and</strong> a behaviour scenario, so deleting the part that
            produced a warning does not count as a repair. Every challenge is proven solvable by the test
            suite, and alternative correct fixes are accepted.
          </p>
        </section>
      </main>
    </div>
  );
}
