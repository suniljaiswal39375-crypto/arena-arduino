import type { FidelityTier } from '@/lib/brand';
import {
  parsePins,
  type AdapterKind,
  type ControlDef,
  type PartCategory,
  type PartDef,
} from './types';

interface Opts {
  desc?: string;
  tags?: string[];
  aliases?: string[];
  pins: string;
  adapter?: AdapterKind;
  engine?: 'functional' | 'firmware' | 'any';
  tier?: FidelityTier;
  notes?: string;
  wokwi?: string;
  controls?: ControlDef[];
  wiring?: string[];
  sketch?: string;
  datasheet?: string;
  mistakes?: string[];
  models?: string[];
  defaults?: Record<string, string | number | boolean>;
  supply?: number;
  current?: number;
  bonds?: string[][];
}

const MODEL_NOTE =
  'Behaviourally modelled by the functional runtime: the response is right, the electrical timing is not. Switch to Firmware Emulation for cycle-accurate behaviour.';
const VISUAL_NOTE =
  'Rendered and wired visually so you can practise the wiring, but its physics are not simulated.';

function P(id: string, name: string, category: PartCategory, o: Opts): PartDef {
  return {
    id,
    name,
    category,
    description: o.desc ?? `${name}.`,
    tags: o.tags ?? [],
    aliases: o.aliases ?? [],
    pins: parsePins(o.pins),
    controls: o.controls ?? [],
    fidelity: {
      engine: o.engine ?? 'functional',
      tier: o.tier ?? 'model',
      notes: o.notes ?? (o.tier === 'visual' ? VISUAL_NOTE : MODEL_NOTE),
    },
    adapter: o.adapter ?? 'static',
    models: o.models ?? [],
    docs: {
      wiring: o.wiring ?? [],
      exampleSketch: o.sketch,
      datasheetUrl: o.datasheet,
      commonMistakes: o.mistakes,
    },
    wokwi: o.wokwi,
    defaults: o.defaults,
    supply: o.supply,
    current: o.current,
    bonds: o.bonds,
  };
}

const SENSOR_INPUT = (id: string, label: string, min: number, max: number, def: number, unit: string): ControlDef => ({
  id,
  label,
  kind: 'slider',
  min,
  max,
  step: Math.max(1, Math.round((max - min) / 200)),
  unit,
  default: def,
});

/* ------------------------------------------------------------------ *
 * Microcontroller (5)
 * ------------------------------------------------------------------ */
const MICROCONTROLLER: PartDef[] = [
  P('arduino-uno', 'Arduino Uno', 'Microcontroller', {
    desc: 'ATmega328P board. The default brain for every beginner mission: 14 digital pins (6 PWM), 6 analog inputs, 5 V logic.',
    tags: ['avr', 'atmega328p', 'starter', 'atl'],
    aliases: ['uno', 'arduino uno r3'],
    pins:
      'A0:analog:l A1:analog:l A2:analog:l A3:analog:l A4:i2c:l A5:i2c:l 5V:power:l 3V3:power:l GND:ground:l GND2:ground:l VIN:power:l RST:digital:l ' +
      'D13:digital:r D12:digital:r D11:pwm:r D10:pwm:r D9:pwm:r D8:digital:r D7:digital:r D6:pwm:r D5:pwm:r D4:digital:r D3:pwm:r D2:digital:r D1:uart:r D0:uart:r',
    adapter: 'board',
    engine: 'any',
    tier: 'model',
    notes:
      'Functional runtime models digital I/O, analog in, PWM, tone, servo, serial and basic LCD/OLED text. No AVR cycle timing or electrical fidelity. Firmware Emulation compiles real code and runs it instruction by instruction.',
    wokwi: 'wokwi-arduino-uno',
    models: ['uno'],
    defaults: { analogBase: 14, pwmPins: '3,5,6,9,10,11', voltage: 5 },
    supply: 5,
    current: 45,
    wiring: ['5V / GND from USB or the 5 V rail', 'D13 drives the on-board LED'],
    sketch: `void setup() {
  pinMode(13, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(13, HIGH);
  Serial.println("on");
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`,
    datasheet: 'https://docs.arduino.cc/hardware/uno-rev3',
    mistakes: [
      'Forgetting that A4/A5 are also SDA/SCL on the Uno.',
      'Driving a motor or relay coil straight from a pin instead of through a driver.',
      'Using D0/D1 while the serial monitor is open - they are the hardware UART.',
    ],
  }),
  P('arduino-nano', 'Arduino Nano', 'Microcontroller', {
    desc: 'Breadboard-friendly ATmega328P in a DIP-ish footprint. Same brain as the Uno, more analog inputs.',
    tags: ['avr', 'atmega328p', 'breadboard'],
    aliases: ['nano', 'nano v3'],
    pins:
      'A0:analog:l A1:analog:l A2:analog:l A3:analog:l A4:i2c:l A5:i2c:l A6:analog:l A7:analog:l 5V:power:l 3V3:power:l GND:ground:l VIN:power:l RST:digital:l ' +
      'D13:digital:r D12:digital:r D11:pwm:r D10:pwm:r D9:pwm:r D8:digital:r D7:digital:r D6:pwm:r D5:pwm:r D4:digital:r D3:pwm:r D2:digital:r D1:uart:r D0:uart:r',
    adapter: 'board',
    engine: 'any',
    tier: 'model',
    wokwi: 'wokwi-arduino-nano',
    defaults: { analogBase: 14, pwmPins: '3,5,6,9,10,11', voltage: 5 },
    supply: 5,
    current: 40,
    notes: 'Same functional coverage as the Uno. A6 and A7 are analog-only.',
  }),
  P('arduino-mega', 'Arduino Mega 2560', 'Microcontroller', {
    desc: 'ATmega2560 with 54 digital pins and 16 analog inputs, for projects that outgrow the Uno.',
    tags: ['avr', 'atmega2560'],
    aliases: ['mega', 'mega 2560'],
    pins:
      'A0:analog:l A1:analog:l A2:analog:l A3:analog:l A4:analog:l A5:analog:l A6:analog:l A7:analog:l 5V:power:l 3V3:power:l GND:ground:l VIN:power:l ' +
      'D53:pwm:r D52:digital:r D51:spi:r D50:digital:r D13:pwm:r D12:pwm:r D11:pwm:r D10:pwm:r D9:pwm:r D8:pwm:r D7:pwm:r D6:pwm:r D5:pwm:r D4:pwm:r D3:pwm:r D2:pwm:r D1:uart:r D0:uart:r',
    adapter: 'board',
    engine: 'any',
    tier: 'model',
    wokwi: 'wokwi-arduino-mega',
    defaults: { analogBase: 54, pwmPins: '2,3,4,5,6,7,8,9,10,11,12,13', voltage: 5 },
    supply: 5,
    current: 60,
    notes: 'Analog inputs start at pin 54. The functional runtime supports every mapped pin.',
  }),
  P('arduino-leonardo', 'Arduino Leonardo', 'Microcontroller', {
    desc: 'ATmega32U4 with native USB, so it can appear as a keyboard or mouse.',
    tags: ['avr', 'atmega32u4', 'hid'],
    aliases: ['leonardo', 'micro'],
    pins:
      'A0:analog:l A1:analog:l A2:analog:l A3:analog:l A4:analog:l A5:analog:l 5V:power:l 3V3:power:l GND:ground:l VIN:power:l ' +
      'D13:digital:r D12:digital:r D11:pwm:r D10:pwm:r D9:pwm:r D8:digital:r D7:digital:r D6:pwm:r D5:pwm:r D4:analog:r D3:pwm:r D2:i2c:r D1:uart:r D0:uart:r',
    adapter: 'board',
    engine: 'any',
    tier: 'model',
    wokwi: 'wokwi-arduino-micro',
    defaults: { analogBase: 18, pwmPins: '3,5,6,9,10,11,13', voltage: 5 },
    supply: 5,
    current: 40,
    notes: 'USB HID behaviour is not simulated in either engine. I/O behaves like an Uno.',
  }),
  P('raspberry-pi-5', 'Raspberry Pi 5', 'Microcontroller', {
    desc: 'A full Linux computer, not a microcontroller. Used in ATL for vision, voice and gateway projects.',
    tags: ['linux', 'sbc', 'gpio'],
    aliases: ['pi 5', 'rpi5', 'raspberry pi'],
    pins:
      '5V:power:l 5V2:power:l GND:ground:l 3V3:power:l GPIO2:i2c:l GPIO3:i2c:l GPIO4:digital:l GPIO14:uart:l GPIO15:uart:l ' +
      'GPIO17:digital:r GPIO18:pwm:r GPIO27:digital:r GPIO22:digital:r GPIO23:digital:r GPIO24:digital:r GPIO25:digital:r GPIO9:spi:r GPIO10:spi:r GPIO11:spi:r',
    adapter: 'static',
    engine: 'any',
    tier: 'visual',
    notes:
      'A Raspberry Pi is a Linux computer. SparkLab renders it and wires it, but does not boot an operating system. Firmware Emulation targets microcontrollers only.',
    supply: 5,
    current: 600,
    mistakes: ['Pi GPIO is 3.3 V logic - never feed it 5 V from an Arduino output.'],
  }),
];

