import type { StepJournalRow, TokenUsage } from '@cairn/shared';
import { formatTokens, formatUsd, mapTokenUsage } from '../api/mappers.js';
import { contextPercentOf } from '../chief/context-meter-ring.js';
import { formatWorkDuration } from '../detail/work-trace.js';
import type { ChiefContextUsage, TodoRecord } from '../fixtures/records.js';
import type { TFunc } from '../i18n/translate.js';

export interface ThreadUsageSummary {
  cost: string;
  tokens: string;
  cached: string;
  models: string[];
  machines: string[];
  duration: string;
  engines: string[];
}

const HARNESS_NAMES = { 'claude-code': 'Claude Code', pi: 'Cairn' } as const;

export function threadRunSeconds(steps: readonly StepJournalRow[], now: number): number | null {
  const started = steps.filter((step) => step.startedAt !== undefined);
  if (started.length === 0) return null;
  return (
    started.reduce(
      (sum, step) => sum + Math.max(0, (step.finishedAt ?? now) - (step.startedAt ?? now)),
      0,
    ) / 1000
  );
}

export function threadEngines(steps: readonly StepJournalRow[]): string[] {
  return [
    ...new Set(
      steps.flatMap((step) =>
        step.route?.harness == null ? [] : [HARNESS_NAMES[step.route.harness]],
      ),
    ),
  ];
}

export function threadUsageBuildIds(
  todo: Pick<TodoRecord, 'latestBuildId' | 'buildHistory'>,
): string[] {
  const history = todo.buildHistory.map((entry) => entry.buildId);
  if (todo.latestBuildId !== null) history.push(todo.latestBuildId);
  return [...new Set(history)];
}

export function threadUsageSummary(
  usage: readonly TokenUsage[] | null,
  machines: readonly string[],
  steps: readonly StepJournalRow[] | null = null,
  now = 0,
): ThreadUsageSummary {
  const knownUsage = usage !== null && usage.length > 0 ? [...usage] : null;
  const tokenUsage = knownUsage === null ? null : mapTokenUsage(knownUsage);
  const price = knownUsage?.every((row) => row.costTotal !== null)
    ? knownUsage.reduce((sum, row) => sum + (row.costTotal ?? 0), 0)
    : null;
  return {
    cost: price === null ? '—' : formatUsd(price),
    tokens: tokenUsage?.total ?? '—',
    cached: tokenUsage?.cacheHitRate ?? '—',
    models: [...new Set(knownUsage?.map((row) => row.model) ?? [])],
    machines: [...new Set(machines)],
    duration: steps === null ? '' : formatWorkDuration(threadRunSeconds(steps, now)),
    engines: steps === null ? [] : threadEngines(steps),
  };
}

const UNKNOWN = '—';

export function threadUsageCaption(summary: ThreadUsageSummary, t: TFunc): string {
  const parts = [
    summary.cost === UNKNOWN ? null : summary.cost,
    summary.tokens === UNKNOWN ? null : t('Token 数：{tokens}', { tokens: summary.tokens }),
  ].filter((part) => part !== null);
  return parts.length === 0 ? t('用量暂不可用') : parts.join(' · ');
}

export function threadContextReading(context: ChiefContextUsage | null | undefined): string {
  const percent = contextPercentOf(context);
  if (context == null || percent === null) return '';
  return `${percent}% · ${formatTokens(context.tokens)} / ${formatTokens(context.contextWindow)}`;
}
