import { describe, expect, it } from 'vitest';
import { claudeQuotaTrip, claudeRateLimitReport } from '../src/claude-quota-trip.js';

describe('claudeRateLimitReport', () => {
  it('carries only the fields the notice has', () => {
    expect(claudeRateLimitReport('machine-1', { status: 'allowed' })).toEqual({
      machineId: 'machine-1',
      status: 'allowed',
    });
  });

  it('passes the limit type, utilization and reset time through', () => {
    expect(
      claudeRateLimitReport('machine-1', {
        status: 'rejected',
        rateLimitType: 'five_hour',
        utilization: 1,
        resetsAt: 1_800_000_000,
      }),
    ).toEqual({
      machineId: 'machine-1',
      status: 'rejected',
      rateLimitType: 'five_hour',
      utilization: 1,
      resetsAt: 1_800_000_000,
    });
  });
});

describe('claudeQuotaTrip', () => {
  const nowMs = 1_700_000_000_000;

  it('does not trip on a notice that is not rejected', () => {
    expect(claudeQuotaTrip({ status: 'allowed' }, nowMs)).toBeNull();
    expect(claudeQuotaTrip({ status: 'allowed_warning' }, nowMs)).toBeNull();
  });

  it('waits until a reset time in the future, given in seconds', () => {
    const trip = claudeQuotaTrip(
      { status: 'rejected', rateLimitType: 'five_hour', resetsAt: 1_700_000_060 },
      nowMs,
    );
    expect(trip?.kind).toBe('quota');
    expect(trip?.retryAfterMs).toBe(60_000);
    expect(trip?.reason).toMatch(/^Claude subscription .+ rejected$/);
  });

  it('has no wait when the reset time is missing or already past', () => {
    expect(claudeQuotaTrip({ status: 'rejected' }, nowMs)?.retryAfterMs).toBeNull();
    expect(
      claudeQuotaTrip({ status: 'rejected', resetsAt: 1_699_999_000 }, nowMs)?.retryAfterMs,
    ).toBeNull();
  });
});
