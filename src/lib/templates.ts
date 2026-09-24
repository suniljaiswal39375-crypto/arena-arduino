import { createProject, makePart, makeWire } from '@/lib/doc/factory';
import type { ProjectDoc, WireColor } from '@/lib/doc/types';
import { getPart } from '@/lib/parts';

interface TemplateSpec {
  slug: string;
  name: string;
  description: string;
  board: string;
  parts: Array<{ id: string; type: string; x: number; y: number }>;
  wires: Array<[string, string, string, string, WireColor?]>;
  code: string;
  inputs?: Record<string, number>;
}

const TEMPLATES: TemplateSpec[] = [
  {
    slug: 'uno-blink',
    name: 'Blink',
    description: 'The hello world of hardware: an LED on D13.',
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 80, y: 140 },
      { id: 'r1', type: 'resistor', x: 420, y: 150 },
      { id: 'led1', type: 'led', x: 580, y: 150 },
    ],
    wires: [
      ['uno', 'D13', 'r1', '1'],
      ['r1', '2', 'led1', 'A'],
      ['led1', 'K', 'uno', 'GND', 'black'],
    ],
    code: `void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`,
  },
  {
    slug: 'button-led',
    name: 'Button and LED',
    description: 'Read a button with INPUT_PULLUP and light an LED.',
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 80, y: 140 },
      { id: 'btn', type: 'pushbutton', x: 420, y: 120 },
      { id: 'r1', type: 'resistor', x: 420, y: 240 },
      { id: 'led1', type: 'led', x: 580, y: 240 },
    ],
    wires: [
      ['uno', 'GND', 'btn', '1', 'black'],
      ['btn', '2', 'uno', 'D2'],
      ['uno', 'D13', 'r1', '1'],
      ['r1', '2', 'led1', 'A'],
      ['led1', 'K', 'uno', 'GND', 'black'],
    ],
    code: `const int buttonPin = 2;
const int ledPin = 13;

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
}

void loop() {
  // Pressed reads LOW because INPUT_PULLUP holds the pin HIGH.
  digitalWrite(ledPin, digitalRead(buttonPin) == LOW ? HIGH : LOW);
}
`,
    inputs: { buttonPressed: 0 },
  },
  {
    slug: 'ldr-relay-lamp',
    name: 'Streetlight',
    description: 'An LDR decides, a relay carries the load.',
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 60, y: 150 },
      { id: 'ldr', type: 'ldr-module', x: 400, y: 90 },
      { id: 'relay', type: 'relay-1ch', x: 400, y: 260 },
      { id: 'r1', type: 'resistor', x: 660, y: 300 },
      { id: 'led1', type: 'led', x: 800, y: 300 },
    ],
    wires: [
      ['uno', '5V', 'ldr', 'VCC', 'red'],
      ['uno', 'GND', 'ldr', 'GND', 'black'],
      ['ldr', 'AO', 'uno', 'A0'],
      ['uno', '5V', 'relay', 'DC+', 'red'],
      ['uno', 'GND', 'relay', 'DC-', 'black'],
      ['relay', 'IN', 'uno', 'D8'],
      ['relay', 'NO', 'r1', '1'],
      ['r1', '2', 'led1', 'A'],
      ['led1', 'K', 'uno', 'GND', 'black'],
    ],
    code: `const int ldrPin = A0;
const int relayPin = 8;

void setup() {
  pinMode(relayPin, OUTPUT);
  digitalWrite(relayPin, HIGH);   // active LOW relay: start off
  Serial.begin(9600);
}

void loop() {
  int light = analogRead(ldrPin);
  Serial.println(light);
  digitalWrite(relayPin, light < 400 ? LOW : HIGH);
  delay(200);
}
`,
    inputs: { ldrLux: 320 },
  },
  {
    slug: 'dht-lcd',
    name: 'DHT11 and LCD',
    description: 'Read temperature and humidity onto a 16x2 I2C display.',
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 60, y: 150 },
      { id: 'dht', type: 'dht11', x: 400, y: 90 },
      { id: 'lcd', type: 'lcd-16x2-i2c', x: 400, y: 270 },
    ],
    wires: [
      ['uno', '5V', 'dht', 'VCC', 'red'],
      ['uno', 'GND', 'dht', 'GND', 'black'],
      ['dht', 'DATA', 'uno', 'D2'],
      ['uno', '5V', 'lcd', 'VCC', 'red'],
      ['uno', 'GND', 'lcd', 'GND', 'black'],
      ['lcd', 'SDA', 'uno', 'A4'],
      ['lcd', 'SCL', 'uno', 'A5'],
    ],
    code: `#include <DHT.h>
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
  lcd.setCursor(6, 0);
  lcd.print(dht.readTemperature());
  lcd.print(" C   ");
  lcd.setCursor(10, 1);
  lcd.print(dht.readHumidity());
  lcd.print(" %   ");
  delay(2000);
}
`,
    inputs: { dhtTemperature: 27, dhtHumidity: 55 },
  },
  {
    slug: 'ultrasonic-radar',
    name: 'Ultrasonic radar',
    description: 'Measure distance with an HC-SR04 and beep faster as it closes in.',
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 60, y: 150 },
      { id: 'us', type: 'hc-sr04', x: 400, y: 100 },
      { id: 'bz', type: 'buzzer-active', x: 400, y: 280 },
    ],
    wires: [
      ['uno', '5V', 'us', 'VCC', 'red'],
      ['uno', 'GND', 'us', 'GND', 'black'],
      ['us', 'TRIG', 'uno', 'D9'],
      ['us', 'ECHO', 'uno', 'D10'],
      ['bz', '+', 'uno', 'D8'],
      ['bz', '-', 'uno', 'GND', 'black'],
    ],
    code: `const int trigPin = 9;
const int echoPin = 10;
const int buzzerPin = 8;

void setup() {
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  pinMode(buzzerPin, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  long duration = pulseIn(echoPin, HIGH);
  long cm = duration * 0.034 / 2;
  Serial.print(cm);
  Serial.println(" cm");

  if (cm > 0 && cm < 30) {
    long gap = map(cm, 2, 30, 60, 600);
    digitalWrite(buzzerPin, HIGH);
    delay(gap);
    digitalWrite(buzzerPin, LOW);
    delay(gap);
  } else {
    delay(60);
  }
}
`,
    inputs: { hcSr04Distance: 42 },
  },
];

