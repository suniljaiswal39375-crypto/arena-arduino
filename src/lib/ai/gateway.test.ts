import { describe, expect, it } from 'vitest';
import { mentorGatewayEnabled, mentorEndpoint } from './gateway';

/**
 * The client always talks to the same-origin route (or an operator-set
 * endpoint). These tests pin the zero-config behaviour: the flag is off and
 * the endpoint is local, so nothing can call a third-party model host without
 * an operator turning it on explicitly.
 */

describe('gateway client configuration', () => {
  it('defaults to disabled (deterministic planner only)', () => {
    // The sandbox does not set NEXT_PUBLIC_FEATURE_MENTOR.
    expect(mentorGatewayEnabled()).toBe(false);
  });

  it('defaults to the same-origin mentor route', () => {
    expect(mentorEndpoint()).toBe('/api/mentor');
  });
});
