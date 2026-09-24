import type { ShowcaseProject } from './types';

/** Showcase projects 1-10. */
export const SHOWCASE_A: ShowcaseProject[] = [
  {
    slug: 'led-breathing-light',
    title: 'LED Breathing Light',
    emoji: '🌬️',
    tagline: 'An LED that fades in and out like a sleeping laptop.',
    description:
      'The smallest project that feels alive. Instead of switching the LED fully on and off, PWM pulses it so fast your eye averages the brightness, and a loop sweeps that average up and down.',
    level: 'Beginner',
    tags: ['pwm', 'led', 'analogWrite'],
    learningOutcomes: [
      'Use analogWrite to set an in-between brightness with PWM.',
      'Explain why a PWM pin is needed for fading.',
      'Control speed with the loop step and delay.',
    ],
    wiringNotes: ['Use a PWM pin (marked ~ on the Uno): 3, 5, 6, 9, 10 or 11.', '220 Ω keeps the LED under 15 mA at full brightness.'],
    builtOn: 'adaptive-lamp',
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 80, y: 140 },
      { id: 'r1', type: 'resistor', x: 420, y: 150 },
      { id: 'led1', type: 'led', x: 580, y: 150 },
    ],
    wires: [
      ['uno', 'D9', 'r1', '1'],
      ['r1', '2', 'led1', 'A'],
      ['led1', 'K', 'uno', 'GND', 'black'],
    ],
    sketch: `// LED Breathing Light
const int ledPin = 9;   // must be a PWM pin

void setup() {
  pinMode(ledPin, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  for (int level = 0; level <= 255; level += 5) {
    analogWrite(ledPin, level);
    delay(12);
  }
  Serial.println("inhale done");
  for (int level = 255; level >= 0; level -= 5) {
    analogWrite(ledPin, level);
    delay(12);
  }
  Serial.println("exhale done");
}
`,
    probe: `name: breathes in and out
steps:
  - wait-serial: { text: inhale done, timeout: 2s }
  - wait-serial: { text: exhale done, timeout: 2s }
  - wait-serial: { text: inhale done, timeout: 2s }
`,
  },
  {
    slug: 'distance-parking-alert',
    title: 'Distance Parking Alert',
    emoji: '🚗',
    tagline: 'Green, then amber, then red as the car creeps closer.',
    description:
      'An ultrasonic sensor measures the gap to the wall and an RGB LED turns it into a traffic light every driver understands. The same idea sits in the bumper of most new cars.',
    level: 'Intermediate',
    tags: ['ultrasonic', 'rgb', 'pulseIn', 'thresholds'],
    learningOutcomes: [
      'Measure distance from an echo time with pulseIn.',
      'Map ranges of a measurement onto discrete states.',
      'Mix red and green channels to make amber.',
    ],
    wiringNotes: ['Keep the HC-SR04 facing a flat surface; soft or angled objects scatter the echo.', 'The RGB module has its own resistors, so it wires straight to PWM pins.'],
    builtOn: 'ultrasonic-parking-radar',
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 60, y: 150 },
      { id: 'sonar', type: 'hc-sr04', x: 400, y: 100 },
      { id: 'rgb', type: 'led-rgb-module', x: 400, y: 290 },
    ],
    wires: [
      ['uno', '5V', 'sonar', 'VCC', 'red'],
      ['uno', 'GND', 'sonar', 'GND', 'black'],
      ['sonar', 'TRIG', 'uno', 'D7'],
      ['sonar', 'ECHO', 'uno', 'D8'],
      ['rgb', 'R', 'uno', 'D9'],
      ['rgb', 'G', 'uno', 'D10'],
      ['rgb', 'B', 'uno', 'D11'],
      ['rgb', 'GND', 'uno', 'GND', 'black'],
    ],
    inputs: { hcSr04Distance: 100 },
    sketch: `// Distance Parking Alert
const int trigPin = 7;
const int echoPin = 8;
const int redPin = 9;
const int greenPin = 10;
const int bluePin = 11;

long readCm() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  return pulseIn(echoPin, HIGH) / 58;   // 58 us per cm, there and back
}

void show(int r, int g) {
  analogWrite(redPin, r);
  analogWrite(greenPin, g);
  analogWrite(bluePin, 0);
}

void setup() {
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  Serial.begin(9600);
}

void loop() {
  long cm = readCm();
  if (cm > 60) { show(0, 255); Serial.println("zone: clear"); }
  else if (cm > 25) { show(255, 120); Serial.println("zone: slow"); }
  else { show(255, 0); Serial.println("zone: stop"); }
  delay(150);
}
`,
    probe: `name: zones follow the distance
steps:
  - set-control: { part-id: sonar, control: hcSr04Distance, value: 100 }
  - wait-serial: { text: "zone: clear", timeout: 1s }
  - set-control: { part-id: sonar, control: hcSr04Distance, value: 40 }
  - wait-serial: { text: "zone: slow", timeout: 1s }
  - set-control: { part-id: sonar, control: hcSr04Distance, value: 10 }
  - wait-serial: { text: "zone: stop", timeout: 1s }
  - expect-pin: { part-id: uno, pin: 10, expected: 0 }
`,
  },
  {
    slug: 'room-climate-console',
    title: 'Room Climate Console',
    emoji: '🌡️',
    tagline: 'Temperature, humidity and a comfort verdict on a 16x2 screen.',
    description:
      'A DHT11 reads the room and an I2C LCD shows the numbers plus a one-word verdict. It is the classroom thermometer every ATL lab builds first, with a little judgement added.',
    level: 'Intermediate',
    tags: ['dht11', 'lcd', 'i2c', 'formatting'],
    learningOutcomes: [
      'Read temperature and humidity from a DHT sensor.',
      'Write fixed-position text to an I2C LCD.',
      'Turn two measurements into one human judgement.',
    ],
    wiringNotes: ['The I2C LCD uses A4 (SDA) and A5 (SCL) on an Uno.', 'A DHT11 is slow: read it no more than once a second.'],
    builtOn: 'temperature-display',
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
    inputs: { dhtTemperature: 26, dhtHumidity: 50 },
    sketch: `// Room Climate Console
#include <DHT.h>
#include <LiquidCrystal_I2C.h>

DHT dht(2, DHT11);
LiquidCrystal_I2C lcd(0x27, 16, 2);

void setup() {
  dht.begin();
  lcd.init();
  lcd.backlight();
  Serial.begin(9600);
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();

  String verdict = "comfy";
  if (t > 30) verdict = "hot";
  else if (t < 18) verdict = "cold";
  else if (h > 70) verdict = "humid";

  lcd.setCursor(0, 0);
  lcd.print(t);
  lcd.print("C ");
  lcd.print(h);
  lcd.print("%  ");
  lcd.setCursor(0, 1);
  lcd.print(verdict);
  lcd.print("        ");

  Serial.print("climate: ");
  Serial.println(verdict);
  delay(1000);
}
`,
    probe: `name: verdict follows the room
steps:
  - set-control: { part-id: dht, control: dhtTemperature, value: 25 }
  - wait-serial: { text: "climate: comfy", timeout: 2s }
  - set-control: { part-id: dht, control: dhtTemperature, value: 34 }
  - wait-serial: { text: "climate: hot", timeout: 2s }
  - set-control: { part-id: dht, control: dhtTemperature, value: 12 }
  - wait-serial: { text: "climate: cold", timeout: 2s }
`,
  },
  {
    slug: 'motion-night-lamp',
    title: 'Motion Night Lamp',
    emoji: '🌙',
    tagline: 'Lights the way at night, stays off in daylight, times out on its own.',
    description:
      'A corridor lamp that only wakes when it is both dark and someone is moving, then switches itself off after a quiet spell. Two sensors, one AND, and a timer built from millis().',
    level: 'Intermediate',
    tags: ['pir', 'ldr', 'millis', 'logic'],
    learningOutcomes: [
      'Combine two conditions with a logical AND.',
      'Build a timeout with millis() instead of delay().',
      'Explain why the lamp must not block while waiting.',
    ],
    wiringNotes: ['A real PIR needs about a minute to settle after power-up.', 'Mount the LDR away from the lamp so it does not see its own light.'],
    builtOn: 'motion-alarm',
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 60, y: 150 },
      { id: 'pir', type: 'pir-motion', x: 400, y: 80 },
      { id: 'ldr', type: 'ldr-module', x: 400, y: 230 },
      { id: 'r1', type: 'resistor', x: 620, y: 360 },
      { id: 'led1', type: 'led', x: 780, y: 360, attrs: { colour: '#ffd166' } },
    ],
    wires: [
      ['uno', '5V', 'pir', 'VCC', 'red'],
      ['uno', 'GND', 'pir', 'GND', 'black'],
      ['pir', 'OUT', 'uno', 'D7'],
      ['uno', '5V', 'ldr', 'VCC', 'red'],
      ['uno', 'GND', 'ldr', 'GND', 'black'],
      ['ldr', 'AO', 'uno', 'A0'],
      ['uno', 'D9', 'r1', '1'],
      ['r1', '2', 'led1', 'A'],
      ['led1', 'K', 'uno', 'GND', 'black'],
    ],
    inputs: { ldrLux: 800, motionDetected: 0 },
    sketch: `// Motion Night Lamp
const int pirPin = 7;
const int ldrPin = A0;
const int lampPin = 9;
const int darkBelow = 300;
const unsigned long holdMs = 3000;

unsigned long lastMotion = 0;
bool lampOn = false;

void setup() {
  pinMode(pirPin, INPUT);
  pinMode(lampPin, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  bool dark = analogRead(ldrPin) < darkBelow;
  bool motion = digitalRead(pirPin) == HIGH;

  if (dark && motion) {
    lastMotion = millis();
    if (!lampOn) Serial.println("lamp on");
    lampOn = true;
  }
  if (lampOn && millis() - lastMotion > holdMs) {
    lampOn = false;
    Serial.println("lamp off");
  }
  digitalWrite(lampPin, lampOn ? HIGH : LOW);
  delay(50);
}
`,
    probe: `name: dark plus motion, then timeout
steps:
  - set-control: { part-id: pir, control: motionDetected, value: 1 }
  - delay: 500ms
  - expect-pin: { part-id: led1, pin: A, expected: 0 }
  - set-control: { part-id: ldr, control: ldrLux, value: 100 }
  - wait-serial: { text: lamp on, timeout: 1s }
  - set-control: { part-id: pir, control: motionDetected, value: 0 }
  - delay: 1s
  - expect-pin: { part-id: led1, pin: A, expected: 1 }
  - wait-serial: { text: lamp off, timeout: 4s }
  - expect-pin: { part-id: led1, pin: A, expected: 0 }
`,
  },
  {
    slug: 'smart-plant-monitor',
    title: 'Smart Plant Monitor',
    emoji: '🪴',
    tagline: 'Tells you when the pot is thirsty, before the leaves do.',
    description:
      'A soil moisture probe feeds an alert LED and the serial plotter, so you can watch a pot dry out over time and see exactly when it crosses from fine to thirsty.',
    level: 'Beginner',
    tags: ['soil', 'analog', 'plotter'],
    learningOutcomes: [
      'Read an analog sensor and print it for the serial plotter.',
      'Choose a threshold from real readings rather than guessing.',
      'Label plotter series with "name: value" output.',
    ],
    wiringNotes: ['Resistive probes corrode if powered constantly; on a real build, power the probe from a pin only while reading.', 'Wet soil reads high on this module, dry soil low.'],
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 60, y: 150 },
      { id: 'soil', type: 'soil-moisture', x: 400, y: 100 },
      { id: 'r1', type: 'resistor', x: 420, y: 300 },
      { id: 'led1', type: 'led', x: 580, y: 300, attrs: { colour: '#3a86ff' } },
    ],
    wires: [
      ['uno', '5V', 'soil', 'VCC', 'red'],
      ['uno', 'GND', 'soil', 'GND', 'black'],
      ['soil', 'AO', 'uno', 'A0'],
      ['uno', 'D13', 'r1', '1'],
      ['r1', '2', 'led1', 'A'],
      ['led1', 'K', 'uno', 'GND', 'black'],
    ],
    inputs: { soilMoisture: 600 },
    sketch: `// Smart Plant Monitor
const int soilPin = A0;
const int alertPin = 13;
const int thirstyBelow = 350;

void setup() {
  pinMode(alertPin, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int moisture = analogRead(soilPin);
  bool thirsty = moisture < thirstyBelow;
  digitalWrite(alertPin, thirsty ? HIGH : LOW);

  // "name: value" pairs label the lines in the serial plotter.
  Serial.print("moisture: ");
  Serial.print(moisture);
  Serial.print(" threshold: ");
  Serial.println(thirstyBelow);
  delay(500);
}
`,
    probe: `name: alerts only when dry
steps:
  - set-control: { part-id: soil, control: soilMoisture, value: 700 }
  - delay: 1s
  - expect-pin: { part-id: led1, pin: A, expected: 0 }
  - set-control: { part-id: soil, control: soilMoisture, value: 200 }
  - delay: 1s
  - expect-pin: { part-id: led1, pin: A, expected: 1 }
  - assert-serial-regex: { pattern: "moisture: 200 threshold: 350", timeout: 1s }
`,
  },
  {
    slug: 'touch-free-lid',
    title: 'Touch-Free Lid',
    emoji: '🗑️',
    tagline: 'A dustbin lid that opens when a hand comes near.',
    description:
      'An ultrasonic sensor watches for a hand and a servo lifts the lid, holds it while the hand is there, and closes it gently after. Built in hundreds of Indian schools during the pandemic.',
    level: 'Intermediate',
    tags: ['servo', 'ultrasonic', 'hygiene'],
    learningOutcomes: [
      'Drive a servo to set angles with the Servo library.',
      'Hold a state while a condition is true, then release it.',
      'Explain why the servo gets its own supply in a real build.',
    ],
    wiringNotes: ['A lid is a real load: give the servo its own 5 V supply and join grounds.', 'Angle the sensor up so it does not see the bin rim.'],
    builtOn: 'servo-barrier-gate',
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 60, y: 150 },
      { id: 'sonar', type: 'hc-sr04', x: 400, y: 90 },
      { id: 'servo', type: 'servo-sg90', x: 400, y: 280 },
    ],
    wires: [
      ['uno', '5V', 'sonar', 'VCC', 'red'],
      ['uno', 'GND', 'sonar', 'GND', 'black'],
      ['sonar', 'TRIG', 'uno', 'D5'],
      ['sonar', 'ECHO', 'uno', 'D6'],
      ['uno', '5V', 'servo', 'VCC', 'red'],
      ['uno', 'GND', 'servo', 'GND', 'black'],
      ['servo', 'SIG', 'uno', 'D9'],
    ],
    inputs: { hcSr04Distance: 80 },
    sketch: `// Touch-Free Lid
#include <Servo.h>

Servo lid;
const int trigPin = 5;
const int echoPin = 6;
const int handWithin = 15;   // cm

long readCm() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  return pulseIn(echoPin, HIGH) / 58;
}

void setup() {
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  lid.attach(9);
  lid.write(0);
  Serial.begin(9600);
}

void loop() {
  if (readCm() < handWithin) {
    lid.write(110);
    Serial.println("lid open");
    delay(1500);   // stay open long enough to drop something in
  } else {
    lid.write(0);
    Serial.println("lid closed");
  }
  delay(100);
}
`,
    probe: `name: opens for a hand
steps:
  - wait-serial: { text: lid closed, timeout: 1s }
  - set-control: { part-id: sonar, control: hcSr04Distance, value: 8 }
  - wait-serial: { text: lid open, timeout: 1s }
  - set-control: { part-id: sonar, control: hcSr04Distance, value: 80 }
  - wait-serial: { text: lid closed, timeout: 3s }
`,
  },
  {
    slug: 'rgb-mood-lamp',
    title: 'RGB Mood Lamp',
    emoji: '🌈',
    tagline: 'One knob, every colour of the rainbow.',
    description:
      'Turn a potentiometer and the lamp walks around the colour wheel from red through green to blue and back. A lesson in mixing light, and in splitting one number into three.',
    level: 'Beginner',
    tags: ['rgb', 'potentiometer', 'colour'],
    learningOutcomes: [
      'Mix red, green and blue light with PWM.',
      'Split one input range into segments of a colour wheel.',
      'Use map() to rescale a reading.',
    ],
    wiringNotes: ['The RGB module includes its resistors.', 'Diffuse the LED with paper or a ping-pong ball to see mixed colours rather than three dots.'],
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 60, y: 150 },
      { id: 'pot', type: 'potentiometer-10k', x: 400, y: 90 },
      { id: 'rgb', type: 'led-rgb-module', x: 400, y: 280 },
    ],
    wires: [
      ['uno', '5V', 'pot', 'VCC', 'red'],
      ['uno', 'GND', 'pot', 'GND', 'black'],
      ['pot', 'OUT', 'uno', 'A0'],
      ['rgb', 'R', 'uno', 'D9'],
      ['rgb', 'G', 'uno', 'D10'],
      ['rgb', 'B', 'uno', 'D11'],
      ['rgb', 'GND', 'uno', 'GND', 'black'],
    ],
    inputs: { potentiometer: 0 },
    sketch: `// RGB Mood Lamp: the knob walks around the colour wheel.
const int knobPin = A0;

void setColour(int r, int g, int b) {
  analogWrite(9, r);
  analogWrite(10, g);
  analogWrite(11, b);
}

void setup() {
  Serial.begin(9600);
}

void loop() {
  int knob = analogRead(knobPin);          // 0 - 1023
  int pos = map(knob, 0, 1023, 0, 767);    // three segments of 256
  int r = 0;
  int g = 0;
  int b = 0;
  if (pos < 256) { r = 255 - pos; g = pos; }
  else if (pos < 512) { g = 511 - pos; b = pos - 256; }
  else { b = 767 - pos; r = pos - 512; }
  setColour(r, g, b);

  Serial.print("r: ");
  Serial.print(r);
  Serial.print(" g: ");
  Serial.print(g);
  Serial.print(" b: ");
  Serial.println(b);
  delay(100);
}
`,
    probe: `name: knob moves around the wheel
steps:
  - set-control: { part-id: pot, control: position, value: 0 }
  - assert-serial-regex: { pattern: "^r: 255 g: 0 b: 0$", timeout: 1s }
  - set-control: { part-id: pot, control: position, value: 0.5 }
  - assert-serial-regex: { pattern: "^r: 0 g: 1?\\\\d?\\\\d b: \\\\d+$", timeout: 1s }
  - set-control: { part-id: pot, control: position, value: 1 }
  - assert-serial-regex: { pattern: "^r: 255 g: 0 b: 0$", timeout: 1s }
`,
  },
  {
    slug: 'reaction-timer',
    title: 'Reaction Timer',
    emoji: '⚡',
    tagline: 'Wait for the light, press as fast as you can, get your time in ms.',
    description:
      'The LED lights after a random pause and the sketch times how long you take to hit the button. It also catches cheaters who press before the light.',
    level: 'Intermediate',
    tags: ['millis', 'random', 'button', 'game'],
    learningOutcomes: [
      'Time an event precisely with millis().',
      'Use random() so the player cannot anticipate.',
      'Handle the "pressed too early" case, not just the happy path.',
    ],
    wiringNotes: ['INPUT_PULLUP means pressed reads LOW.', 'A real button bounces; the 20 ms debounce matters on hardware.'],
    builtOn: 'oled-reaction-timer',
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 80, y: 140 },
      { id: 'btn', type: 'pushbutton', x: 420, y: 110 },
      { id: 'r1', type: 'resistor', x: 420, y: 250 },
      { id: 'led1', type: 'led', x: 580, y: 250, attrs: { colour: '#2ec4b6' } },
    ],
    wires: [
      ['uno', 'GND', 'btn', '1', 'black'],
      ['btn', '2', 'uno', 'D2'],
      ['uno', 'D13', 'r1', '1'],
      ['r1', '2', 'led1', 'A'],
      ['led1', 'K', 'uno', 'GND', 'black'],
    ],
    sketch: `// Reaction Timer
const int buttonPin = 2;
const int ledPin = 13;

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
  randomSeed(42);
  Serial.begin(9600);
  Serial.println("get ready");
}

void loop() {
  digitalWrite(ledPin, LOW);
  unsigned long wait = random(1000, 3000);
  unsigned long start = millis();
  while (millis() - start < wait) {
    if (digitalRead(buttonPin) == LOW) {
      Serial.println("too early!");
      delay(1000);
      return;
    }
    delay(1);
  }

  digitalWrite(ledPin, HIGH);
  Serial.println("GO");
  unsigned long lit = millis();
  while (digitalRead(buttonPin) == HIGH) {
    delay(1);
  }
  Serial.print("time: ");
  Serial.print(millis() - lit);
  Serial.println(" ms");
  delay(20);   // debounce
  while (digitalRead(buttonPin) == LOW) delay(1);
  delay(1000);
}
`,
    probe: `name: times a reaction
steps:
  - wait-serial: { text: GO, timeout: 4s }
  - delay: 250ms
  - set-control: { part-id: btn, control: pressed, value: 1 }
  - assert-serial-regex: { pattern: "^time: 2[5-6]\\\\d ms$", timeout: 1s }
  - set-control: { part-id: btn, control: pressed, value: 0 }
`,
  },
  {
    slug: 'rainfall-alert',
    title: 'Rainfall Alert',
    emoji: '🌧️',
    tagline: 'Beeps when the first drops hit the sensor, so the washing comes in.',
    description:
      'A rain-drop plate changes resistance as water bridges its tracks. The sketch watches for that change, sounds a buzzer once, and does not nag while it keeps raining.',
    level: 'Beginner',
    tags: ['rain', 'buzzer', 'edge-detection'],
    learningOutcomes: [
      'Read a wetness level from an analog sensor.',
      'Alert on the change, not on every loop.',
      'Remember the previous state in a variable.',
    ],
    wiringNotes: ['Mount the plate at an angle so water runs off and the alert clears when the rain stops.'],
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 60, y: 150 },
      { id: 'rain', type: 'rain-drop', x: 400, y: 100 },
      { id: 'buzzer', type: 'buzzer-active', x: 400, y: 290 },
    ],
    wires: [
      ['uno', '5V', 'rain', 'VCC', 'red'],
      ['uno', 'GND', 'rain', 'GND', 'black'],
      ['rain', 'AO', 'uno', 'A0'],
      ['buzzer', '+', 'uno', 'D8'],
      ['buzzer', '-', 'uno', 'GND', 'black'],
    ],
    inputs: { rainLevel: 100 },
    sketch: `// Rainfall Alert: beep once when it starts to rain.
const int rainPin = A0;
const int buzzerPin = 8;
const int wetAbove = 500;

bool wasRaining = false;

void setup() {
  pinMode(buzzerPin, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  bool raining = analogRead(rainPin) > wetAbove;
  if (raining && !wasRaining) {
    Serial.println("rain started");
    digitalWrite(buzzerPin, HIGH);
    delay(800);
    digitalWrite(buzzerPin, LOW);
  }
  if (!raining && wasRaining) Serial.println("rain stopped");
  wasRaining = raining;
  delay(200);
}
`,
    probe: `name: beeps once per shower
steps:
  - delay: 500ms
  - set-control: { part-id: rain, control: rainLevel, value: 800 }
  - wait-serial: { text: rain started, timeout: 1s }
  - delay: 2s
  - expect-pin: { part-id: buzzer, pin: "+", expected: 0 }
  - set-control: { part-id: rain, control: rainLevel, value: 100 }
  - wait-serial: { text: rain stopped, timeout: 1s }
`,
  },
  {
    slug: 'rfid-access-indicator',
    title: 'RFID Access Indicator',
    emoji: '🔐',
    tagline: 'Green for a known card, red and a buzz for a stranger.',
    description:
      'The door-lock logic of an RFID system: compare a card id against an allow-list and show the verdict. In the functional runtime you type the card id into the serial monitor, standing in for the reader.',
    level: 'Advanced',
    tags: ['rfid', 'strings', 'access-control', 'serial'],
    learningOutcomes: [
      'Compare an incoming id against an allow-list.',
      'Read a whole line from serial and clean it with trim().',
      'Design the failure case to be obvious and safe.',
    ],
    wiringNotes: ['The RC522 is a 3.3 V part: its VCC goes to 3V3, never 5V.', 'Real card reads need the MFRC522 library and the firmware emulator.'],
    fidelityNote:
      'The functional runtime does not model the RC522 SPI protocol. Card reads are typed into the serial monitor instead; the access logic is identical. Switch to Firmware Emulation to run the real MFRC522 library.',
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 60, y: 150 },
      { id: 'rfid', type: 'rfid-rc522', x: 400, y: 60 },
      { id: 'rgb', type: 'led-rgb-module', x: 400, y: 320 },
      { id: 'buzzer', type: 'buzzer-active', x: 640, y: 320 },
    ],
    wires: [
      ['uno', '3V3', 'rfid', '3V3', 'red'],
      ['uno', 'GND', 'rfid', 'GND', 'black'],
      ['rfid', 'SDA', 'uno', 'D10'],
      ['rfid', 'SCK', 'uno', 'D13'],
      ['rfid', 'MOSI', 'uno', 'D11'],
      ['rfid', 'MISO', 'uno', 'D12'],
      ['rfid', 'RST', 'uno', 'D9'],
      ['rgb', 'R', 'uno', 'D5'],
      ['rgb', 'G', 'uno', 'D6'],
      ['rgb', 'B', 'uno', 'D3'],
      ['rgb', 'GND', 'uno', 'GND', 'black'],
      ['buzzer', '+', 'uno', 'D4'],
      ['buzzer', '-', 'uno', 'GND', 'black'],
    ],
    sketch: `// RFID Access Indicator (card ids typed into the serial monitor)
const int redPin = 5;
const int greenPin = 6;
const int buzzerPin = 4;

String allowed[] = {"A1B2C3D4", "0F1E2D3C"};
const int allowedCount = 2;

void verdict(bool ok) {
  digitalWrite(greenPin, ok ? HIGH : LOW);
  digitalWrite(redPin, ok ? LOW : HIGH);
  if (!ok) digitalWrite(buzzerPin, HIGH);
  delay(600);
  digitalWrite(buzzerPin, LOW);
  digitalWrite(greenPin, LOW);
  digitalWrite(redPin, LOW);
}

void setup() {
  pinMode(redPin, OUTPUT);
  pinMode(greenPin, OUTPUT);
  pinMode(buzzerPin, OUTPUT);
  Serial.begin(9600);
  Serial.println("scan a card");
}

void loop() {
  if (Serial.available() > 0) {
    String id = Serial.readStringUntil('\\n');
    id.trim();
    id.toUpperCase();
    bool ok = false;
    for (int i = 0; i < allowedCount; i++) {
      if (id == allowed[i]) ok = true;
    }
    Serial.print(ok ? "access granted: " : "access denied: ");
    Serial.println(id);
    verdict(ok);
  }
}
`,
    probe: `name: known and unknown cards
steps:
  - wait-serial: scan a card
  - write-serial: "a1b2c3d4\\n"
  - wait-serial: { text: "access granted: A1B2C3D4", timeout: 1s }
  - write-serial: "DEADBEEF\\n"
  - wait-serial: { text: "access denied: DEADBEEF", timeout: 1s }
  # The verdict holds for 600 ms: the stranger gets red and the buzzer.
  - delay: 100ms
  - expect-pin: { part-id: buzzer, pin: "+", expected: 1 }
  - expect-pin: { part-id: uno, pin: 5, expected: 1 }
  - delay: 700ms
  - expect-pin: { part-id: buzzer, pin: "+", expected: 0 }
`,
  },
];
