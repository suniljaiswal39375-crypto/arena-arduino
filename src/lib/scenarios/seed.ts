import type { ProjectDoc } from '@/lib/doc/types';
import { missionBySlug } from '@/lib/missions/missions';
import { referenceDoc } from '@/lib/missions/reference';
import { templateDoc } from '@/lib/templates';

/**
 * The ten example scenarios that ship with the docs. Each one is plain YAML a
 * student or a CI pipeline can copy, bound to a project that exists in this
 * repository, so the whole set is executed by the test suite on every change.
 *
 * Part ids come from the project: templates use their authored ids, mission
 * reference circuits use stable ids ("uno", "btn", "relay", "led").
 */
export interface SeedScenario {
  slug: string;
  title: string;
  /** What the scenario demonstrates, in one sentence. */
  teaches: string;
  /** `mission:<slug>` or `template:<slug>`. */
  project: string;
  yaml: string;
}

export const SEED_SCENARIOS: SeedScenario[] = [
  {
    slug: 'blink-timing',
    title: 'Blink: the LED really toggles every 500 ms',
    teaches: 'expect-pin and delay: assert a pin level at a known moment.',
    project: 'template:uno-blink',
    yaml: `name: Blink timing
version: 1
author: SparkLab
steps:
  - delay: 250ms
  - expect-pin:
      part-id: uno
      pin: 13
      expected: 1
  - delay: 500ms
  - expect-pin:
      part-id: uno
      pin: 13
      expected: 0
  - delay: 500ms
  - expect-pin:
      part-id: led1
      pin: A
      expected: 1
`,
  },
  {
    slug: 'button-press',
    title: 'Button and LED: pressing lights, releasing darkens',
    teaches: 'set-control on a pushbutton, using the Wokwi control name "pressed".',
    project: 'template:button-led',
    yaml: `name: Button press
version: 1
author: SparkLab
steps:
  - delay: 100ms
  - expect-pin:
      part-id: led1
      pin: A
      expected: 0
  - set-control:
      part-id: btn
      control: pressed
      value: 1
  - delay: 50ms
  - expect-pin:
      part-id: led1
      pin: A
      expected: 1
  - set-control:
      part-id: btn
      control: pressed
      value: 0
  - delay: 50ms
  - expect-pin:
      part-id: led1
      pin: A
      expected: 0
`,
  },
  {
    slug: 'streetlight-dusk',
    title: 'Smart Streetlight: the lamp follows the daylight',
    teaches: 'Driving a sensor through day and night and asserting the relay output.',
    project: 'mission:smart-streetlight',
    yaml: `name: Streetlight at dusk and dawn
version: 1
author: SparkLab
steps:
  - set-control:
      part-id: ldr
      control: ldrLux
      value: 900
  - delay: 1s
  - expect-pin:
      part-id: led
      pin: A
      expected: 0
  - set-control:
      part-id: ldr
      control: ldrLux
      value: 60
  - delay: 1s
  - expect-pin:
      part-id: led
      pin: A
      expected: 1
  - assert-no-diagnostic: short-circuit
`,
  },
  {
    slug: 'motion-alarm-trigger',
    title: 'Motion alarm: detection is reported on serial',
    teaches: 'wait-serial with a timeout: fail fast if a message never arrives.',
    project: 'mission:motion-alarm',
    yaml: `name: Motion alarm trigger
version: 1
author: SparkLab
steps:
  - delay: 300ms
  - expect-pin:
      part-id: buzzer
      pin: "+"
      expected: 0
  - set-control:
      part-id: pir
      control: motionDetected
      value: 1
  - wait-serial:
      text: motion detected
      timeout: 1s
  - expect-pin:
      part-id: buzzer
      pin: "+"
      expected: 1
`,
  },
  {
    slug: 'thermostat-hysteresis-band',
    title: 'Thermostat: no chattering inside the dead band',
    teaches: 'Proving hysteresis: the output only changes outside the band.',
    project: 'mission:thermostat-hysteresis',
    yaml: `name: Thermostat hysteresis band
version: 1
author: SparkLab
description: The heater comes on below 24 C, goes off above 27 C, and holds its state in between.
steps:
  - set-control:
      part-id: dht
      control: dhtTemperature
      value: 20
  - delay: 1s
  - expect-pin:
      part-id: relay
      pin: IN
      expected: 0
  - set-control:
      part-id: dht
      control: dhtTemperature
      value: 25
  - delay: 1s
  - expect-pin:
      part-id: relay
      pin: IN
      expected: 0
  - set-control:
      part-id: dht
      control: dhtTemperature
      value: 28
  - delay: 1s
  - expect-pin:
      part-id: relay
      pin: IN
      expected: 1
  - set-control:
      part-id: dht
      control: dhtTemperature
      value: 25
  - delay: 1s
  - expect-pin:
      part-id: relay
      pin: IN
      expected: 1
`,
  },
  {
    slug: 'parking-radar-distance',
    title: 'Parking radar: the printed distance tracks the object',
    teaches: 'assert-serial-regex: match a number, not an exact string.',
    project: 'mission:ultrasonic-parking-radar',
    yaml: `name: Parking radar distance
version: 1
author: SparkLab
steps:
  - set-control:
      part-id: sonar
      control: hcSr04Distance
      value: 120
  # 120 cm echoes for 6960 us, and 6960 * 0.034 / 2 truncates to 118: the
  # sketch's constant is an approximation, so allow for it rather than hide it.
  - assert-serial-regex:
      pattern: "^11[789] cm$"
      timeout: 2s
  - set-control:
      part-id: sonar
      control: hcSr04Distance
      value: 15
  - assert-serial-regex:
      pattern: "^1[456] cm$"
      timeout: 2s
  - delay: 200ms
  - expect-pin:
      part-id: led
      pin: A
      expected: 1
`,
  },
  {
    slug: 'interrupt-ten-presses',
    title: 'Event counter: ten presses, one report',
    teaches: 'repeat: drive the same input many times without copy-paste.',
    project: 'mission:interrupt-counter',
    yaml: `name: Ten presses on an interrupt
version: 1
author: SparkLab
steps:
  - delay: 100ms
  - repeat:
      times: 10
      steps:
        - set-control:
            part-id: btn
            control: pressed
            value: 1
        - delay: 40ms
        - set-control:
            part-id: btn
            control: pressed
            value: 0
        - delay: 40ms
  - wait-serial:
      text: reached 10
      timeout: 1s
`,
  },
  {
    slug: 'gas-latch-and-reset',
    title: 'Gas shutoff: latches, refuses an early reset, then clears',
    teaches: 'Safety logic: testing the paths that must not happen as well as the ones that must.',
    project: 'mission:gas-leak-shutoff',
    yaml: `name: Gas shutoff latch and reset
version: 1
author: SparkLab
steps:
  - set-control:
      part-id: gas
      control: gasLevel
      value: 700
  - delay: 500ms
  - expect-pin:
      part-id: relay
      pin: IN
      expected: 0
  # The gas drops but is not yet clear: a reset must be refused.
  - set-control:
      part-id: gas
      control: gasLevel
      value: 300
  - set-control:
      part-id: btn
      control: pressed
      value: 1
  - delay: 500ms
  - set-control:
      part-id: btn
      control: pressed
      value: 0
  - expect-pin:
      part-id: relay
      pin: IN
      expected: 0
  # Now the air is clear: the same reset is accepted.
  - set-control:
      part-id: gas
      control: gasLevel
      value: 100
  - set-control:
      part-id: btn
      control: pressed
      value: 1
  - delay: 700ms
  - set-control:
      part-id: btn
      control: pressed
      value: 0
  - delay: 300ms
  - expect-pin:
      part-id: relay
      pin: IN
      expected: 1
`,
  },
  {
    slug: 'serial-command-console',
    title: 'Serial console: the sketch answers typed commands',
    teaches: 'write-serial: type into the monitor and check the reply.',
    project: 'template:uno-blink',
    yaml: `name: Serial command console
version: 1
author: SparkLab
description: Run with the console sketch from the docs, which toggles the LED on "on" and "off".
steps:
  - wait-serial: ready
  - write-serial: "on\\n"
  - wait-serial:
      text: LED on
      timeout: 1s
  - expect-pin:
      part-id: uno
      pin: 13
      expected: 1
  - write-serial: "off\\n"
  - wait-serial:
      text: LED off
      timeout: 1s
  - expect-pin:
      part-id: uno
      pin: 13
      expected: 0
`,
  },
  {
    slug: 'greenhouse-autonomy',
    title: 'Smart greenhouse: waters dry soil and leaves wet soil alone',
    teaches: 'A multi-actuator system checked end to end, as a CI job would.',
    project: 'mission:smart-greenhouse',
    yaml: `name: Greenhouse autonomy
version: 1
author: SparkLab
steps:
  - set-control:
      part-id: soil
      control: soilMoisture
      value: 150
  - delay: 1s
  - expect-pin:
      part-id: relay
      pin: IN
      expected: 0
  - set-control:
      part-id: soil
      control: soilMoisture
      value: 800
  - delay: 1s
  - expect-pin:
      part-id: relay
      pin: IN
      expected: 1
  - assert-serial-regex:
      pattern: "soil 800"
      timeout: 1s
`,
  },
];

