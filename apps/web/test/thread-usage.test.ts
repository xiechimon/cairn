import type { StepJournalRow, TokenUsage } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import { threadContextOf } from '../src/api/mappers.js';
import {
  type ThreadUsageSummary,
  threadContextReading,
  threadEngines,
  threadRunSeconds,
  threadUsageBuildIds,
  threadUsageCaption,
  threadUsageSummary,
} from '../src/board/thread-usage-model.js';
import type { TFunc, TVars } from '../src/i18n/translate.js';

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
    ], ['omarchy', 'Mac', 'omarchy']);
    expect(result).toMatchObject({ cost: '$4.00', tokens: '3.8k', cached: '90%' });
    expect(result.models).toEqual(['provider/model-a', 'provider/model-b']);
    expect(result.machines).toEqual(['omarchy', 'Mac']);
  });

  test('cost uses the same complete detail rows as tokens', () => {
    expect(threadUsageSummary([usage()], []).cost).toBe('$1.25');
  });

  test('one unpriced model makes the aggregate price unknown', () => {
    expect(threadUsageSummary([usage(), usage({ costTotal: null })], []).cost).toBe('—');
  });

  test('known free usage is distinct from absent usage', () => {
    expect(threadUsageSummary([usage({ costTotal: 0 })], []).cost).toBe('$0.00');
    expect(threadUsageSummary([], [])).toMatchObject({ cost: '—', tokens: '—', cached: '—', models: [] });
    expect(threadUsageSummary([], []).cost).toBe('—');
  });

  test('a missing run response never exposes an aggregate price or partial usage', () => {
    expect(threadUsageSummary(null, ['omarchy'])).toMatchObject({
      cost: '—', tokens: '—', cached: '—', models: [],
    });
  });

  test('mixed pricing keeps tokens but cannot become a partial price', () => {
    const rows = [usage(), usage({ buildId: 'build-2', costTotal: null })];
    expect(threadUsageSummary(rows, [])).toMatchObject({ cost: '—', tokens: '2.5k' });
  });

  test('empty and incomplete detail cannot establish a known-free aggregate', () => {
    expect(threadUsageSummary(null, []).cost).toBe('—');
    expect(threadUsageSummary([], []).cost).toBe('—');
  });

  test('zero input tokens has no invented cache hit percentage', () => {
    expect(threadUsageSummary([usage({ input: 0, cacheRead: 0 })], []).cached).toBe('—');
  });
});

describe('threadUsageCaption', () => {
  const t: TFunc = (key: string, vars?: TVars) =>
    key.replace(/\{(\w+)\}/g, (_, name: string) => String(vars?.[name]));
  const summary = (patch: Partial<ThreadUsageSummary> = {}): ThreadUsageSummary => ({
    cost: '$1.25',
    tokens: '2.5k',
    cached: '90%',
    duration: '',
    engines: [],
    models: ['provider/model-a'],
    machines: [],
    ...patch,
  });

  test('joins only the cost and the token total that are known, with no dash placeholders', () => {
    expect(threadUsageCaption(summary(), t)).toBe('$1.25 · Token 数：2.5k');
    expect(threadUsageCaption(summary({ cost: '—' }), t)).toBe('Token 数：2.5k');
    expect(threadUsageCaption(summary({ tokens: '—', models: [] }), t)).toBe('$1.25');
  });

  test('says the usage is unavailable instead of printing placeholders', () => {
    const caption = threadUsageCaption(summary({ cost: '—', tokens: '—', models: [] }), t);
    expect(caption).toBe('用量暂不可用');
    expect(caption).not.toContain('—');
  });

  test('models stay in the popover, however many there are', () => {
    expect(threadUsageCaption(summary({ models: ['a', 'b'] }), t)).toBe('$1.25 · Token 数：2.5k');
  });
});

describe('thread context usage', () => {
  test('a todo that carries the Coordinator-shaped context keeps it', () => {
    expect(threadContextOf({ context: { tokens: 62_000, contextWindow: 200_000, resume: 'warm' } })).toEqual({
      tokens: 62_000,
      contextWindow: 200_000,
    });
  });

  test('a todo without the field, or with an unusable one, has no context', () => {
    expect(threadContextOf({})).toBeNull();
    expect(threadContextOf({ context: null })).toBeNull();
    expect(threadContextOf({ context: { tokens: 10 } })).toBeNull();
    expect(threadContextOf({ context: { tokens: 10, contextWindow: 0 } })).toBeNull();
    expect(threadContextOf({ context: { tokens: '10', contextWindow: 200_000 } })).toBeNull();
  });

  test('the popover row reads the share, then the tokens over the window', () => {
    expect(threadContextReading({ tokens: 62_000, contextWindow: 200_000 })).toBe('31% · 62k / 200k');
    expect(threadContextReading({ tokens: 500, contextWindow: 200_000 })).toBe('0% · 500 / 200k');
  });

  test('no context leaves the row out instead of printing a placeholder', () => {
    expect(threadContextReading(null)).toBe('');
    expect(threadContextReading(undefined)).toBe('');
    expect(threadContextReading({ tokens: 10, contextWindow: 0 })).toBe('');
  });
});

describe('thread run window and engines from the step journal', () => {
  const row = (patch: Partial<StepJournalRow> = {}): StepJournalRow => ({
    id: 'step-1',
    buildId: 'build-1',
    kind: 'build',
    machineId: null,
    createdAt: 0,
    status: 'done',
    checkpointCommit: null,
    skillInjection: null,
    route: null,
    ...patch,
  });

  test('sums finished runs and counts a running one up to now', () => {
    const steps = [
      row({ startedAt: 1_000, finishedAt: 61_000 }),
      row({ id: 'step-2', status: 'claimed', startedAt: 100_000 }),
    ];
    expect(threadRunSeconds(steps, 130_000)).toBe(90);
    expect(threadUsageSummary(null, [], steps, 130_000).duration).toBe('1m 30s');
  });

  test('shows no duration when no run has started', () => {
    expect(threadRunSeconds([row()], 5_000)).toBeNull();
    expect(threadUsageSummary(null, [], [row()], 5_000).duration).toBe('');
    expect(threadUsageSummary(null, []).duration).toBe('');
  });

  test('names each engine once and skips steps without a route', () => {
    const steps = [
      row({ route: { harness: 'claude-code', modelId: 'm' } }),
      row({ id: 'b', route: { harness: 'pi', modelId: null } }),
      row({ id: 'c', route: { harness: 'claude-code', modelId: 'n' } }),
      row({ id: 'd', route: { harness: null, modelId: null } }),
      row({ id: 'e' }),
    ];
    expect(threadEngines(steps)).toEqual(['Claude Code', 'Cairn']);
  });
});
