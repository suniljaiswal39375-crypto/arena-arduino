'use client';

import { useCallback, useEffect, useState } from 'react';
import { Users } from 'lucide-react';
import { useI18n } from '@/lib/i18n/client';
import { useLab } from '@/store/lab';
import {
  collabSession,
  collabState,
  collabWsUrl,
  setCollabRole,
  startCollab,
  stopCollab,
  subscribeCollab,
  type CollabBridgeState,
  type CollabMode,
} from '@/store/collab';
import type { CollabRole } from '@/lib/collab/session';
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
  const [mode, setMode] = useState<CollabMode>('local');
  const [role, setRole] = useState<CollabRole>('editor');
  const serverUrl = collabWsUrl();

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
    // Server mode only makes sense with a relay configured; otherwise fall
    // back to the zero-config same-browser transport.
    const effectiveMode: CollabMode = mode === 'server' && serverUrl ? 'server' : 'local';
    void startCollab({ room: trimmedRoom, name: trimmedName, mode: effectiveMode, role });
  }, [room, name, doc.id, t, mode, serverUrl, role]);

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
          <div className="flex flex-col gap-1 text-[13px]">
            <span>{t('colabMode')}</span>
            <div className="flex gap-3">
              <label className="flex items-center gap-1">
                <input
                  type="radio"
                  name="colab-mode"
                  checked={mode === 'local'}
                  onChange={() => setMode('local')}
                />
                {t('colabModeLocal')}
              </label>
              {serverUrl ? (
                <label className="flex items-center gap-1">
                  <input
                    type="radio"
                    name="colab-mode"
                    checked={mode === 'server'}
                    onChange={() => setMode('server')}
                  />
                  {t('colabModeServer')}
                </label>
              ) : null}
            </div>
            {mode === 'server' && serverUrl ? (
              <p className="text-[12px] text-[var(--color-muted)]">{t('colabModeServerHint')}</p>
            ) : null}
          </div>
          <div className="flex flex-col gap-1 text-[13px]">
            <span>{t('colabRole')}</span>
            <div className="flex gap-3">
              <label className="flex items-center gap-1">
                <input type="radio" name="colab-role" checked={role === 'editor'} onChange={() => setRole('editor')} />
                {t('colabRoleEditor')}
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" name="colab-role" checked={role === 'viewer'} onChange={() => setRole('viewer')} />
                {t('colabRoleViewer')}
              </label>
            </div>
          </div>
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
          <div className="flex items-center gap-2 text-[12.5px]">
            <span>{t('colabRole')}:</span>
            <button type="button" className="btn btn-sm" onClick={() => setCollabRole(bridge.role === 'viewer' ? 'editor' : 'viewer')}>
              {bridge.role === 'viewer' ? t('colabRoleViewer') : t('colabRoleEditor')}
            </button>
          </div>
          {bridge.role === 'viewer' && (
            <p role="status" className="rounded border border-[var(--color-warn)] p-2 text-[12.5px]">
              {t('colabViewOnlyNote')}
            </p>
          )}
          {bridge.status === 'connecting' && (
            <p role="status" className="text-[13px] text-[var(--color-muted)]">
              {t('colabConnecting')}
            </p>
          )}
          {bridge.mode === 'server' && bridge.link && bridge.link !== 'open' && (
            <p role="status" className="text-[13px] text-[var(--color-warn)]">
              {t('colabRelayStatus')}: {bridge.link}
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
                    {peer.role === 'viewer' ? ` (${t('colabViewing')})` : ''}
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

          <h3 className="mt-1 text-[13px] font-semibold">{t('colabComments')}</h3>
          <CommentsForSelection />
        </div>
      )}

      <p className="mt-auto text-[12px] text-[var(--color-muted)]">{t('colabNote')}</p>
    </div>
  );
}

/**
 * The room's comment thread for the currently selected part. Comments live
 * only in the shared room document: they are annotations for the people in
 * the room, never circuit state, never written to the saved project.
 */
function CommentsForSelection() {
  const { t } = useI18n();
  const selection = useLab((s) => s.selection);
  const [bridge, setBridge] = useState<CollabBridgeState>(() => collabState());
  const [draft, setDraft] = useState('');
  useEffect(() => subscribeCollab(setBridge), []);

  if (!selection) {
    return <p className="text-[13px] text-[var(--color-muted)]">{t('colabCommentsNoSelection')}</p>;
  }
  const thread = bridge.comments[selection] ?? [];

  const post = (): void => {
    collabSession()?.addComment(selection, draft);
    setDraft('');
  };

  return (
    <div className="flex flex-col gap-2">
      {thread.length === 0 ? (
        <p className="text-[13px] text-[var(--color-muted)]">{t('colabCommentsNone')}</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {thread.map((c) => (
            <li
              key={c.id}
              className={cn('rounded-md border border-[var(--color-border)] p-2 text-[12.5px] leading-relaxed', c.resolved && 'opacity-60')}
            >
              <div className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: c.color }} />
                <span className="font-medium">{c.author}</span>
                <button
                  type="button"
                  className="btn btn-sm ml-auto"
                  onClick={() => collabSession()?.setCommentResolved(selection, c.id, !c.resolved)}
                >
                  {c.resolved ? t('colabCommentReopen') : t('colabCommentResolve')}
                </button>
              </div>
              <p className={cn('mt-1', c.resolved && 'line-through')}>{c.text}</p>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-1.5">
        <input
          className="input min-w-0 flex-1"
          value={draft}
          maxLength={500}
          placeholder={t('colabCommentPlaceholder')}
          aria-label={t('colabCommentsAria', { id: selection })}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') post();
          }}
        />
        <button type="button" className="btn btn-sm" onClick={post} disabled={draft.trim() === ''}>
          {t('colabCommentAdd')}
        </button>
      </div>
    </div>
  );
}
