import { describe, expect, it } from 'vitest';
import { DigitalTrigger } from './trigger';

describe('DigitalTrigger', () => {
  it('triggers immediately when mode is none', () => {
    const trigger = new DigitalTrigger({ mode: 'none' });
    expect(trigger.check(100, '0')).toBe(true);
    expect(trigger.triggered).toBe(true);
  });

  it('detects a rising edge from 0 to 1', () => {
    const trigger = new DigitalTrigger({ mode: 'edge', slope: 'rising' });
    expect(trigger.check(100, '0')).toBe(false);
    expect(trigger.triggered).toBe(false);

    expect(trigger.check(200, '0')).toBe(false);
    expect(trigger.triggered).toBe(false);

    expect(trigger.check(300, '1')).toBe(true);
    expect(trigger.triggered).toBe(true);
    expect(trigger.triggerTime).toBe(300);

    // Stays triggered
    expect(trigger.check(400, '0')).toBe(true);
  });

  it('detects a falling edge from 1 to 0', () => {
    const trigger = new DigitalTrigger({ mode: 'edge', slope: 'falling' });
    expect(trigger.check(100, '1')).toBe(false);
    expect(trigger.check(200, '1')).toBe(false);
    expect(trigger.check(300, '0')).toBe(true);
    expect(trigger.triggered).toBe(true);
    expect(trigger.triggerTime).toBe(300);
  });

  it('detects level trigger on target level', () => {
    const trigger = new DigitalTrigger({ mode: 'level', level: '1' });
    expect(trigger.check(50, '0')).toBe(false);
    expect(trigger.check(100, '1')).toBe(true);
    expect(trigger.triggered).toBe(true);
    expect(trigger.triggerTime).toBe(100);
  });

  it('resets correctly', () => {
    const trigger = new DigitalTrigger({ mode: 'edge', slope: 'rising' });
    trigger.check(100, '0');
    trigger.check(200, '1');
    expect(trigger.triggered).toBe(true);

    trigger.reset();
    expect(trigger.triggered).toBe(false);
    expect(trigger.triggerTime).toBeNull();
  });
});
