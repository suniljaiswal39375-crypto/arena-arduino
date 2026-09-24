import type { ProjectDoc } from '@/lib/doc/types';
import { getPart } from '@/lib/parts';
import {
  buildNetlist,
  netOf,
  pinsOnNet,
  seriesResistance,
  type NetInfo,
  type Netlist,
  type ResolvedPin,
} from './netlist';
import { boardPinNumber, sketchPinUse } from './sketch-pins';

export const DIAGNOSTIC_CODES = [
  'no-board',
  'unwired-part',
  'missing-signal-pin',
  'missing-required-pin',
  'missing-return-path',
  'floating-net',
  'reverse-polarity',
  'short-circuit',
  'missing-pull-up',
  'pin-conflict',
  'power-budget-exceeded',
  'thermal-overload',
  'level-mismatch',
  'back-powering',
  'unsupported-part-in-engine',
] as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[number];
export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  /** Stable id so evidence and telemetry can point at the same fault twice. */
  id: string;
  code: DiagnosticCode;
  severity: Severity;
  title: string;
  /** One sentence, plain language. */
  explanation: string;
  /** The physics behind it, expanded in the UI. */
  why: string;
  fix: string;
  parts: string[];
  pins: Array<{ part: string; pin: string }>;
  net?: string;
  skill?: string;
  ncert?: string;
}

/** Parts that are physically inert: they never appear in the electrical rules. */
const INERT = new Set([
  'breadboard-400',
  'breadboard-800',
  'jumper-wires',
  'proto-shield',
  'perfboard',
  'alligator-clips',
  'berg-strips',
  'capacitor-kit',
  'emu-breadboard',
  'emu-text-annotation',
  'emu-wifi-ap',
]);

/** Maximum current a board pin can safely source or sink. */
const PIN_CURRENT_MA = 20;
/** Typical 5 V rail budget for a USB-powered Uno. */
const BOARD_BUDGET_MA = 400;

function isInert(type: string): boolean {
  return INERT.has(type);
}

function label(inst: { id: string }, doc: ProjectDoc): string {
  const p = doc.diagram.parts.find((x) => x.id === inst.id);
  const def = p ? getPart(p.type) : undefined;
  return def ? `${def.name} (${p?.id ?? inst.id})` : (p?.id ?? inst.id);
}

function make(
  code: DiagnosticCode,
  severity: Severity,
  parts: string[],
  fields: Omit<Diagnostic, 'id' | 'code' | 'severity' | 'parts' | 'pins'> & {
    pins?: Diagnostic['pins'];
  },
): Diagnostic {
  const netPart = fields.net ? `:${fields.net}` : '';
  return {
    ...fields,
    pins: fields.pins ?? [],
    id: `${code}:${[...parts].sort().join(',')}${netPart}`,
    code,
    severity,
    parts,
  };
}

/**
 * Is this power pin one the part cannot work without? Parts list their main
 * supply first. Later power pins are motor outputs, backlight feeds or
 * optional logic supplies, and an unconnected one is not a fault.
 */
function isRequiredSupply(def: { id: string; pins: Array<{ name: string; electrical: string }> }, pinName: string): boolean {
  const power = def.pins.filter((p) => p.electrical === 'power').map((p) => p.name);
  if (power.length <= 1) return true;
  // Loads that genuinely need two supplies: split-rail LCDs need VDD, the
  // L293D needs both logic (VCC1) and motor (VCC2) supplies.
  if (def.id === 'l293d') return pinName === 'VCC1' || pinName === 'VCC2';
  if (/^(OUT\d|[12][AB]|A[+-]|B[+-]|E[+-]|LIGHT|LED|A)$/.test(pinName)) return false;
  return pinName === power[0];
}

/** "5 V", "3.3 V" or "GND", for messages about a rail. */
function railName(nl: Netlist, net: NetInfo): string {
  if (net.isGround && !net.isPower) return 'GND';
  if (net.isPower && net.voltage !== null) return `${net.voltage} V`;
  return pinsOnNet(nl, net.id).some((p) => p.pin.electrical === 'ground') ? 'GND' : 'a supply rail';
}

function connectedPins(doc: ProjectDoc, partId: string): Set<string> {
  const s = new Set<string>();
  for (const w of doc.diagram.connections) {
    if (w.from.part === partId) s.add(w.from.pin);
    if (w.to.part === partId) s.add(w.to.pin);
  }
  return s;
}

