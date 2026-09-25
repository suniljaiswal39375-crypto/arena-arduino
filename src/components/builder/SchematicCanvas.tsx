'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLab, type DockTab } from '@/store/lab';
import { getPart } from '@/lib/parts';
import { PIN_COLOR } from '@/lib/parts/types';
import { WIRE_COLOR_HEX } from '@/lib/doc/types';
import type { PartInstance, ProjectDoc } from '@/lib/doc/types';
import type { PartState } from '@/lib/sim/runtime';
import {
  GRID,
  PART_WIDTH,
  partHeight,
  pinOffset,
  pinPosition,
  snap,
  wirePath,
} from '@/lib/canvas/geometry';
import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n/client';
import { Image as ImageIcon } from 'lucide-react';
import { FIDELITY_LABEL } from '@/lib/brand';
import { collabState, subscribeCollab } from '@/store/collab';
import type { PeerInfo } from '@/lib/collab/session';
import { PartGlyph } from './PartGlyph';
import { PeerGhosts } from './peer-ghosts';
import { CommentBadges } from './comment-badges';

/** Open (unresolved) comment counts per part, from the bridge's threads. */
function openCommentCounts(comments: Record<string, Array<{ resolved: boolean }>>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [partId, list] of Object.entries(comments)) {
    const open = list.filter((c) => !c.resolved).length;
    if (open > 0) counts[partId] = open;
  }
  return counts;
}

interface View {
  x: number;
  y: number;
  k: number;
}

interface Drag {
  id: string;
  dx: number;
  dy: number;
  moved: boolean;
}

