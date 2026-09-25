/**
 * In-app MQTT topic bus (SparkLab spec §17.1).
 *
 * This is a broker *view* for the lab: a pure, in-memory implementation of
 * MQTT topic semantics — levels, `+` and `#` wildcards, and retained
 * messages — not a network server. Sketches do not model a network stack
 * (documented in DECISIONS.md), so today the bus is fed by `publish-mqtt`
 * scenario steps and by the MQTT dock panel itself; a future networked part
 * can attach here without changing the shape of this module.
 *
 * Everything is bounded and deterministic: no clocks are read, messages are
 * ordered by a sequence number, and history caps at `MAX_HISTORY` with an
 * honest `dropped` counter.
 */

export const MAX_TOPIC_LENGTH = 256;
export const MAX_PAYLOAD_LENGTH = 4096;
export const MAX_HISTORY = 200;

export interface MqttMessage {
  /** Monotonic order of publication, starting at 1. */
  seq: number;
  topic: string;
  payload: string;
  /** Whether the broker keeps this as the retained payload for the topic. */
  retain: boolean;
}

export type MqttPublishResult = { ok: true; message: MqttMessage } | { ok: false; reason: string };

/** A published topic must be concrete: non-empty levels, no wildcards. */
export function validateTopic(topic: string): string | null {
  if (typeof topic !== 'string' || topic.length === 0) return 'topic is empty';
  if (topic.length > MAX_TOPIC_LENGTH) return `topic is longer than ${MAX_TOPIC_LENGTH} characters`;
  if (topic.includes('#') || topic.includes('+')) return 'publish topics cannot contain wildcards';
  if (topic.startsWith('/') || topic.endsWith('/') || topic.includes('//')) return 'topic has an empty level';
  return null;
}

function splitLevels(text: string): string[] {
  return text.split('/');
}

/**
 * MQTT subscription matching: `+` covers exactly one level, a trailing `#`
 * covers the remainder (including zero further levels, so `sport/#` matches
 * `sport` itself).
 */
export function topicMatches(pattern: string, topic: string): boolean {
  const p = splitLevels(pattern);
  const t = splitLevels(topic);
  for (let i = 0; i < p.length; i += 1) {
    const level = p[i] ?? '';
    if (level === '#') return i === p.length - 1;
    if (i >= t.length) return false;
    if (level === '+') continue;
    if (level !== t[i]) return false;
  }
  return p.length === t.length;
}

/** A subscription pattern may use wildcards, but only in valid positions. */
export function validatePattern(pattern: string): string | null {
  if (typeof pattern !== 'string' || pattern.length === 0) return 'pattern is empty';
  if (pattern.length > MAX_TOPIC_LENGTH) return `pattern is longer than ${MAX_TOPIC_LENGTH} characters`;
  const levels = splitLevels(pattern);
  for (let i = 0; i < levels.length; i += 1) {
    const level = levels[i] ?? '';
    if (level === '#') {
      if (i !== levels.length - 1) return '"#" must be the last level of a pattern';
      continue;
    }
    if (level === '+') continue;
    if (level.includes('#') || level.includes('+')) {
      return '"+" and "#" must each occupy a whole level';
    }
    if (level === '' && !(pattern === '/' && levels.length === 2)) return 'pattern has an empty level';
  }
  return null;
}

export interface MqttSubscription {
  pattern: string;
  unsubscribe(): void;
}

/** A bounded in-memory MQTT topic bus. */
export class MqttBroker {
  private history: MqttMessage[] = [];
  private retained = new Map<string, MqttMessage>();
  private subscriptions = new Map<number, { pattern: string; handler: (m: MqttMessage) => void }>();
  private nextSubId = 1;
  private seq = 0;
  private changeListeners = new Set<() => void>();
  dropped = 0;

  /** Publish to a concrete topic. Returns a reason when the publish is refused. */
  publish(topic: string, payload: string, opts: { retain?: boolean } = {}): MqttPublishResult {
    const problem = validateTopic(topic);
    if (problem) return { ok: false, reason: problem };
    if (typeof payload !== 'string') return { ok: false, reason: 'payload must be a string' };
    if (payload.length > MAX_PAYLOAD_LENGTH) {
      return { ok: false, reason: `payload is longer than ${MAX_PAYLOAD_LENGTH} characters` };
    }
    this.seq += 1;
    const message: MqttMessage = { seq: this.seq, topic, payload, retain: opts.retain === true };
    if (message.retain) {
      if (payload === '') this.retained.delete(topic);
      else this.retained.set(topic, message);
    }
    this.history.push(message);
    if (this.history.length > MAX_HISTORY) {
      this.history.shift();
      this.dropped += 1;
    }
    for (const sub of Array.from(this.subscriptions.values())) {
      if (topicMatches(sub.pattern, topic)) sub.handler(message);
    }
    this.notifyChange();
    return { ok: true, message };
  }

  /**
   * Subscribe to a pattern. Matching retained messages are delivered
   * immediately (topic order), as in MQTT. Returns the unsubscribe handle.
   */
  subscribe(pattern: string, handler: (m: MqttMessage) => void): MqttSubscription {
    const problem = validatePattern(pattern);
    if (problem) throw new Error(problem);
    const id = this.nextSubId;
    this.nextSubId += 1;
    this.subscriptions.set(id, { pattern, handler });
    for (const topic of Array.from(this.retained.keys()).sort()) {
      if (topicMatches(pattern, topic)) handler(this.retained.get(topic)!);
    }
    return {
      pattern,
      unsubscribe: () => {
        this.subscriptions.delete(id);
      },
    };
  }

  /** The message log, oldest first, capped at MAX_HISTORY. */
  messages(): readonly MqttMessage[] {
    return this.history;
  }

  /** Topics with a retained payload, sorted. */
  retainedTopics(): readonly string[] {
    return Array.from(this.retained.keys()).sort();
  }

  /** Clear the history and retained store (subscriptions survive). */
  clear(): void {
    this.history = [];
    this.retained.clear();
    this.notifyChange();
  }

  /** UI hook: called after every publish/clear. Returns an unsubscribe. */
  listen(cb: () => void): () => void {
    this.changeListeners.add(cb);
    return () => {
      this.changeListeners.delete(cb);
    };
  }

  private notifyChange(): void {
    for (const cb of Array.from(this.changeListeners)) cb();
  }
}
