/**
 * Session-scoped AI audit log (spec §12.8: an AI-usage audit log).
 *
 * Deliberately in-memory only: it survives this page's lifetime so a student
 * (or a supervising teacher) can see exactly what the mentor did, and it
 * deliberately never reaches localStorage, ProjectDoc or any backend — the
 * privacy rule forbids persisting traces of student questions.
 */

export type AuditKind =
  | 'ask'
  | 'plan'
  | 'tool'
  | 'commands'
  | 'confirm'
  | 'cancel'
  | 'thumbs-down'
  | 'fallback'
  | 'rate-limited'
  | 'gateway-error';

export interface AuditEntry {
  at: number;
  kind: AuditKind;
  /** Short human-readable summary; never the raw student text. */
  detail: string;
}

const MAX_ENTRIES = 200;
let entries: AuditEntry[] = [];

export function recordAudit(kind: AuditKind, detail: string): void {
  entries.push({ at: Date.now(), kind, detail });
  if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
}

export function auditLog(): readonly AuditEntry[] {
  return entries;
}

export function clearAudit(): void {
  entries = [];
}

/** Count of thumbs-down in this session — the prompt-regression signal. */
export function thumbsDownCount(): number {
  return entries.filter((e) => e.kind === 'thumbs-down').length;
}