/* ------------------------------------------------------------------ *
 * IoT (13)
 * ------------------------------------------------------------------ */
const IOT: PartDef[] = [
  P('nodemcu-esp8266', 'NodeMCU ESP8266', 'IoT', {
    desc: 'Wi-Fi microcontroller board with 11 GPIOs, the classic first IoT step.',
    tags: ['wifi', 'esp8266', 'iot'],
    aliases: ['nodemcu', 'esp8266', 'esp-12e'],
    pins:
      'A0:analog:l 3V3:power:l GND:ground:l VIN:power:l RST:digital:l EN:digital:l ' +
      'D0:pwm:r D1:i2c:r D2:i2c:r D3:digital:r D4:digital:r D5:spi:r D6:spi:r D7:spi:r D8:spi:r',
    adapter: 'board',
    engine: 'any',
    tier: 'model',
    wokwi: 'wokwi-esp8266',
    defaults: { analogBase: 17, pwmPins: '0,1,2,3,4,5,12,13,14,15,16', voltage: 3.3 },
    supply: 3.3,
    current: 80,
    notes: 'GPIO numbering on the silkscreen (D0-D8) is remapped for you. Wi-Fi requires Firmware Emulation.',
    mistakes: ['ESP8266 is 3.3 V logic - a 5 V signal will damage it.'],
  }),
  P('wemos-d1-r2', 'WeMos D1 R2', 'IoT', {
    desc: 'ESP8266 in an Arduino-Uno shield footprint, so ATL shields drop straight on.',
    tags: ['wifi', 'esp8266', 'shield'],
    aliases: ['wemos', 'd1 r2'],
    pins:
      'A0:analog:l 5V:power:l 3V3:power:l GND:ground:l VIN:power:l RST:digital:l ' +
      'D13:spi:r D12:spi:r D11:spi:r D10:spi:r D9:digital:r D8:digital:r D7:digital:r D6:digital:r D5:digital:r D4:i2c:r D3:digital:r D2:digital:r D1:uart:r D0:uart:r',
    adapter: 'board',
    engine: 'any',
    tier: 'model',
    defaults: { analogBase: 17, pwmPins: '0,1,2,3,4,5,12,13,14,15,16', voltage: 3.3 },
    supply: 3.3,
    current: 80,
    notes: 'Uno-shaped ESP8266. 3.3 V logic despite the 5 V pin, which feeds the onboard regulator only.',
  }),
  P('esp32-devkit-v1', 'ESP32 DevKit V1', 'IoT', {
    desc: 'Dual-core Wi-Fi + Bluetooth microcontroller. The serious IoT brain.',
    tags: ['wifi', 'bluetooth', 'esp32', 'iot', 'dual-core'],
    aliases: ['esp32', 'esp32 devkit', 'esp-wroom-32'],
    pins:
      'A0:analog:l A3:analog:l A4:analog:l A5:analog:l A6:analog:l A7:analog:l 3V3:power:l GND:ground:l VIN:power:l EN:digital:l ' +
      'D2:digital:r D4:digital:r D5:spi:r D12:digital:r D13:digital:r D14:digital:r D15:digital:r D18:spi:r D19:spi:r D21:i2c:r D22:i2c:r D23:spi:r D25:digital:r D26:digital:r D27:digital:r',
    adapter: 'board',
    engine: 'any',
    tier: 'model',
    wokwi: 'wokwi-esp32-devkit-v1',
    models: ['esp32'],
    defaults: { analogBase: 100, pwmPins: '2,4,5,12,13,14,15,16,17,18,19,21,22,23,25,26,27', voltage: 3.3 },
    supply: 3.3,
    current: 120,
    notes: 'Wi-Fi, Bluetooth and dual-core behaviour need Firmware Emulation. The functional runtime covers plain GPIO, ADC and PWM.',
    wiring: ['3V3 and GND to the rail', 'D21/D22 are the default I2C pair'],
    sketch: `void setup() {
  Serial.begin(115200);
  pinMode(2, OUTPUT);
}

void loop() {
  digitalWrite(2, !digitalRead(2));
  Serial.println("ESP32 heartbeat");
  delay(500);
}
`,
    datasheet: 'https://www.espressif.com/sites/default/files/documentation/esp32_datasheet_en.pdf',
  }),
  P('rfid-rc522', 'RFID Reader RC522', 'IoT', {
    desc: '13.56 MHz RFID reader over SPI. Reads the cards and key fobs in the ATL kit.',
    tags: ['rfid', 'spi', 'nfc', 'access'],
    aliases: ['rc522', 'mfrc522', 'rfid'],
    pins: 'SDA:spi:l SCK:spi:l MOSI:spi:l MISO:spi:l IRQ:digital:l GND:ground:l RST:digital:r 3V3:power:r',
    adapter: 'static',
    tier: 'model',
    controls: [SENSOR_INPUT('cardPresent', 'Card present', 0, 1, 0, '')],
    wiring: ['SDA → D10', 'SCK → D13', 'MOSI → D11', 'MISO → D12', 'RST → D9', '3V3 → 3.3 V (not 5 V)'],
    supply: 3.3,
    current: 26,
    mistakes: ['Powering an RC522 from 5 V - it is a 3.3 V part.'],
  }),
  P('gps-neo6m', 'GPS GY-NEO6MV2', 'IoT', {
    desc: 'Serial GPS module. Needs a view of the sky; in the lab, use the simulated fix.',
    tags: ['gps', 'uart', 'location'],
    aliases: ['neo-6m', 'gy-neo6mv2', 'gps'],
    pins: 'VCC:power:l GND:ground:l TX:uart:r RX:uart:r PPS:digital:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('gpsFix', 'Satellites in view', 0, 12, 6, 'sats')],
    wiring: ['VCC → 5 V', 'TX → D4 (SoftwareSerial RX)', 'RX → D3'],
    supply: 5,
    current: 45,
  }),
  P('bluetooth-hc05', 'Bluetooth HC-05', 'IoT', {
    desc: 'Classic Bluetooth serial module that can act as master or slave.',
    tags: ['bluetooth', 'uart', 'wireless'],
    aliases: ['hc-05', 'hc05'],
    pins: 'EN:digital:l VCC:power:l GND:ground:l TX:uart:r RX:uart:r STATE:digital:r',
    adapter: 'static',
    tier: 'visual',
    wiring: ['VCC → 5 V', 'TX → RX, RX → TX (cross them)', 'Use a divider on RX if the board is 3.3 V'],
    supply: 5,
    current: 30,
    notes: 'Radio traffic is not simulated. Wiring and AT-command flow are.',
    mistakes: ['Connecting TX to TX instead of crossing TX and RX.'],
  }),
  P('bluetooth-hc06', 'Bluetooth HC-06', 'IoT', {
    desc: 'Slave-only Bluetooth serial module, simpler to configure than the HC-05.',
    tags: ['bluetooth', 'uart'],
    aliases: ['hc-06', 'hc06'],
    pins: 'VCC:power:l GND:ground:l TX:uart:r RX:uart:r',
    adapter: 'static',
    tier: 'visual',
    supply: 5,
    current: 30,
    notes: 'Radio traffic is not simulated.',
  }),
  P('gsm-sim800l', 'GSM SIM800L', 'IoT', {
    desc: 'Quad-band GSM/GPRS module for SMS and calls without Wi-Fi.',
    tags: ['gsm', 'sms', 'uart', 'gprs'],
    aliases: ['sim800l', 'sim800'],
    pins: 'VCC:power:l RST:digital:l GND:ground:l TX:uart:r RX:uart:r',
    adapter: 'static',
    tier: 'visual',
    supply: 4,
    current: 2000,
    notes: 'Needs a 2 A supply with a big capacitor. Cellular traffic is not simulated.',
    mistakes: ['Powering it from the Arduino 5 V pin - it browns out at 2 A peaks.'],
  }),
  P('microsd-module', 'Micro SD Card Module', 'IoT', {
    desc: 'SPI microSD breakout with onboard level shifting, for datalogging.',
    tags: ['sd', 'spi', 'storage', 'logging'],
    aliases: ['sd card', 'microsd'],
    pins: 'GND:ground:l VCC:power:l MISO:spi:r MOSI:spi:r SCK:spi:r CS:spi:r',
    adapter: 'static',
    tier: 'visual',
    wokwi: 'wokwi-microsd-card',
    supply: 5,
    current: 80,
    notes: 'Filesystem emulation is only available in Firmware Emulation with SD card support enabled.',
    wiring: ['CS → D10', 'MOSI → D11', 'MISO → D12', 'SCK → D13'],
  }),
  P('max485', 'MAX485 RS485', 'IoT', {
    desc: 'RS485 transceiver for long-distance industrial serial links.',
    tags: ['rs485', 'industrial', 'uart'],
    aliases: ['max485', 'rs485'],
    pins: 'VCC:power:l GND:ground:l RO:uart:r DI:uart:r RE:digital:r DE:digital:r A:digital:r B:digital:r',
    adapter: 'static',
    tier: 'visual',
    supply: 5,
    current: 1,
  }),
  P('lora-e32', 'E32 LoRa 433 MHz', 'IoT', {
    desc: 'Long-range 433 MHz radio for kilometre-scale sensor links.',
    tags: ['lora', 'radio', 'long-range'],
    aliases: ['e32', 'lora', 'sx1278'],
    pins: 'M0:digital:l M1:digital:l RX:uart:l TX:uart:l AUX:digital:l VCC:power:r GND:ground:r',
    adapter: 'static',
    tier: 'visual',
    supply: 5,
    current: 120,
    notes: 'Radio traffic is not simulated.',
  }),
  P('pn532-nfc', 'PN532 NFC', 'IoT', {
    desc: 'NFC reader supporting I2C, SPI and UART, plus card emulation.',
    tags: ['nfc', 'i2c', 'rfid'],
    aliases: ['pn532', 'nfc'],
    pins: 'VCC:power:l GND:ground:l SDA:i2c:r SCL:i2c:r IRQ:digital:r RST:digital:r',
    adapter: 'static',
    tier: 'visual',
    supply: 5,
    current: 30,
  }),
  P('mcp2515-can', 'MCP2515 CAN Bus', 'IoT', {
    desc: 'SPI CAN controller with transceiver, used in automotive and robotics work.',
    tags: ['can', 'spi', 'automotive'],
    aliases: ['mcp2515', 'can bus'],
    pins: 'VCC:power:l GND:ground:l CS:spi:r SCK:spi:r MOSI:spi:r MISO:spi:r INT:digital:r',
    adapter: 'static',
    tier: 'visual',
    supply: 5,
    current: 10,
  }),
];

