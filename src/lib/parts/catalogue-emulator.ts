import type { FidelityTier } from '@/lib/brand';
import { parsePins, type AdapterKind, type PartCategory, type PartDef } from './types';

interface Opts {
  desc?: string;
  tags?: string[];
  aliases?: string[];
  pins: string;
  adapter?: AdapterKind;
  tier?: FidelityTier;
  notes?: string;
  wokwi: string;
  defaults?: Record<string, string | number | boolean>;
  supply?: number;
  current?: number;
  sketch?: string;
  wiring?: string[];
  bonds?: string[][];
}

const EXACT_NOTE =
  'EXACT: the compiled firmware runs on the emulated core, instruction by instruction, with real peripheral timing.';
const EXACT_VISUAL =
  'EXACT core; the part model emulates the protocol (I2C/SPI/UART) at the bus level.';

function E(id: string, name: string, category: PartCategory, o: Opts): PartDef {
  return {
    id,
    name,
    category,
    description: o.desc ?? `${name}.`,
    tags: o.tags ?? [],
    aliases: o.aliases ?? [],
    pins: parsePins(o.pins),
    controls: [],
    fidelity: { engine: 'firmware', tier: o.tier ?? 'exact', notes: o.notes ?? EXACT_NOTE },
    adapter: o.adapter ?? 'static',
    models: [],
    docs: { wiring: o.wiring ?? [], exampleSketch: o.sketch },
    wokwi: o.wokwi,
    defaults: o.defaults,
    supply: o.supply,
    current: o.current,
    bonds: o.bonds,
  };
}

/* ------------------------------------------------------------------ *
 * Emulator boards - these are the parts Firmware Emulation can actually run
 * ------------------------------------------------------------------ */
