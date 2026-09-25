'use client';

import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import { X } from 'lucide-react';
import { useLab } from '@/store/lab';
import { useI18n } from '@/lib/i18n/client';
import { workbenchLayout, CATEGORY_COLORS, type WorkbenchPart } from '@/lib/canvas/workbench3d';
import { PART_CATEGORIES } from '@/lib/parts/types';

/**
 * The 3D workbench (ROADMAP Phase 14): an orbitable viewing aid over the
 * current sheet. This module is only ever imported dynamically (never by the
 * main builder bundle — the performance budget stays intact); the scene data
 * comes from the pure `workbenchLayout`.
 */
export default function Workbench3D({ onClose }: { onClose: () => void }) {
  const { t, locale } = useI18n();
  const doc = useLab((s) => s.doc);
  const selection = useLab((s) => s.selection);
  const select = useLab((s) => s.select);
  const scene = useMemo(() => workbenchLayout(doc, selection), [doc, selection]);

  const partMesh = (part: WorkbenchPart) => (
    <mesh
      key={part.id}
      position={part.position}
      onClick={(e) => {
        e.stopPropagation();
        select(part.selected ? null : part.id);
      }}
    >
      <boxGeometry args={part.size} />
      <meshStandardMaterial
        color={part.color}
        emissive={part.selected ? '#00b4d8' : '#000000'}
        emissiveIntensity={part.selected ? 0.55 : 0}
        roughness={0.65}
        metalness={0.05}
      />
    </mesh>
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/70 p-3 sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('workbench')}
        lang={locale}
        className="panel-2 relative flex min-h-0 flex-1 flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] p-3">
          <h3 className="text-[13.5px] font-semibold">{t('workbench')}</h3>
          <span className="ml-auto" />
          <button type="button" className="btn btn-sm" onClick={onClose} aria-label={t('workbenchClose')}>
            <X size={13} />
          </button>
        </div>

        <div className="min-h-0 flex-1">
          <Canvas camera={{ position: [14, 16, 22], fov: 45 }} aria-label={t('workbench')}>
            <color attach="background" args={['#101418']} />
            <ambientLight intensity={0.75} />
            <directionalLight position={[18, 30, 12]} intensity={1.1} />
            {/* The bench: a plane sized to the sheet plus a hole grid. */}
            <mesh position={[0, -0.5, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <planeGeometry args={[scene.width, scene.depth]} />
              <meshStandardMaterial color="#e9ecef" roughness={0.9} />
            </mesh>
            <gridHelper args={[Math.max(scene.width, scene.depth), Math.round(Math.max(scene.width, scene.depth) / 2.54), '#c1c7cd', '#dee2e6']} position={[0, 0.02, 0]} />
            {scene.parts.map(partMesh)}
            {scene.wires.map((wire) => (
              <Line key={wire.id} points={wire.points} color={wire.color} lineWidth={2.5} />
            ))}
            <OrbitControls makeDefault />
          </Canvas>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--color-border)] p-2.5">
          {PART_CATEGORIES.filter((c) => scene.parts.some((p) => p.category === c)).map((c) => (
            <span key={c} className="flex items-center gap-1.5 text-[11px] text-[var(--color-text-dim)]">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORY_COLORS[c] }} />
              {c}
            </span>
          ))}
          <span className="ml-auto text-[10.5px] leading-snug text-[var(--color-text-faint)]">{t('workbenchHint')}</span>
        </div>
      </div>
    </div>
  );
}
