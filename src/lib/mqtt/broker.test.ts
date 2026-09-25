import { describe, expect, it } from 'vitest';
import { MAX_HISTORY, MqttBroker, topicMatches, validatePattern, validateTopic } from './broker';

describe('topicMatches', () => {
  it('matches exact topics and single-level wildcards', () => {
    expect(topicMatches('lab/temp', 'lab/temp')).toBe(true);
    expect(topicMatches('lab/temp', 'lab/humi')).toBe(false);
    expect(topicMatches('lab/+/value', 'lab/temp/value')).toBe(true);
    expect(topicMatches('lab/+/value', 'lab/value')).toBe(false);
    expect(topicMatches('+', 'anything')).toBe(true);
    expect(topicMatches('+', 'a/b')).toBe(false);
  });

  it('matches multi-level wildcards, including the parent itself', () => {
    expect(topicMatches('lab/#', 'lab/temp/value')).toBe(true);
    expect(topicMatches('lab/#', 'lab')).toBe(true);
    expect(topicMatches('lab/#', 'other')).toBe(false);
    expect(topicMatches('#', 'a/b/c')).toBe(true);
  });

  it('rejects "#" that is not the final level by never matching past it', () => {
    expect(topicMatches('lab/#/x', 'lab/x')).toBe(false);
  });
});

describe('validation', () => {
  it('accepts concrete topics and refuses wildcards, empty levels, and size', () => {
    expect(validateTopic('lab/temp')).toBeNull();
    expect(validateTopic('')).toMatch(/empty/);
    expect(validateTopic('lab/#')).toMatch(/wildcards/);
    expect(validateTopic('a//b')).toMatch(/empty level/);
    expect(validateTopic('/lead')).toMatch(/empty level/);
    expect(validateTopic('x'.repeat(257))).toMatch(/longer/);
  });

  it('accepts well-formed patterns and refuses misplaced wildcards', () => {
    expect(validatePattern('lab/+/value')).toBeNull();
    expect(validatePattern('lab/#')).toBeNull();
    expect(validatePattern('#')).toBeNull();
    expect(validatePattern('lab/#/x')).toMatch(/last level/);
    expect(validatePattern('la+b/x')).toMatch(/whole level/);
    expect(validatePattern('')).toMatch(/empty/);
  });
});

describe('MqttBroker', () => {
  it('delivers to matching subscribers only, in publish order', () => {
    const broker = new MqttBroker();
    const seen: string[] = [];
    broker.subscribe('lab/#', (m) => seen.push(`wild:${m.topic}=${m.payload}`));
    broker.subscribe('lab/temp', (m) => seen.push(`exact:${m.payload}`));
    broker.subscribe('other/+', (m) => seen.push(`other:${m.topic}`));

    expect(broker.publish('lab/temp', '21.5').ok).toBe(true);
    expect(broker.publish('lab/humi', '44').ok).toBe(true);
    expect(broker.publish('misc/x', 'y').ok).toBe(true);

    expect(seen).toEqual(['wild:lab/temp=21.5', 'exact:21.5', 'wild:lab/humi=44']);
  });

  it('hands retained messages to late subscribers, and empty retained payload clears', () => {
    const broker = new MqttBroker();
    broker.publish('lab/temp', '20', { retain: true });
    broker.publish('lab/temp', '22', { retain: true });
    broker.publish('lab/humi', '44'); // not retained

    const seen: string[] = [];
    const sub = broker.subscribe('lab/#', (m) => seen.push(`${m.topic}=${m.payload}`));
    expect(seen).toEqual(['lab/temp=22']);

    // Retaining an empty payload removes the stored retained message (MQTT
    // rule), though live subscribers still see the empty message itself.
    broker.publish('lab/temp', '', { retain: true });
    expect(seen).toEqual(['lab/temp=22', 'lab/temp=']);
    const again: string[] = [];
    broker.subscribe('lab/#', (m) => again.push(`${m.topic}=${m.payload}`));
    expect(again).toEqual([]);

    sub.unsubscribe();
    broker.publish('lab/temp', '23');
    expect(seen).toEqual(['lab/temp=22', 'lab/temp=']);
  });

  it('refuses invalid publishes with an actionable reason', () => {
    const broker = new MqttBroker();
    const bad = broker.publish('lab/#', 'x');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/wildcards/);
    const oversized = broker.publish('lab/temp', 'x'.repeat(5000));
    expect(oversized.ok).toBe(false);
    expect(broker.messages()).toHaveLength(0);
  });

  it('bounds history at MAX_HISTORY with a dropped count', () => {
    const broker = new MqttBroker();
    for (let i = 0; i < MAX_HISTORY + 7; i += 1) broker.publish('lab/temp', String(i));
    const msgs = broker.messages();
    expect(msgs).toHaveLength(MAX_HISTORY);
    expect(broker.dropped).toBe(7);
    expect(msgs[0]?.payload).toBe('7');
    expect(msgs[msgs.length - 1]?.payload).toBe(String(MAX_HISTORY + 6));
  });

  it('notifies change listeners and clears on demand', () => {
    const broker = new MqttBroker();
    let changes = 0;
    const stop = broker.listen(() => {
      changes += 1;
    });
    broker.publish('a/b', '1');
    broker.publish('a/b', '2', { retain: true });
    expect(changes).toBe(2);
    expect(broker.retainedTopics()).toEqual(['a/b']);
    broker.clear();
    expect(changes).toBe(3);
    expect(broker.messages()).toHaveLength(0);
    expect(broker.retainedTopics()).toEqual([]);
    stop();
    broker.publish('a/b', '3');
    expect(changes).toBe(3);
  });

  it('rejects invalid subscription patterns instead of half-registering', () => {
    const broker = new MqttBroker();
    expect(() => broker.subscribe('a/#/b', () => {})).toThrow(/last level/);
  });
});