/**
 * Run the full electrical rule check. Cheap enough to call on every document
 * change; the builder keeps it under the 8 ms budget for realistic projects.
 */
export function runERC(doc: ProjectDoc): Diagnostic[] {
  const nl = buildNetlist(doc);
  const out: Diagnostic[] = [];
  const sketch = doc.files['sketch.ino'] ?? '';

  // ---------------------------------------------------------------- no-board
  if (doc.diagram.parts.length > 0 && nl.boards.length === 0) {
    out.push(
      make('no-board', 'warning', [], {
        title: 'No microcontroller on the canvas',
        explanation: 'There is nothing running your sketch, so nothing can happen yet.',
        why: 'A circuit needs a source of control. The board reads inputs and drives outputs; every other part is inert without one.',
        fix: 'Add an Arduino Uno from the palette and wire it to your parts.',
        skill: 'pc.complete-circuit',
        ncert: 'Class 10 Ch. 12 Electricity - electric circuit and circuit diagrams',
      }),
    );
  }

  // A second view of the circuit in which a resistor is a load, not a wire.
  // 5 V through 220 ohm to GND is a working circuit; 5 V wired to GND is not.
  const strict = buildNetlist(doc, { resistorsAsWires: false });
  const boardInst = doc.diagram.parts.find((p) => nl.boards.includes(p.id));
  const boardDef = boardInst ? getPart(boardInst.type) : undefined;
  const analogBase = Number(boardDef?.defaults?.analogBase ?? 14);
  const pinUse = sketchPinUse(sketch, analogBase);

  // --------------------------------------------------------- short circuits
  for (const net of strict.nets.values()) {
    if (net.isPower && net.isGround) {
      const pins = pinsOnNet(strict, net.id).map((p: ResolvedPin) => ({
        part: p.partId,
        pin: p.pin.name,
      }));
      out.push(
        make('short-circuit', 'error', [...new Set(pins.map((p) => p.part))], {
          title: 'Short circuit',
          explanation: `Power and ground are joined on one net, so current flows with almost nothing to limit it.`,
          why: 'A supply connected straight to ground has no load. The only thing limiting current is the resistance of the wire, which is tiny, so the current spikes until something heats up.',
          fix: 'Separate the power and ground wires. Every part sits between them, never directly across them.',
          pins,
          net: net.id,
          skill: 'pc.short-circuit',
          ncert: 'Class 10 Ch. 12 Electricity - heating effect of current',
        }),
      );
    }
  }

  // ----------------------------------------- output pin straight to a rail
  // Acceptance criterion: "short D13 to 5 V and see the short-circuit code".
  if (boardInst && boardDef) {
    for (const pin of boardDef.pins) {
      if (pin.electrical !== 'digital' && pin.electrical !== 'pwm' && pin.electrical !== 'analog') continue;
      const num = boardPinNumber(pin.name, analogBase);
      if (num === null) continue;
      const net = netOf(strict, { part: boardInst.id, pin: pin.name });
      if (!net || (!net.isPower && !net.isGround)) continue;
      const rail = railName(strict, net);
      const driven = pinUse.outputs.has(num);
      if (!driven && pinUse.reads.has(num)) continue; // tying an input to a rail is legitimate
      out.push(
        make('short-circuit', driven ? 'error' : 'warning', [boardInst.id], {
          title: driven
            ? `${pin.name} is an output wired straight to ${rail}`
            : `${pin.name} is wired straight to ${rail}`,
          explanation: driven
            ? `Your sketch drives ${pin.name}, and a bare wire connects it to ${rail}. The moment it writes the opposite level, the pin is shorted.`
            : `${pin.name} is tied directly to ${rail}. That is only safe while the pin stays an input; one pinMode(OUTPUT) turns it into a short.`,
          why: `An output pin is a switch to 5 V or to 0 V. Connect it to ${rail} with a plain wire and, whenever the two disagree, current flows from one straight into the other with nothing to limit it except the pin's own transistor, which overheats and dies.`,
          fix: `Remove the wire between ${pin.name} and ${rail}. If you need a default level, use a 10 kΩ resistor or INPUT_PULLUP.`,
          pins: [{ part: boardInst.id, pin: pin.name }],
          net: net.id,
          skill: 'pc.short-circuit',
          ncert: 'Class 10 Ch. 12 Electricity - heating effect of current',
        }),
      );
    }
  }

  // ------------------------------------------------------------ back-powering
  for (const net of strict.nets.values()) {
    if (net.supplies.length < 2) continue;
    const pins = pinsOnNet(strict, net.id).filter(
      (p) => p.pin.electrical === 'power' && (p.part.adapter === 'board' || p.part.adapter === 'power'),
    );
    const parts = [...new Set(pins.map((p) => p.partId))];
    const low = net.supplies[0] ?? 0;
    const high = net.supplies[net.supplies.length - 1] ?? 0;
    out.push(
      make('back-powering', 'error', parts, {
        title: `A ${high} V supply is forced onto a ${low} V rail`,
        explanation: `${pins.map((p) => `${p.part.name} ${p.pin.name}`).join(' and ')} are joined, so two supplies at ${net.supplies.join(' V and ')} V fight over one wire.`,
        why: `A supply pin is the output of a regulator. Joining two of them makes the higher one push current backwards into the lower one's regulator, which was never designed to take it. The ${low} V side overheats, and anything on it sees ${high} V.`,
        fix: high > 5.5
          ? `Feed ${high} V into the board's VIN (or barrel jack), never into its 5V or 3V3 pin, and share only ground.`
          : `Pick one supply for this rail. If two supplies must coexist, join only their grounds.`,
        pins: pins.map((p) => ({ part: p.partId, pin: p.pin.name })),
        net: net.id,
        skill: 'pc.power-budget',
        ncert: 'Class 10 Ch. 12 Electricity - potential difference and cells in combination',
      }),
    );
  }

  // ------------------------------------------------------------ floating net
  // A pin with nothing on it is only a problem if the sketch listens to it.
  if (boardInst && boardDef) {
    for (const pin of boardDef.pins) {
      const num = boardPinNumber(pin.name, analogBase);
      if (num === null || !pinUse.reads.has(num) || pinUse.pullups.has(num)) continue;
      const net = netOf(nl, { part: boardInst.id, pin: pin.name });
      if (!net) continue;
      const others = pinsOnNet(nl, net.id).filter(
        (p) => p.partId !== boardInst.id && !isInert(p.partType),
      );
      if (others.length > 0) continue;
      out.push(
        make('floating-net', 'warning', [boardInst.id], {
          title: `Your sketch reads ${pin.name}, but nothing is connected to it`,
          explanation: `${pin.name} is read in the sketch, yet no part is wired to it, so the value is noise.`,
          why: 'A pin that connects to nothing has no defined voltage. On a real input it picks up noise from the room and reads random values, so the program reacts to things that never happened.',
          fix: `Wire the sensor or button that should drive ${pin.name}, or read the pin it is actually connected to.`,
          pins: [{ part: boardInst.id, pin: pin.name }],
          net: net.id,
          skill: 'pc.signal-pin',
        }),
      );
    }
  }

  // ------------------------------------------------------- per-part rules
  for (const inst of doc.diagram.parts) {
    const def = getPart(inst.type);
    if (!def || isInert(inst.type)) continue;
    const wired = connectedPins(doc, inst.id);
    const powerPins = def.pins.filter((p) => p.electrical === 'power');
    const groundPins = def.pins.filter((p) => p.electrical === 'ground');
    const signalPins = def.pins.filter(
      (p) => p.electrical !== 'power' && p.electrical !== 'ground',
    );

    // unwired-part
    if (wired.size === 0 && def.pins.length > 0) {
      out.push(
        make('unwired-part', 'warning', [inst.id], {
          title: `${def.name} is not wired up`,
          explanation: `You placed a ${def.name} but no wires touch it.`,
          why: 'A part only becomes part of a circuit when current can flow through it. Loose parts on the bench do nothing.',
          fix: `Wire ${def.pins.map((p) => p.name).slice(0, 3).join(', ')} and the rest of its pins.`,
          skill: 'pc.complete-circuit',
        }),
      );
      continue;
    }

    // missing-required-pin (power or ground left off a powered module)
    // A board or a supply provides power; it is never the thing that is missing it.
    const isSource = def.adapter === 'board' || def.adapter === 'power';
    if (powerPins.length > 0 && groundPins.length > 0 && def.fidelity.tier !== 'visual' && !isSource) {
      // Only the part's own supply is required. Driver outputs (OUT1, 2A) are
      // outputs, and pins like the L298N's 5V are alternatives: that pin is an
      // output while the on-board regulator jumper is fitted.
      const missingPower = powerPins.filter((p) => !wired.has(p.name) && isRequiredSupply(def, p.name));
      const missingGround = groundPins.filter((p) => !wired.has(p.name));
      if (wired.size > 0 && (missingPower.length > 0 || missingGround.length > 0)) {
        const missing = [...missingPower, ...missingGround];
        out.push(
          make('missing-required-pin', 'error', [inst.id], {
            title: `${def.name} is missing ${missing.map((p) => p.name).join(' and ')}`,
            explanation: `The ${missing.map((p) => p.name).join(' and ')} pin${missing.length > 1 ? 's are' : ' is'} not connected, so the part has no complete supply path.`,
            why: 'Current needs a closed loop: out of the supply, through the part, back to the source. Missing either side leaves the loop open and the part unpowered.',
            fix: `Connect ${missing.map((p) => p.name).join(' and ')} to ${missingPower.length > 0 ? 'a 5 V or 3.3 V rail' : 'ground'}.`,
            pins: missing.map((p) => ({ part: inst.id, pin: p.name })),
            skill: 'pc.return-path',
            ncert: 'Class 10 Ch. 12 Electricity - electric circuit and circuit diagrams',
          }),
        );
      }
    }

    // missing-signal-pin (a sensor or actuator with no data line)
    if (signalPins.length > 0 && def.fidelity.tier !== 'visual') {
      const missingSignal = signalPins.filter((p) => !wired.has(p.name));
      if (
        missingSignal.length === signalPins.length &&
        wired.size > 0 &&
        def.adapter !== 'board' &&
        def.adapter !== 'static'
      ) {
        out.push(
          make('missing-signal-pin', 'warning', [inst.id], {
            title: `${def.name} has no signal wire`,
            explanation: `Power and ground are connected, but ${missingSignal.map((p) => p.name).join(', ')} do${missingSignal.length > 1 ? '' : 'es'} not reach the board.`,
            why: 'A sensor converts the world into a voltage, and that voltage has to travel to an input pin. Without the data wire the board never sees a reading.',
            fix: `Connect ${missingSignal[0]?.name ?? 'the signal pin'} to a board pin.`,
            pins: missingSignal.map((p) => ({ part: inst.id, pin: p.name })),
            skill: 'pc.signal-pin',
          }),
        );
      }
    }

    // missing-return-path (outputs with no route back to ground)
    if (['led', 'buzzer', 'motor', 'relay', 'servo', 'rgb-led', 'stepper'].includes(def.adapter)) {
      const groundSide = groundPins[0];
      // A two-legged output (LED, buzzer) wired on one side only. Parts with a
      // supply pin are already covered by missing-required-pin.
      if (groundSide && !wired.has(groundSide.name) && powerPins.length === 0) {
        out.push(
          make('missing-return-path', 'error', [inst.id], {
            title: `${def.name} has no path back to ground`,
            explanation: `Its ${groundSide.name} pin is not connected to anything, so current has nowhere to go after passing through it.`,
            why: 'Current flows in a loop. It leaves the supply, passes through the part, and must return to the source. A part wired on one side only is an open circuit, and nothing flows.',
            fix: `Connect ${groundSide.name} to a GND pin on the board.`,
            pins: [{ part: inst.id, pin: groundSide.name }],
            skill: 'pc.return-path',
            ncert: 'Class 10 Ch. 12 Electricity - electric circuit and circuit diagrams',
          }),
        );
      }
      if (groundSide && wired.has(groundSide.name)) {
        const gnet = netOf(nl, { part: inst.id, pin: groundSide.name });
        // A motor on an H-bridge returns through the driver's output stage,
        // which is how it can run in both directions.
        const viaDriver = gnet !== undefined && pinsOnNet(nl, gnet.id).some((p) => p.part.category === 'Driver');
        if (gnet && !gnet.isGround && !viaDriver) {
          out.push(
            make('missing-return-path', 'error', [inst.id], {
              title: `${def.name} has no path back to ground`,
              explanation: `The ${groundSide.name} pin is wired, but that wire never reaches a ground pin.`,
              why: 'Current flows in a loop. It leaves the supply, passes through the part, and must return to the source. Without that return path the circuit is open and nothing flows.',
              fix: `Connect ${groundSide.name} to a GND pin on the board.`,
              pins: [{ part: inst.id, pin: groundSide.name }],
              net: gnet.id,
              skill: 'pc.return-path',
              ncert: 'Class 10 Ch. 12 Electricity - electric circuit and circuit diagrams',
            }),
          );
        }
      }
    }

    // reverse-polarity (LED fitted backwards)
    if (def.adapter === 'led') {
      const anode = def.pins.find((p) => p.name === 'A');
      const cathode = def.pins.find((p) => p.name === 'K');
      if (anode && cathode && wired.has(anode.name) && wired.has(cathode.name)) {
        const an = netOf(nl, { part: inst.id, pin: anode.name });
        const cn = netOf(nl, { part: inst.id, pin: cathode.name });
        if (an?.isGround && cn?.isPower) {
          out.push(
            make('reverse-polarity', 'error', [inst.id], {
              title: 'LED is wired backwards',
              explanation: 'The anode is on ground and the cathode is on the supply, so no current can flow.',
              why: 'A diode conducts in one direction only. Reverse bias blocks current until the breakdown voltage is reached, and for an LED that means it simply stays dark.',
              fix: 'Swap the two wires: the long leg (anode) goes towards the signal or supply.',
              pins: [
                { part: inst.id, pin: anode.name },
                { part: inst.id, pin: cathode.name },
              ],
              skill: 'pc.polarity',
              ncert: 'Class 12 Ch. 14 Semiconductor Electronics - p-n junction diode',
            }),
          );
        }
      }
    }

    // level-mismatch / back-powering (3.3 V part on a 5 V rail)
    if (typeof def.supply === 'number' && def.supply === 3.3 && powerPins.length > 0) {
      for (const pp of powerPins) {
        if (!wired.has(pp.name)) continue;
        const n = netOf(nl, { part: inst.id, pin: pp.name });
        if (n && n.voltage !== null && n.voltage > 3.6) {
          out.push(
            make('level-mismatch', 'warning', [inst.id], {
              title: `${def.name} is a 3.3 V part on a ${n.voltage} V rail`,
              explanation: `This part expects 3.3 V but its supply net is at ${n.voltage} V.`,
              why: 'Semiconductor junctions are thin. Feeding 5 V into a part rated for 3.3 V pushes past what its oxide layers tolerate and it usually fails permanently and silently.',
              fix: 'Power it from the 3.3 V pin, or add a level shifter on the data lines.',
              pins: [{ part: inst.id, pin: pp.name }],
              net: n.id,
              skill: 'pc.analog-conditioning',
            }),
          );
        }
      }
    }

    // thermal-overload: LED with no or too small a series resistor
    if (def.adapter === 'led') {
      const anode = def.pins.find((p) => p.name === 'A');
      const cathode = def.pins.find((p) => p.name === 'K');
      if (anode && cathode && wired.has(anode.name) && wired.has(cathode.name)) {
        const r = seriesResistance(doc, nl, { part: inst.id, pin: anode.name }, {
          part: inst.id,
          pin: cathode.name,
        });
        const an = netOf(nl, { part: inst.id, pin: anode.name });
        const vf = Number(inst.attrs.forwardVoltage ?? def.defaults?.forwardVoltage ?? 2.0);
        const vSupply = an?.voltage ?? 5;
        const current = r === null ? Infinity : ((vSupply - vf) / r) * 1000;
        const maxCurrent = Number(inst.attrs.maxCurrent ?? def.defaults?.maxCurrent ?? 20);
        if (current > maxCurrent) {
          out.push(
            make('thermal-overload', 'error', [inst.id], {
              title: r === null ? 'LED has no current-limiting resistor' : 'LED current is too high',
              explanation:
                r === null
                  ? 'This LED is connected with no resistor in series, so nothing limits the current through it.'
                  : `With ${r} Ω in series, about ${Math.round(current)} mA flows, above the ${maxCurrent} mA the LED can take.`,
              why: 'An LED is a diode: once it conducts, its resistance collapses, so the current is set almost entirely by whatever resistance is in series. Too much current overheats the junction and it burns out.',
              fix: `Add a ${Math.max(100, Math.round(((vSupply - vf) / (maxCurrent / 1000)) * 10) * 10)} Ω resistor in series with the LED.`,
              pins: [{ part: inst.id, pin: anode.name }],
              net: an?.id,
              skill: 'pc.ohms-law',
              ncert: 'Class 10 Ch. 12 Electricity - Ohm\'s law and the heating effect of current',
            }),
          );
        }
      }
    }

    // thermal-overload: a high-current load drawing its supply through a pin.
    // Modules with their own VCC take their current from that pin, so the board
    // only carries the control signal and is not overloaded.
    if (['motor', 'relay', 'stepper', 'servo'].includes(def.adapter)) {
      const draw = typeof def.current === 'number' ? def.current : 0;
      if (draw > PIN_CURRENT_MA) {
        const signalPin = def.pins.find(
          (p) => p.electrical === 'digital' || p.electrical === 'pwm',
        );
        if (signalPin && wired.has(signalPin.name)) {
          const n = netOf(nl, { part: inst.id, pin: signalPin.name });
          const boardDriving =
            n !== undefined && pinsOnNet(nl, n.id).some((p) => p.part.adapter === 'board');

          // Does the load take its supply from a board output pin?
          let supplyFromPin = powerPins.length === 0;
          for (const pp of powerPins) {
            if (!wired.has(pp.name)) continue;
            const sn = netOf(nl, { part: inst.id, pin: pp.name });
            if (
              sn !== undefined &&
              pinsOnNet(nl, sn.id).some(
                (p) =>
                  p.part.adapter === 'board' &&
                  (p.pin.electrical === 'digital' || p.pin.electrical === 'pwm'),
              )
            ) {
              supplyFromPin = true;
            }
          }

          if (boardDriving && supplyFromPin) {
            out.push(
              make('thermal-overload', 'error', [inst.id], {
                title: `${def.name} draws more current than a pin can supply`,
                explanation: `This part wants about ${draw} mA, it is fed through a board pin, and an Arduino pin is rated for roughly ${PIN_CURRENT_MA} mA.`,
                why: 'The output transistors inside the chip are tiny. Asking them to pass hundreds of milliamps heats the silicon locally until that pin, and sometimes the whole chip, is destroyed.',
                fix: 'Drive it through a transistor, MOSFET or driver module, with a separate supply for the load.',
                pins: [{ part: inst.id, pin: signalPin.name }],
                net: n?.id,
                skill: 'pc.power-budget',
                ncert: 'Class 10 Ch. 12 Electricity - heating effect of current',
              }),
            );
          }
        }
      }
    }

    // missing-pull-up for buttons
    if (def.adapter === 'button') {
      const a = def.pins[0];
      const b = def.pins[1];
      if (a && b && wired.has(a.name) && wired.has(b.name)) {
        const na = netOf(nl, { part: inst.id, pin: a.name });
        const nb = netOf(nl, { part: inst.id, pin: b.name });
        const touchesBoard =
          (na !== undefined && pinsOnNet(nl, na.id).some((p) => p.part.adapter === 'board')) ||
          (nb !== undefined && pinsOnNet(nl, nb.id).some((p) => p.part.adapter === 'board'));
        const boardPinsHere = [na, nb]
          .filter((n): n is NetInfo => n !== undefined)
          .flatMap((n) => pinsOnNet(nl, n.id))
          .filter((p) => p.part.adapter === 'board')
          .map((p) => boardPinNumber(p.pin.name, analogBase))
          .filter((n): n is number => n !== null);
        const hasPullUp =
          boardPinsHere.some((n) => pinUse.pullups.has(n)) ||
          // A resistor to a supply on the same net is an external pull-up.
          [na, nb].some((n) => n !== undefined && pinsOnNet(nl, n.id).some((p) => p.part.id === 'resistor'));
        if (touchesBoard && !hasPullUp) {
          out.push(
            make('missing-pull-up', 'warning', [inst.id], {
              title: 'Button input may float',
              explanation: 'The button reaches a board pin, but nothing holds that pin at a defined level when the button is open.',
              why: 'An unconnected input pin is an antenna. It picks up mains hum and static, so digitalRead returns 1 and 0 at random and your program reacts to nothing at all.',
              fix: 'Use pinMode(pin, INPUT_PULLUP) and read for LOW when pressed, or add a 10 kΩ resistor to 5 V.',
              pins: [
                { part: inst.id, pin: a.name },
                { part: inst.id, pin: b.name },
              ],
              skill: 'pc.pull-resistor',
            }),
          );
        }
      }
    }

    // unsupported-part-in-engine
    if (def.fidelity.engine === 'firmware' && doc.engine !== 'firmware' && def.adapter !== 'board') {
      out.push(
        make('unsupported-part-in-engine', 'info', [inst.id], {
          title: `${def.name} needs the firmware emulator`,
          explanation: 'This part only models its protocol inside Firmware Emulation.',
          why: 'The functional runtime approximates behaviour without a real core, so bus-level parts have nothing to talk to.',
          fix: 'Switch the engine selector to Firmware Emulation to use this part as designed.',
          skill: 'ct.supported-subset',
        }),
      );
    }
  }

  // ------------------------------------------------------------ pin-conflict
  for (const net of nl.nets.values()) {
    const boardPins = pinsOnNet(nl, net.id).filter((p) => p.part.adapter === 'board');
    const signal = boardPins.filter(
      (p) => p.pin.electrical === 'digital' || p.pin.electrical === 'pwm',
    );
    if (signal.length > 1) {
      out.push(
        make('pin-conflict', 'warning', [...new Set(signal.map((p) => p.partId))], {
          title: `${signal.length} board pins are tied to the same net`,
          explanation: `${signal.map((p) => p.pin.name).join(' and ')} are wired together.`,
          why: 'Two outputs driving the same wire fight each other. If one is HIGH and the other LOW, current flows straight from one pin into the other with no load in between.',
          fix: 'Keep one pin per net unless you are deliberately sharing, and never drive both as outputs.',
          pins: signal.map((p) => ({ part: p.partId, pin: p.pin.name })),
          net: net.id,
          skill: 'pc.pin-conflict',
        }),
      );
    }
  }

  // ------------------------------------------------------ power budget
  // Only current the board itself supplies counts. A part whose main supply
  // pin (the first power pin: VCC, DC+, VMS) sits on a battery or bench supply
  // is fed from there, which is the whole point of giving motors their own.
  const draw = doc.diagram.parts.reduce((sum, inst) => {
    const def = getPart(inst.type);
    if (!def || isInert(inst.type)) return sum;
    if (def.adapter === 'board' || def.adapter === 'power') return sum;
    if (connectedPins(doc, inst.id).size === 0) return sum;
    const mainSupply = def.pins.find((p) => p.electrical === 'power');
    if (mainSupply) {
      const net = netOf(nl, { part: inst.id, pin: mainSupply.name });
      const fedByBoard = net !== undefined && pinsOnNet(nl, net.id).some(
        (p) => p.part.adapter === 'board' && p.pin.electrical === 'power',
      );
      if (!fedByBoard) return sum;
    }
    return sum + (typeof def.current === 'number' ? def.current : 0);
  }, 0);
  if (draw > BOARD_BUDGET_MA && nl.boards.length > 0) {
    out.push(
      make('power-budget-exceeded', 'warning', nl.boards, {
        title: 'The 5 V rail is overloaded',
        explanation: `Wired parts want about ${Math.round(draw)} mA in total; the board's 5 V rail is good for roughly ${BOARD_BUDGET_MA} mA.`,
        why: 'Every milliamp through the board regulator turns into heat. Past its rating the regulator shuts down or cooks, and the voltage sags until the microcontroller resets.',
        fix: 'Give motors, solenoids and pumps their own supply, with a common ground.',
        skill: 'pc.power-budget',
      }),
    );
  }

  return dedupe(out);
}

/** Two rules can find the same physical fault; keep the first, strongest one. */
function dedupe(list: Diagnostic[]): Diagnostic[] {
  const seen = new Map<string, Diagnostic>();
  const rank: Record<Severity, number> = { error: 3, warning: 2, info: 1 };
  for (const d of list) {
    const prev = seen.get(d.id);
    if (!prev || rank[d.severity] > rank[prev.severity]) seen.set(d.id, d);
  }
  return [...seen.values()];
}

export function diagnosticsForPart(list: Diagnostic[], partId: string): Diagnostic[] {
  return list.filter((d) => d.parts.includes(partId));
}

export function hasBlockingFault(list: Diagnostic[]): boolean {
  return list.some((d) => d.severity === 'error');
}

export function countBySeverity(list: Diagnostic[]): Record<Severity, number> {
  return {
    error: list.filter((d) => d.severity === 'error').length,
    warning: list.filter((d) => d.severity === 'warning').length,
    info: list.filter((d) => d.severity === 'info').length,
  };
}
