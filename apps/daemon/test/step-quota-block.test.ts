import type { ProviderConfig } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { stepQuotaBlock } from '../src/step-quota-block.js';

const provider = { kind: 'api_key', providerId: 'anthropic', label: 'Team key' } as ProviderConfig;
const base = { provider, quotaTrip: null, stopped: false, processCrash: false, failureText: null };

describe('stepQuotaBlock', () => {
  test('a quota trip wins over the failure text and keeps its retry delay', () => {
    expect(
      stepQuotaBlock({
        ...base,
        quotaTrip: { kind: 'capacity', reason: 'five hour limit', retryAfterMs: 60_000 },
        stopped: true,
        failureText: 'something else',
      }),
    ).toEqual({
      kind: 'capacity',
      providerId: 'anthropic',
      label: 'Team key',
      reason: 'five hour limit',
      retryAfterMs: 60_000,
    });
  });

  test('a quota failure text becomes a quota block without a label when the provider has none', () => {
    expect(
      stepQuotaBlock({
        ...base,
        provider: { kind: 'api_key', providerId: 'openai' } as ProviderConfig,
        failureText: '402: {"message":"Payment required"}',
      }),
    ).toEqual({
      kind: 'quota',
      providerId: 'openai',
      reason: '402: {"message":"Payment required"}',
    });
  });

  test('the reason is capped at 500 characters and a missing provider reads unknown', () => {
    const block = stepQuotaBlock({
      ...base,
      provider: null,
      failureText: `429: Too Many Requests ${'x'.repeat(600)}`,
    });
    expect(block?.kind).toBe('capacity');
    expect(block?.providerId).toBe('unknown');
    expect(block?.reason).toHaveLength(500);
  });

  test('a stop, a process crash, no failure or a non-quota failure yields no block', () => {
    const quotaText = 'usage limit reached, please wait until 7pm UTC';
    expect(stepQuotaBlock({ ...base, stopped: true, failureText: quotaText })).toBeNull();
    expect(stepQuotaBlock({ ...base, processCrash: true, failureText: quotaText })).toBeNull();
    expect(stepQuotaBlock(base)).toBeNull();
    expect(stepQuotaBlock({ ...base, failureText: 'TypeError: boom' })).toBeNull();
  });
});