export function SchematicCanvas({
  states,
  peers: peersProp,
  commentCounts: commentCountsProp,
}: {
  states: Record<string, PartState>;
  /** Tests inject presence directly; the live canvas subscribes to the Co-Lab bridge. */
  peers?: PeerInfo[];
  /** Tests inject open-comment counts; the live canvas derives them from the bridge. */
  commentCounts?: Record<string, number>;
}) {
  const doc = useLab((s) => s.doc);
  const selection = useLab((s) => s.selection);
  const selectedWire = useLab((s) => s.selectedWire);
  const pendingWire = useLab((s) => s.pendingWire);
  const diagnostics = useLab((s) => s.diagnostics);
  const select = useLab((s) => s.select);
  const selectWire = useLab((s) => s.selectWire);
  const startWire = useLab((s) => s.startWire);
  const moveWire = useLab((s) => s.moveWire);
  const finishWire = useLab((s) => s.finishWire);
  const cancelWire = useLab((s) => s.cancelWire);
  const apply = useLab((s) => s.apply);
  const deleteSelection = useLab((s) => s.deleteSelection);
  const { t } = useI18n();

  // Remote selection ghosts: peers' live selections, session-only presence.
  const [bridge, setBridge] = useState(collabState);
  useEffect(() => {
    if (peersProp !== undefined) return;
    return subscribeCollab(setBridge);
  }, [peersProp]);
  const peers = peersProp ?? (bridge.status === 'active' ? bridge.peers : []);
  const commentCounts = commentCountsProp ?? openCommentCounts(bridge.comments);

  // Photo trace (Phase 14): a session-only reference underlay. It is
  // deliberately *not* persisted or recognized — nothing is auto-placed.
  const [photo, setPhoto] = useState<{ url: string; opacity: number } | null>(null);
  const onPhotoFile = useCallback((file: File | undefined) => {
    if (!file || !file.type.startsWith('image/')) return;
    setPhoto((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { url: URL.createObjectURL(file), opacity: 35 };
    });
  }, []);
  const removePhoto = useCallback(() => {
    setPhoto((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return null;
    });
  }, []);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [drag, setDrag] = useState<Drag | null>(null);
  const [panning, setPanning] = useState<{ x: number; y: number } | null>(null);
  const [hoverPin, setHoverPin] = useState<string | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);

  const faultParts = useMemo(() => {
    const set = new Set<string>();
    for (const d of diagnostics) {
      if (d.severity === 'error') for (const p of d.parts) set.add(p);
    }
    return set;
  }, [diagnostics]);

  const warnParts = useMemo(() => {
    const set = new Set<string>();
    for (const d of diagnostics) {
      if (d.severity === 'warning') for (const p of d.parts) set.add(p);
    }
    return set;
  }, [diagnostics]);

  const toWorld = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left - view.x) / view.k,
        y: (clientY - rect.top - view.y) / view.k,
      };
    },
    [view],
  );

  /* --------------------------------------------------------- keyboard */

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName))) return;

      if (e.code === 'Space') setSpaceDown(true);
      if (e.key === 'Escape') cancelWire();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        deleteSelection();
      }
      if ((e.key === 'r' || e.key === 'R') && selection) {
        apply({ t: 'rotatePart', id: selection });
      }
      if ((e.key === 'z' && (e.metaKey || e.ctrlKey)) && !e.shiftKey) {
        e.preventDefault();
        useLab.getState().undo();
      }
      if ((e.key === 'z' && (e.metaKey || e.ctrlKey) && e.shiftKey) ||
          (e.key === 'y' && (e.metaKey || e.ctrlKey))) {
        e.preventDefault();
        useLab.getState().redo();
      }
    };
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [cancelWire, deleteSelection, selection, apply]);

  /* ------------------------------------------------------------- mouse */

  const onBackgroundDown = (e: React.MouseEvent): void => {
    select(null);
    selectWire(null);
    setPanning({ x: e.clientX - view.x, y: e.clientY - view.y });
  };

  const onPartDown = (e: React.MouseEvent, inst: PartInstance): void => {
    e.stopPropagation();
    if (spaceDown) return;
    select(inst.id);
    const p = toWorld(e.clientX, e.clientY);
    setDrag({ id: inst.id, dx: p.x - inst.x, dy: p.y - inst.y, moved: false });
  };

  const onPinDown = (e: React.MouseEvent, inst: PartInstance, pin: string): void => {
    e.stopPropagation();
    const def = getPart(inst.type);
    if (!def) return;
    const pos = pinPosition(inst, def, pin);
    if (!pos) return;
    const { pendingWire: current } = useLab.getState();
    if (current) {
      finishWire({ part: inst.id, pin });
      return;
    }
    startWire({ part: inst.id, pin }, pos.x, pos.y);
  };

  const onMove = (e: React.MouseEvent): void => {
    if (panning) {
      setView((v) => ({ ...v, x: e.clientX - panning.x, y: e.clientY - panning.y }));
      return;
    }
    if (drag) {
      const p = toWorld(e.clientX, e.clientY);
      const nx = snap(p.x - drag.dx);
      const ny = snap(p.y - drag.dy);
      const inst = doc.diagram.parts.find((x) => x.id === drag.id);
      if (inst && (inst.x !== nx || inst.y !== ny)) {
        setDrag({ ...drag, moved: true });
        apply({ t: 'movePart', id: drag.id, x: nx, y: ny });
      }
      return;
    }
    if (pendingWire) {
      const p = toWorld(e.clientX, e.clientY);
      moveWire(p.x, p.y);
    }
  };

  const onUp = (): void => {
    setPanning(null);
    setDrag(null);
  };

  const onWheel = (e: React.WheelEvent): void => {
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setView((v) => {
      const k = Math.min(2.5, Math.max(0.35, v.k * (e.deltaY < 0 ? 1.1 : 0.9)));
      return { k, x: mx - ((mx - v.x) * k) / v.k, y: my - ((my - v.y) * k) / v.k };
    });
  };

  const fit = useCallback(() => {
    setView({ x: 40, y: 24, k: 0.9 });
  }, []);

  useEffect(() => {
    fit();
  }, [fit]);

  const ghostTargets = pendingWire
    ? doc.diagram.parts.flatMap((inst) => {
        const def = getPart(inst.type);
        if (!def) return [];
        if (inst.id === pendingWire.from.part) return [];
        return def.pins.map((pin) => ({ inst, def, pin }));
      })
    : [];

  return (
    <div className="relative h-full w-full overflow-hidden bg-[var(--color-bg)]">
      {photo && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photo.url}
          alt=""
          aria-hidden="true"
          className="pointer-events-none absolute left-1/2 top-1/2 max-h-full max-w-full -translate-x-1/2 -translate-y-1/2"
          style={{ opacity: photo.opacity / 100 }}
        />
      )}
      <svg
        ref={svgRef}
        className={cn('h-full w-full', spaceDown ? 'cursor-grab' : 'cursor-default')}
        onMouseDown={onBackgroundDown}
        onMouseMove={onMove}
        onMouseUp={onUp}
        onMouseLeave={onUp}
        onWheel={onWheel}
        role="application"
        aria-label="Schematic canvas"
      >
        <defs>
          <pattern id="grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
            <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />
          </pattern>
          <marker id="pinhead" markerWidth="6" markerHeight="6" refX="3" refY="3">
            <circle cx="3" cy="3" r="3" fill="currentColor" />
          </marker>
        </defs>

        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          <rect x={-4000} y={-4000} width={9000} height={9000} fill="url(#grid)" />

          {/* wires */}
          {doc.diagram.connections.map((w) => {
            const a = pointFor(doc, w.from.part, w.from.pin);
            const b = pointFor(doc, w.to.part, w.to.pin);
            if (!a || !b) return null;
            const isSelected = selectedWire === w.id;
            return (
              <g key={w.id}>
                <path
                  d={wirePath(a, b)}
                  fill="none"
                  stroke={WIRE_COLOR_HEX[w.color]}
                  strokeWidth={isSelected ? 4 : 2.5}
                  strokeLinecap="round"
                  opacity={isSelected ? 1 : 0.85}
                />
                <path
                  d={wirePath(a, b)}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                  className="cursor-pointer"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    selectWire(w.id);
                  }}
                />
              </g>
            );
          })}

          {/* pending wire */}
          {pendingWire && (
            <path
              d={wirePath(pendingWire, pendingWire)}
              fill="none"
              stroke={WIRE_COLOR_HEX.green}
              strokeWidth={2}
              strokeDasharray="6 4"
              opacity={0.9}
            />
          )}
          {pendingWire &&
            (() => {
              const from = pointFor(doc, pendingWire.from.part, pendingWire.from.pin);
              if (!from) return null;
              return (
                <path
                  d={wirePath(from, { x: pendingWire.x, y: pendingWire.y })}
                  fill="none"
                  stroke="#00b4d8"
                  strokeWidth={2.5}
                  strokeDasharray="6 5"
                />
              );
            })()}

          {/* parts */}
          {doc.diagram.parts.map((inst) => {
            const def = getPart(inst.type);
            if (!def) return null;
            const h = partHeight(def);
            const isSelected = selection === inst.id;
            const faulted = faultParts.has(inst.id);
            const warned = warnParts.has(inst.id);
            return (
              <g
                key={inst.id}
                transform={`translate(${inst.x} ${inst.y})`}
                onMouseDown={(e) => onPartDown(e, inst)}
                className="cursor-move"
              >
                <rect
                  x={-3}
                  y={-3}
                  width={PART_WIDTH + 6}
                  height={h + 6}
                  rx={12}
                  fill={faulted ? 'rgba(230,57,70,0.16)' : 'transparent'}
                  stroke={
                    faulted
                      ? 'var(--color-fault)'
                      : warned
                        ? 'var(--color-warn)'
                        : isSelected
                          ? 'var(--color-accent)'
                          : 'transparent'
                  }
                  strokeWidth={2}
                  className={faulted ? 'diag-pulse' : undefined}
                />
                <rect
                  x={0}
                  y={0}
                  width={PART_WIDTH}
                  height={h}
                  rx={10}
                  fill="var(--color-surface-2)"
                  stroke={isSelected ? 'var(--color-accent)' : 'var(--color-border-strong)'}
                  strokeWidth={1.25}
                />
                <rect x={0} y={0} width={PART_WIDTH} height={22} rx={10} fill="rgba(0,180,216,0.10)" />
                <text x={10} y={15} fontSize={11.5} fontWeight={600} fill="var(--color-text)">
                  {truncate(def.name, 17)}
                </text>

                <PartGlyph
                  def={def}
                  inst={inst}
                  state={states[inst.id]}
                  width={PART_WIDTH}
                  height={h}
                />

                {/* pins */}
                {def.pins.map((pin) => {
                  const off = pinOffset(def, pin.name);
                  if (!off) return null;
                  const hovered = hoverPin === `${inst.id}:${pin.name}`;
                  return (
                    <g key={pin.name}>
                      <circle
                        cx={off.dx}
                        cy={off.dy}
                        r={hovered ? 6 : 4.5}
                        fill={PIN_COLOR[pin.electrical]}
                        stroke="var(--color-bg)"
                        strokeWidth={1.5}
                        className="cursor-crosshair"
                        onMouseDown={(e) => onPinDown(e, inst, pin.name)}
                        onMouseEnter={() => setHoverPin(`${inst.id}:${pin.name}`)}
                        onMouseLeave={() => setHoverPin(null)}
                      />
                      {(hovered || pendingWire) && (
                        <text
                          x={off.dx + (off.dx === 0 ? 10 : -10)}
                          y={off.dy + 3.5}
                          fontSize={9.5}
                          textAnchor={off.dx === 0 ? 'start' : 'end'}
                          fill="var(--color-text-dim)"
                          pointerEvents="none"
                        >
                          {pin.name}
                        </text>
                      )}
                    </g>
                  );
                })}

                <text
                  x={PART_WIDTH - 8}
                  y={h - 5}
                  fontSize={8.5}
                  textAnchor="end"
                  fill="var(--color-text-faint)"
                  pointerEvents="none"
                >
                  {FIDELITY_LABEL[def.fidelity.tier]}
                </text>
              </g>
            );
          })}

          {/* remote editors' live selections (presence only, never persisted) */}
          <PeerGhosts parts={doc.diagram.parts} peers={peers} />

          {/* open room comments per part (room annotations, never persisted) */}
          <CommentBadges parts={doc.diagram.parts} counts={commentCounts} />

          {/* wire target ghosts */}
          {pendingWire &&
            ghostTargets.map(({ inst, def, pin }) => {
              const off = pinOffset(def, pin.name);
              if (!off) return null;
              return (
                <circle
                  key={`${inst.id}:${pin.name}`}
                  cx={inst.x + off.dx}
                  cy={inst.y + off.dy}
                  r={7}
                  fill="none"
                  stroke="#00b4d8"
                  strokeWidth={1.5}
                  opacity={0.55}
                  pointerEvents="none"
                />
              );
            })}
        </g>
      </svg>

      <div className="absolute right-3 top-3 flex items-center gap-1.5">
        <label className="btn btn-sm cursor-pointer">
          <ImageIcon size={12} /> {t('photoTrace')}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              onPhotoFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        {photo && (
          <>
            <label className="panel-2 flex items-center gap-1.5 px-2 py-1 text-[11px] text-[var(--color-text-dim)]">
              {t('photoOpacity')}
              <input
                type="range"
                min={10}
                max={90}
                value={photo.opacity}
                onChange={(e) => setPhoto((prev) => (prev ? { ...prev, opacity: Number(e.target.value) } : prev))}
                aria-label={t('photoOpacity')}
              />
            </label>
            <button type="button" className="btn btn-sm" onClick={removePhoto}>
              {t('photoRemove')}
            </button>
          </>
        )}
      </div>
      {photo && (
        <p role="note" className="panel-2 pointer-events-none absolute left-1/2 top-3 max-w-md -translate-x-1/2 px-2.5 py-1 text-[10.5px] leading-snug text-[var(--color-text-dim)]">
          {t('photoTraceHint')}
        </p>
      )}

      <div className="pointer-events-none absolute bottom-3 left-3 flex items-center gap-2 text-[11px] text-[var(--color-text-faint)]">
        <span className="panel-2 px-2 py-1">
          {doc.diagram.parts.length} parts · {doc.diagram.connections.length} wires
        </span>
        <span className="panel-2 px-2 py-1">R rotate · Del remove · Space pan · wheel zoom</span>
      </div>
      <button className="btn btn-sm absolute bottom-3 right-3" onClick={fit} type="button">
        Fit
      </button>
    </div>
  );
}

function pointFor(doc: ProjectDoc, partId: string, pin: string): { x: number; y: number } | null {
  const inst = doc.diagram.parts.find((p) => p.id === partId);
  if (!inst) return null;
  const def = getPart(inst.type);
  if (!def) return null;
  return pinPosition(inst, def, pin);
}

function truncate(text: string, n: number): string {
  return text.length <= n ? text : `${text.slice(0, n - 1)}…`;
}
