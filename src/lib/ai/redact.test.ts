import { describe, expect, it } from 'vitest';
import { containsPII, redactPII } from './redact';

describe('redactPII', () => {
  it('redacts email addresses', () => {
    const out = redactPII('mail me at aarav.sharma@panchkula.edu.in for the photo');
    expect(out).toContain('[email]');
    expect(out).not.toContain('aarav.sharma');
    expect(containsPII(out)).toBe(false);
  });

  it('redacts phone numbers but not pin numbers', () => {
    expect(redactPII('call me on +91 98765 43210')).toContain('[phone]');
    expect(redactPII('my number is 9876543210')).toContain('[phone]');
    // Pin numbers and small integers must survive.
    expect(redactPII('wire D13 to pin 2 and use 220 ohm')).toBe('wire D13 to pin 2 and use 220 ohm');
  });

  it('redacts @handles', () => {
    expect(redactPII('ping @aarav_tinker about it')).toContain('[handle]');
    expect(redactPII('the resistor R1 @ 5V heats up')).toBe('the resistor R1 @ 5V heats up');
  });

  it('redacts self-introductions in English and Hindi', () => {
    expect(redactPII('my name is Aarav and I am stuck')).toContain('[name]');
    expect(redactPII('my name is Aarav and I am stuck')).not.toContain('Aarav');
    expect(redactPII('मेरा नाम आरव है और मैं फंस गया हूँ')).toContain('[name]');
    expect(redactPII('मेरा नाम आरव है और मैं फंस गया हूँ')).not.toContain('आरव');
  });

  it('strips credentialed URLs but keeps plain domains', () => {
    expect(redactPII('fetch https://user:secret@example.com/data?x=12345678')).toContain('[url]');
    expect(redactPII('see example.com/docs')).toBe('see example.com/docs');
  });

  it('leaves technical content untouched', () => {
    const sketch = 'void loop() { Serial.println(analogRead(A0)); delay(500); }';
    expect(redactPII(sketch)).toBe(sketch);
  });
});