/* ------------------------------------------------------------------ *
 * Sensor (35 listed in the ATL kit)
 * ------------------------------------------------------------------ */
const SENSOR: PartDef[] = [
  P('hc-sr04', 'HC-SR04 Ultrasonic', 'Sensor', {
    desc: 'Measures 2-400 cm by timing an ultrasonic echo.',
    tags: ['distance', 'ultrasonic', 'pulseIn'],
    aliases: ['hcsr04', 'ultrasonic', 'sonar'],
    pins: 'VCC:power:l TRIG:digital:l ECHO:digital:r GND:ground:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('hcSr04Distance', 'Distance', 2, 400, 42, 'cm')],
    wiring: ['VCC → 5 V', 'GND → GND', 'TRIG → D9', 'ECHO → D10'],
    sketch: `const int trigPin = 9;
const int echoPin = 10;

void setup() {
  Serial.begin(9600);
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
}

void loop() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);

  long duration = pulseIn(echoPin, HIGH);
  int cm = duration * 0.034 / 2;
  Serial.print(cm);
  Serial.println(" cm");
  delay(200);
}
`,
    notes: 'Interactive distance is returned through pulseIn. No ultrasonic timing fidelity.',
    supply: 5,
    current: 15,
    datasheet: 'https://cdn.sparkfun.com/datasheets/Sensors/Proximity/HCSR04.pdf',
    mistakes: ['Leaving ECHO floating instead of reading it as an input.'],
  }),
  P('dht11', 'DHT11 Temperature & Humidity', 'Sensor', {
    desc: 'Cheap single-wire temperature and humidity sensor, whole-number only.',
    tags: ['temperature', 'humidity', 'onewire'],
    aliases: ['dht11', 'dht'],
    pins: 'VCC:power:l DATA:onewire:l NC:digital:r GND:ground:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [
      SENSOR_INPUT('dhtTemperature', 'Temperature', 0, 50, 27, '°C'),
      SENSOR_INPUT('dhtHumidity', 'Humidity', 20, 90, 55, '%'),
    ],
    defaults: { sensor: 'dht11' },
    wiring: ['VCC → 5 V', 'DATA → D2 (with a 10 k pull-up)', 'GND → GND'],
    sketch: `#include <DHT.h>
#define DHTPIN 2
#define DHTTYPE DHT11
DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(9600);
  dht.begin();
}

void loop() {
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  Serial.print(t);
  Serial.print(" C  ");
  Serial.print(h);
  Serial.println(" %");
  delay(2000);
}
`,
    supply: 5,
    current: 2,
    mistakes: ['Forgetting the 10 k pull-up between DATA and VCC.'],
  }),
  P('dht22', 'DHT22 Temperature & Humidity', 'Sensor', {
    desc: 'Higher-accuracy version of the DHT11 with decimal readings.',
    tags: ['temperature', 'humidity', 'onewire'],
    aliases: ['dht22', 'am2302'],
    pins: 'VCC:power:l DATA:onewire:l NC:digital:r GND:ground:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [
      SENSOR_INPUT('dhtTemperature', 'Temperature', -40, 80, 24, '°C'),
      SENSOR_INPUT('dhtHumidity', 'Humidity', 0, 100, 48, '%'),
    ],
    defaults: { sensor: 'dht22' },
    supply: 5,
    current: 2,
    notes: 'Same protocol as the DHT11 with a different scale factor.',
  }),
  P('ldr-module', 'LDR Module', 'Sensor', {
    desc: 'Light-dependent resistor on a breakout with a comparator, giving analog and digital outputs.',
    tags: ['light', 'analog', 'ldr', 'photoresistor'],
    aliases: ['ldr', 'photoresistor', 'light sensor'],
    pins: 'VCC:power:l GND:ground:l AO:analog:r DO:digital:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('ldrLux', 'Light level', 0, 1023, 320, 'lux')],
    defaults: { sensor: 'ldr' },
    wiring: ['VCC → 5 V', 'GND → GND', 'AO → A0'],
    sketch: `const int ldrPin = A0;

void setup() {
  Serial.begin(9600);
}

void loop() {
  int light = analogRead(ldrPin);
  Serial.println(light);
  if (light < 400) {
    Serial.println("It is dark - switch the lamp on");
  }
  delay(500);
}
`,
    supply: 5,
    current: 1,
    datasheet: 'https://components101.com/resistor/ldr-datasheet',
  }),
  P('soil-moisture', 'Soil Moisture Sensor', 'Sensor', {
    desc: 'Resistive probe that reads wetter soil as a higher analog value.',
    tags: ['soil', 'moisture', 'agriculture', 'analog'],
    aliases: ['soil sensor', 'moisture'],
    pins: 'VCC:power:l GND:ground:l AO:analog:r DO:digital:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('soilMoisture', 'Soil moisture', 0, 1023, 380, '')],
    defaults: { sensor: 'soil' },
    supply: 5,
    current: 5,
    mistakes: ['Leaving a resistive probe powered in wet soil - it corrodes. Power it only when reading.'],
  }),
  P('soil-moisture-capacitive', 'Capacitive Soil Moisture v1.2', 'Sensor', {
    desc: 'Corrosion-free capacitive soil probe; higher value means drier soil on most boards.',
    tags: ['soil', 'capacitive', 'agriculture'],
    aliases: ['capacitive soil', 'soil pro'],
    pins: 'VCC:power:l GND:ground:l AUOT:analog:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('soilMoisture', 'Soil moisture', 0, 1023, 520, '')],
    defaults: { sensor: 'soil', invert: true },
    supply: 5,
    current: 5,
  }),
  P('pir-motion', 'PIR Motion Sensor', 'Sensor', {
    desc: 'Passive infrared detector that goes HIGH when a warm body moves.',
    tags: ['motion', 'pir', 'security', 'digital'],
    aliases: ['pir', 'motion sensor', 'hc-sr501'],
    pins: 'VCC:power:l OUT:digital:r GND:ground:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [{ id: 'motionDetected', label: 'Motion', kind: 'toggle', default: 0 }],
    defaults: { sensor: 'pir' },
    wiring: ['VCC → 5 V', 'OUT → D7', 'GND → GND'],
    sketch: `const int pirPin = 7;
const int ledPin = 13;

void setup() {
  pinMode(pirPin, INPUT);
  pinMode(ledPin, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  if (digitalRead(pirPin) == HIGH) {
    digitalWrite(ledPin, HIGH);
    Serial.println("motion");
  } else {
    digitalWrite(ledPin, LOW);
  }
  delay(100);
}
`,
    supply: 5,
    current: 1,
    mistakes: ['Reading PIR during its 30-60 second warm-up and concluding it is broken.'],
  }),
  P('ir-obstacle', 'IR Obstacle Sensor', 'Sensor', {
    desc: 'Reflective infrared proximity switch with an adjustable threshold.',
    tags: ['proximity', 'ir', 'obstacle'],
    aliases: ['ir sensor', 'obstacle'],
    pins: 'VCC:power:l GND:ground:l OUT:digital:r EN:digital:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [{ id: 'obstacleNear', label: 'Obstacle within range', kind: 'toggle', default: 0 }],
    defaults: { sensor: 'ir' },
    supply: 5,
    current: 8,
  }),
  P('rain-drop', 'Rain Drop Sensor', 'Sensor', {
    desc: 'Conductive pad that reads lower resistance as water bridges its traces.',
    tags: ['rain', 'water', 'weather'],
    aliases: ['rain sensor', 'water drop'],
    pins: 'VCC:power:l GND:ground:l AO:analog:r DO:digital:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('rainLevel', 'Wetness', 0, 1023, 120, '')],
    defaults: { sensor: 'rain' },
    supply: 5,
    current: 3,
  }),
  P('flex-sensor', 'Flex Sensor', 'Sensor', {
    desc: 'Bendable resistor whose resistance rises with the bend angle.',
    tags: ['flex', 'bend', 'wearable'],
    aliases: ['flex', 'bend sensor'],
    pins: 'A:digital:l B:digital:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('flexAngle', 'Bend angle', 0, 90, 15, '°')],
    defaults: { sensor: 'flex' },
    supply: 5,
    current: 1,
  }),
  P('sound-sensor', 'Sound Sensor', 'Sensor', {
    desc: 'Microphone breakout with an analog envelope and a threshold digital output.',
    tags: ['sound', 'microphone', 'analog'],
    aliases: ['mic', 'sound', 'noise'],
    pins: 'VCC:power:l GND:ground:l AO:analog:r DO:digital:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('soundLevel', 'Sound level', 0, 1023, 180, 'dB')],
    defaults: { sensor: 'sound' },
    supply: 5,
    current: 4,
  }),
  P('mq2-gas', 'MQ-2 Gas Sensor', 'Sensor', {
    desc: 'Heated tin-oxide sensor responding to LPG, smoke, propane and hydrogen.',
    tags: ['gas', 'smoke', 'safety', 'mq2'],
    aliases: ['mq2', 'mq-2', 'gas sensor', 'smoke'],
    pins: 'VCC:power:l GND:ground:l AO:analog:r DO:digital:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('gasLevel', 'Gas concentration', 0, 1023, 140, 'ppm')],
    defaults: { sensor: 'gas' },
    wiring: ['VCC → 5 V (the heater needs 5 V)', 'AO → A1', 'GND → GND'],
    supply: 5,
    current: 160,
    mistakes: ['Trusting MQ-2 readings before a 24 hour burn-in, or using it as a certified gas alarm.'],
  }),
  P('mq135-air', 'MQ-135 Air Quality', 'Sensor', {
    desc: 'Heated sensor responding to ammonia, benzene, CO2 and smoke.',
    tags: ['air', 'co2', 'quality'],
    aliases: ['mq135', 'air quality'],
    pins: 'VCC:power:l GND:ground:l AO:analog:r DO:digital:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('airQuality', 'Air quality', 0, 1023, 260, 'ppm')],
    defaults: { sensor: 'air' },
    supply: 5,
    current: 160,
  }),
  P('water-level', 'Water Level Sensor', 'Sensor', {
    desc: 'Exposed parallel traces that read a rising analog value as water covers them.',
    tags: ['water', 'level', 'tank'],
    aliases: ['water level', 'depth'],
    pins: 'S:analog:l +:power:r -:ground:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('waterLevel', 'Water level', 0, 1023, 300, '')],
    defaults: { sensor: 'water' },
    supply: 5,
    current: 8,
  }),
  P('vibration-sw420', 'Vibration SW-420', 'Sensor', {
    desc: 'Spring-based vibration switch with a sensitivity potentiometer.',
    tags: ['vibration', 'shock', 'sw-420'],
    aliases: ['sw-420', 'vibration', 'shock'],
    pins: 'VCC:power:l GND:ground:l DO:digital:r AO:analog:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [{ id: 'vibrationDetected', label: 'Vibration', kind: 'toggle', default: 0 }],
    defaults: { sensor: 'vibration' },
    supply: 5,
    current: 3,
  }),
  P('joystick', 'Analog Joystick', 'Sensor', {
    desc: 'Two potentiometers and a push switch, for steering and menu navigation.',
    tags: ['joystick', 'potentiometer', 'input'],
    aliases: ['joystick module', 'thumbstick'],
    pins: 'GND:ground:l +5V:power:l VRX:analog:r VRY:analog:r SW:digital:r',
    adapter: 'sensor-value',
    tier: 'model',
    wokwi: 'wokwi-analog-joystick',
    controls: [
      SENSOR_INPUT('joystickX', 'X axis', 0, 1023, 512, ''),
      SENSOR_INPUT('joystickY', 'Y axis', 0, 1023, 512, ''),
    ],
    defaults: { sensor: 'joystick' },
    supply: 5,
    current: 10,
  }),
  P('keypad-4x4', '4x4 Keypad', 'Sensor', {
    desc: 'Sixteen-key matrix on eight pins, standard for locks and menus.',
    tags: ['keypad', 'input', 'matrix'],
    aliases: ['keypad', '4x4', 'membrane'],
    pins: 'R1:digital:l R2:digital:l R3:digital:l R4:digital:l C1:digital:r C2:digital:r C3:digital:r C4:digital:r',
    adapter: 'matrix',
    tier: 'model',
    wokwi: 'wokwi-membrane-keypad',
    controls: [
      { id: 'pressedKey', label: 'Pressed key', kind: 'button', default: 0 },
    ],
    defaults: { sensor: 'keypad' },
    supply: 5,
    current: 5,
  }),
  P('ttp223-touch', 'TTP223 Touch Sensor', 'Sensor', {
    desc: 'Capacitive touch pad that replaces a mechanical button.',
    tags: ['touch', 'capacitive', 'input'],
    aliases: ['ttp223', 'touch sensor'],
    pins: 'VCC:power:l GND:ground:l SIG:digital:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [{ id: 'touchPressed', label: 'Touched', kind: 'toggle', default: 0 }],
    defaults: { sensor: 'touch' },
    supply: 5,
    current: 2,
  }),
  P('tcs3200-colour', 'TCS3200 Colour Sensor', 'Sensor', {
    desc: 'Programmable light-to-frequency converter that reads red, green and blue.',
    tags: ['colour', 'color', 'light'],
    aliases: ['tcs3200', 'tcs230', 'colour sensor'],
    pins: 'VCC:power:l GND:ground:l S0:digital:r S1:digital:r S2:digital:r S3:digital:r OUT:digital:r LED:digital:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('colourValue', 'Colour channel', 0, 255, 128, '')],
    defaults: { sensor: 'colour' },
    supply: 5,
    current: 20,
  }),
  P('water-flow-yfs201', 'Water Flow YF-S201', 'Sensor', {
    desc: 'Hall-effect flow meter that pulses in proportion to litres per minute.',
    tags: ['flow', 'water', 'pulse'],
    aliases: ['yf-s201', 'yfs201', 'flow sensor', 'water flow'],
    pins: 'VCC:power:l GND:ground:l SIG:digital:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('flowRate', 'Flow rate', 0, 30, 4, 'L/min')],
    defaults: { sensor: 'flow' },
    supply: 5,
    current: 15,
    notes: 'Search aliases are forwarded: typing YF-S201 finds this part.',
  }),
  P('fsr402-force', 'FSR402 Force Sensor', 'Sensor', {
    desc: 'Thin force-sensitive resistor for pressure and weight sensing.',
    tags: ['force', 'pressure', 'fsr'],
    aliases: ['fsr', 'fsr402', 'pressure'],
    pins: 'A:digital:l B:digital:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('forceValue', 'Applied force', 0, 1023, 90, '')],
    defaults: { sensor: 'force' },
    supply: 5,
    current: 1,
  }),
  P('line-follower-array', '5-Channel Line Follower', 'Sensor', {
    desc: 'Five IR reflectance sensors in a row, the classic line-robot nose.',
    tags: ['line', 'robot', 'ir', 'array'],
    aliases: ['line follower', 'ir array'],
    pins: 'VCC:power:l GND:ground:l D1:digital:r D2:digital:r D3:digital:r D4:digital:r D5:digital:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('linePosition', 'Line position', -2, 2, 0, '')],
    defaults: { sensor: 'line' },
    supply: 5,
    current: 20,
  }),
  P('ph-pro-kit', 'pH Pro Kit', 'Sensor', {
    desc: 'Analog pH probe with a calibration board for hydroponics and water testing.',
    tags: ['ph', 'water', 'chemistry'],
    aliases: ['ph sensor', 'ph probe'],
    pins: 'VCC:power:l GND:ground:l PO:analog:r TO:analog:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('phValue', 'pH value', 0, 14, 7, 'pH')],
    defaults: { sensor: 'ph' },
    supply: 5,
    current: 10,
  }),
  P('ph-4502c', 'Liquid pH 4502C', 'Sensor', {
    desc: 'BNC pH meter board with temperature compensation input.',
    tags: ['ph', 'liquid', 'chemistry'],
    aliases: ['ph4502c', 'ph 4502c'],
    pins: 'VCC:power:l GND:ground:l PO:analog:r TO:analog:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('phValue', 'pH value', 0, 14, 7, 'pH')],
    defaults: { sensor: 'ph' },
    supply: 5,
    current: 10,
  }),
  P('tds-meter', 'TDS Meter', 'Sensor', {
    desc: 'Total dissolved solids probe for water-quality projects.',
    tags: ['tds', 'water', 'quality'],
    aliases: ['tds', 'tds sensor'],
    pins: 'VCC:power:l GND:ground:l AO:analog:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('tdsValue', 'TDS', 0, 1000, 180, 'ppm')],
    defaults: { sensor: 'tds' },
    supply: 5,
    current: 10,
  }),
  P('heart-rate-pulse', 'Heart-Rate Pulse Sensor', 'Sensor', {
    desc: 'Optical pulse sensor that outputs an analog heartbeat waveform.',
    tags: ['heart', 'pulse', 'biomedical'],
    aliases: ['pulse sensor', 'heartbeat'],
    pins: 'VCC:power:l GND:ground:l S:analog:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('heartRate', 'Heart rate', 40, 180, 74, 'bpm')],
    defaults: { sensor: 'heart' },
    supply: 5,
    current: 4,
  }),
  P('emyo-muscle', 'EMG MyoWare', 'Sensor', {
    desc: 'Muscle-signal (EMG) sensor that rectifies and amplifies microvolt activity.',
    tags: ['emg', 'muscle', 'biomedical'],
    aliases: ['myoware', 'emg'],
    pins: 'VCC:power:l GND:ground:l SIG:analog:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('emgValue', 'Muscle activity', 0, 1023, 60, '')],
    defaults: { sensor: 'emg' },
    supply: 5,
    current: 9,
  }),
  P('mh-z19b-co2', 'MH-Z19B CO2', 'Sensor', {
    desc: 'NDIR carbon-dioxide module read over UART or PWM.',
    tags: ['co2', 'air', 'uart'],
    aliases: ['mh-z19', 'mh-z19b', 'co2'],
    pins: 'VCC:power:l GND:ground:l RX:uart:r TX:uart:r PWM:pwm:r HD:digital:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('co2Level', 'CO2', 400, 5000, 620, 'ppm')],
    defaults: { sensor: 'co2' },
    supply: 5,
    current: 150,
  }),
  P('gp2y10-dust', 'GP2Y10 Dust Sensor', 'Sensor', {
    desc: 'Optical dust sensor with an IR LED and photodiode for air quality.',
    tags: ['dust', 'air', 'pm2.5'],
    aliases: ['gp2y10', 'dust sensor', 'sharp dust'],
    pins: 'VCC:power:l GND:ground:l LED:digital:r OUT:analog:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('dustDensity', 'Dust density', 0, 500, 40, 'µg/m³')],
    defaults: { sensor: 'dust' },
    supply: 5,
    current: 20,
  }),
  P('as608-fingerprint', 'AS608 Fingerprint', 'Sensor', {
    desc: 'Optical fingerprint module with onboard matching and storage.',
    tags: ['fingerprint', 'biometric', 'security'],
    aliases: ['as608', 'fingerprint'],
    pins: 'VCC:power:l GND:ground:l TX:uart:r RX:uart:r',
    adapter: 'static',
    tier: 'visual',
    supply: 3.3,
    current: 60,
    notes: 'Biometric matching is not simulated.',
  }),
  P('voice-recognition-v3', 'Voice Recognition V3', 'Sensor', {
    desc: 'Offline voice-command module trained with up to 80 phrases.',
    tags: ['voice', 'speech', 'audio'],
    aliases: ['voice recognition', 'vr3'],
    pins: 'VCC:power:l GND:ground:l TX:uart:r RX:uart:r',
    adapter: 'static',
    tier: 'visual',
    supply: 5,
    current: 40,
    notes: 'Audio recognition is not simulated.',
  }),
  P('max30102-oximeter', 'MAX30102 Oximeter', 'Sensor', {
    desc: 'I2C pulse oximeter and heart-rate module with red and IR LEDs.',
    tags: ['spo2', 'heart', 'i2c', 'biomedical'],
    aliases: ['max30102', 'oximeter', 'spo2'],
    pins: 'VCC:power:l GND:ground:l SDA:i2c:r SCL:i2c:r INT:digital:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('spo2', 'SpO2', 70, 100, 97, '%')],
    defaults: { sensor: 'spo2' },
    supply: 3.3,
    current: 25,
  }),
  P('mpu6050-imu', 'MPU6050 IMU', 'Sensor', {
    desc: 'Six-axis accelerometer and gyroscope over I2C, the standard for balance robots.',
    tags: ['imu', 'accelerometer', 'gyroscope', 'i2c'],
    aliases: ['mpu6050', 'imu', 'gyro'],
    pins: 'VCC:power:l GND:ground:l SCL:i2c:r SDA:i2c:r XDA:i2c:r XCL:i2c:r INT:digital:r',
    adapter: 'sensor-value',
    wokwi: 'wokwi-mpu6050',
    tier: 'model',
    controls: [
      SENSOR_INPUT('tiltX', 'Tilt X', -90, 90, 0, '°'),
      SENSOR_INPUT('tiltY', 'Tilt Y', -90, 90, 0, '°'),
    ],
    defaults: { sensor: 'imu' },
    supply: 5,
    current: 5,
  }),
  P('bmp280', 'BMP280 Barometer', 'Sensor', {
    desc: 'I2C/SPI temperature, pressure and altitude sensor.',
    tags: ['pressure', 'altitude', 'i2c', 'weather'],
    aliases: ['bmp280', 'barometer', 'pressure'],
    pins: 'VCC:power:l GND:ground:l SCL:i2c:r SDA:i2c:r CSB:spi:r SDO:spi:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('pressure', 'Pressure', 30000, 110000, 101325, 'Pa')],
    defaults: { sensor: 'pressure' },
    supply: 3.3,
    current: 1,
  }),
  P('piezo-plate', 'Piezo Sensor Plate', 'Sensor', {
    desc: 'Bare piezo element that generates a voltage when struck or vibrated.',
    tags: ['piezo', 'knock', 'vibration'],
    aliases: ['piezo', 'knock sensor'],
    pins: '+:analog:l -:ground:r',
    adapter: 'sensor-value',
    tier: 'model',
    controls: [SENSOR_INPUT('knockLevel', 'Knock strength', 0, 1023, 0, '')],
    defaults: { sensor: 'knock' },
    supply: 5,
    current: 1,
  }),
];

