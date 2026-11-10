import type { TokenUsage } from '@cairn/shared';
import { formatUsd, mapTokenUsage } from '../api/mappers.js';
import type { TodoRecord } from '../fixtures/records.js';
import type { TFunc } from '../i18n/translate.js';

export interface ThreadUsageSummary {
  cost: string;
  tokens: string;
  cached: string;
  models: string[];
  machines: string[];
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
  };
}

const UNKNOWN = '—';

export function threadUsageCaption(summary: ThreadUsageSummary, t: TFunc): string | null {
  const parts = [
    summary.cost === UNKNOWN ? null : summary.cost,
    summary.tokens === UNKNOWN ? null : t('Token 数：{tokens}', { tokens: summary.tokens }),
    summary.models.length === 0
      ? null
      : summary.models.length === 1
        ? summary.models[0]
        : t('{n} 个模型', { n: summary.models.length }),
  ].filter((part): part is string => part !== null && part !== undefined);
  return parts.length === 0 ? null : parts.join(' · ');
}