export const EMULATOR_BOARDS: PartDef[] = [
  E('emu-uno', 'Arduino Uno (emulated)', 'Microcontroller', {
    desc: 'ATmega328P running your compiled sketch on an emulated AVR core.',
    tags: ['avr', 'atmega328p', 'exact'],
    aliases: ['uno', 'arduino uno'],
    pins:
      'A0:analog:l A1:analog:l A2:analog:l A3:analog:l A4:i2c:l A5:i2c:l 5V:power:l 3V3:power:l GND:ground:l GND2:ground:l VIN:power:l ' +
      'D13:digital:r D12:digital:r D11:pwm:r D10:pwm:r D9:pwm:r D8:digital:r D7:digital:r D6:pwm:r D5:pwm:r D4:digital:r D3:pwm:r D2:digital:r D1:uart:r D0:uart:r',
    adapter: 'board',
    wokwi: 'wokwi-arduino-uno',
    defaults: { analogBase: 14, pwmPins: '3,5,6,9,10,11', voltage: 5, arch: 'avr', fqbn: 'arduino:avr:uno' },
    supply: 5,
    current: 45,
    notes: EXACT_NOTE,
  }),
  E('emu-nano', 'Arduino Nano (emulated)', 'Microcontroller', {
    desc: 'ATmega328P in the small footprint, emulated.',
    tags: ['avr', 'exact'],
    aliases: ['nano'],
    pins:
      'A0:analog:l A1:analog:l A2:analog:l A3:analog:l A4:i2c:l A5:i2c:l A6:analog:l A7:analog:l 5V:power:l GND:ground:l VIN:power:l ' +
      'D13:digital:r D12:digital:r D11:pwm:r D10:pwm:r D9:pwm:r D8:digital:r D7:digital:r D6:pwm:r D5:pwm:r D4:digital:r D3:pwm:r D2:digital:r D1:uart:r D0:uart:r',
    adapter: 'board',
    wokwi: 'wokwi-arduino-nano',
    defaults: { analogBase: 14, pwmPins: '3,5,6,9,10,11', voltage: 5, arch: 'avr', fqbn: 'arduino:avr:nano' },
    supply: 5,
    current: 40,
  }),
  E('emu-mega', 'Arduino Mega 2560 (emulated)', 'Microcontroller', {
    desc: 'ATmega2560, emulated, for pin-hungry projects.',
    tags: ['avr', 'exact'],
    aliases: ['mega'],
    pins:
      'A0:analog:l A1:analog:l A2:analog:l A3:analog:l A4:analog:l A5:analog:l 5V:power:l GND:ground:l VIN:power:l ' +
      'D53:pwm:r D52:digital:r D51:spi:r D50:digital:r D13:pwm:r D12:pwm:r D11:pwm:r D10:pwm:r D9:pwm:r D8:pwm:r D7:pwm:r D6:pwm:r D5:pwm:r D4:pwm:r D3:pwm:r D2:pwm:r D1:uart:r D0:uart:r',
    adapter: 'board',
    wokwi: 'wokwi-arduino-mega',
    defaults: { analogBase: 54, pwmPins: '2,3,4,5,6,7,8,9,10,11,12,13', voltage: 5, arch: 'avr', fqbn: 'arduino:avr:mega' },
    supply: 5,
    current: 60,
  }),
  E('emu-leonardo', 'Arduino Leonardo (emulated)', 'Microcontroller', {
    desc: 'ATmega32U4 with native USB, emulated.',
    tags: ['avr', 'exact'],
    aliases: ['leonardo'],
    pins:
      'A0:analog:l A1:analog:l A2:analog:l A3:analog:l A4:analog:l A5:analog:l 5V:power:l GND:ground:l ' +
      'D13:digital:r D12:digital:r D11:pwm:r D10:pwm:r D9:pwm:r D8:digital:r D7:digital:r D6:pwm:r D5:pwm:r D3:pwm:r D2:i2c:r D1:uart:r D0:uart:r',
    adapter: 'board',
    wokwi: 'wokwi-arduino-micro',
    defaults: { analogBase: 18, pwmPins: '3,5,6,9,10,11,13', voltage: 5, arch: 'avr', fqbn: 'arduino:avr:leonardo' },
    supply: 5,
    current: 40,
  }),
  E('emu-attiny85', 'ATtiny85', 'Microcontroller', {
    desc: 'Eight-pin AVR for the smallest projects.',
    tags: ['avr', 'tiny', 'exact'],
    aliases: ['attiny85', 'tiny85'],
    pins: 'VCC:power:l GND:ground:l PB0:pwm:r PB1:digital:r PB2:digital:r PB3:analog:r PB4:analog:r RST:digital:r',
    adapter: 'board',
    wokwi: 'wokwi-attiny85',
    defaults: { analogBase: 2, pwmPins: '0,1', voltage: 5, arch: 'avr', fqbn: 'attiny:avr:ATtinyX5' },
    supply: 5,
    current: 10,
  }),
  E('emu-franzininho', 'Franzininho', 'Microcontroller', {
    desc: 'Brazilian ATtiny85 board with an onboard LED and buzzer.',
    tags: ['avr', 'attiny85'],
    aliases: ['franzininho'],
    pins: '5V:power:l GND:ground:l D0:pwm:r D1:digital:r D2:digital:r D3:analog:r D4:analog:r D5:digital:r',
    adapter: 'board',
    wokwi: 'wokwi-franzininho',
    defaults: { analogBase: 2, pwmPins: '0,1', voltage: 5, arch: 'avr' },
    supply: 5,
    current: 20,
  }),
  E('emu-esp32-devkitc', 'ESP32 DevKitC V4', 'Microcontroller', {
    desc: 'Xtensa dual-core with Wi-Fi and Bluetooth, emulated.',
    tags: ['esp32', 'wifi', 'exact'],
    aliases: ['esp32 devkitc'],
    pins:
      '3V3:power:l GND:ground:l VIN:power:l EN:digital:l A0:analog:l A3:analog:l A4:analog:l A5:analog:l A6:analog:l A7:analog:l ' +
      'D2:digital:r D4:digital:r D5:spi:r D12:digital:r D13:digital:r D14:digital:r D15:digital:r D18:spi:r D19:spi:r D21:i2c:r D22:i2c:r D23:spi:r D25:digital:r D26:digital:r D27:digital:r',
    adapter: 'board',
    wokwi: 'wokwi-esp32-devkitc-v4',
    defaults: { analogBase: 100, voltage: 3.3, arch: 'xtensa', fqbn: 'esp32:esp32:esp32' },
    supply: 3.3,
    current: 120,
  }),
  E('emu-esp32-s2', 'ESP32-S2', 'Microcontroller', {
    desc: 'Single-core Xtensa with USB and Wi-Fi.',
    tags: ['esp32', 's2'],
    pins: '3V3:power:l GND:ground:l D2:digital:r D4:digital:r D5:digital:r D18:digital:r D19:digital:r D21:digital:r D22:digital:r D23:digital:r',
    adapter: 'board',
    wokwi: 'wokwi-esp32-s2-devkitc-1',
    defaults: { analogBase: 100, voltage: 3.3, arch: 'xtensa', fqbn: 'esp32:esp32:esp32s2' },
    supply: 3.3,
    current: 110,
  }),
  E('emu-esp32-s3', 'ESP32-S3', 'Microcontroller', {
    desc: 'Dual-core Xtensa with vector instructions and USB OTG.',
    tags: ['esp32', 's3'],
    pins: '3V3:power:l GND:ground:l D2:digital:r D4:digital:r D5:digital:r D8:digital:r D9:digital:r D18:digital:r D19:digital:r D21:i2c:r D22:i2c:r',
    adapter: 'board',
    wokwi: 'wokwi-esp32-s3-devkitc-1',
    defaults: { analogBase: 100, voltage: 3.3, arch: 'xtensa', fqbn: 'esp32:esp32:esp32s3' },
    supply: 3.3,
    current: 130,
  }),
  E('emu-esp32-c3', 'ESP32-C3', 'Microcontroller', {
    desc: 'RISC-V ESP32 with Wi-Fi and Bluetooth 5 LE.',
    tags: ['esp32', 'riscv', 'c3'],
    pins: '3V3:power:l GND:ground:l D2:digital:r D3:digital:r D4:analog:r D5:analog:r D6:digital:r D7:digital:r D8:i2c:r D9:i2c:r D10:digital:r',
    adapter: 'board',
    wokwi: 'wokwi-esp32-c3-devkitm-1',
    defaults: { analogBase: 100, voltage: 3.3, arch: 'riscv', fqbn: 'esp32:esp32:esp32c3' },
    supply: 3.3,
    current: 100,
  }),
  E('emu-esp32-c6', 'ESP32-C6', 'Microcontroller', {
    desc: 'RISC-V with Wi-Fi 6, Bluetooth 5 and 802.15.4 Thread/Zigbee.',
    tags: ['esp32', 'riscv', 'wifi6'],
    pins: '3V3:power:l GND:ground:l D2:digital:r D4:digital:r D5:digital:r D6:digital:r D7:digital:r D18:digital:r D19:digital:r',
    adapter: 'board',
    wokwi: 'wokwi-esp32-c6-devkitc-1',
    defaults: { analogBase: 100, voltage: 3.3, arch: 'riscv', fqbn: 'esp32:esp32:esp32c6' },
    supply: 3.3,
    current: 100,
  }),
  E('emu-esp32-h2', 'ESP32-H2', 'Microcontroller', {
    desc: 'RISC-V with Bluetooth 5 LE and 802.15.4, no Wi-Fi.',
    tags: ['esp32', 'riscv', 'thread'],
    pins: '3V3:power:l GND:ground:l D2:digital:r D4:digital:r D5:digital:r D18:digital:r D19:digital:r D25:digital:r',
    adapter: 'board',
    wokwi: 'wokwi-esp32-h2-devkitm-1',
    defaults: { analogBase: 100, voltage: 3.3, arch: 'riscv' },
    supply: 3.3,
    current: 90,
  }),
  E('emu-nucleo-c031c6', 'ST Nucleo C031C6', 'Microcontroller', {
    desc: 'STM32 Cortex-M0+ Nucleo board with an ST-Link onboard.',
    tags: ['stm32', 'arm', 'cortex-m0'],
    pins: '3V3:power:l 5V:power:l GND:ground:l A0:analog:l A1:analog:l D2:digital:r D3:pwm:r D4:digital:r D5:digital:r D6:pwm:r D13:digital:r',
    adapter: 'board',
    wokwi: 'board-nucleo-c031c6',
    defaults: { analogBase: 100, voltage: 3.3, arch: 'arm', fqbn: 'STM32:stm32:Nucleo_64' },
    supply: 3.3,
    current: 50,
  }),
  E('emu-nucleo-l031k6', 'ST Nucleo L031K6', 'Microcontroller', {
    desc: 'Ultra-low-power STM32L0 Cortex-M0+ in a Nucleo-32 footprint.',
    tags: ['stm32', 'arm', 'low-power'],
    pins: '3V3:power:l 5V:power:l GND:ground:l A0:analog:l D2:digital:r D3:pwm:r D4:digital:r D5:digital:r',
    adapter: 'board',
    wokwi: 'board-nucleo-l031k6',
    defaults: { analogBase: 100, voltage: 3.3, arch: 'arm' },
    supply: 3.3,
    current: 30,
  }),
  E('emu-bluepill', 'STM32 BluePill F103C8', 'Microcontroller', {
    desc: 'The famous cheap STM32F103 board. Real ARM Cortex-M3 emulation.',
    tags: ['stm32', 'arm', 'cortex-m3', 'bluepill'],
    aliases: ['blue pill', 'stm32f103'],
    pins: '3V3:power:l GND:ground:l 5V:power:l A0:analog:l A1:analog:l A2:analog:l A3:analog:l B0:digital:r B1:digital:r B10:i2c:r B11:i2c:r PA2:uart:r PA3:uart:r',
    adapter: 'board',
    wokwi: 'wokwi-stm32-bluepill',
    defaults: { analogBase: 100, voltage: 3.3, arch: 'arm', fqbn: 'STM32:stm32:GenF1' },
    supply: 3.3,
    current: 50,
  }),
  E('emu-pi-pico', 'Raspberry Pi Pico', 'Microcontroller', {
    desc: 'RP2040 dual-core Cortex-M0+ with programmable I/O. Both cores are emulated.',
    tags: ['rp2040', 'pico', 'dual-core', 'pio'],
    aliases: ['pico', 'rp2040'],
    pins:
      'GP0:uart:l GP1:uart:l GP2:digital:l GP3:digital:l GP4:i2c:l GP5:i2c:l GND:ground:l 3V3:power:l VSYS:power:l ' +
      'GP26:analog:r GP27:analog:r GP28:analog:r GP16:spi:r GP17:spi:r GP18:spi:r GP22:digital:r GP25:digital:r',
    adapter: 'board',
    wokwi: 'wokwi-pi-pico',
    defaults: { analogBase: 26, pwmPins: '0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22', voltage: 3.3, arch: 'arm', cores: 2 },
    supply: 3.3,
    current: 40,
    notes: 'Both Cortex-M0+ cores are emulated. PIO state machines are available in Firmware Emulation.',
  }),
  E('emu-pi-pico-w', 'Raspberry Pi Pico W', 'Microcontroller', {
    desc: 'RP2040 with an Infineon CYW43439 wireless chip.',
    tags: ['rp2040', 'pico w', 'wifi'],
    aliases: ['pico w'],
    pins:
      'GP0:uart:l GP1:uart:l GP2:digital:l GP3:digital:l GP4:i2c:l GP5:i2c:l GND:ground:l 3V3:power:l VSYS:power:l ' +
      'GP26:analog:r GP27:analog:r GP28:analog:r GP16:spi:r GP17:spi:r GP18:spi:r GP22:digital:r',
    adapter: 'board',
    wokwi: 'wokwi-pi-pico-w',
    defaults: { analogBase: 26, voltage: 3.3, arch: 'arm', cores: 2 },
    supply: 3.3,
    current: 90,
  }),
];

