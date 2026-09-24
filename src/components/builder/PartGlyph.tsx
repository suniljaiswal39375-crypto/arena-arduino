'use client';

import type { PartInstance } from '@/lib/doc/types';
import type { PartDef } from '@/lib/parts/types';
import type { PartState } from '@/lib/sim/runtime';

interface Props {
  def: PartDef;
  inst: PartInstance;
  state: PartState | undefined;
  width: number;
  height: number;
}

const text = (s: string, max: number): string => (s.length <= max ? s : s.slice(0, max));

export function PartGlyph({ def, state, width, height }: Props) {
  const top = 24;
  const cy = top + (height - top) / 2;

  switch (state?.kind) {
    case 'led': {
      const on = state.on;
      return (
        <g>
          <circle
            cx={width / 2}
            cy={cy}
            r={13}
            fill={state.colour}
            opacity={on ? 0.25 + state.brightness * 0.75 : 0.12}
          />
          {on && (
            <circle cx={width / 2} cy={cy} r={20} fill={state.colour} opacity={0.12 * state.brightness} />
          )}
          <circle
            cx={width / 2}
            cy={cy}
            r={13}
            fill="none"
            stroke={state.colour}
            strokeWidth={1.5}
            opacity={on ? 1 : 0.45}
          />
        </g>
      );
    }

    case 'rgb': {
      const cols: Array<[string, number, number]> = [
        ['#e63946', width / 2 - 22, state.r],
        ['#2a9d8f', width / 2, state.g],
        ['#3a86ff', width / 2 + 22, state.b],
      ];
      return (
        <g>
          {cols.map(([c, x, v]) => (
            <circle key={c} cx={x} cy={cy} r={11} fill={c} opacity={0.15 + (v ?? 0) * 0.85} />
          ))}
          <circle cx={width / 2} cy={cy} r={20} fill="none" stroke="var(--color-border)" strokeWidth={1} />
        </g>
      );
    }

    case 'servo': {
      const angle = ((state.angle - 90) * Math.PI) / 180;
      const r = 15;
      return (
        <g>
          <circle cx={width / 2} cy={cy} r={r} fill="none" stroke="var(--color-border-strong)" strokeWidth={1.5} />
          <line
            x1={width / 2}
            y1={cy}
            x2={width / 2 + Math.sin(angle) * r}
            y2={cy - Math.cos(angle) * r}
            stroke="var(--color-accent)"
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <circle cx={width / 2} cy={cy} r={3} fill="var(--color-accent)" />
          <text x={width - 10} y={height - 6} fontSize={9} textAnchor="end" fill="var(--color-text-dim)">
            {Math.round(state.angle)}°
          </text>
        </g>
      );
    }

    case 'relay': {
      const closed = state.closed;
      return (
        <g>
          <rect x={width / 2 - 28} y={cy - 12} width={56} height={24} rx={5} fill="rgba(255,255,255,0.03)" stroke="var(--color-border)" />
          <circle cx={width / 2 - 16} cy={cy} r={3} fill="var(--color-text-faint)" />
          <circle cx={width / 2 + 16} cy={cy} r={3} fill="var(--color-text-faint)" />
          <line
            x1={width / 2 - 16}
            y1={cy}
            x2={width / 2 + (closed ? 16 : 6)}
            y2={cy - (closed ? 0 : 8)}
            stroke={closed ? 'var(--color-ok)' : 'var(--color-text-faint)'}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
          <text x={width / 2} y={cy + 24} fontSize={9} textAnchor="middle" fill="var(--color-text-dim)">
            {closed ? 'closed' : 'open'}
          </text>
        </g>
      );
    }

    case 'buzzer': {
      const active = state.active;
      return (
        <g>
          <circle cx={width / 2} cy={cy} r={12} fill="none" stroke="var(--color-border-strong)" strokeWidth={1.5} />
          <text x={width / 2} y={cy + 4} fontSize={11} textAnchor="middle" fill="var(--color-text)">
            ♪
          </text>
          {active &&
            [0, 1, 2].map((i) => (
              <path
                key={i}
                d={`M ${width / 2 + 15 + i * 6} ${cy - 7 - i * 2} q 4 7 0 14`}
                fill="none"
                stroke="var(--color-warn)"
                strokeWidth={1.5}
                opacity={0.85 - i * 0.2}
              />
            ))}
          {active && (
            <text x={width / 2} y={cy + 26} fontSize={9} textAnchor="middle" fill="var(--color-warn)">
              {Math.round(state.frequency)} Hz
            </text>
          )}
        </g>
      );
    }

    case 'lcd': {
      const lines = state.lines ?? [];
      return (
        <g>
          <rect x={12} y={top + 2} width={width - 24} height={height - top - 6} rx={4} fill="#0d2b1f" stroke="var(--color-border-strong)" />
          {lines.slice(0, state.rows).map((line, i) => (
            <text
              key={i}
              x={18}
              y={top + 16 + i * 13}
              fontSize={9.5}
              fill={state.backlight ? '#7ee0b8' : '#2c5a48'}
              fontFamily="var(--font-mono)"
            >
              {text(line, 18)}
            </text>
          ))}
        </g>
      );
    }

    case 'oled': {
      const lines = (state.lines ?? []).filter((l) => l.length > 0).slice(-3);
      return (
        <g>
          <rect x={12} y={top + 2} width={width - 24} height={height - top - 6} rx={3} fill="#0a0f16" stroke="var(--color-border-strong)" />
          {lines.length === 0 ? (
            <text x={width / 2} y={cy + 4} fontSize={9} textAnchor="middle" fill="var(--color-text-faint)">
              blank
            </text>
          ) : (
            lines.map((line, i) => (
              <text
                key={i}
                x={18}
                y={top + 15 + i * 12}
                fontSize={9}
                fill="#cfe8ff"
                fontFamily="var(--font-mono)"
              >
                {text(line, 18)}
              </text>
            ))
          )}
        </g>
      );
    }

    case 'motor': {
      const speed = state.speed;
      return (
        <g>
          <circle cx={width / 2} cy={cy} r={14} fill="none" stroke="var(--color-border-strong)" strokeWidth={1.5} />
          <g transform={`rotate(${speed * 25} ${width / 2} ${cy})`}>
            {[0, 120, 240].map((a) => (
              <line
                key={a}
                x1={width / 2}
                y1={cy}
                x2={width / 2 + Math.cos((a * Math.PI) / 180) * 12}
                y2={cy + Math.sin((a * Math.PI) / 180) * 12}
                stroke={speed > 0 ? 'var(--color-accent)' : 'var(--color-border-strong)'}
                strokeWidth={2.5}
                strokeLinecap="round"
              />
            ))}
          </g>
        </g>
      );
    }

    case 'sensor': {
      return (
        <g>
          <text
            x={width / 2}
            y={cy + 2}
            fontSize={14}
            textAnchor="middle"
            fill="var(--color-accent)"
            fontFamily="var(--font-mono)"
          >
            {Math.round(state.value)}
          </text>
          <text x={width / 2} y={cy + 16} fontSize={8.5} textAnchor="middle" fill="var(--color-text-faint)">
            {state.unit || state.label}
          </text>
        </g>
      );
    }

    case 'seven-seg': {
      // Illuminate the *observed segments*, even when they do not form a digit.
      // A text glyph would invent a character for partial/shorted wiring.
      const segments: Array<[number, number, number, number]> = [
        [-7, -13, 14, 2], [8, -11, 2, 10], [8, 1, 2, 10],
        [-7, 12, 14, 2], [-10, 1, 2, 10], [-10, -11, 2, 10], [-7, -1, 14, 2],
      ];
      return (
        <g>
          <rect x={width / 2 - 26} y={cy - 17} width={52} height={34} rx={4} fill="#2a0d10" stroke="var(--color-border)" />
          {segments.map(([dx, dy, w, h], i) => (
            <rect key={i} x={width / 2 + dx!} y={cy + dy!} width={w} height={h}
              fill={state.segments & (1 << i) ? '#ff5a5f' : '#4c1a20'} rx={0.7} />
          ))}
          <circle cx={width / 2 + 14} cy={cy + 12} r={1.6}
            fill={state.segments & 0x80 ? '#ff5a5f' : '#4c1a20'} />
        </g>
      );
    }

    case 'stepper': {
      return (
        <g>
          {[0, 1, 2, 3].map((bit) => (
            <circle key={bit} cx={width / 2 - 18 + bit * 12} cy={cy - 5} r={3.5}
              fill={state.coils !== null && (state.coils & (1 << bit)) !== 0 && state.powered ? 'var(--color-accent)' : 'var(--color-border-strong)'} />
          ))}
          <text x={width / 2} y={cy + 15} fontSize={9} textAnchor="middle"
            fill="var(--color-text-muted)" fontFamily="var(--font-mono)">
            {state.powered ? state.coils === null ? 'GPIO ?' : `GPIO ${state.transitions > 0 ? '+' : ''}${state.transitions}` : 'unpowered'}
          </text>
        </g>
      );
    }

    case 'logic-analyzer': {
      return (
        <g>
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <g key={i}>
              <circle cx={width / 2 - 28 + (i % 4) * 18} cy={cy - 12 + Math.floor(i / 4) * 16} r={3.5}
                fill={state.levels[i] === '1' ? 'var(--color-ok)' : state.levels[i] === '0' ? 'var(--color-accent)' : 'var(--color-border-strong)'} />
              <text x={width / 2 - 28 + (i % 4) * 18} y={cy - 18 + Math.floor(i / 4) * 16}
                textAnchor="middle" fontSize={6} fill="var(--color-text-faint)">{i}</text>
            </g>
          ))}
          <text x={width / 2} y={cy + 31} fontSize={9} textAnchor="middle" fill="var(--color-text-dim)">
            {state.grounded ? `${state.edges} edges${state.dropped ? ' · clipped' : ''}` : 'GND ?'}
          </text>
        </g>
      );
    }

    case 'matrix': {
      const cells = state.cells ?? [];
      const size = 3;
      return (
        <g>
          {Array.from({ length: 64 }).map((_, i) => {
            const row = Math.floor(i / 8);
            const col = i % 8;
            return (
              <rect
                key={i}
                x={width / 2 - 16 + col * 4}
                y={cy - 16 + row * 4}
                width={size}
                height={size}
                fill={cells[i] ? 'var(--color-warn)' : 'rgba(255,255,255,0.05)'}
              />
            );
          })}
        </g>
      );
    }

    case 'board': {
      const pins = state.pins ?? {};
      const ids = Object.keys(pins).slice(0, 12);
      return (
        <g>
          {ids.map((id, i) => {
            const col = i % 6;
            const row = Math.floor(i / 6);
            const on = (pins[id] ?? 0) >= 2.5;
            return (
              <rect
                key={id}
                x={14 + col * 18}
                y={top + 6 + row * 14}
                width={13}
                height={9}
                rx={2}
                fill={on ? 'var(--color-accent)' : 'rgba(255,255,255,0.06)'}
              />
            );
          })}
        </g>
      );
    }

    default:
      return (
        <text x={width / 2} y={cy + 4} fontSize={9} textAnchor="middle" fill="var(--color-text-faint)">
          {def.category}
        </text>
      );
  }
}
