import {
  applyClaudeRateLimit,
  CLAUDE_RATE_LIMIT_UNKNOWN_PROBE_MS,
  CLAUDE_RATE_LIMIT_UNSPECIFIED,
  type ClaudeRateLimitWindow,
  claudeRateBlock,
  claudeRateProbeAt,
  normalizeClaudeResetsAt,
  subscriptionKeyOf,
} from '@cairn/shared';
import { describe, expect, test } from 'vitest';

const HOUR = 60 * 60 * 1000;

function window(
  subscription: string,
  status: ClaudeRateLimitWindow['status'],
  resetsAt: number | null,
  reportedAt = 1,
): ClaudeRateLimitWindow {
  return { subscription, status, utilization: 1, resetsAt, reportedAt };
}

describe('claude rate limit windows', () => {
  test('unix seconds and epoch milliseconds both become epoch milliseconds', () => {
    expect(normalizeClaudeResetsAt(1_700_000_000)).toBe(1_700_000_000_000);
    expect(normalizeClaudeResetsAt(1_700_000_000_000)).toBe(1_700_000_000_000);
    expect(normalizeClaudeResetsAt(1_700_000_000.5)).toBe(1_700_000_000_500);
    expect(normalizeClaudeResetsAt(undefined)).toBeNull();
    expect(normalizeClaudeResetsAt(Number.NaN)).toBeNull();
    expect(normalizeClaudeResetsAt(Number.POSITIVE_INFINITY)).toBeNull();
    expect(normalizeClaudeResetsAt(0)).toBeNull();
    expect(normalizeClaudeResetsAt(-5)).toBeNull();
  });

  test('a missing rate limit type is stored as unspecified and does not clobber a named window', () => {
    const named = applyClaudeRateLimit(
      [],
      { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 2_000, utilization: 1 },
      100,
    );
    const both = applyClaudeRateLimit(named, { status: 'allowed' }, 101);
    expect(subscriptionKeyOf(undefined)).toBe(CLAUDE_RATE_LIMIT_UNSPECIFIED);
    expect(subscriptionKeyOf('   ')).toBe(CLAUDE_RATE_LIMIT_UNSPECIFIED);
    expect(both).toEqual([
      expect.objectContaining({ subscription: 'five_hour', status: 'rejected', resetsAt: 2_000 }),
      expect.objectContaining({ subscription: 'unspecified', status: 'allowed', resetsAt: null }),
    ]);
  });

  test('a later report for the same window replaces the earlier one', () => {
    const first = applyClaudeRateLimit(
      [],
      { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 5_000, utilization: 0.9 },
      100,
    );
    const next = applyClaudeRateLimit(
      first,
      { status: 'allowed', rateLimitType: 'five_hour', utilization: 0.2 },
      200,
    );
    expect(next).toEqual([
      {
        subscription: 'five_hour',
        status: 'allowed',
        utilization: 0.2,
        resetsAt: null,
        reportedAt: 200,
      },
    ]);
  });

  test('rejected blocks until the later reset; allowed and warning do not block', () => {
    const now = 10_000;
    const rejected = [window('five_hour', 'rejected', now + HOUR)];
    expect(claudeRateBlock(rejected, now)).toEqual({
      until: now + HOUR,
      subscription: 'five_hour',
    });
    expect(claudeRateBlock(rejected, now + HOUR)).toBeNull();
    expect(claudeRateBlock([window('five_hour', 'allowed', now + HOUR)], now)).toBeNull();
    expect(claudeRateBlock([window('five_hour', 'allowed_warning', now + HOUR)], now)).toBeNull();
    const two = applyClaudeRateLimit(
      rejected,
      { status: 'rejected', rateLimitType: 'seven_day', resetsAt: now + 2 * HOUR },
      now,
    );
    expect(claudeRateBlock(two, now)).toEqual({
      until: now + 2 * HOUR,
      subscription: 'seven_day',
    });
  });

  test('an unknown end dominates a known future reset and probes a week out', () => {
    const now = 10_000;
    const windows = [
      window('five_hour', 'rejected', now + HOUR),
      window('seven_day', 'rejected', null),
    ];
    const block = claudeRateBlock(windows, now);
    expect(block).toEqual({ until: null, subscription: 'seven_day' });
    if (block === null) throw new Error('expected a claude rate block');
    expect(claudeRateProbeAt(block, now)).toBe(now + CLAUDE_RATE_LIMIT_UNKNOWN_PROBE_MS);
    expect(claudeRateProbeAt({ until: now + HOUR, subscription: 'five_hour' }, now)).toBe(
      now + HOUR,
    );
  });

  test('an unknown rate limit type string is kept and seconds are normalized on apply', () => {
    const windows = applyClaudeRateLimit(
      [],
      {
        status: 'rejected',
        rateLimitType: 'seven_day_overage_included',
        resetsAt: 1_700_000_000,
        utilization: 0.5,
      },
      10,
    );
    expect(windows).toEqual([
      {
        subscription: 'seven_day_overage_included',
        status: 'rejected',
        utilization: 0.5,
        resetsAt: 1_700_000_000_000,
        reportedAt: 10,
      },
    ]);
  });
});
