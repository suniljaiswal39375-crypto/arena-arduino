'use client';

import { useCallback, useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { useI18n } from '@/lib/i18n/client';
import { useLab } from '@/store/lab';
import {
  collabState,
  startCollab,
  stopCollab,
  subscribeCollab,
  type CollabBridgeState,
} from '@/store/collab';
import { cn } from '@/lib/cn';

/**
 * The Co-Lab rail panel (spec §15, foundation slice). Loaded lazily by the
 * builder shell so yjs stays out of the first-load bundle, and only rendered
 * when NEXT_PUBLIC_FEATURE_MULTIPLAYER is on.
 *
 * Honesty rules baked into the UI: the built-in transport is the browser's
 * BroadcastChannel, so a room reaches other tabs/windows of THIS browser
 * profile and nothing beyond it. That is stated in the panel, not implied.
 * Presence is session-only; nothing here persists.
 */
export default function CoLabPanel() {
  const { t } = useI18n();
  const doc = useLab((s) => s.doc);
  const [bridge, setBridge] = useState<CollabBridgeState>(() => collabState());
  const [name, setName] = useState('');
  const [room, setRoom] = useState('');

  useEffect(() => subscribeCollab(setBridge), []);
  // Default the room to the project id every time the panel re-mounts, but
  // never fight the user's typing.
  useEffect(() => {
    setRoom((current) => (current === '' ? doc.id : current));
  }, [doc.id]);

  const active = bridge.status === 'active' || bridge.status === 'connecting';

  const join = useCallback(() => {
    const trimmedRoom = room.trim() || doc.id;
    const trimmedName = name.trim() || t('colabNamePlaceholder');
    void startCollab({ room: trimmedRoom, name: trimmedName });
  }, [room, name, doc.id, t]);

  return (
    <div className="flex h-full flex-col gap-3 p-3 text-sm">
      <div className="flex items-center gap-2">
        <Users size={15} aria-hidden />
        <h2 className="font-semibold">{t('colabTitle')}</h2>
      </div>
      <p className="text-[13px] text-[var(--color-muted)]">{t('colabIntro')}</p>

      {bridge.status === 'unsupported' && (
        <p role="status" className="rounded border border-[var(--color-warn)] p-2 text-[13px]">
          {t('colabUnsupported')}
        </p>
      )}

      {!active && bridge.status !== 'unsupported' && (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-[13px]">
            <span>{t('colabName')}</span>
            <input
              className="input"
              value={name}
              placeholder={t('colabNamePlaceholder')}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1 text-[13px]">
            <span>{t('colabRoom')}</span>
            <input
              className="input"
              value={room}
              placeholder={doc.id}
              maxLength={80}
              onChange={(e) => setRoom(e.target.value)}
            />
          </label>
          <button type="button" className="btn btn-primary self-start" onClick={join}>
            {t('colabJoin')}
          </button>
        </div>
      )}

      {active && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[12px]" title={bridge.room ?? undefined}>
              {bridge.room}
            </span>
            <button type="button" className="btn" onClick={() => stopCollab()}>
              {t('colabLeave')}
            </button>
          </div>
          {bridge.status === 'connecting' && (
            <p role="status" className="text-[13px] text-[var(--color-muted)]">
              {t('colabConnecting')}
            </p>
          )}

          <h3 className="mt-1 text-[13px] font-semibold">{t('colabPeers')}</h3>
          {bridge.peers.length === 0 ? (
            <p className="text-[13px] text-[var(--color-muted)]">{t('colabPeersNone')}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {bridge.peers.map((peer) => (
                <li key={peer.clientId} className="flex items-center gap-2 text-[13px]">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: peer.color }}
                  />
                  <span className={cn('truncate', peer.selectedPartId && 'font-medium')}>
                    {peer.name}
                  </span>
                  {peer.selectedPartId && (
                    <span className="font-mono text-[11px] text-[var(--color-muted)]">
                      {peer.selectedPartId}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="mt-auto text-[12px] text-[var(--color-muted)]">{t('colabNote')}</p>
    </div>
  );
}
