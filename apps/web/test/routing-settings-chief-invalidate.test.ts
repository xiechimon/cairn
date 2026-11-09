import { describe, expect, it } from 'vitest';
import { routingRuleInvalidateKeys } from '../src/api/routing-settings.js';

describe('routingRuleInvalidateKeys', () => {
  it('includes chief when the Coordinator routing rule changes', () => {
    expect(routingRuleInvalidateKeys('team-1', 'coordinator')).toEqual([
      ['routing-settings', 'team-1'],
      ['chief', 'team-1'],
    ]);
  });

  it('leaves chief cached when a non-Coordinator rule changes', () => {
    expect(routingRuleInvalidateKeys('team-1', 'session')).toEqual([
      ['routing-settings', 'team-1'],
    ]);
  });
});
