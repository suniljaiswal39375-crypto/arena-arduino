import type { PartState } from '@/lib/sim/runtime';
import type { PartDef } from '@/lib/parts/types';

/**
 * Headless visual capture for automation scenarios (`take-screenshot`).
 *
 * Wokwi rasterises a part's rendered pixels; SparkLab's engines keep the same
 * information as decoded state (LCD/OLED text, matrix cells, segment bits,
 * LED/servo positions), so the capture renders that state into a small,
 * byte-deterministic SVG. Two runs of the same simulation produce the same
 * file, which is what `compare-with` needs for visual regression.
 */

const xml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const svg = (width: number, height: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${body}</svg>\n`;

/** Monospace text line; `y` is the baseline. */
const textLine = (x: number, y: number, fill: string, content: string, size = 12): string =>
  `<text x="${x}" y="${y}" font-family="monospace" font-size="${size}" fill="${fill}" xml:space="preserve">${xml(content)}</text>`;

function lcdSvg(state: { lines: string[]; backlight: boolean; cols: number; rows: number }): string {
  const cell = 10;
  const rowH = 18;
  const pad = 8;
  const w = pad * 2 + state.cols * cell;
  const h = pad * 2 + state.rows * rowH;
  const bg = state.backlight ? '#9fbf5a' : '#39493a';
  const ink = '#102010';
  let body = `<rect width="${w}" height="${h}" fill="${bg}"/>`;
  for (let r = 0; r < state.rows; r++) {
    const line = state.lines[r] ?? '';
    body += textLine(pad, pad + r * rowH + 14, ink, line.padEnd(state.cols).slice(0, state.cols), 14);
  }
  return svg(w, h, body);
}

function oledSvg(state: { lines: string[] }): string {
  const rowH = 12;
  const rows = Math.max(state.lines.length, 1);
  const longest = Math.max(...state.lines.map((l) => l.length), 1);
  const w = 16 + longest * 8;
  const h = 8 + rows * rowH;
  let body = `<rect width="${w}" height="${h}" fill="#000000"/>`;
  state.lines.forEach((line, r) => {
    body += textLine(8, 8 + r * rowH + 9, '#ffffff', line, 11);
  });
  return svg(w, h, body);
}

function matrixSvg(cells: boolean[], def?: PartDef): string {
  const cols = Number(def?.defaults?.width ?? 8) || 8;
  const rows = Math.max(1, Math.ceil(cells.length / cols));
  const px = 8;
  const w = cols * px;
  const h = rows * px;
  let body = `<rect width="${w}" height="${h}" fill="#101010"/>`;
  cells.forEach((on, i) => {
    if (!on) return;
    body += `<rect x="${(i % cols) * px}" y="${Math.floor(i / cols) * px}" width="${px}" height="${px}" fill="#ff4444"/>`;
  });
  return svg(w, h, body);
}

function sevenSegSvg(value: string, segments: number): string {
  const shown = value.length > 0 ? value : segments === 0 ? ' ' : '?';
  return svg(48, 64, `<rect width="48" height="64" rx="6" fill="#1a1a1a"/>${textLine(12, 44, '#ff2d2d', shown, 32)}`);
}

function ledSvg(on: boolean, brightness: number, colour: string): string {
  const fill = on ? colour : '#3a3a3a';
  const alpha = on ? Math.max(0.25, Math.min(1, brightness)) : 1;
  return svg(
    32,
    32,
    `<rect width="32" height="32" fill="#141414"/>` +
      `<circle cx="16" cy="16" r="10" fill="${xml(fill)}" fill-opacity="${Number(alpha.toFixed(2))}"/>`,
  );
}

function rgbSvg(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const fill = `rgb(${clamp(r)},${clamp(g)},${clamp(b)})`;
  return svg(
    32,
    32,
    `<rect width="32" height="32" fill="#141414"/><circle cx="16" cy="16" r="10" fill="${fill}"/>`,
  );
}

function servoSvg(angle: number): string {
  const a = ((Math.max(0, Math.min(180, angle)) - 90) * Math.PI) / 180;
  const x2 = 16 + Math.round(12 * Math.cos(a));
  const y2 = 16 + Math.round(12 * Math.sin(a));
  return svg(
    32,
    32,
    `<rect width="32" height="32" fill="#141414"/>` +
      `<circle cx="16" cy="16" r="12" fill="none" stroke="#666666"/>` +
      `<line x1="16" y1="16" x2="${x2}" y2="${y2}" stroke="#ffb703" stroke-width="2"/>`,
  );
}

/**
 * Render a part's live state as a deterministic SVG, or null when the part
 * has no visual state the engines model.
 */
export function capturePartSvg(state: PartState | undefined, def?: PartDef): string | null {
  if (!state) return null;
  switch (state.kind) {
    case 'lcd':
      return lcdSvg(state);
    case 'oled':
      return oledSvg(state);
    case 'matrix':
      return matrixSvg(state.cells, def);
    case 'seven-seg':
      return sevenSegSvg(state.value, state.segments);
    case 'led':
      return ledSvg(state.on, state.brightness, state.colour);
    case 'rgb':
      return rgbSvg(state.r, state.g, state.b);
    case 'servo':
      return servoSvg(state.angle);
    default:
      return null;
  }
}