/**
 * The sketch the serial-console scenario runs. Shipped here rather than as a
 * template because it exists to demonstrate scenarios, not as a starter.
 */
export const SERIAL_CONSOLE_SKETCH = `// Serial command console: type "on" or "off" in the monitor.
String command = "";

void setup() {
  pinMode(13, OUTPUT);
  Serial.begin(9600);
  Serial.println("ready");
}

void loop() {
  while (Serial.available() > 0) {
    char c = Serial.read();
    if (c == '\\n') {
      command.trim();
      if (command == "on") {
        digitalWrite(13, HIGH);
        Serial.println("LED on");
      } else if (command == "off") {
        digitalWrite(13, LOW);
        Serial.println("LED off");
      } else {
        Serial.println("unknown command");
      }
      command = "";
    } else {
      command += c;
    }
  }
}
`;

/** Build the project a seed scenario runs against, with any sketch override. */
export function projectForScenario(scenario: SeedScenario): { doc: ProjectDoc; source?: string } {
  const [kind, slug] = scenario.project.split(':');
  let doc: ProjectDoc | null = null;
  if (kind === 'template' && slug) doc = templateDoc(slug);
  if (kind === 'mission' && slug) {
    const mission = missionBySlug(slug);
    if (mission) doc = referenceDoc(mission);
  }
  if (!doc) throw new Error(`scenario ${scenario.slug} refers to unknown project ${scenario.project}`);
  return scenario.slug === 'serial-command-console' ? { doc, source: SERIAL_CONSOLE_SKETCH } : { doc };
}