/* ------------------------------------------------------------------ *
 * Actuator (11)
 * ------------------------------------------------------------------ */
const ACTUATOR: PartDef[] = [
  P('buzzer-active', 'Active Buzzer', 'Actuator', {
    desc: 'Buzzer with an internal oscillator: apply DC and it beeps at a fixed pitch.',
    tags: ['sound', 'buzzer', 'alarm'],
    aliases: ['active buzzer', 'buzzer'],
    pins: '+:digital:l -:ground:r',
    adapter: 'buzzer',
    tier: 'model',
    defaults: { active: true },
    wiring: ['+ → D8', '− → GND'],
    sketch: `const int buzzerPin = 8;

void setup() {
  pinMode(buzzerPin, OUTPUT);
}

void loop() {
  digitalWrite(buzzerPin, HIGH);
  delay(300);
  digitalWrite(buzzerPin, LOW);
  delay(1200);
}
`,
    supply: 5,
    current: 30,
    notes: 'Plays through Web Audio. The browser blocks sound until you interact with the page.',
  }),
  P('buzzer-passive', 'Passive Buzzer', 'Actuator', {
    desc: 'Buzzer without an oscillator: drive it with tone() to make notes.',
    tags: ['sound', 'buzzer', 'tone', 'music'],
    aliases: ['passive buzzer', 'piezo buzzer'],
    pins: '+:digital:l -:ground:r',
    adapter: 'buzzer',
    tier: 'model',
    defaults: { active: false },
    wiring: ['+ → D8', '− → GND'],
    sketch: `const int buzzerPin = 8;

void setup() {
  pinMode(buzzerPin, OUTPUT);
}

void loop() {
  tone(buzzerPin, 880);
  delay(250);
  tone(buzzerPin, 587);
  delay(250);
  noTone(buzzerPin);
  delay(600);
}
`,
    supply: 5,
    current: 30,
  }),
  P('water-pump', 'Water Pump', 'Actuator', {
    desc: 'Small 5 V DC pump. Never drive it from a pin - use a relay or driver.',
    tags: ['pump', 'water', 'irrigation'],
    aliases: ['pump', 'mini pump'],
    pins: '+:power:l -:ground:r',
    adapter: 'motor',
    tier: 'model',
    defaults: { rpm: 3000 },
    supply: 5,
    current: 220,
    mistakes: ['Connecting a pump directly to an Arduino pin - pins supply about 20 mA, not 220 mA.'],
  }),
  P('vibrating-motor', 'Vibrating Motor', 'Actuator', {
    desc: 'Coin vibration motor for haptic feedback.',
    tags: ['vibration', 'haptic', 'motor'],
    aliases: ['vibration motor', 'coin motor'],
    pins: '+:digital:l -:ground:r',
    adapter: 'motor',
    tier: 'model',
    defaults: { rpm: 9000 },
    supply: 5,
    current: 90,
  }),
  P('isd1820-playback', 'ISD1820 Playback', 'Actuator', {
    desc: 'Record-and-playback voice module with 10 seconds of storage.',
    tags: ['audio', 'voice', 'record'],
    aliases: ['isd1820', 'voice module'],
    pins: 'VCC:power:l GND:ground:l REC:digital:r PLAYE:digital:r PLAYL:digital:r MIC:digital:r SP+:digital:r SP-:digital:r',
    adapter: 'static',
    tier: 'visual',
    supply: 5,
    current: 25,
  }),
  P('led-rgb-module', 'RGB LED Module (common cathode)', 'Actuator', {
    desc: 'Three LEDs in one package. PWM each channel to mix any colour.',
    tags: ['led', 'rgb', 'pwm', 'colour'],
    aliases: ['rgb led', 'rgb module'],
    pins: 'R:pwm:l G:pwm:l B:pwm:r GND:ground:r',
    adapter: 'rgb-led',
    tier: 'model',
    wiring: ['R → D9 (PWM)', 'G → D10 (PWM)', 'B → D11 (PWM)', 'GND → GND'],
    sketch: `const int r = 9, g = 10, b = 11;

void setup() {
  pinMode(r, OUTPUT);
  pinMode(g, OUTPUT);
  pinMode(b, OUTPUT);
}

void loop() {
  analogWrite(r, 255); analogWrite(g, 0);   analogWrite(b, 0);   delay(500);
  analogWrite(r, 0);   analogWrite(g, 255); analogWrite(b, 0);   delay(500);
  analogWrite(r, 0);   analogWrite(g, 0);   analogWrite(b, 255); delay(500);
}
`,
    supply: 5,
    current: 60,
    datasheet: 'https://components101.com/sites/default/files/component_datasheet/RGB-LED-Datasheet.pdf',
  }),
  P('solenoid-lock', 'Solenoid Lock', 'Actuator', {
    desc: 'Electromagnetic bolt that retracts when energised. Needs a driver and flyback diode.',
    tags: ['lock', 'solenoid', 'security'],
    aliases: ['solenoid', 'electronic lock'],
    pins: '+:power:l -:ground:r',
    adapter: 'relay',
    tier: 'model',
    defaults: { holdCurrent: 650 },
    supply: 12,
    current: 650,
    mistakes: ['Skipping the flyback diode - the inductive kick destroys the driver.'],
  }),
  P('thermal-printer', 'TTL Thermal Printer', 'Actuator', {
    desc: 'Serial thermal printer for receipts, labels and data logs.',
    tags: ['printer', 'uart', 'output'],
    aliases: ['thermal printer', 'receipt printer'],
    pins: 'VCC:power:l GND:ground:l RX:uart:r TX:uart:r',
    adapter: 'static',
    tier: 'visual',
    supply: 5,
    current: 1500,
  }),
  P('rotary-encoder-ky040', 'KY-040 Rotary Encoder', 'Actuator', {
    desc: 'Incremental encoder with quadrature outputs and a push switch.',
    tags: ['encoder', 'input', 'rotary'],
    aliases: ['ky-040', 'ky040', 'rotary encoder', 'encoder'],
    pins: 'GND:ground:l +:power:l SW:digital:r DT:digital:r CLK:digital:r',
    adapter: 'sensor-value',
    tier: 'model',
    wokwi: 'wokwi-ky-040',
    controls: [SENSOR_INPUT('encoderStep', 'Encoder step', -100, 100, 0, '')],
    defaults: { sensor: 'encoder' },
    supply: 5,
    current: 10,
  }),
  P('solenoid-valve', '12 V Solenoid Water Valve', 'Actuator', {
    desc: 'Normally-closed 12 V valve for irrigation control.',
    tags: ['valve', 'water', 'irrigation'],
    aliases: ['solenoid valve', 'water valve'],
    pins: '+:power:l -:ground:r',
    adapter: 'relay',
    tier: 'model',
    supply: 12,
    current: 500,
  }),
  P('led', 'LED', 'Actuator', {
    desc: 'A light-emitting diode. The hello world of physical computing.',
    tags: ['led', 'output', 'starter'],
    aliases: ['led', 'light emitting diode'],
    pins: 'A:digital:l K:ground:r',
    adapter: 'led',
    tier: 'model',
    wokwi: 'wokwi-led',
    models: ['led'],
    defaults: { colour: '#e63946', forwardVoltage: 2.0, maxCurrent: 20 },
    wiring: ['A (anode) → D13 through a 220 Ω resistor', 'K (cathode) → GND'],
    sketch: `void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
`,
    supply: 5,
    current: 20,
    datasheet: 'https://components101.com/led',
    mistakes: [
      'Omitting the current-limiting resistor - see the thermal diagnostic in the lab.',
      'Wiring the LED backwards: the long leg is the anode and goes to the signal.',
    ],
  }),
];