/* ------------------------------------------------------------------ *
 * Emulator parts - protocol-level models driven by the emulated core
 * ------------------------------------------------------------------ */
export const EMULATOR_PARTS: PartDef[] = [
  E('emu-pushbutton', 'Pushbutton', 'Passive', {
    wokwi: 'wokwi-pushbutton',
    pins: '1:digital:l 2:digital:r',
    adapter: 'button',
    tier: 'exact',
    desc: 'Tactile switch. Interactive digital input with INPUT_PULLUP semantics: pressed reads LOW.',
    supply: 5,
    current: 0,
  }),
  E('emu-slide-switch', 'Slide Switch', 'Passive', {
    wokwi: 'wokwi-slide-switch',
    pins: '1:digital:l 2:digital:r 3:digital:r',
    adapter: 'button',
    supply: 5,
  }),
  E('emu-dip-switch-8', 'DIP Switch 8', 'Passive', {
    wokwi: 'wokwi-dip-switch-8',
    pins: '1:digital:l 2:digital:l 3:digital:l 4:digital:l 5:digital:r 6:digital:r 7:digital:r 8:digital:r',
    adapter: 'static',
    supply: 5,
  }),
  E('emu-keypad-4x4', '4x4 Membrane Keypad', 'Sensor', {
    wokwi: 'wokwi-membrane-keypad',
    pins: 'R1:digital:l R2:digital:l R3:digital:l R4:digital:l C1:digital:r C2:digital:r C3:digital:r C4:digital:r',
    adapter: 'matrix',
    supply: 5,
  }),
  E('emu-joystick', 'Analog Joystick', 'Sensor', {
    wokwi: 'wokwi-analog-joystick',
    pins: 'GND:ground:l +5V:power:l VRX:analog:r VRY:analog:r SW:digital:r',
    adapter: 'potentiometer',
    supply: 5,
  }),
  E('emu-potentiometer', 'Potentiometer', 'Passive', {
    wokwi: 'wokwi-potentiometer',
    pins: 'GND:ground:l VCC:power:l SIG:analog:r',
    adapter: 'potentiometer',
    supply: 5,
  }),
  E('emu-slide-pot', 'Slide Potentiometer', 'Passive', {
    wokwi: 'wokwi-slide-potentiometer',
    pins: 'GND:ground:l VCC:power:l SIG:analog:r',
    adapter: 'potentiometer',
    supply: 5,
  }),
  E('emu-encoder', 'KY-040 Rotary Encoder', 'Sensor', {
    wokwi: 'wokwi-ky-040',
    pins: 'GND:ground:l +:power:l SW:digital:r DT:digital:r CLK:digital:r',
    adapter: 'sensor-value',
    supply: 5,
  }),
  E('emu-led', 'LED', 'Display', {
    wokwi: 'wokwi-led',
    pins: 'A:digital:l K:ground:r',
    adapter: 'led',
    defaults: { colour: '#e63946', forwardVoltage: 2.0, maxCurrent: 20 },
    supply: 5,
    current: 20,
    notes: EXACT_NOTE + ' Brightness follows the real PWM duty and the series resistance on the net.',
  }),
  E('emu-rgb-led', 'RGB LED', 'Display', {
    wokwi: 'wokwi-rgb-led',
    pins: 'R:pwm:l G:pwm:l B:pwm:r K:ground:r',
    adapter: 'rgb-led',
    supply: 5,
    current: 60,
  }),
  E('emu-led-bar', 'LED Bar Graph', 'Display', {
    wokwi: 'wokwi-led-bar-graph',
    pins: 'D1:digital:l D2:digital:l D3:digital:l D4:digital:l D5:digital:l D6:digital:r D7:digital:r D8:digital:r D9:digital:r D10:digital:r',
    adapter: 'static',
    supply: 5,
    current: 100,
  }),
  E('emu-ws2812', 'WS2812 LED', 'Display', {
    wokwi: 'wokwi-ws2812',
    pins: 'DIN:digital:l VDD:power:l VSS:ground:r DOUT:digital:r',
    adapter: 'static',
    supply: 5,
    current: 60,
    notes: 'The WS2812 timing protocol is emulated bit by bit; the logic analyzer can decode it.',
  }),
  E('emu-ws2812-matrix', 'WS2812 Matrix 8x32', 'Display', {
    wokwi: 'wokwi-neopixel-matrix',
    pins: 'DIN:digital:l VDD:power:l VSS:ground:r',
    adapter: 'static',
    supply: 5,
    current: 1500,
  }),
  E('emu-lcd1602', 'LCD 1602', 'Display', {
    wokwi: 'wokwi-lcd1602',
    pins: 'VSS:ground:l VDD:power:l VO:analog:l RS:digital:l RW:ground:l E:digital:l D0:digital:l D1:digital:l D2:digital:l D3:digital:l D4:digital:l D5:digital:l D6:digital:l D7:digital:l A:power:l K:ground:l',
    adapter: 'lcd',
    defaults: { cols: 16, rows: 2 },
    supply: 5,
    current: 120,
    notes: 'HD44780 at the bus level: real 4-bit and 8-bit timing, real character RAM.',
  }),
  E('emu-lcd2004', 'LCD 2004', 'Display', {
    wokwi: 'wokwi-lcd2004',
    pins: 'VSS:ground:l VDD:power:l VO:analog:l RS:digital:l RW:ground:l E:digital:l D4:digital:l D5:digital:l D6:digital:l D7:digital:l A:power:l K:ground:l',
    adapter: 'lcd',
    defaults: { cols: 20, rows: 4 },
    supply: 5,
    current: 140,
  }),
  E('emu-nokia-5110', 'Nokia 5110 LCD', 'Display', {
    wokwi: 'wokwi-nokia-5110',
    pins: 'RST:digital:l CE:digital:l DC:digital:l DIN:spi:l CLK:spi:l VCC:power:l LIGHT:power:l GND:ground:l',
    adapter: 'static',
    supply: 3.3,
    current: 20,
  }),
  E('emu-ili9341', 'ILI9341 TFT 2.8"', 'Display', {
    wokwi: 'wokwi-ili9341',
    pins: 'VCC:power:l GND:ground:l CS:spi:l RESET:digital:l DC:digital:l SDI:spi:l SCK:spi:l LED:power:l SDO:spi:l T_CLK:spi:r T_CS:spi:r T_DIN:spi:r T_DO:spi:r T_IRQ:digital:r',
    adapter: 'static',
    supply: 3.3,
    current: 120,
    notes: 'Including the FT6206 touch controller, emulated over I2C.',
  }),
  E('emu-ssd1306', 'SSD1306 OLED 128x64', 'Display', {
    wokwi: 'board-ssd1306',
    pins: 'VCC:power:l GND:ground:l SCL:i2c:r SDA:i2c:r',
    adapter: 'oled',
    defaults: { width: 128, height: 64 },
    supply: 3.3,
    current: 25,
    notes: EXACT_VISUAL,
  }),
  E('emu-sh1107', 'SH1107 OLED 128x128', 'Display', {
    wokwi: 'board-sh1107',
    pins: 'VCC:power:l GND:ground:l SCL:i2c:r SDA:i2c:r',
    adapter: 'oled',
    defaults: { width: 128, height: 128 },
    supply: 3.3,
    current: 30,
  }),
  E('emu-max7219', 'MAX7219 Dot Matrix', 'Display', {
    wokwi: 'wokwi-max7219-matrix',
    pins: 'VCC:power:l GND:ground:l DIN:spi:r CS:spi:r CLK:spi:r',
    adapter: 'matrix',
    supply: 5,
    current: 200,
  }),
  E('emu-7segment', '7-Segment Display', 'Display', {
    wokwi: 'wokwi-7segment',
    pins: 'a:digital:l b:digital:l c:digital:l d:digital:l e:digital:l f:digital:l g:digital:l dp:digital:l COM:ground:r',
    adapter: 'seven-seg',
    supply: 5,
    current: 80,
  }),
  E('emu-tm1637', 'TM1637 4-Digit Display', 'Display', {
    wokwi: 'wokwi-tm1637',
    pins: 'CLK:digital:l DIO:digital:l VCC:power:l GND:ground:l',
    adapter: 'static',
    supply: 5,
    current: 80,
    notes: 'The TM1637 two-wire protocol is emulated at the bit level.',
  }),
  E('emu-epaper', '2.9" E-Paper', 'Display', {
    wokwi: 'wokwi-epaper-2in9',
    pins: 'VCC:power:l GND:ground:l DIN:spi:r CLK:spi:r CS:spi:r DC:digital:r RST:digital:r BUSY:digital:r',
    adapter: 'static',
    supply: 3.3,
    current: 30,
  }),
  E('emu-pal-tv', 'PAL TV', 'Display', {
    wokwi: 'wokwi-pal-tv',
    pins: 'GND:ground:l VIDEO:analog:r',
    adapter: 'static',
    supply: 5,
    current: 100,
  }),
  E('emu-servo', 'Servo Motor', 'Motor', {
    wokwi: 'wokwi-servo',
    pins: 'GND:ground:l VCC:power:l PWM:pwm:r',
    adapter: 'servo',
    defaults: { minAngle: 0, maxAngle: 180 },
    supply: 5,
    current: 250,
    notes: 'Pulse width is measured against a real 50 Hz timeline.',
  }),
  E('emu-stepper', 'Bipolar Stepper', 'Motor', {
    wokwi: 'wokwi-stepper-motor',
    pins: 'A+:power:l A-:power:l B+:power:r B-:power:r',
    adapter: 'stepper',
    defaults: { stepsPerRev: 200 },
    supply: 12,
    current: 1000,
  }),
  E('emu-a4988', 'A4988 Stepper Driver', 'Driver', {
    wokwi: 'wokwi-a4988',
    pins: 'VMOT:power:l GND:ground:l VDD:power:l DIR:digital:l STEP:digital:l SLEEP:digital:l RESET:digital:l MS1:digital:l MS2:digital:l MS3:digital:l EN:digital:l 2B:power:r 2A:power:r 1A:power:r 1B:power:r',
    adapter: 'static',
    supply: 12,
    current: 1000,
  }),
  E('emu-ir-receiver', 'IR Receiver', 'Sensor', {
    wokwi: 'wokwi-ir-receiver',
    pins: 'VCC:power:l GND:ground:l OUT:digital:r',
    adapter: 'sensor-value',
    supply: 5,
    current: 5,
  }),
  E('emu-ir-remote', 'IR Remote (20 keys)', 'Sensor', {
    wokwi: 'wokwi-ir-remote',
    pins: 'VCC:power:l GND:ground:l',
    adapter: 'static',
    supply: 5,
  }),
  E('emu-resistor', 'Resistor', 'Passive', {
    wokwi: 'wokwi-resistor',
    pins: '1:digital:l 2:digital:r',
    adapter: 'static',
    bonds: [['1', '2']],
    defaults: { resistance: 220 },
  }),
  E('emu-buzzer', 'Buzzer', 'Actuator', {
    wokwi: 'wokwi-buzzer',
    pins: '1:digital:l 2:ground:r',
    adapter: 'buzzer',
    supply: 5,
    current: 30,
  }),
  E('emu-clock-generator', 'Clock Generator', 'Passive', {
    wokwi: 'wokwi-clock-generator',
    pins: 'GND:ground:l VCC:power:l OUT:digital:r',
    adapter: 'static',
    supply: 5,
  }),
  E('emu-relay-module', 'Relay Module', 'Driver', {
    wokwi: 'wokwi-relay-module',
    pins: 'DC+:power:l DC-:ground:l IN:digital:l NO:digital:r COM:digital:r NC:digital:r',
    adapter: 'relay',
    defaults: { activeLow: true, coilCurrent: 70 },
    supply: 5,
    current: 70,
  }),
  E('emu-relay-dpdt', 'DPDT Relay', 'Driver', {
    wokwi: 'wokwi-relay-dpdt',
    pins: 'COIL1:digital:l COIL2:ground:l NO1:digital:r COM1:digital:r NC1:digital:r NO2:digital:r COM2:digital:r NC2:digital:r',
    adapter: 'relay',
    supply: 5,
    current: 140,
  }),
  E('emu-breadboard', 'Breadboard (full)', 'Passive', {
    wokwi: 'wokwi-breadboard',
    pins: '+:power:l -:ground:l a:digital:r b:digital:r',
    adapter: 'static',
    tier: 'visual',
  }),
  E('emu-logic-analyzer', 'Logic Analyzer (8 ch)', 'Sensor', {
    wokwi: 'wokwi-logic-analyzer',
    pins: 'GND:ground:l D0:digital:l D1:digital:l D2:digital:l D3:digital:l D4:digital:r D5:digital:r D6:digital:r D7:digital:r',
    adapter: 'static',
    tier: 'exact',
    desc: 'Eight channels at a 1 GHz sample rate with edge and level triggering. Captures to VCD.',
    notes: 'The only instrument that sees inside the emulated core. Exports a VCD that opens in PulseView and GTKWave.',
  }),
  E('emu-microsd', 'microSD Card', 'IoT', {
    wokwi: 'wokwi-microsd-card',
    pins: 'GND:ground:l VCC:power:l MISO:spi:r MOSI:spi:r SCK:spi:r CS:spi:r',
    adapter: 'static',
    supply: 3.3,
    current: 80,
  }),
  E('emu-text-annotation', 'Text Annotation', 'Passive', {
    wokwi: 'wokwi-text',
    pins: '',
    adapter: 'static',
    tier: 'visual',
    desc: 'A sticky note on the schematic. Wires nothing, explains everything.',
  }),
  E('emu-wifi-ap', 'WiFi Access Point', 'IoT', {
    wokwi: 'wokwi-wifi-ap',
    pins: '',
    adapter: 'static',
    desc: 'A virtual access point with a configurable SSID, WPA2 password, channel and BSSID.',
    notes: 'Multiple APs let you test scanning and selection. Custom APs are a paid-tier feature.',
  }),
  E('emu-ds1307', 'DS1307 RTC', 'Sensor', {
    wokwi: 'wokwi-ds1307',
    pins: 'GND:ground:l VCC:power:l SDA:i2c:r SCL:i2c:r SQW:digital:r',
    adapter: 'static',
    tier: 'exact',
    supply: 5,
    current: 2,
    notes: EXACT_VISUAL,
  }),
  E('emu-ds18b20', 'DS18B20 Temperature', 'Sensor', {
    wokwi: 'wokwi-ds18b20',
    pins: 'GND:ground:l VDD:power:l DQ:onewire:r',
    adapter: 'sensor-value',
    tier: 'exact',
    supply: 5,
    current: 1,
    notes: 'The 1-Wire reset, presence and bit timings are emulated.',
  }),
  E('emu-ntc', 'NTC Thermistor', 'Sensor', {
    wokwi: 'wokwi-ntc-temperature-sensor',
    pins: 'VCC:power:l GND:ground:l OUT:analog:r',
    adapter: 'sensor-value',
    supply: 5,
  }),
  E('emu-hx711', 'HX711 Load Cell Amp', 'Sensor', {
    wokwi: 'wokwi-hx711',
    pins: 'VDD:power:l GND:ground:l SCK:digital:r DT:digital:r E+:power:r E-:ground:r A-:power:r A+:power:r',
    adapter: 'sensor-value',
    tier: 'exact',
    supply: 5,
    current: 2,
    notes: EXACT_VISUAL,
  }),
  E('emu-bmp180', 'BMP180 Pressure', 'Sensor', {
    wokwi: 'wokwi-bmp180',
    pins: 'VCC:power:l GND:ground:l SDA:i2c:r SCL:i2c:r',
    adapter: 'sensor-value',
    tier: 'exact',
    supply: 3.3,
    notes: EXACT_VISUAL,
  }),
  E('emu-mpu6050', 'MPU6050 IMU', 'Sensor', {
    wokwi: 'wokwi-mpu6050',
    pins: 'VCC:power:l GND:ground:l SCL:i2c:r SDA:i2c:r XDA:i2c:r XCL:i2c:r INT:digital:r ADO:digital:r',
    adapter: 'sensor-value',
    tier: 'exact',
    supply: 5,
    notes: EXACT_VISUAL,
  }),
  E('emu-mfrc522', 'MFRC522 RFID', 'IoT', {
    wokwi: 'wokwi-mfrc522',
    pins: 'VCC:power:l GND:ground:l SDA:spi:r SCK:spi:r MOSI:spi:r MISO:spi:r RST:digital:r',
    adapter: 'static',
    tier: 'exact',
    supply: 3.3,
    notes: EXACT_VISUAL,
  }),
  E('emu-grove-oled', 'Grove OLED 96x96', 'Display', {
    wokwi: 'wokwi-grove-oled-96',
    pins: 'GND:ground:l VCC:power:l SDA:i2c:r SCL:i2c:r',
    adapter: 'oled',
    defaults: { width: 96, height: 96 },
    supply: 3.3,
  }),
  E('emu-dht22', 'DHT22', 'Sensor', {
    wokwi: 'wokwi-dht22',
    pins: 'VDD:power:l SDA:onewire:r GND:ground:r',
    adapter: 'sensor-value',
    tier: 'exact',
    supply: 5,
    notes: 'Single-wire protocol with real bit timing.',
  }),
  E('emu-hc-sr04', 'HC-SR04 Ultrasonic', 'Sensor', {
    wokwi: 'wokwi-hc-sr04',
    pins: 'VCC:power:l TRIG:digital:l ECHO:digital:r GND:ground:r',
    adapter: 'sensor-value',
    tier: 'exact',
    supply: 5,
    notes: 'pulseIn measures a real echo pulse generated by the model.',
  }),
  E('emu-photoresistor', 'Photoresistor', 'Sensor', {
    wokwi: 'wokwi-photoresistor-sensor',
    pins: 'VCC:power:l GND:ground:l AO:analog:r DO:digital:r',
    adapter: 'sensor-value',
    supply: 5,
  }),
];

export const EMULATOR_CATALOGUE: PartDef[] = [...EMULATOR_BOARDS, ...EMULATOR_PARTS];
