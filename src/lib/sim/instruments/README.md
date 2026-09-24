# Instruments (`src/lib/sim/instruments`)

Calibrated virtual-time inspection bench instruments for SparkLab:
- **Eight-channel digital logic analyzer (`logic-analyzer.ts`)**: bounded (2,048 edges), event-driven digital capture with 16 MHz AVR instruction-cycle timestamps or functional microsecond timestamps; deterministic VCD export; trigger support (edge/level).
- **Dual-channel virtual-time oscilloscope (`oscilloscope.ts`)**: dual analog probes (CH1 & CH2), 10-division timebase (100 µs/div to 1 s/div), auto-measurements (Vpp, Vmax, Vmin, Vmean, Vrms, frequency, duty cycle, rise time), configurable trigger modes (Auto, Normal, Single, rising/falling slope, threshold), and hold/run freeze controls.
- **Digital multimeter (`multimeter.ts`)**: DC voltage, DC current, passive impedance/resistance, continuity test with audio/visual beep, and diode/LED forward-bias testing. Powered by graph-based netlist analysis; unpowered/floating/open nodes report honest states (`O.L`, `unmeasured`, `floating`) rather than invented analog noise.
- **Shared trigger models (`trigger.ts`)**: digital and analog trigger engines operating strictly in virtual time.

## Fidelity Boundaries & Honesty
1. **Virtual Time**: All waveforms and measurements are calibrated to the simulation's virtual timeline (`timeUs` / `timeNs`), not real-world wall clock or renderer frames.
2. **No Invented Analog Precision**: Undecoded, unwired, or floating nets are marked as `x` (logic) or `null` / unmeasured (oscilloscope / multimeter). No random Gaussian noise or fabricated high-frequency ringing is generated.
3. **Transient Memory Only**: Captured traces live strictly in worker/React memory. They are excluded from `ProjectDoc` persistence, `localStorage`, and service worker caches.

## Running Tests

```bash
npx vitest run src/lib/sim/instruments/
```