/* ------------------------------------------------------------------ *
 * Display (6 listed)
 * ------------------------------------------------------------------ */
const DISPLAY: PartDef[] = [
  P('lcd-16x2-i2c', '16x2 I2C LCD', 'Display', {
    desc: 'Two-line character LCD on an I2C backpack, so it needs only four wires.',
    tags: ['lcd', 'i2c', 'text', 'display'],
    aliases: ['1602 lcd', '16x2 lcd', 'i2c lcd', 'lcd'],
    pins: 'GND:ground:l VCC:power:l SDA:i2c:r SCL:i2c:r',
    adapter: 'lcd',
    tier: 'model',
    wokwi: 'wokwi-lcd1602',
    defaults: { cols: 16, rows: 2, address: 39 },
    wiring: ['VCC → 5 V', 'GND → GND', 'SDA → A4', 'SCL → A5 (Uno)'],
    sketch: `#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

void setup() {
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Hello, ATL!");
}

void loop() {
  lcd.setCursor(0, 1);
  lcd.print(millis() / 1000);
  delay(1000);
}
`,
    supply: 5,
    current: 120,
    mistakes: [
      'Assuming the backpack address is always 0x27 - some are 0x3F.',
      'Forgetting lcd.init() and wondering why the display is blank.',
    ],
  }),
  P('matrix-8x8-max7219', '8x8 MAX7219 Matrix', 'Display', {
    desc: 'SPI-driven 8x8 LED matrix that daisy-chains for scrolling text.',
    tags: ['matrix', 'led', 'spi'],
    aliases: ['max7219', '8x8 matrix', 'dot matrix'],
    pins: 'VCC:power:l GND:ground:l DIN:spi:r CS:spi:r CLK:spi:r DOUT:spi:r',
    adapter: 'matrix',
    tier: 'model',
    wokwi: 'wokwi-max7219-matrix',
    supply: 5,
    current: 200,
  }),
  P('led-rgb', 'RGB LED', 'Display', {
    desc: 'Single RGB LED with four legs, common cathode.',
    tags: ['led', 'rgb', 'pwm'],
    aliases: ['rgb led', 'rgb'],
    pins: 'R:pwm:l G:pwm:l B:pwm:r K:ground:r',
    adapter: 'rgb-led',
    tier: 'model',
    wokwi: 'wokwi-rgb-led',
    supply: 5,
    current: 60,
  }),
  P('seven-segment', '7-Segment Display', 'Display', {
    desc: 'Single-digit seven-segment display for counters and scores.',
    tags: ['seven segment', 'display', 'counter'],
    aliases: ['7 segment', '7-seg'],
    pins: 'a:digital:l b:digital:l c:digital:l d:digital:l e:digital:l f:digital:l g:digital:l dp:digital:l COM:ground:r',
    adapter: 'seven-seg',
    tier: 'model',
    wokwi: 'wokwi-7segment',
    supply: 5,
    current: 80,
  }),
  P('oled-128x64', 'OLED 0.96" 128x64', 'Display', {
    desc: 'I2C SSD1306 monochrome OLED, sharp and readable in any light.',
    tags: ['oled', 'i2c', 'display', 'ssd1306'],
    aliases: ['oled', 'ssd1306', '128x64 oled'],
    pins: 'VCC:power:l GND:ground:l SCL:i2c:r SDA:i2c:r',
    adapter: 'oled',
    tier: 'model',
    wokwi: 'board-ssd1306',
    defaults: { width: 128, height: 64, address: 60 },
    wiring: ['VCC → 3.3 V or 5 V (most modules accept both)', 'SDA → A4', 'SCL → A5'],
    sketch: `#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);

void setup() {
  display.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  display.clearDisplay();
  display.setTextSize(2);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("SparkLab");
  display.display();
}

void loop() {}
`,
    supply: 5,
    current: 25,
  }),
  P('leds-assorted', 'LEDs Assorted Colours', 'Display', {
    desc: 'The mixed bag of red, green, yellow, blue and white LEDs from the ATL kit.',
    tags: ['led', 'kit', 'output'],
    aliases: ['led kit', 'assorted leds'],
    pins: 'A:digital:l K:ground:r',
    adapter: 'led',
    tier: 'visual',
    defaults: { colour: '#ffb703', forwardVoltage: 2.0, maxCurrent: 20 },
    supply: 5,
    current: 20,
    notes: 'A kit of spares. Use the single LED part when you want to simulate brightness.',
  }),
];

