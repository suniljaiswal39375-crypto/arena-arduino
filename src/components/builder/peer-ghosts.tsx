'use client';

import type { PeerInfo } from '@/lib/collab/session';
import { PART_WIDTH, partHeight } from '@/lib/canvas/geometry';
import { getPart } from '@/lib/parts';
import type { PartInstance } from '@/lib/doc/types';

/**
 * Remote selection ghosts: for every peer that currently has a part
 * selected, draw that peer's colour as a dashed halo around the part plus a
 * name tag. Pure presence data — never part of the document, never
 * persisted. Read-only overlay (pointer events off).
 */
export function PeerGhosts({ parts, peers }: { parts: PartInstance[]; peers: PeerInfo[] }) {
  const byPart = new Map<string, PeerInfo[]>();
  for (const peer of peers) {
    if (!peer.selectedPartId) continue;
    const list = byPart.get(peer.selectedPartId) ?? [];
    list.push(peer);
    byPart.set(peer.selectedPartId, list);
  }

  const ghosts = parts.flatMap((inst) => {
    const viewers = byPart.get(inst.id);
    if (!viewers) return [];
    const def = getPart(inst.type);
    if (!def) return [];
    const h = partHeight(def);
    return [
      <g key={inst.id} transform={`translate(${inst.x} ${inst.y})`}>
        {viewers.map((peer, i) => (
          <rect
            key={`ring:${peer.clientId}`}
            x={-8 - i * 4}
            y={-8 - i * 4}
            width={PART_WIDTH + 16 + i * 8}
            height={h + 16 + i * 8}
            rx={14}
            fill="none"
            stroke={peer.color}
            strokeWidth={1.5}
            strokeDasharray="4 4"
          />
        ))}
        {viewers.map((peer, i) => (
          <g key={`tag:${peer.clientId}`} transform={`translate(${PART_WIDTH + 12} ${-8 + i * 16})`}>
            <rect x={0} y={-11} width={Math.min(24, Math.max(2, peer.name.length)) * 6.5 + 12} height={15} rx={7} fill={peer.color} />
            <text x={6} y={1} fontSize={10} fontWeight={600} fill="#081018">
              {peer.name.slice(0, 24)}
            </text>
          </g>
        ))}
      </g>,
    ];
  });

  if (ghosts.length === 0) return null;
  return (
    <g pointerEvents="none" aria-hidden="true">
      {ghosts}
    </g>
  );
}