export interface TemplateSummary {
  slug: string;
  name: string;
  description: string;
}

export function templates(): TemplateSummary[] {
  return TEMPLATES.map(({ slug, name, description }) => ({ slug, name, description }));
}

export function templateDoc(slug: string): ProjectDoc | null {
  const t = TEMPLATES.find((x) => x.slug === slug);
  if (!t) return null;
  return buildTemplate(t);
}

function buildTemplate(t: TemplateSpec): ProjectDoc {
  const doc = createProject({ name: t.name, board: t.board });
  doc.diagram.parts = [];
  doc.diagram.connections = [];

  for (const p of t.parts) {
    const def = getPart(p.type);
    const part = makePart(p.type, p.x, p.y, {
      attrs: { ...(def?.defaults ?? {}) } as never,
    });
    // Keep readable template ids on the canvas rather than random ones.
    part.id = p.id;
    doc.diagram.parts.push(part);
  }

  for (const [fromPart, fromPin, toPart, toPin, colour] of t.wires) {
    doc.diagram.connections.push(
      makeWire({ part: fromPart, pin: fromPin }, { part: toPart, pin: toPin }, colour ?? 'green'),
    );
  }

  doc.files['sketch.ino'] = t.code;
  doc.sim.inputs = { ...(t.inputs ?? {}) };
  return doc;
}
