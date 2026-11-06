import { describe, expect, test } from 'vitest';
import { routingRulesFlagOn } from '../src/routing-flag.js';

describe('routingRulesFlagOn', () => {
  test.each([undefined, '', '1', 'true', 'TRUE', 'yes', 'on', 'anything-else'])(
    '%s leaves the routing path on',
    (raw) => {
      expect(routingRulesFlagOn(raw)).toBe(true);
    },
  );

  test.each(['0', 'false', 'FALSE', 'no', 'off', ' 0 '])('%s switches it off', (raw) => {
    expect(routingRulesFlagOn(raw)).toBe(false);
  });
});
