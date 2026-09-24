import type { DiagnosticCode } from '@/lib/erc/diagnostics';
import type { WireColor } from '@/lib/doc/types';

export type MissionLevel = 'Beginner' | 'Intermediate' | 'Advanced';

/** A virtual input to set before a behavioural check, e.g. `{ ldrLux: 50 }`. */
export type InputSetup = Record<string, number>;

export type StepValidation =
  | { type: 'componentPresent'; partType: string }
  | { type: 'componentCount'; partType: string; count: number }
  | { type: 'wireConnection'; fromType: string; fromPin: string; toType: string; toPin: string }
  | { type: 'noDiagnostic'; code: DiagnosticCode }
  | { type: 'sketchContains'; pattern: string }
  /** Run the sketch headless with `inputs`; pass when serial output contains `pattern` within `withinMs`. */
  | { type: 'simOutput'; pattern: string; withinMs: number; inputs?: InputSetup }
  /** Run the sketch headless with `inputs` for `afterMs`; pass when a pin of a part type reads `expected`. */
  | { type: 'simPinValue'; partType: string; pin: string; expected: 0 | 1; afterMs: number; inputs?: InputSetup }
  | { type: 'manualConfirm'; note: string };

export interface MissionStep {
  id: string;
  instruction: string;
  hint: string;
  whyItMatters: string;
  validate: StepValidation;
}

export interface WireSpec {
  fromType: string;
  fromPin: string;
  toType: string;
  toPin: string;
  color?: WireColor;
}

export interface Mission {
  id: string;
  slug: string;
  title: string;
  emoji: string;
  level: MissionLevel;
  estMinutes: number;
  /** Part types used, as BOM chips. */
  components: string[];
  learningObjectives: string[];
  realWorldUse: string;
  prerequisites: string[];
  skills: string[];
  ncertAnchors: string[];
  summary: string;
  starterCode: string;
  referenceSketch: string;
  /** Where the reference solution drops each part, in canvas coordinates. */
  placement: Array<{ type: string; x: number; y: number }>;
  wiring: WireSpec[];
  steps: MissionStep[];
  tags: string[];
}

/* ---------------------------------------------------------------- helpers */

const has = (partType: string): StepValidation => ({ type: 'componentPresent', partType });
const wire = (
  fromType: string,
  fromPin: string,
  toType: string,
  toPin: string,
): StepValidation => ({ type: 'wireConnection', fromType, fromPin, toType, toPin });
const noFault = (code: DiagnosticCode): StepValidation => ({ type: 'noDiagnostic', code });
const code = (pattern: string): StepValidation => ({ type: 'sketchContains', pattern });
const manual = (note: string): StepValidation => ({ type: 'manualConfirm', note });
const simPin = (
  partType: string,
  pin: string,
  expected: 0 | 1,
  inputs: InputSetup,
  afterMs = 1500,
): StepValidation => ({ type: 'simPinValue', partType, pin, expected, afterMs, inputs });
const simOut = (pattern: string, inputs: InputSetup = {}, withinMs = 3000): StepValidation => ({
  type: 'simOutput',
  pattern,
  withinMs,
  inputs,
});

const STARTER = (comment: string): string => `// ${comment}
// Write your sketch here, then press Run.

void setup() {
  // Runs once when the board powers up.
}

void loop() {
  // Runs again and again, forever.
}
`;

/* ---------------------------------------------------------------- missions */

