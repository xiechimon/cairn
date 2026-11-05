import type { TokenUsage, UsageCost } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { threadUsageBuildIds, threadUsageSummary } from '../src/board/thread-usage-model.js';

const FREE: UsageCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, priced: true };

function usage(overrides: Partial<TokenUsage> = {}): TokenUsage {
  return {
    buildId: 'build-1',
    model: 'provider/model-a',
    input: 100,
    output: 200,
    cacheRead: 900,
    cacheWrite: 50,
    costInput: 0,
    costOutput: 0,
    costCacheRead: 0,
    costCacheWrite: 0,
    costTotal: 1.25,
    ...overrides,
  };
}

describe('threadUsageBuildIds', () => {
  test('all previous runs and the latest run appear exactly once', () => {
    expect(threadUsageBuildIds({
      latestBuildId: 'build-2',
      buildHistory: [
        { buildId: 'build-1', createdAt: 10 },
        { buildId: 'build-2', createdAt: 20 },
        { buildId: 'build-1', createdAt: 10 },
      ],
    })).toEqual(['build-1', 'build-2']);
  });

  test('a thread without runs has nothing to fetch', () => {
    expect(threadUsageBuildIds({ latestBuildId: null, buildHistory: [] })).toEqual([]);
  });
});

describe('threadUsageSummary', () => {
  test('tokens and prices include every run and every model', () => {
    const result = threadUsageSummary([
      usage(),
      usage({ buildId: 'build-2', model: 'provider/model-b', costTotal: 2.5 }),
      usage({ buildId: 'build-3', costTotal: 0.25 }),
    ], undefined, ['omarchy', 'Mac', 'omarchy']);
    expect(result).toMatchObject({ cost: '$4.00', tokens: '3.8k', cached: '90%' });
    expect(result.models).toEqual(['provider/model-a', 'provider/model-b']);
    expect(result.machines).toEqual(['omarchy', 'Mac']);
  });

  test('the explicit whole-thread cost is authoritative', () => {
    expect(threadUsageSummary([usage()], { ...FREE, total: 7.5 }, []).cost).toBe('$7.50');
    expect(threadUsageSummary([usage()], { ...FREE, priced: false }, []).cost).toBe('—');
  });

  test('one unpriced model makes the aggregate price unknown', () => {
    expect(threadUsageSummary([usage(), usage({ costTotal: null })], undefined, []).cost).toBe('—');
  });

  test('known free usage is distinct from absent usage', () => {
    expect(threadUsageSummary([usage({ costTotal: 0 })], undefined, []).cost).toBe('$0.00');
    expect(threadUsageSummary([], undefined, [])).toMatchObject({ cost: '—', tokens: '—', cached: '—', models: [] });
    expect(threadUsageSummary([], FREE, []).cost).toBe('$0.00');
  });

  test('a missing run response never exposes a partial token or model total', () => {
    expect(threadUsageSummary(null, { ...FREE, total: 5 }, ['omarchy'])).toMatchObject({
      cost: '$5.00', tokens: '—', cached: '—', models: [],
    });
  });

  test('zero input tokens has no invented cache hit percentage', () => {
    expect(threadUsageSummary([usage({ input: 0, cacheRead: 0 })], undefined, []).cached).toBe('—');
  });
});