/* ------------------------------------------------------------------ *
 * Driver (5 listed)
 * ------------------------------------------------------------------ */
const DRIVER: PartDef[] = [
  P('l298n', 'L298N Motor Driver', 'Driver', {
    desc: 'Dual H-bridge driving two DC motors or one stepper, with a 5 V regulator onboard.',
    tags: ['motor driver', 'h-bridge', 'robot'],
    aliases: ['l298n', 'l298'],
    pins: 'VMS:power:l GND:ground:l 5V:power:l ENA:pwm:r IN1:digital:r IN2:digital:r IN3:digital:r IN4:digital:r ENB:pwm:r OUT1:power:r OUT2:power:r OUT3:power:r OUT4:power:r',
    adapter: 'static',
    tier: 'model',
    supply: 12,
    current: 2000,
    mistakes: ['Forgetting the common ground between the motor supply and the Arduino.'],
  }),
  P('l293d', 'L293D Motor Driver', 'Driver', {
    desc: 'Quadruple half-H driver for small DC motors and steppers.',
    tags: ['motor driver', 'h-bridge'],
    aliases: ['l293d', 'l293'],
    pins: 'VCC1:power:l VCC2:power:l GND:ground:l GND2:ground:l EN1:pwm:r IN1:digital:r IN2:digital:r OUT1:power:r OUT2:power:r IN3:digital:r IN4:digital:r EN2:pwm:r',
    adapter: 'static',
    tier: 'model',
    supply: 5,
    current: 600,
  }),
  P('uln2003', 'ULN2003 Driver', 'Driver', {
    desc: 'Darlington array used to switch the 28BYJ-48 stepper and other inductive loads.',
    tags: ['stepper', 'driver', 'darlington'],
    aliases: ['uln2003', 'uln2003a'],
    pins: 'IN1:digital:l IN2:digital:l IN3:digital:l IN4:digital:l GND:ground:r VCC:power:r OUT1:digital:r OUT2:digital:r OUT3:digital:r OUT4:digital:r',
    adapter: 'stepper',
    tier: 'model',
    supply: 5,
    current: 300,
  }),
  P('relay-1ch', '1-Channel Relay', 'Driver', {
    desc: 'Electromechanical switch that lets 5 V logic control a mains-rated load. Active LOW on most boards.',
    tags: ['relay', 'switch', 'mains', 'safety'],
    aliases: ['relay', '1 channel relay', 'single relay'],
    pins: 'DC+:power:l DC-:ground:l IN:digital:l NO:digital:r COM:digital:r NC:digital:r',
    adapter: 'relay',
    tier: 'model',
    wokwi: 'wokwi-relay-module',
    defaults: { activeLow: true, coilCurrent: 70 },
    wiring: ['DC+ → 5 V', 'DC− → GND', 'IN → D8', 'COM and NO go in series with the load'],
    sketch: `// Most relay boards are active LOW: LOW energises the coil.
const int relayPin = 8;

void setup() {
  pinMode(relayPin, OUTPUT);
  digitalWrite(relayPin, HIGH);   // start switched off
}

void loop() {
  digitalWrite(relayPin, LOW);    // lamp on
  delay(2000);
  digitalWrite(relayPin, HIGH);   // lamp off
  delay(2000);
}
`,
    supply: 5,
    current: 70,
    datasheet: 'https://components101.com/switches/relay-module-pinout-working-datasheet',
    mistakes: [
      'Assuming IN is active HIGH when most boards are active LOW.',
      'Wiring mains voltage on a breadboard - never in a school lab.',
    ],
  }),
  P('relay-4ch', '4-Channel Relay', 'Driver', {
    desc: 'Four relay channels on one board, for multi-actuator control.',
    tags: ['relay', 'switch', 'multi'],
    aliases: ['4 channel relay', 'relay board'],
    pins: 'VCC:power:l GND:ground:l IN1:digital:l IN2:digital:l IN3:digital:l IN4:digital:l NO1:digital:r COM1:digital:r NO2:digital:r COM2:digital:r NO3:digital:r COM3:digital:r NO4:digital:r COM4:digital:r',
    adapter: 'relay',
    tier: 'model',
    defaults: { activeLow: true, coilCurrent: 70, channels: 4 },
    supply: 5,
    current: 280,
    mistakes: ['Wiring mains voltage on a breadboard - never in a school lab.'],
  }),
];

