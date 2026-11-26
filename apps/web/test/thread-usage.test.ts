import type { StepActivity, StepJournalRow, TokenUsage } from '@cairn/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, test, vi } from 'vitest';
import { threadContextOf } from '../src/api/mappers.js';
import {
  type ThreadUsageSummary,
  threadEngines,
  threadRunSeconds,
  threadUsageBuildIds,
  threadUsageCaption,
  threadUsageSummary,
} from '../src/board/thread-usage-model.js';
import {
  mergeLiveContext,
  mergeLiveUsageRows,
  useThreadUsage,
} from '../src/board/use-thread-usage.js';
import type { TodoRecord } from '../src/fixtures/records.js';
import { I18nProvider } from '../src/i18n/provider.js';
import type { TFunc, TVars } from '../src/i18n/translate.js';

vi.mock('../src/api/provider.js', () => ({
  useLiveData: () => ({ live: true, teamId: 't1', userName: 'Owner' }),
}));

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
    expect(result).toMatchObject({ cost: '$4.00', tokens: '3.8k', cached: '85.7%' });
    expect(result.models).toEqual(['provider/model-a', 'provider/model-b']);
    expect(result.machines).toEqual(['omarchy', 'Mac']);
  });

  test('cost uses the same complete detail rows as tokens', () => {
    expect(threadUsageSummary([usage()], []).cost).toBe('$1.25');
  });

  test('one unpriced model makes the aggregate price empty instead of a dash placeholder', () => {
    expect(threadUsageSummary([usage(), usage({ costTotal: null })], []).cost).toBe('');
  });

  test('known free usage is distinct from absent usage', () => {
    expect(threadUsageSummary([usage({ costTotal: 0 })], []).cost).toBe('$0.00');
    expect(threadUsageSummary([], [])).toMatchObject({ cost: '', tokens: '', cached: '', models: [] });
    expect(threadUsageSummary([], []).cost).toBe('');
  });

  test('a missing run response never exposes an aggregate price or partial usage', () => {
    expect(threadUsageSummary(null, ['omarchy'])).toMatchObject({
      cost: '', tokens: '', cached: '', models: [],
    });
  });

  test('mixed pricing keeps tokens but cannot become a partial price', () => {
    const rows = [usage(), usage({ buildId: 'build-2', costTotal: null })];
    expect(threadUsageSummary(rows, [])).toMatchObject({ cost: '', tokens: '2.5k' });
  });

  test('empty and incomplete detail cannot establish a known-free aggregate', () => {
    expect(threadUsageSummary(null, []).cost).toBe('');
    expect(threadUsageSummary([], []).cost).toBe('');
  });

  test('zero input tokens has no invented cache hit percentage', () => {
    expect(threadUsageSummary([usage({ input: 0, cacheRead: 0, cacheWrite: 0 })], []).cached).toBe('');
  });

  test('cache writes count against the hit rate', () => {
    expect(threadUsageSummary([usage({ input: 0, cacheRead: 0 })], []).cached).toBe('0%');
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
    expect(threadUsageCaption(summary({ cost: '' }), t)).toBe('Token 数：2.5k');
    expect(threadUsageCaption(summary({ tokens: '', models: [] }), t)).toBe('$1.25');
  });

  test('says the usage is unavailable instead of printing placeholders', () => {
    const caption = threadUsageCaption(summary({ cost: '', tokens: '', models: [] }), t);
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

  test('a reported compact point comes through for the auto-compact hint', () => {
    expect(
      threadContextOf({ context: { tokens: 62_000, contextWindow: 200_000, compactAt: 91_808 } }),
    ).toEqual({ tokens: 62_000, contextWindow: 200_000, compactAt: 91_808 });
    expect(
      threadContextOf({ context: { tokens: 62_000, contextWindow: 200_000, compactAt: -1 } }),
    ).toEqual({ tokens: 62_000, contextWindow: 200_000 });
  });

  test('a todo without the field, or with an unusable one, has no context', () => {
    expect(threadContextOf({})).toBeNull();
    expect(threadContextOf({ context: null })).toBeNull();
    expect(threadContextOf({ context: { tokens: 10 } })).toBeNull();
    expect(threadContextOf({ context: { tokens: 10, contextWindow: 0 } })).toBeNull();
    expect(threadContextOf({ context: { tokens: '10', contextWindow: 200_000 } })).toBeNull();
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

  test('separates current vs historical engine, formatted model, and runner', () => {
    const steps: StepJournalRow[] = [
      row({
        id: 's1',
        machineId: 'm1',
        createdAt: 1000,
        startedAt: 1000,
        finishedAt: 2000,
        route: { harness: 'claude-code', modelId: 'claude-haiku-5-5' },
      }),
      row({
        id: 's2',
        machineId: 'm2',
        createdAt: 3000,
        startedAt: 3000,
        finishedAt: 5000,
        route: { harness: 'devin', modelId: 'swe-2-1-medium' },
      }),
    ];
    const summary = threadUsageSummary(
      [
        usage({ buildId: 'b1', model: 'claude-code/claude-haiku-5-5' }),
        usage({ buildId: 'b2', model: 'swe-2-1-medium' }),
      ],
      ['studioMac-0001.local', 'Studio-Mac-mini'],
      steps,
      6000,
    );
    expect(summary.latestEngine).toEqual({ label: 'Devin', runtime: 'devin' });
    expect(summary.historyEngines).toEqual([{ label: 'Claude Code', runtime: 'claude-code' }]);
    expect(summary.latestModel).toMatchObject({ modelId: 'swe-2-1-medium', modelName: 'SWE-2.1' });
    expect(summary.historyModels?.map((m) => m.modelName)).toEqual(['Claude Haiku 5.5']);
    expect(summary.latestMachine).toMatchObject({ name: 'Studio-Mac-mini' });
    expect(summary.historyMachines?.map((m) => m.name)).toEqual(['studioMac-0001.local']);
  });
});

describe('live activity usage and context merging', () => {
  const activity: StepActivity = {
    stepId: 'step-live',
    at: 5_000,
    phase: 'thinking',
    tokens: { input: 10_000, output: 500 },
    cacheRead: 8_000,
    cacheWrite: 1_000,
    contextTokens: 32_000,
    contextWindow: 200_000,
    compactAt: 150_000,
    costTotal: 0.25,
  };

  test('appends live step tokens, cache hit, and cost onto completed earlier build rows', () => {
    const merged = mergeLiveUsageRows(
      [usage({ buildId: 'build-old', input: 100, output: 400, cacheRead: 1_000, cacheWrite: 0, costTotal: 1.0 })],
      [
        {
          id: 'step-live',
          buildId: 'build-new',
          kind: 'build',
          machineId: 'm1',
          createdAt: 1_000,
          status: 'claimed',
          checkpointCommit: null,
          skillInjection: null,
          route: { harness: 'pi', modelId: 'claude-sonnet-5-5' },
        },
      ],
      activity,
      'build-new',
    );
    const summary = threadUsageSummary(merged, ['Studio-Mac-mini']);
    expect(summary.cost).toBe('$1.25');
    expect(summary.tokens).toBe('12k');
    expect(summary.cached).toBe('81.1%');
    expect(summary.models).toEqual(['provider/model-a', 'pi/claude-sonnet-5-5']);
  });

  test('keeps live tokens and cache hit when DB usage is empty for a running build', () => {
    const merged = mergeLiveUsageRows([], [], activity, 'build-1');
    const summary = threadUsageSummary(merged, []);
    expect(summary.cost).toBe('$0.25');
    expect(summary.tokens).toBe('10.5k');
    expect(summary.cached).toBe('80%');
    expect(summary.models).toEqual([]);
  });

  test('merges live context tokens, window, compactAt, and cache into ChiefContextUsage', () => {
    expect(mergeLiveContext(null, activity)).toEqual({
      tokens: 32_000,
      contextWindow: 200_000,
      compactAt: 150_000,
      cache: { read: 8_000, write: 1_000, input: 1_000 },
    });
  });

  test('useThreadUsage preserves earlier build rows when a newly started build has 0 DB rows', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(['usage', 'build-old'], [usage({ buildId: 'build-old', costTotal: 1.5 })]);
    qc.setQueryData(['usage', 'build-new'], []);
    qc.setQueryData(['steps', 'build-old'], []);
    qc.setQueryData(['steps', 'build-new'], []);
    qc.setQueryData(['machines', 't1'], []);
    qc.setQueryData(['modelSources', 't1'], { sources: [] });
    const todo = {
      id: 'todo-1',
      latestBuildId: 'build-new',
      buildHistory: [
        { buildId: 'build-old', createdAt: 10 },
        { buildId: 'build-new', createdAt: 20 },
      ],
    } as unknown as TodoRecord;
    const results: ReturnType<typeof useThreadUsage>[] = [];
    function Probe() {
      results.push(useThreadUsage(todo, activity));
      return null;
    }
    renderToStaticMarkup(
      createElement(QueryClientProvider, {
        client: qc,
        children: createElement(MemoryRouter, {
          children: createElement(I18nProvider, {
            initialLocale: 'en',
            children: createElement(Probe),
          }),
        }),
      }),
    );
    const captured = results.at(-1);
    expect(captured?.summary.cost).toBe('$1.75');
    expect(captured?.summary.tokens).toBe('11.8k');
    expect(captured?.context).toEqual({
      tokens: 32_000,
      contextWindow: 200_000,
      compactAt: 150_000,
      cache: { read: 8_000, write: 1_000, input: 1_000 },
    });
  });
});
