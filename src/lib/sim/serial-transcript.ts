import type { SerialLine } from './runtime';

/**
 * Session-long serial transcript assembled on the UI side of the sim client.
 *
 * The engines keep a bounded window of the most recent lines (so the worker
 * can never grow without limit); this module folds each window into a longer
 * session view using the engine's lifetime line counter. Lines the engine
 * emitted between two snapshots — or that fall off the view cap — are counted
 * in `dropped`, never silently forgotten.
 */

/** How many lines the Serial panel retains for one session. */
export const SERIAL_VIEW_CAP = 2000;

export interface SerialTranscriptState {
  /** Lifetime line count reported by the last snapshot folded in. */
  seen: number;
  /** Lines that left the retained view: view-cap evictions plus snapshot gaps. */
  dropped: number;
  /** Retained lines — the tail of the session log, in order. */
  lines: SerialLine[];
}

export function emptySerialTranscript(): SerialTranscriptState {
  return { seen: 0, dropped: 0, lines: [] };
}

/**
 * Fold one engine window into the transcript. The window holds the engine's
 * most recent lines; `total` is how many lines the engine has ever printed
 * (it restarts from zero when a project is loaded).
 */
export function accumulateSerial(
  state: SerialTranscriptState,
  window: SerialLine[],
  total: number,
  cap: number = SERIAL_VIEW_CAP,
): SerialTranscriptState {
  // The engine restarted (fresh load, or fewer lifetime lines than before):
  // the old transcript belongs to a different run.
  if (total < state.seen) return retain({ seen: total, dropped: 0, lines: [...window] }, cap);
  if (window.length === 0) return state.seen === total ? state : { ...state, seen: total };

  const windowStart = total - window.length;
  // Lines already retained end at `state.seen`; skip that prefix of the window.
  const skip = Math.max(0, state.seen - windowStart);
  const fresh = skip < window.length ? window.slice(skip) : [];
  // Lines printed between snapshots that no longer exist in the window were
  // never seen here; account for them honestly.
  const gap = Math.max(0, windowStart - state.seen);
  return retain(
    {
      seen: total,
      dropped: state.dropped + gap,
      lines: fresh.length > 0 ? state.lines.concat(fresh) : state.lines,
    },
    cap,
  );
}

function retain(state: SerialTranscriptState, cap: number): SerialTranscriptState {
  if (state.lines.length <= cap) return state;
  const overflow = state.lines.length - cap;
  return {
    seen: state.seen,
    dropped: state.dropped + overflow,
    lines: state.lines.slice(overflow),
  };
}