/* ------------------------------------------------------------------ *
 * Motor (7 listed, plus the 28BYJ-48 stepper)
 * ------------------------------------------------------------------ */
const MOTOR: PartDef[] = [
  P('servo-sg90', 'SG90 Servo', 'Motor', {
    desc: 'Micro 9 g servo with about 180 degrees of travel, positioned by pulse width.',
    tags: ['servo', 'sg90', 'angle'],
    aliases: ['sg90', 'servo', 'micro servo'],
    pins: 'GND:ground:l VCC:power:l SIG:pwm:r',
    adapter: 'servo',
    tier: 'model',
    wokwi: 'wokwi-servo',
    models: ['servo'],
    defaults: { minAngle: 0, maxAngle: 180, minPulse: 544, maxPulse: 2400 },
    wiring: ['VCC → 5 V', 'GND → GND', 'SIG → D9 (PWM)'],
    sketch: `#include <Servo.h>
Servo myservo;

void setup() {
  myservo.attach(9);
}

void loop() {
  for (int a = 0; a <= 180; a++) {
    myservo.write(a);
    delay(15);
  }
  for (int a = 180; a >= 0; a--) {
    myservo.write(a);
    delay(15);
  }
}
`,
    supply: 5,
    current: 250,
    datasheet: 'https://components101.com/motors/servo-motor-basics-pinout-datasheet',
    mistakes: ['Powering a servo from the Arduino 5 V pin - it stalls and browns out the board.'],
  }),
  P('servo-mg90s', 'MG90S Servo', 'Motor', {
    desc: 'Metal-gear micro servo with more torque than the SG90.',
    tags: ['servo', 'mg90s', 'metal gear'],
    aliases: ['mg90s'],
    pins: 'GND:ground:l VCC:power:l SIG:pwm:r',
    adapter: 'servo',
    tier: 'model',
    wokwi: 'wokwi-servo',
    defaults: { minAngle: 0, maxAngle: 180, minPulse: 544, maxPulse: 2400 },
    supply: 5,
    current: 400,
  }),
  P('servo-mg995', 'MG995 Servo', 'Motor', {
    desc: 'Standard-size high-torque servo for robot arms and steering.',
    tags: ['servo', 'mg995', 'torque'],
    aliases: ['mg995'],
    pins: 'GND:ground:l VCC:power:l SIG:pwm:r',
    adapter: 'servo',
    tier: 'model',
    wokwi: 'wokwi-servo',
    defaults: { minAngle: 0, maxAngle: 180, minPulse: 500, maxPulse: 2500 },
    supply: 5,
    current: 800,
  }),
  P('servo-continuous', 'Continuous Rotation Servo', 'Motor', {
    desc: 'Servo modified for continuous rotation: 90 is stop, 0 and 180 are full speed either way.',
    tags: ['servo', 'continuous', 'wheel'],
    aliases: ['continuous servo', '360 servo'],
    pins: 'GND:ground:l VCC:power:l SIG:pwm:r',
    adapter: 'servo',
    tier: 'model',
    defaults: { continuous: true, minAngle: 0, maxAngle: 180 },
    supply: 5,
    current: 400,
  }),
  P('dc-motor-bo', 'DC Gear Motor 150 RPM BO', 'Motor', {
    desc: 'Yellow BO gear motor, the standard ATL robot wheel drive.',
    tags: ['motor', 'dc', 'robot', 'geared'],
    aliases: ['bo motor', 'dc motor', 'yellow motor'],
    pins: '+:power:l -:ground:r',
    adapter: 'motor',
    tier: 'model',
    defaults: { rpm: 150 },
    supply: 6,
    current: 300,
  }),
  P('stepper-28byj48', '28BYJ-48 Stepper', 'Motor', {
    desc: 'Cheap geared stepper with the ULN2003 driver, 2048 steps per revolution.',
    tags: ['stepper', '28byj48', 'precision'],
    aliases: ['28byj-48', '28byj48', 'stepper'],
    pins: 'IN1:digital:l IN2:digital:l IN3:digital:l IN4:digital:l VCC:power:r GND:ground:r',
    adapter: 'stepper',
    tier: 'model',
    defaults: { stepsPerRev: 2048, rpm: 15 },
    supply: 5,
    current: 240,
  }),
  P('bipolar-stepper', 'Bipolar Stepper (4-wire)', 'Motor', {
    desc: 'NEMA-style bipolar stepper driven by an A4988 or similar chopper driver.',
    tags: ['stepper', 'bipolar', 'nema'],
    aliases: ['nema 17', 'bipolar stepper'],
    pins: 'A+:power:l A-:power:l B+:power:r B-:power:r',
    adapter: 'stepper',
    tier: 'model',
    wokwi: 'wokwi-stepper-motor',
    defaults: { stepsPerRev: 200, rpm: 60 },
    supply: 12,
    current: 1000,
  }),
  P('fan-12v', '12 V Brushless Fan', 'Motor', {
    desc: 'Brushless cooling fan switched by a driver or MOSFET.',
    tags: ['fan', 'cooling', '12v'],
    aliases: ['fan', 'brushless fan'],
    pins: '+:power:l -:ground:r',
    adapter: 'motor',
    tier: 'model',
    defaults: { rpm: 3000 },
    supply: 12,
    current: 160,
  }),
];

