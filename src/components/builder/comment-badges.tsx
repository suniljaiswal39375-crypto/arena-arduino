'use client';

import { PART_WIDTH } from '@/lib/canvas/geometry';
import type { PartInstance } from '@/lib/doc/types';

/**
 * Open-comment count badges, top-right corner of each part that has any.
 * Room annotation data only — never part of the document, never persisted.
 */
export function CommentBadges({ parts, counts }: { parts: PartInstance[]; counts: Record<string, number> }) {
  const marked = parts.filter((p) => (counts[p.id] ?? 0) > 0);
  if (marked.length === 0) return null;
  return (
    <g pointerEvents="none" aria-hidden="true">
      {marked.map((inst) => (
        <g key={inst.id} transform={`translate(${inst.x + PART_WIDTH - 2} ${inst.y - 2})`}>
          <circle r={9} fill="#ffb703" stroke="#081018" strokeWidth={1.5} />
          <text x={0} y={3.5} fontSize={10} fontWeight={700} textAnchor="middle" fill="#081018">
            {Math.min(9, counts[inst.id] ?? 0)}
          </text>
        </g>
      ))}
    </g>
  );
}
