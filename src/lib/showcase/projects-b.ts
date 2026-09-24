import type { ShowcaseProject } from './types';

/** Showcase projects 11-20. */
export const SHOWCASE_B: ShowcaseProject[] = [
  {
    slug: 'line-following-rover',
    title: 'Line-Following Rover',
    emoji: '🤖',
    tagline: 'Two motors and a sensor bar keep a rover on a black track.',
    description:
      'The classic robotics-competition build. A five-channel sensor bar reports where the line is, and the sketch speeds up one motor and slows the other to steer back onto it. This is proportional control in its simplest form.',
    level: 'Advanced',
    tags: ['motors', 'l298n', 'control', 'robotics'],
    learningOutcomes: [
      'Steer by driving two motors at different speeds.',
      'Turn a position error into a correction (proportional control).',
      'Keep motor current off the Arduino with a driver and its own battery.',
    ],
    wiringNotes: [
      'Motors are fed from the L298N outputs, never from Arduino pins.',
      'The battery powers the driver; the Arduino and the driver must share ground.',
      'Remove the L298N 5 V jumper if the battery is above 12 V.',
    ],
    fidelityNote:
      'Each of the five sensor channels reports whether it is over the line; move the line with the Line position slider (-2 far left, 2 far right). Motor speeds follow the PWM duty on the enable pins; wheel physics are not simulated.',
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 60, y: 150 },
      { id: 'line', type: 'line-follower-array', x: 380, y: 40 },
      { id: 'drv', type: 'l298n', x: 380, y: 250 },
      { id: 'bat', type: 'battery-9v', x: 640, y: 420 },
      { id: 'left', type: 'dc-motor-bo', x: 700, y: 180 },
      { id: 'right', type: 'dc-motor-bo', x: 700, y: 300 },
    ],
    wires: [
      ['uno', '5V', 'line', 'VCC', 'red'],
      ['uno', 'GND', 'line', 'GND', 'black'],
      ['line', 'D1', 'uno', 'A0'],
      ['line', 'D2', 'uno', 'A1'],
      ['line', 'D3', 'uno', 'A2'],
      ['line', 'D4', 'uno', 'A3'],
      ['line', 'D5', 'uno', 'D2'],
      ['bat', '+', 'drv', 'VMS', 'red'],
      ['bat', '-', 'drv', 'GND', 'black'],
      ['drv', 'GND', 'uno', 'GND', 'black'],
      ['uno', 'D5', 'drv', 'ENA'],
      ['uno', 'D7', 'drv', 'IN1'],
      ['uno', 'D8', 'drv', 'IN2'],
      ['uno', 'D6', 'drv', 'ENB'],
      ['uno', 'D9', 'drv', 'IN3'],
      ['uno', 'D10', 'drv', 'IN4'],
      ['drv', 'OUT1', 'left', '+'],
      ['drv', 'OUT2', 'left', '-'],
      ['drv', 'OUT3', 'right', '+'],
      ['drv', 'OUT4', 'right', '-'],
    ],
    inputs: { linePosition: 0 },
    sketch: `// Line-Following Rover: proportional steering from a 5-channel sensor bar.
const int sensorPins[] = {A0, A1, A2, A3, 2};   // D1 (far left) .. D5 (far right)
const int weights[] = {-2, -1, 0, 1, 2};
const int enLeft = 5;
const int enRight = 6;
const int base = 150;       // cruising speed
const int gain = 45;        // how hard to steer per unit of error
int lastError = 0;

// Where is the line? The average position of every channel that sees it.
int lineError() {
  int sum = 0;
  int seen = 0;
  for (int i = 0; i < 5; i++) {
    if (digitalRead(sensorPins[i]) == HIGH) {
      sum += weights[i];
      seen++;
    }
  }
  if (seen == 0) return lastError;   // lost the line: keep turning the way we were
  return sum / seen;
}

void setup() {
  for (int i = 0; i < 5; i++) pinMode(sensorPins[i], INPUT);
  pinMode(7, OUTPUT);
  pinMode(8, OUTPUT);
  pinMode(9, OUTPUT);
  pinMode(10, OUTPUT);
  // Both motors forward.
  digitalWrite(7, HIGH);
  digitalWrite(8, LOW);
  digitalWrite(9, HIGH);
  digitalWrite(10, LOW);
  Serial.begin(9600);
}

void loop() {
  int error = lineError();   // negative means the line is to the left
  lastError = error;
  int left = constrain(base + error * gain, 0, 255);
  int right = constrain(base - error * gain, 0, 255);
  analogWrite(enLeft, left);
  analogWrite(enRight, right);
  Serial.print("left: ");
  Serial.print(left);
  Serial.print(" right: ");
  Serial.println(right);
  delay(100);
}
`,
    probe: `name: steers toward the line
steps:
  - set-control: { part-id: line, control: linePosition, value: 0 }
  - assert-serial-regex: { pattern: "^left: 150 right: 150$", timeout: 1s }
  - set-control: { part-id: line, control: linePosition, value: 2 }
  - assert-serial-regex: { pattern: "^left: 240 right: 60$", timeout: 1s }
  - set-control: { part-id: line, control: linePosition, value: -1 }
  - assert-serial-regex: { pattern: "^left: 105 right: 195$", timeout: 1s }
  - assert-no-diagnostic: power-budget-exceeded
`,
  },
  {
    slug: 'water-saving-irrigation',
    title: 'Water-Saving Irrigation',
    emoji: '💧',
    tagline: 'Waters only when the soil is dry and never when it is raining.',
    description:
      'A pump relay controlled by two sensors: water when the soil is dry, but skip it entirely if the rain sensor says the sky is already doing the job. Two sensors, one decision, less water wasted.',
    level: 'Advanced',
    tags: ['relay', 'soil', 'rain', 'sustainability'],
    learningOutcomes: [
      'Combine an enabling and an inhibiting condition.',
      'Drive a pump through a relay, not a pin.',
      'Log decisions so the system can be audited.',
    ],
    wiringNotes: ['The pump runs from its own supply through the relay contacts.', 'Water and 230 V never meet: keep mains out of school builds entirely.'],
    builtOn: 'smart-greenhouse',
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 60, y: 150 },
      { id: 'soil', type: 'soil-moisture', x: 380, y: 40 },
      { id: 'rain', type: 'rain-drop', x: 380, y: 190 },
      { id: 'relay', type: 'relay-1ch', x: 380, y: 340 },
    ],
    wires: [
      ['uno', '5V', 'soil', 'VCC', 'red'],
      ['uno', 'GND', 'soil', 'GND', 'black'],
      ['soil', 'AO', 'uno', 'A0'],
      ['uno', '5V', 'rain', 'VCC', 'red'],
      ['uno', 'GND', 'rain', 'GND', 'black'],
      ['rain', 'AO', 'uno', 'A1'],
      ['uno', '5V', 'relay', 'DC+', 'red'],
      ['uno', 'GND', 'relay', 'DC-', 'black'],
      ['relay', 'IN', 'uno', 'D8'],
    ],
    inputs: { soilMoisture: 600, rainLevel: 100 },
    sketch: `// Water-Saving Irrigation
const int soilPin = A0;
const int rainPin = A1;
const int pumpPin = 8;       // active LOW relay
const int dryBelow = 350;
const int rainAbove = 500;

void setup() {
  pinMode(pumpPin, OUTPUT);
  digitalWrite(pumpPin, HIGH);
  Serial.begin(9600);
}

void loop() {
  bool dry = analogRead(soilPin) < dryBelow;
  bool raining = analogRead(rainPin) > rainAbove;
  bool water = dry && !raining;
  digitalWrite(pumpPin, water ? LOW : HIGH);

  if (water) Serial.println("pump: on");
  else if (dry && raining) Serial.println("pump: off (rain will do it)");
  else Serial.println("pump: off");
  delay(500);
}
`,
    probe: `name: dry soil waters, rain vetoes
steps:
  - set-control: { part-id: soil, control: soilMoisture, value: 200 }
  - wait-serial: { text: "pump: on", timeout: 1s }
  - expect-pin: { part-id: relay, pin: IN, expected: 0 }
  - set-control: { part-id: rain, control: rainLevel, value: 800 }
  - wait-serial: { text: rain will do it, timeout: 1s }
  - expect-pin: { part-id: relay, pin: IN, expected: 1 }
`,
  },
  {
    slug: 'parking-barrier-gate',
    title: 'Parking Barrier Gate',
    emoji: '🚧',
    tagline: 'Press for entry, the boom lifts, and it will not drop on a car.',
    description:
      'A servo boom that opens on a button press and refuses to close while the ultrasonic sensor still sees a vehicle underneath. Safety interlocks like this are required on every real barrier.',
    level: 'Advanced',
    tags: ['servo', 'ultrasonic', 'safety', 'state'],
    learningOutcomes: [
      'Sequence open, hold and close as distinct states.',
      'Add a safety interlock that overrides the normal sequence.',
      'Test the dangerous case deliberately.',
    ],
    wiringNotes: ['On a real barrier, the servo is replaced by a geared motor with limit switches.'],
    builtOn: 'servo-barrier-gate',
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 60, y: 150 },
      { id: 'btn', type: 'pushbutton', x: 400, y: 60 },
      { id: 'sonar', type: 'hc-sr04', x: 400, y: 170 },
      { id: 'servo', type: 'servo-sg90', x: 400, y: 330 },
    ],
    wires: [
      ['uno', 'GND', 'btn', '1', 'black'],
      ['btn', '2', 'uno', 'D2'],
      ['uno', '5V', 'sonar', 'VCC', 'red'],
      ['uno', 'GND', 'sonar', 'GND', 'black'],
      ['sonar', 'TRIG', 'uno', 'D5'],
      ['sonar', 'ECHO', 'uno', 'D6'],
      ['uno', '5V', 'servo', 'VCC', 'red'],
      ['uno', 'GND', 'servo', 'GND', 'black'],
      ['servo', 'SIG', 'uno', 'D9'],
    ],
    inputs: { hcSr04Distance: 200 },
    sketch: `// Parking Barrier Gate with a safety interlock.
#include <Servo.h>

Servo boom;
const int buttonPin = 2;
const int trigPin = 5;
const int echoPin = 6;
bool isOpen = false;

long readCm() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  return pulseIn(echoPin, HIGH) / 58;
}

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  boom.attach(9);
  boom.write(0);
  Serial.begin(9600);
  Serial.println("gate closed");
}

void loop() {
  if (!isOpen && digitalRead(buttonPin) == LOW) {
    boom.write(90);
    isOpen = true;
    Serial.println("gate open");
    delay(2000);
  }
  if (isOpen) {
    if (readCm() < 50) {
      Serial.println("vehicle below, holding");
    } else {
      boom.write(0);
      isOpen = false;
      Serial.println("gate closed");
    }
  }
  delay(200);
}
`,
    probe: `name: opens, holds for a car, then closes
steps:
  - wait-serial: gate closed
  - set-control: { part-id: sonar, control: hcSr04Distance, value: 20 }
  - set-control: { part-id: btn, control: pressed, value: 1 }
  - wait-serial: { text: gate open, timeout: 1s }
  - set-control: { part-id: btn, control: pressed, value: 0 }
  - wait-serial: { text: vehicle below, timeout: 3s }
  - set-control: { part-id: sonar, control: hcSr04Distance, value: 200 }
  - wait-serial: { text: gate closed, timeout: 1s }
`,
  },
  {
    slug: 'kitchen-gas-safety-valve',
    title: 'Kitchen Gas Safety Valve',
    emoji: '🔥',
    tagline: 'Smells gas, closes the valve, sounds the alarm, waits for clean air.',
    description:
      'A latched safety system: once the MQ-2 detects gas, the solenoid valve relay closes and stays closed until the air is clean and a person presses reset. It never reopens by itself.',
    level: 'Advanced',
    tags: ['mq2', 'relay', 'safety', 'latching'],
    learningOutcomes: [
      'Latch an alarm so it survives the condition clearing.',
      'Require a human reset for a safety system.',
      'Use a second, lower threshold before allowing reset.',
    ],
    wiringNotes: ['The MQ-2 heater draws about 160 mA and needs a few minutes to warm up.', 'Real gas valves are certified devices; this build teaches the logic, not the plumbing.'],
    builtOn: 'gas-leak-shutoff',
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 60, y: 150 },
      { id: 'gas', type: 'mq2-gas', x: 400, y: 40 },
      { id: 'relay', type: 'relay-1ch', x: 400, y: 190 },
      { id: 'buzzer', type: 'buzzer-active', x: 400, y: 340 },
      { id: 'btn', type: 'pushbutton', x: 620, y: 340 },
    ],
    wires: [
      ['uno', '5V', 'gas', 'VCC', 'red'],
      ['uno', 'GND', 'gas', 'GND', 'black'],
      ['gas', 'AO', 'uno', 'A0'],
      ['uno', '5V', 'relay', 'DC+', 'red'],
      ['uno', 'GND', 'relay', 'DC-', 'black'],
      ['relay', 'IN', 'uno', 'D8'],
      ['buzzer', '+', 'uno', 'D7'],
      ['buzzer', '-', 'uno', 'GND', 'black'],
      ['uno', 'GND', 'btn', '1', 'black'],
      ['btn', '2', 'uno', 'D2'],
    ],
    inputs: { gasLevel: 120 },
    sketch: `// Kitchen Gas Safety Valve
const int gasPin = A0;
const int valvePin = 8;     // active LOW relay: LOW closes the valve
const int buzzerPin = 7;
const int resetPin = 2;
const int trip = 450;
const int clean = 200;

bool tripped = false;

void setup() {
  pinMode(valvePin, OUTPUT);
  pinMode(buzzerPin, OUTPUT);
  pinMode(resetPin, INPUT_PULLUP);
  digitalWrite(valvePin, HIGH);
  Serial.begin(9600);
}

void loop() {
  int gas = analogRead(gasPin);
  if (!tripped && gas > trip) {
    tripped = true;
    Serial.println("GAS! valve closed");
  }
  if (tripped && digitalRead(resetPin) == LOW) {
    if (gas < clean) {
      tripped = false;
      Serial.println("reset: valve open");
    } else {
      Serial.println("reset refused: air not clean");
    }
    delay(300);
  }
  digitalWrite(valvePin, tripped ? LOW : HIGH);
  digitalWrite(buzzerPin, tripped ? HIGH : LOW);
  delay(100);
}
`,
    probe: `name: trips, refuses early reset, resets when clean
steps:
  - set-control: { part-id: gas, control: gasLevel, value: 700 }
  - wait-serial: { text: valve closed, timeout: 1s }
  - set-control: { part-id: gas, control: gasLevel, value: 300 }
  - set-control: { part-id: btn, control: pressed, value: 1 }
  - wait-serial: { text: reset refused, timeout: 1s }
  - set-control: { part-id: btn, control: pressed, value: 0 }
  - set-control: { part-id: gas, control: gasLevel, value: 100 }
  - set-control: { part-id: btn, control: pressed, value: 1 }
  - wait-serial: { text: "reset: valve open", timeout: 1s }
`,
  },
  {
    slug: 'shopfront-visitor-counter',
    title: 'Shopfront Visitor Counter',
    emoji: '🚶',
    tagline: 'Counts people walking through a doorway on an IR beam.',
    description:
      'An IR obstacle sensor across the doorway counts one visitor per break in the beam, not one per loop. The count goes to the serial monitor and a seven-segment-style display line.',
    level: 'Intermediate',
    tags: ['ir', 'counting', 'edge-detection'],
    learningOutcomes: [
      'Count events on the edge, not the level.',
      'Understand active-LOW sensor outputs.',
      'Avoid double-counting a slow walker.',
    ],
    wiringNotes: ['Mount the sensor at waist height so bags and children both count once.'],
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 60, y: 150 },
      { id: 'ir', type: 'ir-obstacle', x: 400, y: 120 },
    ],
    wires: [
      ['uno', '5V', 'ir', 'VCC', 'red'],
      ['uno', 'GND', 'ir', 'GND', 'black'],
      ['ir', 'OUT', 'uno', 'D4'],
    ],
    inputs: { obstacleNear: 0 },
    sketch: `// Shopfront Visitor Counter
const int beamPin = 4;      // IR modules pull LOW when something is in front
int visitors = 0;
bool blocked = false;

void setup() {
  pinMode(beamPin, INPUT);
  Serial.begin(9600);
  Serial.println("visitors: 0");
}

void loop() {
  bool now = digitalRead(beamPin) == LOW;
  if (now && !blocked) {
    visitors++;
    Serial.print("visitors: ");
    Serial.println(visitors);
  }
  blocked = now;
  delay(20);
}
`,
    probe: `name: counts each visitor once
steps:
  - wait-serial: "visitors: 0"
  - repeat:
      times: 3
      steps:
        - set-control: { part-id: ir, control: obstacleNear, value: 1 }
        - delay: 400ms
        - set-control: { part-id: ir, control: obstacleNear, value: 0 }
        - delay: 300ms
  - wait-serial: { text: "visitors: 3", timeout: 1s }
`,
  },
  {
    slug: 'morse-code-trainer',
    title: 'Morse Code Trainer',
    emoji: '📡',
    tagline: 'Type a word, hear and see it in Morse.',
    description:
      'Type text into the serial monitor and the sketch flashes and beeps it in International Morse code, with correct timing: a dash is three dots long and gaps separate letters.',
    level: 'Intermediate',
    tags: ['strings', 'arrays', 'timing', 'serial'],
    learningOutcomes: [
      'Look up a letter in an array of codes.',
      'Walk through a String one character at a time.',
      'Encode timing rules as named constants.',
    ],
    wiringNotes: ['An active buzzer beeps at its own pitch; a passive one needs tone().'],
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 80, y: 140 },
      { id: 'r1', type: 'resistor', x: 420, y: 150 },
      { id: 'led1', type: 'led', x: 580, y: 150, attrs: { colour: '#ffb703' } },
      { id: 'buzzer', type: 'buzzer-active', x: 420, y: 300 },
    ],
    wires: [
      ['uno', 'D13', 'r1', '1'],
      ['r1', '2', 'led1', 'A'],
      ['led1', 'K', 'uno', 'GND', 'black'],
      ['buzzer', '+', 'uno', 'D8'],
      ['buzzer', '-', 'uno', 'GND', 'black'],
    ],
    sketch: `// Morse Code Trainer
const int ledPin = 13;
const int buzzerPin = 8;
const int unit = 80;   // one dot, in ms

String codes[] = {
  ".-", "-...", "-.-.", "-..", ".", "..-.", "--.", "....", "..", ".---", "-.-", ".-..", "--",
  "-.", "---", ".--.", "--.-", ".-.", "...", "-", "..-", "...-", ".--", "-..-", "-.--", "--.."
};

void signal(int units) {
  digitalWrite(ledPin, HIGH);
  digitalWrite(buzzerPin, HIGH);
  delay(unit * units);
  digitalWrite(ledPin, LOW);
  digitalWrite(buzzerPin, LOW);
  delay(unit);
}

void setup() {
  pinMode(ledPin, OUTPUT);
  pinMode(buzzerPin, OUTPUT);
  Serial.begin(9600);
  Serial.println("type a word");
}

void loop() {
  if (Serial.available() > 0) {
    // Not "word": that is an Arduino type name, like int.
    String text = Serial.readStringUntil('\\n');
    text.trim();
    text.toUpperCase();
    String sent = "";
    for (int i = 0; i < text.length(); i++) {
      char c = text.charAt(i);
      if (c >= 'A' && c <= 'Z') {
        String code = codes[c - 'A'];
        for (int j = 0; j < code.length(); j++) {
          signal(code.charAt(j) == '.' ? 1 : 3);
        }
        sent += code;
        sent += " ";
        delay(unit * 2);   // three units between letters in total
      }
    }
    Serial.print("sent: ");
    Serial.println(sent);
  }
}
`,
    probe: `name: encodes SOS
steps:
  - wait-serial: type a word
  - write-serial: "sos\\n"
  - wait-serial: { text: "sent: ... --- ...", timeout: 5s }
`,
  },
  {
    slug: 'desk-rgb-mood-lamp',
    title: 'Desk RGB Mood Lamp',
    emoji: '💡',
    tagline: 'Tap to cycle warm, cool, focus and night modes.',
    description:
      'A capacitive touch pad cycles an RGB lamp through four named scenes. It is the Three-Mode Lamp mission grown up: more states, colour instead of brightness, and a touch sensor instead of a button.',
    level: 'Intermediate',
    tags: ['rgb', 'touch', 'state-machine'],
    learningOutcomes: [
      'Cycle through states with a counter and the modulo operator.',
      'Store scene colours in arrays.',
      'Trigger on the touch, not while the finger stays down.',
    ],
    wiringNotes: ['The TTP223 output is HIGH while touched; it needs no pull-up.'],
    builtOn: 'three-mode-lamp',
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 60, y: 150 },
      { id: 'touch', type: 'ttp223-touch', x: 400, y: 100 },
      { id: 'rgb', type: 'led-rgb-module', x: 400, y: 270 },
    ],
    wires: [
      ['uno', '5V', 'touch', 'VCC', 'red'],
      ['uno', 'GND', 'touch', 'GND', 'black'],
      ['touch', 'SIG', 'uno', 'D2'],
      ['rgb', 'R', 'uno', 'D9'],
      ['rgb', 'G', 'uno', 'D10'],
      ['rgb', 'B', 'uno', 'D11'],
      ['rgb', 'GND', 'uno', 'GND', 'black'],
    ],
    inputs: { touchPressed: 0 },
    sketch: `// Desk RGB Mood Lamp
const int touchPin = 2;
String names[] = {"warm", "cool", "focus", "night"};
int reds[] = {255, 120, 255, 40};
int greens[] = {140, 180, 255, 0};
int blues[] = {40, 255, 255, 60};

int scene = 0;
bool wasTouched = false;

void apply() {
  analogWrite(9, reds[scene]);
  analogWrite(10, greens[scene]);
  analogWrite(11, blues[scene]);
  Serial.print("scene: ");
  Serial.println(names[scene]);
}

void setup() {
  pinMode(touchPin, INPUT);
  Serial.begin(9600);
  apply();
}

void loop() {
  bool touched = digitalRead(touchPin) == HIGH;
  if (touched && !wasTouched) {
    scene = (scene + 1) % 4;
    apply();
  }
  wasTouched = touched;
  delay(30);
}
`,
    probe: `name: taps cycle the scenes
steps:
  - wait-serial: "scene: warm"
  - set-control: { part-id: touch, control: touchPressed, value: 1 }
  - wait-serial: { text: "scene: cool", timeout: 1s }
  - set-control: { part-id: touch, control: touchPressed, value: 0 }
  - delay: 100ms
  - set-control: { part-id: touch, control: touchPressed, value: 1 }
  - wait-serial: { text: "scene: focus", timeout: 1s }
`,
  },
  {
    slug: 'classroom-quiet-signal',
    title: 'Classroom Quiet Signal',
    emoji: '🤫',
    tagline: 'A lamp that turns amber, then red, as the room gets louder.',
    description:
      'A sound sensor listens to the room and an RGB lamp shows how loud it is. Averaging several readings keeps a single dropped book from turning the lamp red.',
    level: 'Intermediate',
    tags: ['sound', 'rgb', 'averaging', 'classroom'],
    learningOutcomes: [
      'Smooth a noisy reading by averaging several samples.',
      'Map a level onto three traffic-light zones.',
      'Explain why one spike should not change the verdict.',
    ],
    wiringNotes: ['Turn the sensor\'s potentiometer until the quiet room reads low but not zero.'],
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 60, y: 150 },
      { id: 'mic', type: 'sound-sensor', x: 400, y: 100 },
      { id: 'rgb', type: 'led-rgb-module', x: 400, y: 280 },
    ],
    wires: [
      ['uno', '5V', 'mic', 'VCC', 'red'],
      ['uno', 'GND', 'mic', 'GND', 'black'],
      ['mic', 'AO', 'uno', 'A0'],
      ['rgb', 'R', 'uno', 'D9'],
      ['rgb', 'G', 'uno', 'D10'],
      ['rgb', 'B', 'uno', 'D11'],
      ['rgb', 'GND', 'uno', 'GND', 'black'],
    ],
    inputs: { soundLevel: 150 },
    sketch: `// Classroom Quiet Signal
const int micPin = A0;

int averageLevel() {
  long sum = 0;
  for (int i = 0; i < 10; i++) {
    sum += analogRead(micPin);
    delay(10);
  }
  return sum / 10;
}

void setup() {
  Serial.begin(9600);
}

void loop() {
  int level = averageLevel();
  if (level < 300) {
    analogWrite(9, 0); analogWrite(10, 255); analogWrite(11, 0);
    Serial.println("room: calm");
  } else if (level < 600) {
    analogWrite(9, 255); analogWrite(10, 120); analogWrite(11, 0);
    Serial.println("room: getting loud");
  } else {
    analogWrite(9, 255); analogWrite(10, 0); analogWrite(11, 0);
    Serial.println("room: too loud");
  }
}
`,
    probe: `name: lamp follows the noise
steps:
  - wait-serial: { text: "room: calm", timeout: 1s }
  - set-control: { part-id: mic, control: soundLevel, value: 450 }
  - wait-serial: { text: "room: getting loud", timeout: 1s }
  - set-control: { part-id: mic, control: soundLevel, value: 900 }
  - wait-serial: { text: "room: too loud", timeout: 1s }
`,
  },
  {
    slug: 'iot-automated-greenhouse',
    title: 'IoT Automated Greenhouse Controller',
    emoji: '🏡',
    tagline: 'Vent, pump and status report, publishing JSON every few seconds.',
    description:
      'The full greenhouse: a servo vent with hysteresis, a pump relay on dry soil, an LCD for the gardener, and a JSON status line ready for an MQTT broker. On an ESP32 the same JSON goes to the cloud.',
    level: 'Advanced',
    tags: ['iot', 'json', 'servo', 'relay', 'lcd'],
    learningOutcomes: [
      'Run several independent control loops in one sketch.',
      'Format sensor data as JSON for another system to read.',
      'Report on a schedule with millis() without blocking the controls.',
    ],
    wiringNotes: ['On an Uno the JSON goes to serial; an ESP32 or ESP8266 publishes it over Wi-Fi.', 'Give the servo and pump their own supply in a real greenhouse.'],
    builtOn: 'smart-greenhouse',
    fidelityNote:
      'Wi-Fi and MQTT need the firmware emulator on an ESP32. Here the JSON status is printed to serial, exactly as it would be published.',
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 60, y: 150 },
      { id: 'dht', type: 'dht22', x: 380, y: 20 },
      { id: 'soil', type: 'soil-moisture', x: 380, y: 150 },
      { id: 'servo', type: 'servo-sg90', x: 380, y: 280 },
      { id: 'relay', type: 'relay-1ch', x: 380, y: 400 },
      { id: 'lcd', type: 'lcd-16x2-i2c', x: 640, y: 120 },
    ],
    wires: [
      ['uno', '5V', 'dht', 'VCC', 'red'],
      ['uno', 'GND', 'dht', 'GND', 'black'],
      ['dht', 'DATA', 'uno', 'D2'],
      ['uno', '5V', 'soil', 'VCC', 'red'],
      ['uno', 'GND', 'soil', 'GND', 'black'],
      ['soil', 'AO', 'uno', 'A0'],
      ['uno', '5V', 'servo', 'VCC', 'red'],
      ['uno', 'GND', 'servo', 'GND', 'black'],
      ['servo', 'SIG', 'uno', 'D9'],
      ['uno', '5V', 'relay', 'DC+', 'red'],
      ['uno', 'GND', 'relay', 'DC-', 'black'],
      ['relay', 'IN', 'uno', 'D8'],
      ['uno', '5V', 'lcd', 'VCC', 'red'],
      ['uno', 'GND', 'lcd', 'GND', 'black'],
      ['lcd', 'SDA', 'uno', 'A4'],
      ['lcd', 'SCL', 'uno', 'A5'],
    ],
    inputs: { dhtTemperature: 24, dhtHumidity: 60, soilMoisture: 600 },
    sketch: `// IoT Automated Greenhouse Controller
#include <DHT.h>
#include <LiquidCrystal_I2C.h>
#include <Servo.h>

DHT dht(2, DHT22);
LiquidCrystal_I2C lcd(0x27, 16, 2);
Servo vent;

const int soilPin = A0;
const int pumpPin = 8;       // active LOW relay
bool ventOpen = false;
bool pumping = false;
unsigned long lastReport = 0;

void setup() {
  dht.begin();
  lcd.init();
  lcd.backlight();
  vent.attach(9);
  vent.write(0);
  pinMode(pumpPin, OUTPUT);
  digitalWrite(pumpPin, HIGH);
  Serial.begin(9600);
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  int soil = analogRead(soilPin);

  if (!ventOpen && t > 30) { vent.write(90); ventOpen = true; }
  if (ventOpen && t < 26) { vent.write(0); ventOpen = false; }
  pumping = soil < 350;
  digitalWrite(pumpPin, pumping ? LOW : HIGH);

  lcd.setCursor(0, 0);
  lcd.print(t);
  lcd.print("C ");
  lcd.print(ventOpen ? "vent open " : "vent shut ");

  if (millis() - lastReport >= 2000) {
    lastReport = millis();
    Serial.print("{\\"temp\\":");
    Serial.print(t);
    Serial.print(",\\"humidity\\":");
    Serial.print(h);
    Serial.print(",\\"soil\\":");
    Serial.print(soil);
    Serial.print(",\\"vent\\":");
    Serial.print(ventOpen ? "true" : "false");
    Serial.print(",\\"pump\\":");
    Serial.print(pumping ? "true" : "false");
    Serial.println("}");
  }
  delay(200);
}
`,
    probe: `name: vents when hot, pumps when dry, reports JSON
steps:
  - assert-serial-regex: { pattern: '"vent":false,"pump":false', timeout: 3s }
  - set-control: { part-id: dht, control: dhtTemperature, value: 33 }
  - set-control: { part-id: soil, control: soilMoisture, value: 200 }
  - assert-serial-regex: { pattern: '^\\{"temp":33\\.00,.*"vent":true,"pump":true\\}$', timeout: 3s }
  - expect-pin: { part-id: relay, pin: IN, expected: 0 }
`,
  },
  {
    slug: 'ultrasonic-panoramic-radar',
    title: 'Ultrasonic 2D Panoramic Radar Scanner',
    emoji: '📡',
    tagline: 'A servo sweeps a sensor through 180° and maps what it finds.',
    description:
      'An HC-SR04 rides on a servo that sweeps from 0 to 180 degrees. At each step the sketch prints "angle,distance", which a Processing or p5.js sketch on a laptop turns into a green radar sweep.',
    level: 'Advanced',
    tags: ['servo', 'ultrasonic', 'mapping', 'csv'],
    learningOutcomes: [
      'Coordinate an actuator and a sensor step by step.',
      'Stream CSV data for another program to plot.',
      'Understand polar coordinates: an angle and a distance.',
    ],
    wiringNotes: ['Mount the sensor firmly: any wobble shows up as noise in the map.', 'Let the servo settle for a few ms before each reading.'],
    board: 'arduino-uno',
    parts: [
      { id: 'uno', type: 'arduino-uno', x: 60, y: 150 },
      { id: 'sonar', type: 'hc-sr04', x: 400, y: 100 },
      { id: 'servo', type: 'servo-sg90', x: 400, y: 280 },
    ],
    wires: [
      ['uno', '5V', 'sonar', 'VCC', 'red'],
      ['uno', 'GND', 'sonar', 'GND', 'black'],
      ['sonar', 'TRIG', 'uno', 'D10'],
      ['sonar', 'ECHO', 'uno', 'D11'],
      ['uno', '5V', 'servo', 'VCC', 'red'],
      ['uno', 'GND', 'servo', 'GND', 'black'],
      ['servo', 'SIG', 'uno', 'D9'],
    ],
    inputs: { hcSr04Distance: 75 },
    sketch: `// Ultrasonic 2D Panoramic Radar Scanner
#include <Servo.h>

Servo scanner;
const int trigPin = 10;
const int echoPin = 11;

long readCm() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  return pulseIn(echoPin, HIGH) / 58;
}

void scanAt(int angle) {
  scanner.write(angle);
  delay(15);
  Serial.print(angle);
  Serial.print(",");
  Serial.println(readCm());
}

void setup() {
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  scanner.attach(9);
  Serial.begin(9600);
}

void loop() {
  for (int a = 0; a <= 180; a += 15) scanAt(a);
  for (int a = 165; a > 0; a -= 15) scanAt(a);
}
`,
    probe: `name: sweeps and reports angle,distance
steps:
  - wait-serial: { text: "0,75", timeout: 1s }
  - wait-serial: { text: "90,75", timeout: 2s }
  - wait-serial: { text: "180,75", timeout: 2s }
  - set-control: { part-id: sonar, control: hcSr04Distance, value: 30 }
  - wait-serial: { text: "90,30", timeout: 3s }
`,
  },
];