/* ------------------------------------------------------------------ *
 * Passive (11)
 * ------------------------------------------------------------------ */
const PASSIVE: PartDef[] = [
  P('breadboard-400', 'Breadboard 400', 'Passive', {
    desc: 'Half-size solderless breadboard with two power rails.',
    tags: ['breadboard', 'prototyping'],
    aliases: ['breadboard', 'half breadboard'],
    pins: '+:power:l -:ground:l a:digital:r b:digital:r',
    adapter: 'static',
    tier: 'visual',
    wokwi: 'wokwi-breadboard-half',
    notes: 'A breadboard connects rows and rails electrically. SparkLab renders it faithfully for wiring practice, but the netlist treats your explicit wires as the source of truth.',
    supply: 0,
    current: 0,
  }),
  P('breadboard-800', 'Breadboard 800', 'Passive', {
    desc: 'Full-size solderless breadboard with four power rails.',
    tags: ['breadboard', 'prototyping'],
    aliases: ['breadboard 800', 'full breadboard'],
    pins: '+:power:l -:ground:l a:digital:r b:digital:r',
    adapter: 'static',
    tier: 'visual',
    wokwi: 'wokwi-breadboard',
    supply: 0,
    current: 0,
  }),
  P('jumper-wires', 'Jumper Wires', 'Passive', {
    desc: 'Male-to-male, male-to-female and female-to-female jumpers.',
    tags: ['wire', 'jumper', 'kit'],
    aliases: ['jumper', 'dupont'],
    pins: 'A:digital:l B:digital:r',
    adapter: 'static',
    tier: 'visual',
    supply: 0,
    current: 0,
  }),
  P('resistor', 'Resistor', 'Passive', {
    desc: 'Current-limiting resistor. The difference between an LED that works and one that smokes.',
    tags: ['resistor', 'passive', 'ohms law'],
    aliases: ['220 ohm', '330 ohm', 'resistor'],
    pins: '1:digital:l 2:digital:r',
    adapter: 'static',
    tier: 'model',
    bonds: [['1', '2']],
    wokwi: 'wokwi-resistor',
    defaults: { resistance: 220 },
    controls: [{ id: 'resistance', label: 'Resistance', kind: 'slider', min: 10, max: 10000, step: 10, unit: 'Ω', default: 220 }],
    wiring: ['In series with the LED anode or cathode'],
    notes: 'Ohm\'s law is applied to the net: the ERC flags an LED series resistance that lets more than 20 mA flow.',
    supply: 0,
    current: 0,
    datasheet: 'https://components101.com/resistor',
  }),
  P('capacitor-kit', 'Capacitor Kit', 'Passive', {
    desc: 'Electrolytic and ceramic capacitors for decoupling and timing.',
    tags: ['capacitor', 'passive', 'decoupling'],
    aliases: ['capacitor', 'cap'],
    pins: '+:power:l -:ground:r',
    adapter: 'static',
    tier: 'visual',
    supply: 0,
    current: 0,
  }),
  P('potentiometer-10k', 'Potentiometer 10k', 'Passive', {
    desc: 'Three-terminal variable resistor, the standard analog input demo.',
    tags: ['potentiometer', 'analog', 'input', 'pot'],
    aliases: ['pot', 'potentiometer', '10k pot'],
    pins: 'GND:ground:l VCC:power:l OUT:analog:r',
    adapter: 'potentiometer',
    tier: 'model',
    wokwi: 'wokwi-potentiometer',
    controls: [SENSOR_INPUT('potentiometer', 'Wiper', 0, 1023, 512, '')],
    wiring: ['Outer pins to 5 V and GND', 'Wiper (middle) to A0'],
    sketch: `const int potPin = A0;
const int ledPin = 9;

void setup() {
  pinMode(ledPin, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  int raw = analogRead(potPin);
  analogWrite(ledPin, raw / 4);
  Serial.println(raw);
  delay(20);
}
`,
    supply: 5,
    current: 1,
    datasheet: 'https://components101.com/resistor/potentiometer',
  }),
  P('pushbutton', 'Pushbutton', 'Passive', {
    desc: 'Momentary tactile switch. Use INPUT_PULLUP and read for LOW when pressed.',
    tags: ['button', 'input', 'switch', 'starter'],
    aliases: ['button', 'tact switch', 'push button'],
    pins: '1:digital:l 2:digital:r',
    adapter: 'button',
    tier: 'model',
    wokwi: 'wokwi-pushbutton',
    controls: [{ id: 'buttonPressed', label: 'Pressed', kind: 'toggle', default: 0 }],
    wiring: ['One leg to GND', 'The other to D2, using INPUT_PULLUP'],
    sketch: `const int buttonPin = 2;
const int ledPin = 13;

void setup() {
  pinMode(buttonPin, INPUT_PULLUP);
  pinMode(ledPin, OUTPUT);
}

void loop() {
  // Pressed reads LOW because INPUT_PULLUP holds the pin HIGH.
  if (digitalRead(buttonPin) == LOW) {
    digitalWrite(ledPin, HIGH);
  } else {
    digitalWrite(ledPin, LOW);
  }
}
`,
    supply: 5,
    current: 0,
    datasheet: 'https://components101.com/switch/push-button',
    mistakes: [
      'Using a plain INPUT with no pull-up or pull-down, leaving the pin floating.',
      'Expecting a pressed button to read HIGH under INPUT_PULLUP.',
    ],
  }),
  P('proto-shield', 'Proto Shield', 'Passive', {
    desc: 'Solderable shield that stacks on an Uno for semi-permanent builds.',
    tags: ['shield', 'prototyping'],
    aliases: ['proto shield', 'prototyping shield'],
    pins: '5V:power:l GND:ground:l D13:digital:r D12:digital:r D11:digital:r D10:digital:r',
    adapter: 'static',
    tier: 'visual',
    supply: 0,
    current: 0,
  }),
  P('perfboard', 'Perfboard', 'Passive', {
    desc: 'Plain copper-pad board for permanent soldered circuits.',
    tags: ['perfboard', 'soldering'],
    aliases: ['perf board', 'dot pcb'],
    pins: 'A:digital:l B:digital:r',
    adapter: 'static',
    tier: 'visual',
    supply: 0,
    current: 0,
  }),
  P('alligator-clips', 'Alligator Clips', 'Passive', {
    desc: 'Clip leads for probing and temporary connections.',
    tags: ['clip', 'probe', 'wire'],
    aliases: ['alligator', 'crocodile clip'],
    pins: 'A:digital:l B:digital:r',
    adapter: 'static',
    tier: 'visual',
    bonds: [['A', 'B']],
    supply: 0,
    current: 0,
  }),
  P('berg-strips', 'Berg Strips', 'Passive', {
    desc: 'Breakaway pin headers for making any module pluggable.',
    tags: ['header', 'connector'],
    aliases: ['berg strip', 'pin header', 'headers'],
    pins: 'A:digital:l B:digital:r',
    adapter: 'static',
    tier: 'visual',
    bonds: [['A', 'B']],
    supply: 0,
    current: 0,
  }),
  P('power-bank-5v', '5 V Power Bank', 'Passive', {
    desc: 'USB battery pack. The safe way to power an ATL project.',
    tags: ['power', 'battery', 'usb'],
    aliases: ['power bank', 'battery'],
    pins: '+:power:l -:ground:r',
    adapter: 'power',
    tier: 'model',
    defaults: { voltage: 5, maxCurrent: 2000 },
    supply: 5,
    current: 0,
  }),
  P('battery-9v', '9 V Rechargeable Battery', 'Passive', {
    desc: 'PP3 battery and clip, for projects that need more than 5 V.',
    tags: ['power', 'battery', '9v'],
    aliases: ['9v battery', 'pp3'],
    pins: '+:power:l -:ground:r',
    adapter: 'power',
    tier: 'model',
    defaults: { voltage: 9, maxCurrent: 500 },
    supply: 9,
    current: 0,
  }),
];

export const ATL_PARTS: PartDef[] = [
  ...MICROCONTROLLER,
  ...IOT,
  ...SENSOR,
  ...ACTUATOR,
  ...DISPLAY,
  ...DRIVER,
  ...MOTOR,
  ...PASSIVE,
];