export const MISSIONS: Mission[] = [
  {
    id: 'm1',
    slug: 'smart-streetlight',
    title: 'Smart Streetlight',
    emoji: '💡',
    level: 'Beginner',
    estMinutes: 20,
    components: ['arduino-uno', 'ldr-module', 'relay-1ch', 'led', 'resistor'],
    learningObjectives: [
      'Read an analog sensor and compare it against a threshold',
      'Use a relay as a switch that a 5 V pin can control safely',
      'Understand why most relay boards are active LOW',
    ],
    realWorldUse:
      'Streetlights along the Panchkula sector roads switch themselves on at dusk. A light sensor decides, a relay carries the current.',
    prerequisites: [],
    skills: ['pc.complete-circuit', 'pc.ohms-law', 'ct.analog-io', 'ct.conditional'],
    ncertAnchors: ['Class 10 Ch. 12 Electricity - electric circuit and circuit diagrams'],
    summary:
      'Build a lamp that switches itself on when the room goes dark, using an LDR to decide and a relay to carry the load.',
    starterCode: STARTER('Smart Streetlight'),
    placement: [
      { type: 'arduino-uno', x: 80, y: 160 },
      { type: 'ldr-module', x: 400, y: 80 },
      { type: 'relay-1ch', x: 400, y: 250 },
      { type: 'resistor', x: 640, y: 300 },
      { type: 'led', x: 760, y: 300 },
    ],
    wiring: [
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'ldr-module', toPin: 'VCC', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'ldr-module', toPin: 'GND', color: 'black' },
      { fromType: 'ldr-module', fromPin: 'AO', toType: 'arduino-uno', toPin: 'A0' },
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'relay-1ch', toPin: 'DC+', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'relay-1ch', toPin: 'DC-', color: 'black' },
      { fromType: 'relay-1ch', fromPin: 'IN', toType: 'arduino-uno', toPin: 'D8' },
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'relay-1ch', toPin: 'COM', color: 'red' },
      { fromType: 'relay-1ch', fromPin: 'NO', toType: 'resistor', toPin: '1' },
      { fromType: 'resistor', fromPin: '2', toType: 'led', toPin: 'A' },
      { fromType: 'led', fromPin: 'K', toType: 'arduino-uno', toPin: 'GND', color: 'black' },
    ],
    referenceSketch: `// Smart Streetlight: the lamp decides for itself.
const int ldrPin = A0;
const int relayPin = 8;
const int threshold = 400;   // below this it counts as dark

void setup() {
  pinMode(relayPin, OUTPUT);
  digitalWrite(relayPin, HIGH);   // relay boards are active LOW: HIGH is off
  Serial.begin(9600);
}

void loop() {
  int light = analogRead(ldrPin);
  Serial.println(light);

  if (light < threshold) {
    digitalWrite(relayPin, LOW);    // dark: switch the lamp on
  } else {
    digitalWrite(relayPin, HIGH);   // light: switch it off
  }
  delay(200);
}
`,
    steps: [
      {
        id: 's1',
        instruction: 'Place an Arduino Uno on the canvas.',
        hint: 'Open the Microcontroller category in the palette and click Arduino Uno.',
        whyItMatters: 'Every circuit needs a brain. Nothing happens until the board is there.',
        validate: has('arduino-uno'),
      },
      {
        id: 's2',
        instruction: 'Add an LDR module to the canvas.',
        hint: 'Search for "LDR" or "light" in the palette.',
        whyItMatters: 'The light sensor is what lets the lamp make its own decision.',
        validate: has('ldr-module'),
      },
      {
        id: 's3',
        instruction: 'Add a 1-channel relay module.',
        hint: 'It is in the Driver category.',
        whyItMatters: 'A pin cannot carry a lamp current, so a relay does the switching instead.',
        validate: has('relay-1ch'),
      },
      {
        id: 's4',
        instruction: 'Power the LDR: connect its VCC to 5V and its GND to GND.',
        hint: 'Click the pin, then click the target pin. Power wires are coloured red and black for you.',
        whyItMatters: 'No power, no reading. The sensor has to be part of a closed loop.',
        validate: wire('arduino-uno', '5V', 'ldr-module', 'VCC'),
      },
      {
        id: 's5',
        instruction: 'Connect the LDR analog output AO to pin A0 on the Uno.',
        hint: 'AO carries a voltage proportional to the light level.',
        whyItMatters: 'This is the wire that carries the measurement into the board.',
        validate: wire('ldr-module', 'AO', 'arduino-uno', 'A0'),
      },
      {
        id: 's6',
        instruction: 'Power the relay module: DC+ to 5V and DC- to GND.',
        hint: 'The coil needs its own supply; it must not come from a signal pin.',
        whyItMatters: 'A relay coil draws about 70 mA, far more than a pin can give.',
        validate: wire('arduino-uno', '5V', 'relay-1ch', 'DC+'),
      },
      {
        id: 's7',
        instruction: 'Connect the relay IN pin to D8 on the Uno.',
        hint: 'This is the control wire, not the load wire.',
        whyItMatters: 'The control pin only decides; the contacts carry the current.',
        validate: wire('relay-1ch', 'IN', 'arduino-uno', 'D8'),
      },
      {
        id: 's8',
        instruction: 'Add an LED and a 220 Ω resistor, and wire NO → resistor → LED anode, LED cathode → GND.',
        hint: 'Put the resistor in series with the LED, in either order.',
        whyItMatters: 'Without the resistor the LED draws unlimited current and burns out.',
        validate: noFault('thermal-overload'),
      },
      {
        id: 's8b',
        instruction: 'Feed the lamp circuit: connect the relay COM terminal to 5V.',
        hint: 'COM is the moving contact. When the relay clicks, COM joins NO and current reaches the lamp.',
        whyItMatters: 'A relay is only a switch. It needs something to switch: here, the 5 V supply for the lamp.',
        validate: wire('arduino-uno', '5V', 'relay-1ch', 'COM'),
      },
      {
        id: 's9',
        instruction: 'In your sketch, read the LDR with analogRead(A0) and switch the relay when it is dark.',
        hint: 'Remember: relay boards are active LOW, so digitalWrite(relayPin, LOW) switches it on.',
        whyItMatters: 'The threshold is the whole decision the streetlight makes.',
        validate: code('analogRead'),
      },
      {
        id: 's10',
        instruction: 'Make it work: in the dark (light level 50) the lamp must be on. SparkLab runs your sketch to check.',
        hint: 'Open the Inputs panel and move the LDR slider below 400 to watch it happen. If it stays off, check the threshold direction and that the relay is active LOW.',
        whyItMatters: 'Testing with a virtual sensor is how you know the logic is right before you build it.',
        validate: simPin('led', 'A', 1, { ldrLux: 50 }),
      },
      {
        id: 's11',
        instruction: 'And in daylight (light level 900) the lamp must be off.',
        hint: 'A streetlight that is always on passes the first check and wastes power all day.',
        whyItMatters: 'Checking both sides of a threshold is how engineers catch a logic that is simply stuck on.',
        validate: simPin('led', 'A', 0, { ldrLux: 900 }),
      },
      {
        id: 's12',
        instruction: 'Confirm what you observed.',
        hint: 'Drag the light slider slowly across 400 and watch the relay click.',
        whyItMatters: 'Seeing the switch-over yourself is what turns a passing check into understanding.',
        validate: manual('I saw the lamp switch on when the light level dropped.'),
      },
    ],
    tags: ['light', 'relay', 'analog', 'beginner'],
  },

  {
    id: 'm2',
    slug: 'motion-alarm',
    title: 'Motion-Activated Alarm',
    emoji: '🚨',
    level: 'Beginner',
    estMinutes: 15,
    components: ['arduino-uno', 'pir-motion', 'buzzer-active', 'led', 'resistor'],
    learningObjectives: [
      'Read a digital sensor that goes HIGH on its own',
      'Drive two outputs from one decision',
      'Avoid powering a buzzer beyond what a pin can supply',
    ],
    realWorldUse:
      'Shop counters and corridor lights react when someone walks past. A PIR sensor is the cheapest way to notice a person.',
    prerequisites: [],
    skills: ['pc.complete-circuit', 'pc.signal-pin', 'ct.setup-loop', 'ct.conditional'],
    ncertAnchors: ['Class 10 Ch. 12 Electricity - electric circuit and circuit diagrams'],
    summary: 'Wire a PIR motion sensor so that movement sounds a buzzer and lights an LED.',
    starterCode: STARTER('Motion-Activated Alarm'),
    placement: [
      { type: 'arduino-uno', x: 80, y: 160 },
      { type: 'pir-motion', x: 400, y: 100 },
      { type: 'buzzer-active', x: 400, y: 280 },
      { type: 'resistor', x: 640, y: 120 },
      { type: 'led', x: 760, y: 120 },
    ],
    wiring: [
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'pir-motion', toPin: 'VCC', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'pir-motion', toPin: 'GND', color: 'black' },
      { fromType: 'pir-motion', fromPin: 'OUT', toType: 'arduino-uno', toPin: 'D7' },
      { fromType: 'buzzer-active', fromPin: '+', toType: 'arduino-uno', toPin: 'D8' },
      { fromType: 'buzzer-active', fromPin: '-', toType: 'arduino-uno', toPin: 'GND', color: 'black' },
      { fromType: 'arduino-uno', fromPin: 'D13', toType: 'resistor', toPin: '1' },
      { fromType: 'resistor', fromPin: '2', toType: 'led', toPin: 'A' },
      { fromType: 'led', fromPin: 'K', toType: 'arduino-uno', toPin: 'GND', color: 'black' },
    ],
    referenceSketch: `// Motion-Activated Alarm
const int pirPin = 7;
const int buzzerPin = 8;
const int ledPin = 13;

void setup() {
  pinMode(pirPin, INPUT);
  pinMode(buzzerPin, OUTPUT);
  pinMode(ledPin, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  if (digitalRead(pirPin) == HIGH) {
    digitalWrite(ledPin, HIGH);
    digitalWrite(buzzerPin, HIGH);
    Serial.println("motion detected");
  } else {
    digitalWrite(ledPin, LOW);
    digitalWrite(buzzerPin, LOW);
  }
  delay(100);
}
`,
    steps: [
      {
        id: 's1',
        instruction: 'Place an Arduino Uno on the canvas.',
        hint: 'Microcontroller category.',
        whyItMatters: 'The board reads the sensor and drives the alarm.',
        validate: has('arduino-uno'),
      },
      {
        id: 's2',
        instruction: 'Add a PIR motion sensor.',
        hint: 'Search "PIR" or "motion".',
        whyItMatters: 'This is the sensor that notices a person.',
        validate: has('pir-motion'),
      },
      {
        id: 's3',
        instruction: 'Add an active buzzer.',
        hint: 'Actuator category. An active buzzer beeps on its own when you apply 5 V.',
        whyItMatters: 'Sound carries further than light, which is why alarms buzz.',
        validate: has('buzzer-active'),
      },
      {
        id: 's4',
        instruction: 'Power the PIR: VCC to 5V, GND to GND.',
        hint: 'Two wires, red and black.',
        whyItMatters: 'A sensor with no supply reports nothing.',
        validate: wire('arduino-uno', '5V', 'pir-motion', 'VCC'),
      },
      {
        id: 's5',
        instruction: 'Connect the PIR OUT pin to D7.',
        hint: 'The PIR pulls this line HIGH when it sees movement.',
        whyItMatters: 'Digital sensors speak in one bit: moving or not moving.',
        validate: wire('pir-motion', 'OUT', 'arduino-uno', 'D7'),
      },
      {
        id: 's6',
        instruction: 'Wire the buzzer: + to D8 and − to GND.',
        hint: '+ is the signal side.',
        whyItMatters: 'The buzzer needs a return path to ground or no current flows.',
        validate: wire('buzzer-active', '+', 'arduino-uno', 'D8'),
      },
      {
        id: 's7',
        instruction: 'Add an LED with a 220 Ω resistor on D13 and make sure no fault is reported.',
        hint: 'Check the Diagnostics panel: it should be clear of errors.',
        whyItMatters: 'A second output shows the same event two ways, which is how real alarms work.',
        validate: noFault('thermal-overload'),
      },
      {
        id: 's8',
        instruction: 'Write a sketch that reads the PIR and drives both the buzzer and the LED.',
        hint: 'digitalRead(pirPin) == HIGH means motion.',
        whyItMatters: 'One input, two outputs: the simplest control program there is.',
        validate: code('digitalRead'),
      },
      {
        id: 's8b',
        instruction: 'Prove it: with motion detected, the buzzer must sound. SparkLab runs your sketch to check.',
        hint: 'The PIR output goes HIGH on motion. Read it with digitalRead and drive the buzzer pin HIGH.',
        whyItMatters: 'An alarm that never sounds is worse than none: people trust it.',
        validate: simPin('buzzer-active', '+', 1, { motionDetected: 1 }),
      },
      {
        id: 's8c',
        instruction: 'And with no motion, the alarm must be quiet.',
        hint: 'The else branch matters as much as the if.',
        whyItMatters: 'False alarms teach people to ignore an alarm, which is how real ones get missed.',
        validate: simPin('buzzer-active', '+', 0, { motionDetected: 0 }),
      },
      {
        id: 's9',
        instruction: 'Run it and toggle the Motion switch in the Inputs panel. The alarm must sound.',
        hint: 'Inputs panel, Motion toggle.',
        whyItMatters: 'You have just tested the alarm without walking in front of it.',
        validate: manual('The buzzer and LED came on when I triggered the motion input.'),
      },
    ],
    tags: ['motion', 'security', 'digital', 'beginner'],
  },

  {
    id: 'm3',
    slug: 'water-level-alert',
    title: 'Water Level Alert',
    emoji: '🚰',
    level: 'Beginner',
    estMinutes: 20,
    components: ['arduino-uno', 'potentiometer-10k', 'buzzer-active', 'led', 'resistor'],
    learningObjectives: [
      'Use a potentiometer to stand in for a varying sensor',
      'Compare a reading against an alarm band',
      'Keep a loop responsive while it alarms',
    ],
    realWorldUse:
      'Overhead tanks in Indian homes overflow because nobody knows the level. A probe and an alarm fix that.',
    prerequisites: ['motion-alarm'],
    skills: ['pc.analog-conditioning', 'ct.analog-io', 'ct.conditional'],
    ncertAnchors: ['Class 10 Ch. 12 Electricity - electric circuit and circuit diagrams'],
    summary:
      'Use a potentiometer as a water-level probe and raise an alarm when the level crosses a band.',
    starterCode: STARTER('Water Level Alert'),
    placement: [
      { type: 'arduino-uno', x: 80, y: 160 },
      { type: 'potentiometer-10k', x: 400, y: 100 },
      { type: 'buzzer-active', x: 400, y: 300 },
      { type: 'resistor', x: 640, y: 120 },
      { type: 'led', x: 760, y: 120 },
    ],
    wiring: [
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'potentiometer-10k', toPin: 'VCC', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'potentiometer-10k', toPin: 'GND', color: 'black' },
      { fromType: 'potentiometer-10k', fromPin: 'OUT', toType: 'arduino-uno', toPin: 'A1' },
      { fromType: 'buzzer-active', fromPin: '+', toType: 'arduino-uno', toPin: 'D8' },
      { fromType: 'buzzer-active', fromPin: '-', toType: 'arduino-uno', toPin: 'GND', color: 'black' },
      { fromType: 'arduino-uno', fromPin: 'D13', toType: 'resistor', toPin: '1' },
      { fromType: 'resistor', fromPin: '2', toType: 'led', toPin: 'A' },
      { fromType: 'led', fromPin: 'K', toType: 'arduino-uno', toPin: 'GND', color: 'black' },
    ],
    referenceSketch: `// Water Level Alert: warn when the tank is nearly full.
const int levelPin = A1;
const int buzzerPin = 8;
const int ledPin = 13;
const int alarmLevel = 800;   // above this the tank is too full

void setup() {
  pinMode(buzzerPin, OUTPUT);
  pinMode(ledPin, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int level = analogRead(levelPin);
  Serial.println(level);

  if (level > alarmLevel) {
    digitalWrite(ledPin, HIGH);
    digitalWrite(buzzerPin, HIGH);
    delay(150);
    digitalWrite(buzzerPin, LOW);
    delay(150);
  } else {
    digitalWrite(ledPin, LOW);
    digitalWrite(buzzerPin, LOW);
    delay(100);
  }
}
`,
    steps: [
      {
        id: 's1',
        instruction: 'Place an Arduino Uno and a 10 kΩ potentiometer.',
        hint: 'The potentiometer stands in for the level probe.',
        whyItMatters: 'A potentiometer gives you a controllable analog value, which is exactly what a probe does.',
        validate: has('potentiometer-10k'),
      },
      {
        id: 's2',
        instruction: 'Wire the potentiometer: outer pins to 5V and GND, wiper to A1.',
        hint: 'The middle pin is the wiper.',
        whyItMatters: 'Reversing the outer pins only reverses the direction; the reading still works.',
        validate: wire('potentiometer-10k', 'OUT', 'arduino-uno', 'A1'),
      },
      {
        id: 's3',
        instruction: 'Add an active buzzer on D8 and an LED with a resistor on D13.',
        hint: 'Both need a ground return.',
        whyItMatters: 'Two alerts, one silent one loud, is the pattern real alarms use.',
        validate: has('buzzer-active'),
      },
      {
        id: 's4',
        instruction: 'Read the level with analogRead(A1) and print it to the serial monitor.',
        hint: 'Serial.println(level) then open the Serial panel.',
        whyItMatters: 'Printing the raw value is how you find the right threshold.',
        validate: code('analogRead'),
      },
      {
        id: 's5',
        instruction: 'Sound the alarm only when the level passes your threshold.',
        hint: 'Use an if statement with a constant such as 800.',
        whyItMatters: 'A threshold turns a continuous reading into a decision.',
        validate: code('if'),
      },
      {
        id: 's5b',
        instruction: 'Prove it: with the tank nearly full (level 950), the LED must be on.',
        hint: 'Compare analogRead with your alarm level and drive the LED on pin 13.',
        whyItMatters: 'The alert only matters if it fires when the tank really is full.',
        validate: simPin('led', 'A', 1, { potentiometer: 950 }),
      },
      {
        id: 's5c',
        instruction: 'And with the tank half full (level 400), the LED must be off.',
        hint: 'Check the other side of your threshold.',
        whyItMatters: 'An alert that is always on gets unplugged.',
        validate: simPin('led', 'A', 0, { potentiometer: 400 }),
      },
      {
        id: 's6',
        instruction: 'Run it and sweep the potentiometer slider past the threshold.',
        hint: 'Inputs panel, Wiper slider.',
        whyItMatters: 'You have proven the alarm triggers at the right point.',
        validate: manual('The alarm sounded when the level crossed my threshold.'),
      },
    ],
    tags: ['water', 'analog', 'threshold', 'beginner'],
  },

  {
    id: 'm4',
    slug: 'temperature-display',
    title: 'Temperature Display',
    emoji: '🌡️',
    level: 'Intermediate',
    estMinutes: 25,
    components: ['arduino-uno', 'dht11', 'lcd-16x2-i2c'],
    learningObjectives: [
      'Read a digital sensor over a single data wire',
      'Show text and numbers on an I2C character LCD',
      'Refresh a display without flicker',
    ],
    realWorldUse:
      'Every weather station, cold store and incubator shows its temperature on a small display.',
    prerequisites: ['smart-streetlight'],
    skills: ['pc.signal-pin', 'ct.abstraction', 'ct.analog-io'],
    ncertAnchors: ['Class 10 Ch. 12 Electricity - heating effect of current'],
    summary: 'Read a DHT11 and show the temperature and humidity on a 16x2 I2C LCD.',
    starterCode: STARTER('Temperature Display'),
    placement: [
      { type: 'arduino-uno', x: 80, y: 160 },
      { type: 'dht11', x: 400, y: 90 },
      { type: 'lcd-16x2-i2c', x: 400, y: 280 },
    ],
    wiring: [
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'dht11', toPin: 'VCC', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'dht11', toPin: 'GND', color: 'black' },
      { fromType: 'dht11', fromPin: 'DATA', toType: 'arduino-uno', toPin: 'D2' },
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'lcd-16x2-i2c', toPin: 'VCC', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'lcd-16x2-i2c', toPin: 'GND', color: 'black' },
      { fromType: 'lcd-16x2-i2c', fromPin: 'SDA', toType: 'arduino-uno', toPin: 'A4' },
      { fromType: 'lcd-16x2-i2c', fromPin: 'SCL', toType: 'arduino-uno', toPin: 'A5' },
    ],
    referenceSketch: `#include <DHT.h>
#include <LiquidCrystal_I2C.h>

#define DHTPIN 2
#define DHTTYPE DHT11

DHT dht(DHTPIN, DHTTYPE);
LiquidCrystal_I2C lcd(0x27, 16, 2);

void setup() {
  dht.begin();
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Temp:");
  lcd.setCursor(0, 1);
  lcd.print("Humidity:");
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  lcd.setCursor(6, 0);
  lcd.print(t);
  lcd.print(" C   ");
  lcd.setCursor(10, 1);
  lcd.print(h);
  lcd.print(" %   ");

  delay(2000);
}
`,
    steps: [
      {
        id: 's1',
        instruction: 'Place an Arduino Uno, a DHT11 and a 16x2 I2C LCD.',
        hint: 'The DHT11 is a Sensor, the LCD is a Display.',
        whyItMatters: 'Sensor in, display out: the shape of most measurement projects.',
        validate: has('dht11'),
      },
      {
        id: 's2',
        instruction: 'Power the DHT11 and connect its DATA pin to D2.',
        hint: 'VCC to 5V, GND to GND, DATA to D2.',
        whyItMatters: 'The DHT11 sends its reading as a timed pulse train on one wire.',
        validate: wire('dht11', 'DATA', 'arduino-uno', 'D2'),
      },
      {
        id: 's3',
        instruction: 'Power the LCD and connect SDA to A4 and SCL to A5.',
        hint: 'On the Uno, A4 and A5 double as the I2C bus.',
        whyItMatters: 'I2C lets two devices talk over two wires, which is why this display needs only four.',
        validate: wire('lcd-16x2-i2c', 'SDA', 'arduino-uno', 'A4'),
      },
      {
        id: 's4',
        instruction: 'Create the DHT object and call dht.begin() in setup().',
        hint: 'DHT dht(DHTPIN, DHTTYPE);',
        whyItMatters: 'A library object hides the awkward timing so your code stays readable.',
        validate: code('dht.begin'),
      },
      {
        id: 's5',
        instruction: 'Initialise the LCD with lcd.init() and lcd.backlight().',
        hint: 'Without init() the display stays blank.',
        whyItMatters: 'The display needs to be told it exists before it will show anything.',
        validate: code('lcd.init'),
      },
      {
        id: 's6',
        instruction: 'Print the temperature and humidity to the LCD and update it every two seconds.',
        hint: 'lcd.setCursor(col, row) then lcd.print(value).',
        whyItMatters: 'Updating too fast makes the text flicker; two seconds is readable.',
        validate: code('readTemperature'),
      },
      {
        id: 's7',
        instruction: 'Run it and change the temperature slider. The display must follow.',
        hint: 'Inputs panel, Temperature slider.',
        whyItMatters: 'You have closed the loop from sensor to display.',
        validate: manual('The LCD showed the temperature and it changed with the slider.'),
      },
    ],
    tags: ['temperature', 'lcd', 'i2c', 'intermediate'],
  },

  {
    id: 'm5',
    slug: 'obstacle-avoiding-logic',
    title: 'Obstacle-Avoiding Logic',
    emoji: '🤖',
    level: 'Intermediate',
    estMinutes: 30,
    components: ['arduino-uno', 'ir-obstacle', 'servo-sg90'],
    learningObjectives: [
      'Turn a sensor reading into a steering decision',
      'Position a servo by angle',
      'Keep decisions simple and testable',
    ],
    realWorldUse:
      'Robot vacuums and warehouse carts decide where to go from what their sensors see.',
    prerequisites: ['motion-alarm'],
    skills: ['pc.signal-pin', 'ct.conditional', 'ct.state'],
    ncertAnchors: ['Class 10 Ch. 12 Electricity - electric circuit and circuit diagrams'],
    summary: 'Use an IR obstacle sensor to steer a servo left or right when something is close.',
    starterCode: STARTER('Obstacle-Avoiding Logic'),
    placement: [
      { type: 'arduino-uno', x: 80, y: 160 },
      { type: 'ir-obstacle', x: 400, y: 100 },
      { type: 'servo-sg90', x: 400, y: 300 },
    ],
    wiring: [
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'ir-obstacle', toPin: 'VCC', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'ir-obstacle', toPin: 'GND', color: 'black' },
      { fromType: 'ir-obstacle', fromPin: 'OUT', toType: 'arduino-uno', toPin: 'D4' },
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'servo-sg90', toPin: 'VCC', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'servo-sg90', toPin: 'GND', color: 'black' },
      { fromType: 'servo-sg90', fromPin: 'SIG', toType: 'arduino-uno', toPin: 'D9' },
    ],
    referenceSketch: `#include <Servo.h>

const int irPin = 4;
Servo steering;

void setup() {
  pinMode(irPin, INPUT);
  steering.attach(9);
  steering.write(90);        // centred
}

void loop() {
  if (digitalRead(irPin) == LOW) {
    // Most IR modules pull LOW when something is close.
    steering.write(30);      // steer away
    delay(400);
  } else {
    steering.write(90);      // straight ahead
  }
  delay(50);
}
`,
    steps: [
      {
        id: 's1',
        instruction: 'Place an Arduino Uno, an IR obstacle sensor and an SG90 servo.',
        hint: 'The servo is in the Motor category.',
        whyItMatters: 'Sense, decide, act: the three parts of any robot.',
        validate: has('ir-obstacle'),
      },
      {
        id: 's2',
        instruction: 'Power the IR sensor and connect its OUT pin to D4.',
        hint: 'VCC, GND and OUT.',
        whyItMatters: 'The sensor does the seeing; the wire brings the result home.',
        validate: wire('ir-obstacle', 'OUT', 'arduino-uno', 'D4'),
      },
      {
        id: 's3',
        instruction: 'Power the servo and connect its signal wire to D9.',
        hint: 'SIG to D9, which is a PWM pin.',
        whyItMatters: 'A servo is positioned by pulse width, so it needs a PWM-capable pin.',
        validate: wire('servo-sg90', 'SIG', 'arduino-uno', 'D9'),
      },
      {
        id: 's4',
        instruction: 'Attach the servo in setup() and centre it at 90 degrees.',
        hint: 'steering.attach(9); steering.write(90);',
        whyItMatters: 'Starting from a known position makes the rest of the logic predictable.',
        validate: code('attach'),
      },
      {
        id: 's5',
        instruction: 'Steer away when the sensor reports an obstacle, and return to centre otherwise.',
        hint: 'Most IR modules read LOW when something is close.',
        whyItMatters: 'This is decision logic: a rule that maps a reading to an action.',
        validate: code('write'),
      },
      {
        id: 's5b',
        instruction: 'Prove it: with an obstacle ahead, the servo must steer away from centre.',
        hint: 'IR obstacle modules pull their output LOW when something is close.',
        whyItMatters: 'A robot that does not steer away from a wall is a robot that hits walls.',
        validate: code('LOW'),
      },
      {
        id: 's6',
        instruction: 'Run it and toggle the obstacle input. The servo must move.',
        hint: 'Inputs panel, obstacle toggle.',
        whyItMatters: 'Watching the servo respond proves your rule works.',
        validate: manual('The servo turned when I triggered the obstacle input.'),
      },
    ],
    tags: ['robot', 'servo', 'ir', 'intermediate'],
  },

  {
    id: 'm6',
    slug: 'three-mode-lamp',
    title: 'Three-Mode Lamp',
    emoji: '🔆',
    level: 'Intermediate',
    estMinutes: 25,
    components: ['arduino-uno', 'pushbutton', 'led', 'resistor'],
    learningObjectives: [
      'Count presses in a variable and act on the count',
      'Use switch() to choose between states',
      'Debounce a mechanical button in software',
    ],
    realWorldUse:
      'One button that cycles off, dim and bright is how desk lamps and torch modes work.',
    prerequisites: ['motion-alarm'],
    skills: ['pc.pull-resistor', 'ct.state', 'ct.conditional', 'ct.repetition'],
    ncertAnchors: ['Class 10 Ch. 12 Electricity - electric circuit and circuit diagrams'],
    summary: 'Cycle a lamp through off, dim and bright with a single button.',
    starterCode: STARTER('Three-Mode Lamp'),
    placement: [
      { type: 'arduino-uno', x: 80, y: 160 },
      { type: 'pushbutton', x: 400, y: 100 },
      { type: 'resistor', x: 640, y: 120 },
      { type: 'led', x: 760, y: 120 },
    ],
    wiring: [
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'pushbutton', toPin: '1', color: 'black' },
      { fromType: 'pushbutton', fromPin: '2', toType: 'arduino-uno', toPin: 'D2' },
      { fromType: 'arduino-uno', fromPin: 'D9', toType: 'resistor', toPin: '1' },
      { fromType: 'resistor', fromPin: '2', toType: 'led', toPin: 'A' },
      { fromType: 'led', fromPin: 'K', toType: 'arduino-uno', toPin: 'GND', color: 'black' },
    ],
    referenceSketch: `// Three-Mode Lamp: one button, three states.
const int buttonPin = 2;
const int lampPin = 9;        // PWM pin, so it can dim

int mode = 0;                 // 0 off, 1 dim, 2 bright
bool lastPressed = false;

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(lampPin, OUTPUT);
}

void loop() {
  bool pressed = (digitalRead(buttonPin) == LOW);

  // Count a press only on the transition, not while it is held.
  if (pressed && !lastPressed) {
    mode = (mode + 1) % 3;
    delay(200);               // simple debounce
  }
  lastPressed = pressed;

  switch (mode) {
    case 0: analogWrite(lampPin, 0);   break;
    case 1: analogWrite(lampPin, 64);  break;
    case 2: analogWrite(lampPin, 255); break;
  }
}
`,
    steps: [
      {
        id: 's1',
        instruction: 'Place an Arduino Uno, a pushbutton, an LED and a resistor.',
        hint: 'The button and resistor are in Passive.',
        whyItMatters: 'A button plus a light is the smallest complete interactive circuit.',
        validate: has('pushbutton'),
      },
      {
        id: 's2',
        instruction: 'Wire the button between D2 and GND.',
        hint: 'One leg to GND, the other to D2.',
        whyItMatters: 'With INPUT_PULLUP the pin rests HIGH and reads LOW when the button closes.',
        validate: wire('pushbutton', '2', 'arduino-uno', 'D2'),
      },
      {
        id: 's3',
        instruction: 'Wire the LED through the resistor to D9.',
        hint: 'D9 is a PWM pin, which is what lets the lamp dim.',
        whyItMatters: 'analogWrite only dims on pins that support PWM.',
        validate: wire('arduino-uno', 'D9', 'resistor', '1'),
      },
      {
        id: 's4',
        instruction: 'Use pinMode(buttonPin, INPUT_PULLUP) so the input never floats.',
        hint: 'The Diagnostics panel warns you if you forget.',
        whyItMatters: 'A floating input reads random values; a pull-up gives it a defined resting level.',
        validate: code('INPUT_PULLUP'),
      },
      {
        id: 's5',
        instruction: 'Count presses into a variable and wrap it with the modulo operator.',
        hint: 'mode = (mode + 1) % 3;',
        whyItMatters: 'The modulo operator is what makes the modes cycle instead of counting forever.',
        validate: code('% 3'),
      },
      {
        id: 's6',
        instruction: 'Use switch() to set the brightness for each mode.',
        hint: 'analogWrite values are 0 to 255.',
        whyItMatters: 'switch() states the three cases more clearly than nested ifs.',
        validate: code('switch'),
      },
      {
        id: 's7',
        instruction: 'Run it and press the button three times. The lamp must go dim, then bright, then off.',
        hint: 'Inputs panel, Pressed toggle. Toggle it off between presses.',
        whyItMatters: 'Cycling through every state is how you know the counter wraps correctly.',
        validate: manual('The lamp cycled through dim, bright and off.'),
      },
    ],
    tags: ['button', 'state', 'pwm', 'intermediate'],
  },

  {
    id: 'm7',
    slug: 'traffic-light',
    title: 'Traffic Light Sequencer',
    emoji: '🚦',
    level: 'Advanced',
    estMinutes: 35,
    components: ['arduino-uno', 'led-rgb-module', 'pushbutton'],
    learningObjectives: [
      'Model a sequence as a state machine',
      'Handle a pedestrian request without blocking the sequence',
      'Keep timing readable with constants',
    ],
    realWorldUse:
      'Junctions run a fixed cycle and interrupt it when a pedestrian presses the crossing button.',
    prerequisites: ['three-mode-lamp'],
    skills: ['ct.state', 'ct.nonblocking-timing', 'pc.complete-circuit'],
    ncertAnchors: ['Class 10 Ch. 12 Electricity - electric circuit and circuit diagrams'],
    summary: 'Run a red-amber-green sequence on an RGB module, with a button that requests a crossing.',
    starterCode: STARTER('Traffic Light Sequencer'),
    placement: [
      { type: 'arduino-uno', x: 80, y: 160 },
      { type: 'led-rgb-module', x: 420, y: 120 },
      { type: 'pushbutton', x: 420, y: 320 },
    ],
    wiring: [
      { fromType: 'led-rgb-module', fromPin: 'R', toType: 'arduino-uno', toPin: 'D9' },
      { fromType: 'led-rgb-module', fromPin: 'G', toType: 'arduino-uno', toPin: 'D10' },
      { fromType: 'led-rgb-module', fromPin: 'B', toType: 'arduino-uno', toPin: 'D11' },
      { fromType: 'led-rgb-module', fromPin: 'GND', toType: 'arduino-uno', toPin: 'GND', color: 'black' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'pushbutton', toPin: '1', color: 'black' },
      { fromType: 'pushbutton', fromPin: '2', toType: 'arduino-uno', toPin: 'D2' },
    ],
    referenceSketch: `// Traffic Light Sequencer with a pedestrian request.
const int redPin = 9;
const int greenPin = 10;
const int bluePin = 11;
const int buttonPin = 2;

const int redTime = 4000;
const int amberTime = 1000;
const int greenTime = 4000;

int stage = 0;
unsigned long stageStart = 0;

void setLamp(bool red, bool amber, bool green) {
  digitalWrite(redPin, red ? HIGH : LOW);
  digitalWrite(greenPin, green ? HIGH : LOW);
  digitalWrite(bluePin, amber ? HIGH : LOW);
}

void setup() {
  pinMode(redPin, OUTPUT);
  pinMode(greenPin, OUTPUT);
  pinMode(bluePin, OUTPUT);
  pinMode(buttonPin, INPUT_PULLUP);
  stageStart = millis();
}

void loop() {
  unsigned long now = millis();
  unsigned long elapsed = now - stageStart;

  if (stage == 0 && elapsed > greenTime) { stage = 1; stageStart = now; }
  else if (stage == 1 && elapsed > amberTime) { stage = 2; stageStart = now; }
  else if (stage == 2 && elapsed > redTime) { stage = 0; stageStart = now; }

  if (stage == 0) setLamp(false, false, true);
  else if (stage == 1) setLamp(false, true, false);
  else setLamp(true, false, false);

  if (digitalRead(buttonPin) == LOW) {
    // A request shortens the current stage rather than stopping everything.
    if (stage == 0 && elapsed > 1000) { stage = 1; stageStart = now; }
  }
}
`,
    steps: [
      {
        id: 's1',
        instruction: 'Place an Arduino Uno, an RGB LED module and a pushbutton.',
        hint: 'The RGB module is an Actuator with four pins.',
        whyItMatters: 'One module gives you three lights, which is exactly a traffic signal.',
        validate: has('led-rgb-module'),
      },
      {
        id: 's2',
        instruction: 'Wire R to D9, G to D10 and B to D11, and the module GND to GND.',
        hint: 'Three signal wires plus ground.',
        whyItMatters: 'Each colour is a separate channel, so the code can mix or switch them.',
        validate: wire('led-rgb-module', 'R', 'arduino-uno', 'D9'),
      },
      {
        id: 's3',
        instruction: 'Wire the button between D2 and GND.',
        hint: 'Use INPUT_PULLUP in the sketch.',
        whyItMatters: 'The crossing button is an input that interrupts a fixed cycle.',
        validate: wire('pushbutton', '2', 'arduino-uno', 'D2'),
      },
      {
        id: 's4',
        instruction: 'Write a setLamp() helper that takes three booleans.',
        hint: 'One function, three arguments, no repeated digitalWrite blocks.',
        whyItMatters: 'Naming the states makes the sequence readable.',
        validate: code('void setLamp'),
      },
      {
        id: 's5',
        instruction: 'Time the stages with millis() rather than delay().',
        hint: 'Store stageStart and compare elapsed time.',
        whyItMatters: 'With delay() the button would only be noticed between stages.',
        validate: code('millis'),
      },
      {
        id: 's6',
        instruction: 'Let the pedestrian button shorten the green stage.',
        hint: 'Only accept the request after green has run for a second.',
        whyItMatters: 'Real signals refuse a request that arrives too early, for safety.',
        validate: code('digitalRead'),
      },
      {
        id: 's7',
        instruction: 'Run it and watch the lights cycle green, amber, red without you touching anything.',
        hint: 'Press the button during green to see it cut short.',
        whyItMatters: 'A state machine that runs by itself is the heart of embedded software.',
        validate: manual('The lights cycled on their own and the button cut the green stage short.'),
      },
    ],
    tags: ['state machine', 'timing', 'rgb', 'advanced'],
  },

  {
    id: 'm8',
    slug: 'adaptive-lamp',
    title: 'Adaptive Lamp Brightness',
    emoji: '🌗',
    level: 'Advanced',
    estMinutes: 30,
    components: ['arduino-uno', 'ldr-module', 'led', 'resistor'],
    learningObjectives: [
      'Scale one range of numbers onto another with map()',
      'Replace on/off switching with a smooth PWM response',
      'Invert a range when brighter light should mean a dimmer lamp',
    ],
    realWorldUse:
      'Phone screens and smart bulbs fade their brightness to match the room instead of switching.',
    prerequisites: ['smart-streetlight'],
    skills: ['pc.analog-conditioning', 'ct.analog-io', 'ct.abstraction'],
    ncertAnchors: ['Class 10 Ch. 12 Electricity - Ohm\'s law'],
    summary: 'Fade an LED in proportion to the darkness, instead of switching it.',
    starterCode: STARTER('Adaptive Lamp Brightness'),
    placement: [
      { type: 'arduino-uno', x: 80, y: 160 },
      { type: 'ldr-module', x: 400, y: 100 },
      { type: 'resistor', x: 640, y: 140 },
      { type: 'led', x: 760, y: 140 },
    ],
    wiring: [
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'ldr-module', toPin: 'VCC', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'ldr-module', toPin: 'GND', color: 'black' },
      { fromType: 'ldr-module', fromPin: 'AO', toType: 'arduino-uno', toPin: 'A0' },
      { fromType: 'arduino-uno', fromPin: 'D9', toType: 'resistor', toPin: '1' },
      { fromType: 'resistor', fromPin: '2', toType: 'led', toPin: 'A' },
      { fromType: 'led', fromPin: 'K', toType: 'arduino-uno', toPin: 'GND', color: 'black' },
    ],
    referenceSketch: `// Adaptive Lamp: the darker the room, the brighter the lamp.
const int ldrPin = A0;
const int lampPin = 9;        // PWM

void setup() {
  pinMode(lampPin, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int light = analogRead(ldrPin);          // 0 dark, 1023 bright
  int brightness = map(light, 0, 1023, 255, 0);   // inverted on purpose
  brightness = constrain(brightness, 0, 255);

  analogWrite(lampPin, brightness);
  Serial.print(light);
  Serial.print(" -> ");
  Serial.println(brightness);
  delay(50);
}
`,
    steps: [
      {
        id: 's1',
        instruction: 'Place an Arduino Uno, an LDR module, an LED and a resistor.',
        hint: 'Same parts as the streetlight, without the relay.',
        whyItMatters: 'Switching and fading need the same sensor, but different output control.',
        validate: has('ldr-module'),
      },
      {
        id: 's2',
        instruction: 'Wire the LDR to 5V, GND and A0.',
        hint: 'The analog output carries a value from 0 to 1023.',
        whyItMatters: 'A continuous reading is what makes a fade possible.',
        validate: wire('ldr-module', 'AO', 'arduino-uno', 'A0'),
      },
      {
        id: 's3',
        instruction: 'Wire the LED through the resistor to D9, a PWM pin.',
        hint: 'Only PWM pins can fade.',
        whyItMatters: 'analogWrite is not a true analog output; it switches fast enough to look dim.',
        validate: wire('arduino-uno', 'D9', 'resistor', '1'),
      },
      {
        id: 's4',
        instruction: 'Use map() to convert the light reading into a brightness value.',
        hint: 'map(light, 0, 1023, 255, 0) inverts it: dark room, bright lamp.',
        whyItMatters: 'Mapping one range onto another is the most useful line in Arduino.',
        validate: code('map('),
      },
      {
        id: 's5',
        instruction: 'Constrain the result so it can never fall outside 0 to 255.',
        hint: 'constrain(value, 0, 255).',
        whyItMatters: 'Real sensors drift past their nominal range; constrain keeps the output legal.',
        validate: code('constrain'),
      },
      {
        id: 's6',
        instruction: 'Run it and sweep the light slider. The LED brightness must change smoothly.',
        hint: 'Watch the LED, and the values in the Serial panel.',
        whyItMatters: 'Smooth response is the whole point of PWM.',
        validate: manual('The LED faded smoothly as I changed the light level.'),
      },
    ],
    tags: ['pwm', 'analog', 'map', 'advanced'],
  },

  {
    id: 'm9',
    slug: 'interrupt-counter',
    title: 'Interrupt-Driven Event Counter',
    emoji: '⚡',
    level: 'Advanced',
    estMinutes: 30,
    components: ['arduino-uno', 'pushbutton', 'led', 'resistor'],
    learningObjectives: [
      'React to an input the moment it changes, using attachInterrupt',
      'Mark shared variables volatile',
      'Keep an interrupt handler short',
    ],
    realWorldUse:
      'People counters, flow meters and tachometers cannot afford to miss an event while the main loop is busy.',
    prerequisites: ['three-mode-lamp'],
    skills: ['ct.interrupts', 'ct.state', 'pc.pull-resistor'],
    ncertAnchors: ['Class 12 Ch. 14 Semiconductor Electronics'],
    summary: 'Count button presses with an interrupt so none are missed, and blink the LED on every tenth.',
    starterCode: STARTER('Interrupt-Driven Event Counter'),
    placement: [
      { type: 'arduino-uno', x: 80, y: 160 },
      { type: 'pushbutton', x: 400, y: 100 },
      { type: 'resistor', x: 640, y: 140 },
      { type: 'led', x: 760, y: 140 },
    ],
    wiring: [
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'pushbutton', toPin: '1', color: 'black' },
      { fromType: 'pushbutton', fromPin: '2', toType: 'arduino-uno', toPin: 'D2' },
      { fromType: 'arduino-uno', fromPin: 'D13', toType: 'resistor', toPin: '1' },
      { fromType: 'resistor', fromPin: '2', toType: 'led', toPin: 'A' },
      { fromType: 'led', fromPin: 'K', toType: 'arduino-uno', toPin: 'GND', color: 'black' },
    ],
    referenceSketch: `// Interrupt-Driven Event Counter
const int buttonPin = 2;
const int ledPin = 13;

volatile int count = 0;

void onPress() {
  count = count + 1;      // handlers must be quick: just count
}

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
  attachInterrupt(digitalPinToInterrupt(buttonPin), onPress, FALLING);
  Serial.begin(9600);
}

void loop() {
  if (count > 0 && count % 10 == 0) {
    digitalWrite(ledPin, HIGH);
    Serial.print("reached ");
    Serial.println(count);
    delay(300);
    digitalWrite(ledPin, LOW);
    count = count + 1;    // so the message fires once per ten
  }
}
`,
    steps: [
      {
        id: 's1',
        instruction: 'Place an Arduino Uno, a pushbutton, an LED and a resistor.',
        hint: 'The button signal goes to D2, which is an interrupt pin on the Uno.',
        whyItMatters: 'Only some pins can trigger an interrupt, and D2 is one of them.',
        validate: has('pushbutton'),
      },
      {
        id: 's2',
        instruction: 'Wire the button between D2 and GND, and the LED through the resistor to D13.',
        hint: 'Both need ground.',
        whyItMatters: 'The interrupt fires on a falling edge, which is what a pull-up gives you.',
        validate: wire('pushbutton', '2', 'arduino-uno', 'D2'),
      },
      {
        id: 's3',
        instruction: 'Declare the counter volatile.',
        hint: 'volatile int count = 0;',
        whyItMatters: 'The handler and the loop both touch it; volatile stops the compiler caching a stale copy.',
        validate: code('volatile'),
      },
      {
        id: 's4',
        instruction: 'Register the handler with attachInterrupt on FALLING.',
        hint: 'attachInterrupt(digitalPinToInterrupt(buttonPin), onPress, FALLING);',
        whyItMatters: 'Interrupts notice the press even while the loop is doing something else.',
        validate: code('attachInterrupt'),
      },
      {
        id: 's5',
        instruction: 'Keep the handler to a single increment, and do the reporting in loop().',
        hint: 'No Serial printing inside the handler.',
        whyItMatters: 'Long handlers block other interrupts and lose events.',
        validate: code('void onPress'),
      },
      {
        id: 's6',
        instruction: 'Run it and press the button ten times. The LED must blink and the count print.',
        hint: 'Inputs panel, toggle Pressed on and off repeatedly.',
        whyItMatters: 'You have just built the mechanism behind every people counter.',
        validate: manual('The counter reached ten and the LED blinked.'),
      },
    ],
    tags: ['interrupts', 'counter', 'advanced'],
  },

  {
    id: 'm10',
    slug: 'thermostat-hysteresis',
    title: 'Thermostat with Hysteresis',
    emoji: '🔥',
    level: 'Advanced',
    estMinutes: 30,
    components: ['arduino-uno', 'dht11', 'relay-1ch', 'led', 'resistor'],
    learningObjectives: [
      'Stop a relay chattering at the threshold with two limits',
      'Separate the switch-on point from the switch-off point',
      'Write control logic that is stable at the boundary',
    ],
    realWorldUse:
      'Every thermostat, fridge and geyser uses a dead band. Without it the relay buzzes and dies young.',
    prerequisites: ['temperature-display', 'smart-streetlight'],
    skills: ['ct.state', 'ct.conditional', 'pc.power-budget'],
    ncertAnchors: ['Class 10 Ch. 12 Electricity - heating effect of current'],
    summary: 'Hold a temperature band with two thresholds so the relay never chatters.',
    starterCode: STARTER('Thermostat with Hysteresis'),
    placement: [
      { type: 'arduino-uno', x: 80, y: 160 },
      { type: 'dht11', x: 400, y: 80 },
      { type: 'relay-1ch', x: 400, y: 240 },
      { type: 'resistor', x: 660, y: 300 },
      { type: 'led', x: 780, y: 300 },
    ],
    wiring: [
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'dht11', toPin: 'VCC', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'dht11', toPin: 'GND', color: 'black' },
      { fromType: 'dht11', fromPin: 'DATA', toType: 'arduino-uno', toPin: 'D2' },
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'relay-1ch', toPin: 'DC+', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'relay-1ch', toPin: 'DC-', color: 'black' },
      { fromType: 'relay-1ch', fromPin: 'IN', toType: 'arduino-uno', toPin: 'D8' },
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'relay-1ch', toPin: 'COM', color: 'red' },
      { fromType: 'relay-1ch', fromPin: 'NO', toType: 'resistor', toPin: '1' },
      { fromType: 'resistor', fromPin: '2', toType: 'led', toPin: 'A' },
      { fromType: 'led', fromPin: 'K', toType: 'arduino-uno', toPin: 'GND', color: 'black' },
    ],
    referenceSketch: `#include <DHT.h>

#define DHTPIN 2
#define DHTTYPE DHT11

DHT dht(DHTPIN, DHTTYPE);
const int relayPin = 8;

const float heatOn = 24.0;    // switch the heater on below this
const float heatOff = 27.0;   // and off again above this

bool heating = false;

void setup() {
  pinMode(relayPin, OUTPUT);
  digitalWrite(relayPin, HIGH);   // active LOW relay: start off
  dht.begin();
  Serial.begin(9600);
}

void loop() {
  float t = dht.readTemperature();

  if (!heating && t < heatOn) heating = true;
  else if (heating && t > heatOff) heating = false;

  digitalWrite(relayPin, heating ? LOW : HIGH);
  Serial.println(t);
  delay(500);
}
`,
    steps: [
      {
        id: 's1',
        instruction: 'Place an Arduino Uno, a DHT11, a relay, an LED and a resistor.',
        hint: 'Sensor, switch, and something to switch.',
        whyItMatters: 'A thermostat is a sensor, a decision and an actuator.',
        validate: has('dht11'),
      },
      {
        id: 's2',
        instruction: 'Wire the DHT11 DATA pin to D2.',
        hint: 'Plus 5V and GND.',
        whyItMatters: 'The temperature reading drives every decision that follows.',
        validate: wire('dht11', 'DATA', 'arduino-uno', 'D2'),
      },
      {
        id: 's3',
        instruction: 'Wire the relay: DC+ to 5V, DC− to GND, IN to D8, and NO through the LED to GND.',
        hint: 'The load side is separate from the control side.',
        whyItMatters: 'Keeping the load off the pin is what makes this safe.',
        validate: wire('relay-1ch', 'IN', 'arduino-uno', 'D8'),
      },
      {
        id: 's4',
        instruction: 'Use two thresholds: switch on below 24 °C and off above 27 °C.',
        hint: 'The gap between them is the dead band.',
        whyItMatters: 'With one threshold the relay would click on and off dozens of times a second.',
        validate: code('heating'),
      },
      {
        id: 's5',
        instruction: 'Track whether you are heating in a boolean, and only change it at the thresholds.',
        hint: 'The state variable is what stops the chatter.',
        whyItMatters: 'State plus two limits is the standard motor and heater pattern.',
        validate: code('bool'),
      },
      {
        id: 's5b',
        instruction: 'Prove it: at 20 °C the heater relay must be on (IN driven LOW).',
        hint: 'Below your lower threshold, heating becomes true and the active-LOW relay is driven LOW.',
        whyItMatters: 'A thermostat that does not heat a cold room is broken, however clever its logic.',
        validate: simPin('relay-1ch', 'IN', 0, { dhtTemperature: 20 }),
      },
      {
        id: 's5c',
        instruction: 'And at 30 °C the heater must be off (IN HIGH).',
        hint: 'Above the upper threshold, heating becomes false.',
        whyItMatters: 'Overheating wastes power and, in a greenhouse, kills plants.',
        validate: simPin('relay-1ch', 'IN', 1, { dhtTemperature: 30 }),
      },
      {
        id: 's6',
        instruction: 'Run it and sweep the temperature from 20 to 30 °C. The relay must switch once each way.',
        hint: 'Inputs panel, Temperature slider.',
        whyItMatters: 'One clean switch on the way down and one on the way up is exactly right.',
        validate: manual('The relay switched on below 24 and off above 27, once each.'),
      },
    ],
    tags: ['thermostat', 'relay', 'hysteresis', 'advanced'],
  },

  {
    id: 'm11',
    slug: 'buzzer-alarm-clock',
    title: 'Buzzer Alarm Clock',
    emoji: '⏰',
    level: 'Advanced',
    estMinutes: 35,
    components: ['arduino-uno', 'buzzer-passive', 'pushbutton', 'lcd-16x2-i2c'],
    learningObjectives: [
      'Schedule events with millis() instead of delay()',
      'Add a snooze that does not block the clock',
      'Show a running clock on an LCD',
    ],
    realWorldUse:
      'An alarm clock has to keep time, ring, and respond to a snooze button all at once.',
    prerequisites: ['temperature-display', 'traffic-light'],
    skills: ['ct.nonblocking-timing', 'ct.state', 'ct.abstraction'],
    ncertAnchors: ['Class 10 Ch. 12 Electricity - electric circuit and circuit diagrams'],
    summary: 'Keep a clock, ring a buzzer at a set time, and let a button snooze it.',
    starterCode: STARTER('Buzzer Alarm Clock'),
    placement: [
      { type: 'arduino-uno', x: 80, y: 160 },
      { type: 'buzzer-passive', x: 400, y: 80 },
      { type: 'pushbutton', x: 400, y: 220 },
      { type: 'lcd-16x2-i2c', x: 400, y: 340 },
    ],
    wiring: [
      { fromType: 'buzzer-passive', fromPin: '+', toType: 'arduino-uno', toPin: 'D8' },
      { fromType: 'buzzer-passive', fromPin: '-', toType: 'arduino-uno', toPin: 'GND', color: 'black' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'pushbutton', toPin: '1', color: 'black' },
      { fromType: 'pushbutton', fromPin: '2', toType: 'arduino-uno', toPin: 'D2' },
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'lcd-16x2-i2c', toPin: 'VCC', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'lcd-16x2-i2c', toPin: 'GND', color: 'black' },
      { fromType: 'lcd-16x2-i2c', fromPin: 'SDA', toType: 'arduino-uno', toPin: 'A4' },
      { fromType: 'lcd-16x2-i2c', fromPin: 'SCL', toType: 'arduino-uno', toPin: 'A5' },
    ],
    referenceSketch: `#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

const int buzzerPin = 8;
const int snoozePin = 2;

const unsigned long alarmAt = 10000;   // ring 10 seconds after start
unsigned long snoozeUntil = 0;
bool ringing = false;

void setup() {
  pinMode(buzzerPin, OUTPUT);
  pinMode(snoozePin, INPUT_PULLUP);
  lcd.init();
  lcd.backlight();
  Serial.begin(9600);
}

void loop() {
  unsigned long now = millis();

  lcd.setCursor(0, 0);
  lcd.print("Clock ");
  lcd.print(now / 1000);
  lcd.print(" s   ");

  if (now >= alarmAt && now > snoozeUntil) {
    ringing = true;
  }

  if (digitalRead(snoozePin) == LOW && ringing) {
    ringing = false;
    snoozeUntil = now + 5000;    // five more minutes of sleep, in demo seconds
    noTone(buzzerPin);
    lcd.setCursor(0, 1);
    lcd.print("snoozed        ");
    delay(250);
  }

  if (ringing) {
    tone(buzzerPin, 880);
    lcd.setCursor(0, 1);
    lcd.print("WAKE UP        ");
  } else {
    noTone(buzzerPin);
  }
}
`,
    steps: [
      {
        id: 's1',
        instruction: 'Place an Arduino Uno, a passive buzzer, a pushbutton and an I2C LCD.',
        hint: 'A passive buzzer needs tone(); an active one will not play notes.',
        whyItMatters: 'Passive buzzers are the ones that can make a tune.',
        validate: has('buzzer-passive'),
      },
      {
        id: 's2',
        instruction: 'Wire the buzzer to D8, the button to D2, and the LCD to A4 and A5.',
        hint: 'SDA to A4, SCL to A5.',
        whyItMatters: 'Three peripherals on one board, each with its own wires.',
        validate: wire('buzzer-passive', '+', 'arduino-uno', 'D8'),
      },
      {
        id: 's3',
        instruction: 'Keep time with millis() and print the elapsed seconds to the LCD.',
        hint: 'Do not use delay() for the clock; it would stop the clock.',
        whyItMatters: 'A clock that blocks cannot also watch a button.',
        validate: code('millis'),
      },
      {
        id: 's4',
        instruction: 'Ring the buzzer with tone() once the alarm time is reached.',
        hint: 'tone(pin, 880) plays a 880 Hz note continuously.',
        whyItMatters: 'tone() drives a square wave, which is what a piezo needs.',
        validate: code('tone('),
      },
      {
        id: 's5',
        instruction: 'Let the button snooze the alarm for a further period.',
        hint: 'Record snoozeUntil = millis() + 5000 and stop ringing until then.',
        whyItMatters: 'Snooze is a timer that runs alongside the clock, not instead of it.',
        validate: code('snoozeUntil'),
      },
      {
        id: 's6',
        instruction: 'Run it. The clock counts, the alarm rings, and the button snoozes it.',
        hint: 'The alarm is set 10 seconds after start so you do not have to wait.',
        whyItMatters: 'Three things happening at once is what non-blocking timing buys you.',
        validate: manual('The clock ran, the buzzer rang, and pressing the button snoozed it.'),
      },
    ],
    tags: ['clock', 'tone', 'millis', 'advanced'],
  },

  {
    id: 'm12',
    slug: 'ultrasonic-parking-radar',
    title: 'Ultrasonic Parking Radar',
    emoji: '📏',
    level: 'Advanced',
    estMinutes: 40,
    components: ['arduino-uno', 'hc-sr04', 'buzzer-active', 'led', 'resistor'],
    learningObjectives: [
      'Measure distance by timing an echo with pulseIn()',
      'Turn microseconds into centimetres using the speed of sound',
      'Vary a warning rate with distance',
    ],
    realWorldUse:
      'Reverse parking sensors beep faster as the wall gets closer, using exactly this calculation.',
    prerequisites: ['motion-alarm'],
    skills: ['pc.signal-pin', 'ct.analog-io', 'ct.conditional'],
    ncertAnchors: ['Class 9 Ch. 12 Sound - reflection of sound waves, echo'],
    summary: 'Measure distance with an HC-SR04 and beep faster the closer the obstacle gets.',
    starterCode: STARTER('Ultrasonic Parking Radar'),
    placement: [
      { type: 'arduino-uno', x: 80, y: 160 },
      { type: 'hc-sr04', x: 400, y: 90 },
      { type: 'buzzer-active', x: 400, y: 260 },
      { type: 'resistor', x: 660, y: 140 },
      { type: 'led', x: 780, y: 140 },
    ],
    wiring: [
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'hc-sr04', toPin: 'VCC', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'hc-sr04', toPin: 'GND', color: 'black' },
      { fromType: 'hc-sr04', fromPin: 'TRIG', toType: 'arduino-uno', toPin: 'D9' },
      { fromType: 'hc-sr04', fromPin: 'ECHO', toType: 'arduino-uno', toPin: 'D10' },
      { fromType: 'buzzer-active', fromPin: '+', toType: 'arduino-uno', toPin: 'D8' },
      { fromType: 'buzzer-active', fromPin: '-', toType: 'arduino-uno', toPin: 'GND', color: 'black' },
      { fromType: 'arduino-uno', fromPin: 'D13', toType: 'resistor', toPin: '1' },
      { fromType: 'resistor', fromPin: '2', toType: 'led', toPin: 'A' },
      { fromType: 'led', fromPin: 'K', toType: 'arduino-uno', toPin: 'GND', color: 'black' },
    ],
    referenceSketch: `// Ultrasonic Parking Radar
const int trigPin = 9;
const int echoPin = 10;
const int buzzerPin = 8;
const int ledPin = 13;

long measureCm() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  long duration = pulseIn(echoPin, HIGH);
  return duration * 0.034 / 2;      // 0.034 cm per microsecond, there and back
}

void setup() {
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  pinMode(buzzerPin, OUTPUT);
  pinMode(ledPin, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  long cm = measureCm();
  Serial.print(cm);
  Serial.println(" cm");

  if (cm > 0 && cm < 30) {
    digitalWrite(ledPin, HIGH);
    long gap = map(cm, 2, 30, 60, 600);   // closer means faster beeps
    digitalWrite(buzzerPin, HIGH);
    delay(gap);
    digitalWrite(buzzerPin, LOW);
    delay(gap);
  } else {
    digitalWrite(ledPin, LOW);
    digitalWrite(buzzerPin, LOW);
    delay(60);
  }
}
`,
    steps: [
      {
        id: 's1',
        instruction: 'Place an Arduino Uno, an HC-SR04, a buzzer, an LED and a resistor.',
        hint: 'The HC-SR04 has four pins: VCC, TRIG, ECHO, GND.',
        whyItMatters: 'Four pins and a pulse is all it takes to measure distance.',
        validate: has('hc-sr04'),
      },
      {
        id: 's2',
        instruction: 'Wire TRIG to D9 and ECHO to D10, plus 5V and GND.',
        hint: 'TRIG is an output, ECHO is an input.',
        whyItMatters: 'The board starts the ping and times the echo.',
        validate: wire('hc-sr04', 'TRIG', 'arduino-uno', 'D9'),
      },
      {
        id: 's3',
        instruction: 'Send a 10 microsecond pulse on TRIG inside a measuring function.',
        hint: 'LOW, wait 2 µs, HIGH, wait 10 µs, LOW.',
        whyItMatters: 'That pulse is the trigger the datasheet requires.',
        validate: code('delayMicroseconds(10)'),
      },
      {
        id: 's4',
        instruction: 'Time the echo with pulseIn(echoPin, HIGH) and convert it to centimetres.',
        hint: 'duration * 0.034 / 2.',
        whyItMatters: 'Sound travels 0.034 cm per microsecond, and the pulse went there and back.',
        validate: code('pulseIn'),
      },
      {
        id: 's5',
        instruction: 'Beep faster as the distance shrinks, using map() for the gap.',
        hint: 'map(cm, 2, 30, 60, 600).',
        whyItMatters: 'Rate of beeping carries information, which is why parking sensors work.',
        validate: code('map('),
      },
      {
        id: 's5b',
        instruction: 'Prove it: with an object at 50 cm, the sketch must print a distance of about 50 cm.',
        hint: 'Print the value you computed from pulseIn, followed by " cm". Within a centimetre either way counts: integer maths truncates, as it does on the real board.',
        whyItMatters: 'Printing what the sensor sees is the fastest way to find out whether your maths is right.',
        validate: simOut('/\\b(49|50|51) cm/', { hcSr04Distance: 50 }),
      },
      {
        id: 's6',
        instruction: 'Run it and drag the distance slider closer. The beeps must speed up.',
        hint: 'Inputs panel, Distance slider.',
        whyItMatters: 'You have just replicated a reversing sensor.',
        validate: manual('The beeping sped up as the distance decreased.'),
      },
    ],
    tags: ['ultrasonic', 'distance', 'pulseIn', 'advanced'],
  },

  {
    id: 'm13',
    slug: 'servo-barrier-gate',
    title: 'Servo Barrier Gate',
    emoji: '🚧',
    level: 'Advanced',
    estMinutes: 30,
    components: ['arduino-uno', 'servo-sg90', 'pushbutton', 'hc-sr04'],
    learningObjectives: [
      'Sequence two actions with a hold condition',
      'Keep a gate open until the way is clear',
      'Combine a manual request with an automatic safety check',
    ],
    realWorldUse:
      'Parking barriers lift on a ticket and stay up until the sensor says the car has passed.',
    prerequisites: ['obstacle-avoiding-logic'],
    skills: ['ct.state', 'ct.conditional', 'pc.signal-pin'],
    ncertAnchors: ['Class 10 Ch. 12 Electricity - electric circuit and circuit diagrams'],
    summary: 'Lift a barrier when a button is pressed and hold it until the vehicle has cleared.',
    starterCode: STARTER('Servo Barrier Gate'),
    placement: [
      { type: 'arduino-uno', x: 80, y: 160 },
      { type: 'servo-sg90', x: 420, y: 90 },
      { type: 'pushbutton', x: 420, y: 230 },
      { type: 'hc-sr04', x: 420, y: 350 },
    ],
    wiring: [
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'servo-sg90', toPin: 'VCC', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'servo-sg90', toPin: 'GND', color: 'black' },
      { fromType: 'servo-sg90', fromPin: 'SIG', toType: 'arduino-uno', toPin: 'D9' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'pushbutton', toPin: '1', color: 'black' },
      { fromType: 'pushbutton', fromPin: '2', toType: 'arduino-uno', toPin: 'D2' },
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'hc-sr04', toPin: 'VCC', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'hc-sr04', toPin: 'GND', color: 'black' },
      { fromType: 'hc-sr04', fromPin: 'TRIG', toType: 'arduino-uno', toPin: 'D5' },
      { fromType: 'hc-sr04', fromPin: 'ECHO', toType: 'arduino-uno', toPin: 'D6' },
    ],
    referenceSketch: `#include <Servo.h>

Servo barrier;
const int buttonPin = 2;
const int trigPin = 5;
const int echoPin = 6;

const int closedAngle = 0;
const int openAngle = 90;

bool open = false;

long distanceCm() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  long duration = pulseIn(echoPin, HIGH);
  return duration * 0.034 / 2;
}

void setup() {
  barrier.attach(9);
  barrier.write(closedAngle);
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
}

void loop() {
  if (!open && digitalRead(buttonPin) == LOW) {
    barrier.write(openAngle);
    open = true;
    delay(500);
  }

  // Hold the gate up while anything is still in the way.
  if (open) {
    long cm = distanceCm();
    if (cm <= 0 || cm > 40) {
      barrier.write(closedAngle);
      open = false;
      delay(500);
    }
  }
  delay(100);
}
`,
    steps: [
      {
        id: 's1',
        instruction: 'Place an Arduino Uno, an SG90 servo, a pushbutton and an HC-SR04.',
        hint: 'Servo in Motor, sensor in Sensor.',
        whyItMatters: 'A barrier needs both a request and a safety check.',
        validate: has('servo-sg90'),
      },
      {
        id: 's2',
        instruction: 'Wire the servo signal to D9, the button to D2, and TRIG/ECHO to D5/D6.',
        hint: 'Three devices, each with its own pins.',
        whyItMatters: 'Pin planning is a real skill: no two devices share a signal pin.',
        validate: wire('servo-sg90', 'SIG', 'arduino-uno', 'D9'),
      },
      {
        id: 's3',
        instruction: 'Start the barrier closed and open it only when the button is pressed.',
        hint: 'barrier.write(0) is closed, 90 is open.',
        whyItMatters: 'Starting from a known safe state is what real gates do on power-up.',
        validate: code('barrier.attach'),
      },
      {
        id: 's4',
        instruction: 'While the gate is open, keep measuring distance and hold it open until the way is clear.',
        hint: 'Only close when the measured distance is greater than 40 cm.',
        whyItMatters: 'This is the safety rule: never close on top of a vehicle.',
        validate: code('distanceCm'),
      },
      {
        id: 's5',
        instruction: 'Run it: press the button to open, then move the distance slider past 40 cm to close.',
        hint: 'Inputs panel: Pressed toggle and Distance slider.',
        whyItMatters: 'You have built the exact logic a parking barrier uses.',
        validate: manual('The gate opened on the button and closed once the way was clear.'),
      },
    ],
    tags: ['servo', 'ultrasonic', 'sequencing', 'advanced'],
  },

  {
    id: 'm14',
    slug: 'oled-reaction-timer',
    title: 'OLED Reaction Timer',
    emoji: '⚡',
    level: 'Advanced',
    estMinutes: 40,
    components: ['arduino-uno', 'oled-128x64', 'pushbutton', 'buzzer-passive'],
    learningObjectives: [
      'Wait a random interval before starting a trial',
      'Measure a response time in milliseconds',
      'Show a score and a best on an OLED',
    ],
    realWorldUse:
      'Reaction timers are used in sports science and driver testing, and the same timing logic drives them all.',
    prerequisites: ['temperature-display', 'interrupt-counter'],
    skills: ['ct.nonblocking-timing', 'ct.state', 'ct.abstraction'],
    ncertAnchors: ['Class 9 Ch. 8 Motion - measurement of time'],
    summary: 'Test reaction time: wait a random delay, show GO, and measure how fast the button is pressed.',
    starterCode: STARTER('OLED Reaction Timer'),
    placement: [
      { type: 'arduino-uno', x: 80, y: 160 },
      { type: 'oled-128x64', x: 420, y: 90 },
      { type: 'pushbutton', x: 420, y: 250 },
      { type: 'buzzer-passive', x: 420, y: 360 },
    ],
    wiring: [
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'oled-128x64', toPin: 'VCC', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'oled-128x64', toPin: 'GND', color: 'black' },
      { fromType: 'oled-128x64', fromPin: 'SDA', toType: 'arduino-uno', toPin: 'A4' },
      { fromType: 'oled-128x64', fromPin: 'SCL', toType: 'arduino-uno', toPin: 'A5' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'pushbutton', toPin: '1', color: 'black' },
      { fromType: 'pushbutton', fromPin: '2', toType: 'arduino-uno', toPin: 'D2' },
      { fromType: 'buzzer-passive', fromPin: '+', toType: 'arduino-uno', toPin: 'D8' },
      { fromType: 'buzzer-passive', fromPin: '-', toType: 'arduino-uno', toPin: 'GND', color: 'black' },
    ],
    referenceSketch: `#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);

const int buttonPin = 2;
const int buzzerPin = 8;

int state = 0;             // 0 waiting, 1 armed, 2 showing result
unsigned long waitUntil = 0;
unsigned long goAt = 0;
unsigned long best = 9999;

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(buzzerPin, OUTPUT);
  randomSeed(analogRead(A2));
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  display.clearDisplay();
  display.setTextSize(2);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Ready");
  display.display();
}

void loop() {
  unsigned long now = millis();

  if (state == 0) {
    state = 1;
    waitUntil = now + random(1500, 4000);
  } else if (state == 1 && now >= waitUntil) {
    state = 2;
    goAt = now;
    tone(buzzerPin, 1200, 80);
    display.clearDisplay();
    display.setTextSize(3);
    display.setCursor(10, 20);
    display.println("GO!");
    display.display();
  } else if (state == 2 && digitalRead(buttonPin) == LOW) {
    unsigned long reaction = now - goAt;
    if (reaction < best) best = reaction;
    noTone(buzzerPin);
    display.clearDisplay();
    display.setTextSize(2);
    display.setCursor(0, 0);
    display.print(reaction);
    display.println(" ms");
    display.print("best ");
    display.print(best);
    display.display();
    state = 0;
    delay(1500);
  }
}
`,
    steps: [
      {
        id: 's1',
        instruction: 'Place an Arduino Uno, an OLED display, a pushbutton and a passive buzzer.',
        hint: 'The OLED is a Display; it uses I2C.',
        whyItMatters: 'An OLED gives you room for large text and numbers.',
        validate: has('oled-128x64'),
      },
      {
        id: 's2',
        instruction: 'Wire the OLED to 5V, GND, A4 (SDA) and A5 (SCL).',
        hint: 'Same two I2C pins as the character LCD.',
        whyItMatters: 'I2C is a bus: many devices, the same two wires.',
        validate: wire('oled-128x64', 'SDA', 'arduino-uno', 'A4'),
      },
      {
        id: 's3',
        instruction: 'Wire the button to D2 and the buzzer to D8.',
        hint: 'Both need ground.',
        whyItMatters: 'The button is the input you time; the buzzer is the GO signal.',
        validate: wire('pushbutton', '2', 'arduino-uno', 'D2'),
      },
      {
        id: 's4',
        instruction: 'Wait a random interval between 1.5 and 4 seconds before showing GO.',
        hint: 'random(1500, 4000).',
        whyItMatters: 'A fixed delay would let you anticipate it, which ruins the test.',
        validate: code('random('),
      },
      {
        id: 's5',
        instruction: 'Record millis() when GO appears and subtract it when the button is pressed.',
        hint: 'reaction = millis() - goAt.',
        whyItMatters: 'That subtraction is the whole measurement.',
        validate: code('goAt'),
      },
      {
        id: 's6',
        instruction: 'Show the time and the best time on the OLED.',
        hint: 'display.clearDisplay(), setCursor, print, display.display().',
        whyItMatters: 'Nothing appears on an OLED until you call display().',
        validate: code('display.display'),
      },
      {
        id: 's7',
        instruction: 'Run it, wait for GO, and press the button. Your reaction time must appear.',
        hint: 'Inputs panel, Pressed toggle.',
        whyItMatters: 'You have built a real instrument.',
        validate: manual('My reaction time appeared on the OLED.'),
      },
    ],
    tags: ['oled', 'timing', 'game', 'advanced'],
  },

  {
    id: 'm15',
    slug: 'gas-leak-shutoff',
    title: 'Gas Leak Shutoff',
    emoji: '🛑',
    level: 'Advanced',
    estMinutes: 60,
    components: ['arduino-uno', 'mq2-gas', 'relay-1ch', 'buzzer-active', 'pushbutton'],
    learningObjectives: [
      'Latch an alarm so it stays on after the trigger clears',
      'Require a deliberate action to reset a safety system',
      'Use two thresholds to avoid nuisance trips',
    ],
    realWorldUse:
      'Kitchen gas valves latch shut on a leak and stay shut until a person resets them by hand.',
    prerequisites: ['smart-streetlight', 'thermostat-hysteresis'],
    skills: ['ct.state', 'pc.power-budget', 'al.self-diagnosis', 'ct.conditional'],
    ncertAnchors: ['Class 10 Ch. 12 Electricity - heating effect of current'],
    summary: 'Shut a valve and latch the alarm when gas is detected, until someone resets it.',
    starterCode: STARTER('Gas Leak Shutoff'),
    placement: [
      { type: 'arduino-uno', x: 80, y: 160 },
      { type: 'mq2-gas', x: 400, y: 70 },
      { type: 'relay-1ch', x: 400, y: 200 },
      { type: 'buzzer-active', x: 400, y: 310 },
      { type: 'pushbutton', x: 400, y: 410 },
    ],
    wiring: [
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'mq2-gas', toPin: 'VCC', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'mq2-gas', toPin: 'GND', color: 'black' },
      { fromType: 'mq2-gas', fromPin: 'AO', toType: 'arduino-uno', toPin: 'A1' },
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'relay-1ch', toPin: 'DC+', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'relay-1ch', toPin: 'DC-', color: 'black' },
      { fromType: 'relay-1ch', fromPin: 'IN', toType: 'arduino-uno', toPin: 'D8' },
      { fromType: 'buzzer-active', fromPin: '+', toType: 'arduino-uno', toPin: 'D7' },
      { fromType: 'buzzer-active', fromPin: '-', toType: 'arduino-uno', toPin: 'GND', color: 'black' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'pushbutton', toPin: '1', color: 'black' },
      { fromType: 'pushbutton', fromPin: '2', toType: 'arduino-uno', toPin: 'D2' },
    ],
    referenceSketch: `// Gas Leak Shutoff: a latched safety system.
const int gasPin = A1;
const int valvePin = 8;
const int buzzerPin = 7;
const int resetPin = 2;

const int tripLevel = 400;    // gas concentration that trips the valve
const int clearLevel = 250;   // must fall below this before a reset is allowed

bool latched = false;

void setup() {
  pinMode(valvePin, OUTPUT);
  pinMode(buzzerPin, OUTPUT);
  pinMode(resetPin, INPUT_PULLUP);
  digitalWrite(valvePin, HIGH);   // active LOW relay: valve open
  Serial.begin(9600);
}

void loop() {
  int gas = analogRead(gasPin);
  Serial.println(gas);

  if (gas > tripLevel) latched = true;

  if (latched) {
    digitalWrite(valvePin, LOW);      // close the valve
    digitalWrite(buzzerPin, HIGH);    // and sound the alarm
  } else {
    digitalWrite(valvePin, HIGH);
    digitalWrite(buzzerPin, LOW);
  }

  // A reset only works once the air has actually cleared.
  if (latched && digitalRead(resetPin) == LOW && gas < clearLevel) {
    latched = false;
    delay(400);
  }
  delay(100);
}
`,
    steps: [
      {
        id: 's1',
        instruction: 'Place an Arduino Uno, an MQ-2 gas sensor, a relay, a buzzer and a button.',
        hint: 'MQ-2 is a Sensor; its heater draws real current, so it needs 5 V.',
        whyItMatters: 'A safety system needs a sensor, an actuator and a way back to normal.',
        validate: has('mq2-gas'),
      },
      {
        id: 's2',
        instruction: 'Wire the MQ-2 AO to A1, with 5V and GND.',
        hint: 'Analog output carries the concentration.',
        whyItMatters: 'Thresholds only work on a reading you trust.',
        validate: wire('mq2-gas', 'AO', 'arduino-uno', 'A1'),
      },
      {
        id: 's3',
        instruction: 'Wire the relay IN to D8, the buzzer + to D7, and the reset button to D2.',
        hint: 'Three outputs and one input.',
        whyItMatters: 'The valve, the alarm and the reset are three separate concerns.',
        validate: wire('relay-1ch', 'IN', 'arduino-uno', 'D8'),
      },
      {
        id: 's4',
        instruction: 'Latch the alarm: once gas is detected, stay latched even if the level falls.',
        hint: 'A boolean that only ever gets set true here.',
        whyItMatters: 'An alarm that switches itself off the moment the reading dips is worse than no alarm.',
        validate: code('latched'),
      },
      {
        id: 's5',
        instruction: 'Only allow a reset when the gas has fallen below a second, lower threshold.',
        hint: 'Two thresholds: tripLevel to latch, clearLevel to allow reset.',
        whyItMatters: 'This is the same dead-band idea as the thermostat, applied to safety.',
        validate: code('clearLevel'),
      },
      {
        id: 's5b',
        instruction: 'Prove it: when the gas level passes the trip point, the valve relay must close off (IN driven LOW).',
        hint: 'Your trip level is compared with analogRead on the MQ-2 pin.',
        whyItMatters: 'A shutoff that does not trip is the one failure a safety system is not allowed to have.',
        validate: simPin('relay-1ch', 'IN', 0, { gasLevel: 700 }),
      },
      {
        id: 's5c',
        instruction: 'And in clean air the valve must stay open (IN HIGH).',
        hint: 'Active-LOW relay: HIGH means off, so the valve stays open.',
        whyItMatters: 'A valve that closes for no reason shuts off cooking gas in a hundred kitchens at dinner time.',
        validate: simPin('relay-1ch', 'IN', 1, { gasLevel: 100 }),
      },
      {
        id: 's6',
        instruction: 'Run it: raise the gas level to trip it, lower it, and confirm the alarm stays on until you reset.',
        hint: 'Inputs panel, gas concentration slider, then the Pressed toggle.',
        whyItMatters: 'Proving the latch holds is the entire point of this mission.',
        validate: manual('The alarm latched and stayed on until I pressed reset with the gas cleared.'),
      },
    ],
    tags: ['safety', 'latching', 'relay', 'advanced'],
  },

  {
    id: 'm16',
    slug: 'smart-greenhouse',
    title: 'Smart Greenhouse Climate',
    emoji: '🌱',
    level: 'Advanced',
    estMinutes: 45,
    components: [
      'arduino-uno',
      'dht11',
      'soil-moisture',
      'servo-sg90',
      'relay-1ch',
      'lcd-16x2-i2c',
    ],
    learningObjectives: [
      'Coordinate several actuators from one loop',
      'Balance temperature, moisture and light in one decision',
      'Write a control loop that runs unattended',
    ],
    realWorldUse:
      'Greenhouses and vertical farms run exactly this loop: vent when hot, water when dry, report on a display.',
    prerequisites: ['temperature-display', 'thermostat-hysteresis', 'obstacle-avoiding-logic'],
    skills: ['ct.state', 'ct.nonblocking-timing', 'pc.power-budget', 'al.exploration'],
    ncertAnchors: ['Class 10 Ch. 12 Electricity - heating effect of current'],
    summary: 'Run a greenhouse: vent when it is hot, water when the soil is dry, and report on an LCD.',
    starterCode: STARTER('Smart Greenhouse Climate'),
    placement: [
      { type: 'arduino-uno', x: 60, y: 160 },
      { type: 'dht11', x: 360, y: 70 },
      { type: 'soil-moisture', x: 360, y: 180 },
      { type: 'servo-sg90', x: 360, y: 290 },
      { type: 'relay-1ch', x: 360, y: 400 },
      { type: 'lcd-16x2-i2c', x: 660, y: 200 },
    ],
    wiring: [
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'dht11', toPin: 'VCC', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'dht11', toPin: 'GND', color: 'black' },
      { fromType: 'dht11', fromPin: 'DATA', toType: 'arduino-uno', toPin: 'D2' },
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'soil-moisture', toPin: 'VCC', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'soil-moisture', toPin: 'GND', color: 'black' },
      { fromType: 'soil-moisture', fromPin: 'AO', toType: 'arduino-uno', toPin: 'A1' },
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'servo-sg90', toPin: 'VCC', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'servo-sg90', toPin: 'GND', color: 'black' },
      { fromType: 'servo-sg90', fromPin: 'SIG', toType: 'arduino-uno', toPin: 'D9' },
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'relay-1ch', toPin: 'DC+', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'relay-1ch', toPin: 'DC-', color: 'black' },
      { fromType: 'relay-1ch', fromPin: 'IN', toType: 'arduino-uno', toPin: 'D8' },
      { fromType: 'arduino-uno', fromPin: '5V', toType: 'lcd-16x2-i2c', toPin: 'VCC', color: 'red' },
      { fromType: 'arduino-uno', fromPin: 'GND', toType: 'lcd-16x2-i2c', toPin: 'GND', color: 'black' },
      { fromType: 'lcd-16x2-i2c', fromPin: 'SDA', toType: 'arduino-uno', toPin: 'A4' },
      { fromType: 'lcd-16x2-i2c', fromPin: 'SCL', toType: 'arduino-uno', toPin: 'A5' },
    ],
    referenceSketch: `#include <DHT.h>
#include <LiquidCrystal_I2C.h>
#include <Servo.h>

#define DHTPIN 2
#define DHTTYPE DHT11

DHT dht(DHTPIN, DHTTYPE);
LiquidCrystal_I2C lcd(0x27, 16, 2);
Servo vent;

const int soilPin = A1;
const int pumpPin = 8;

const float ventAbove = 28.0;     // open the vent when hotter than this
const float ventBelow = 24.0;     // and close it again below this
const int drySoil = 300;          // water when the soil reads drier than this

bool ventOpen = false;

void setup() {
  dht.begin();
  lcd.init();
  lcd.backlight();
  vent.attach(9);
  vent.write(0);                  // closed
  pinMode(pumpPin, OUTPUT);
  digitalWrite(pumpPin, HIGH);    // active LOW relay: pump off
  Serial.begin(9600);
}

void loop() {
  float t = dht.readTemperature();
  int soil = analogRead(soilPin);

  if (!ventOpen && t > ventAbove) { vent.write(90); ventOpen = true; }
  else if (ventOpen && t < ventBelow) { vent.write(0); ventOpen = false; }

  if (soil < drySoil) digitalWrite(pumpPin, LOW);
  else digitalWrite(pumpPin, HIGH);

  lcd.setCursor(0, 0);
  lcd.print("T:");
  lcd.print(t);
  lcd.print("C  V:");
  lcd.print(ventOpen ? "open " : "shut ");

  lcd.setCursor(0, 1);
  lcd.print("soil ");
  lcd.print(soil);
  lcd.print("     ");

  Serial.print(t);
  Serial.print(" C, soil ");
  Serial.println(soil);
  delay(500);
}
`,
    steps: [
      {
        id: 's1',
        instruction: 'Place an Arduino Uno, DHT11, soil moisture sensor, servo, relay and LCD.',
        hint: 'This is the biggest circuit in the course: six parts.',
        whyItMatters: 'Real systems coordinate several sensors and actuators at once.',
        validate: has('soil-moisture'),
      },
      {
        id: 's2',
        instruction: 'Wire the DHT11 to D2 and the soil sensor to A1, both with 5V and GND.',
        hint: 'Two sensors, two different pins.',
        whyItMatters: 'Each sensor gets its own pin so the readings never get mixed up.',
        validate: wire('soil-moisture', 'AO', 'arduino-uno', 'A1'),
      },
      {
        id: 's3',
        instruction: 'Wire the servo vent to D9 and the pump relay to D8.',
        hint: 'Servo signal is PWM; the relay is a plain digital pin.',
        whyItMatters: 'Two actuators, two kinds of output.',
        validate: wire('relay-1ch', 'IN', 'arduino-uno', 'D8'),
      },
      {
        id: 's4',
        instruction: 'Wire the LCD to A4 and A5 and initialise it.',
        hint: 'SDA to A4, SCL to A5, then lcd.init() and lcd.backlight().',
        whyItMatters: 'A greenhouse nobody can read is a greenhouse nobody trusts.',
        validate: wire('lcd-16x2-i2c', 'SDA', 'arduino-uno', 'A4'),
      },
      {
        id: 's5',
        instruction: 'Open the vent above 28 °C and close it below 24 °C, using hysteresis.',
        hint: 'Same two-threshold pattern as the thermostat.',
        whyItMatters: 'Hysteresis stops the servo hunting around the set point.',
        validate: code('ventOpen'),
      },
      {
        id: 's6',
        instruction: 'Run the pump when the soil reads drier than your threshold.',
        hint: 'Low readings mean dry soil on this sensor.',
        whyItMatters: 'Watering on a threshold is the simplest useful irrigation controller.',
        validate: code('drySoil'),
      },
      {
        id: 's7',
        instruction: 'Report temperature, vent state and soil moisture on the LCD.',
        hint: 'Two rows of sixteen characters: plan your layout.',
        whyItMatters: 'A good display tells the whole story at a glance.',
        validate: code('lcd.print'),
      },
      {
        id: 's8',
        instruction: 'Run it and drive the greenhouse hot, then dry, checking each actuator responds.',
        hint: 'Inputs panel: temperature and soil moisture sliders.',
        whyItMatters: 'This is a complete control system, and it is yours.',
        validate: manual('The vent opened when hot, the pump ran when dry, and the LCD reported both.'),
      },
    ],
    tags: ['greenhouse', 'control loop', 'multi-actuator', 'advanced'],
  },
];

export function missionBySlug(slug: string): Mission | undefined {
  return MISSIONS.find((m) => m.slug === slug);
}

export function missionIndex(slug: string): number {
  return MISSIONS.findIndex((m) => m.slug === slug);
}
