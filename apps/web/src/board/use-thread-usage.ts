import type { StepActivity, StepJournalRow, TokenUsage } from '@cairn/shared';
import { useQueries } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { api } from '../api/client.js';
import { useMachines, useModelSources, useTeams } from '../api/hooks.js';
import { toModelOptions } from '../api/mappers.js';
import { useLiveData } from '../api/provider.js';
import type { ChiefContextUsage, TodoRecord } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { threadUsageBuildIds, threadUsageSummary } from './thread-usage-model.js';

export function mergeLiveUsageRows(
  dbRows: readonly TokenUsage[] | null,
  steps: readonly StepJournalRow[] | null,
  liveActivity: StepActivity | null,
  fallbackBuildId: string | null,
): TokenUsage[] | null {
  if (dbRows === null) return null;
  if (
    liveActivity === null ||
    (liveActivity.tokens === undefined &&
      liveActivity.cacheRead === undefined &&
      liveActivity.cacheWrite === undefined &&
      liveActivity.costTotal === undefined)
  ) {
    return [...dbRows];
  }
  const activeStep =
    steps?.find(
      (s) => s.status === 'claimed' || s.status === 'pending' || s.status === 'waiting_quota',
    ) ?? null;
  const buildId = activeStep?.buildId ?? fallbackBuildId ?? '';
  const cacheRead = liveActivity.cacheRead ?? 0;
  const cacheWrite = liveActivity.cacheWrite ?? 0;
  const totalInput = liveActivity.tokens?.input ?? 0;
  const input = Math.max(0, totalInput - cacheRead - cacheWrite);
  const output = liveActivity.tokens?.output ?? 0;
  const routeModel = activeStep?.route?.modelId;
  const routeHarness = activeStep?.route?.harness;
  const model =
    routeModel != null && routeModel !== ''
      ? routeHarness != null
        ? `${routeHarness}/${routeModel}`
        : routeModel
      : '';
  return [
    ...dbRows,
    {
      buildId,
      model,
      input,
      output,
      cacheRead,
      cacheWrite,
      costInput: null,
      costOutput: null,
      costCacheRead: null,
      costCacheWrite: null,
      costTotal: liveActivity.costTotal ?? null,
    },
  ];
}

export function mergeLiveContext(
  baseContext: ChiefContextUsage | null | undefined,
  liveActivity: StepActivity | null,
): ChiefContextUsage | null {
  const base = baseContext ?? null;
  if (liveActivity === null) return base;
  const tokens = liveActivity.contextTokens;
  const contextWindow = liveActivity.contextWindow ?? base?.contextWindow;
  const compactAt = liveActivity.compactAt ?? base?.compactAt;
  if (tokens === undefined || tokens <= 0 || contextWindow === undefined || contextWindow <= 0) {
    return base;
  }
  return {
    ...(base ?? {}),
    tokens,
    contextWindow,
    ...(compactAt !== undefined ? { compactAt } : {}),
    ...(liveActivity.tokens !== undefined
      ? {
          cache: {
            read: liveActivity.cacheRead ?? 0,
            write: liveActivity.cacheWrite ?? 0,
            input: Math.max(
              0,
              liveActivity.tokens.input -
                (liveActivity.cacheRead ?? 0) -
                (liveActivity.cacheWrite ?? 0),
            ),
          },
        }
      : {}),
  };
}

export function useThreadUsage(todo: TodoRecord, liveActivity: StepActivity | null = null) {
  const { t } = useI18n();
  const { live, teamId } = useLiveData();
  const [searchParams] = useSearchParams();
  const seeded = live ? undefined : resolveScenario(searchParams).details?.[todo.id]?.usage;
  const buildIds = threadUsageBuildIds(todo);
  const usageQueries = useQueries({
    queries: buildIds.map((buildId) => ({
      queryKey: ['usage', buildId],
      queryFn: () => api.get<TokenUsage[]>(`/api/builds/${buildId}/usage`),
      enabled: live,
      staleTime: 30_000,
    })),
  });
  const stepQueries = useQueries({
    queries: buildIds.map((buildId) => ({
      queryKey: ['steps', buildId],
      queryFn: () => api.get<StepJournalRow[]>(`/api/builds/${buildId}/steps`),
      enabled: live,
      staleTime: 30_000,
    })),
  });
  const hasRuns = buildIds.length > 0;
  const teamsQuery = useTeams(live && hasRuns && teamId === undefined);
  const machinesQuery = useMachines(teamId, live && hasRuns);
  const sourcesQuery = useModelSources(teamId, live && hasRuns);
  const teamUnavailable = teamId === undefined && (teamsQuery.isError || teamsQuery.isSuccess);
  const queries = [...usageQueries, ...stepQueries];
  const usageComplete = live && usageQueries.every((query) => query.isSuccess && !query.isFetching);
  const machinesComplete =
    live && stepQueries.every((query) => query.isSuccess) && machinesQuery.isSuccess;
  const machineIds = machinesComplete
    ? [
        ...new Set(
          stepQueries.flatMap((query) =>
            (query.data ?? []).flatMap((step) => (step.machineId === null ? [] : [step.machineId])),
          ),
        ),
      ]
    : [];
  const machineNames = machineIds.map(
    (id) => machinesQuery.data?.find((machine) => machine.id === id)?.name ?? t('未知执行机'),
  );
  const stepsComplete = live && stepQueries.every((query) => query.isSuccess);
  const steps = stepsComplete ? stepQueries.flatMap((query) => query.data ?? []) : null;
  const dbRows = usageComplete
    ? usageQueries.flatMap((query) => query.data ?? [])
    : (seeded?.rows ?? null);
  const mergedRows = mergeLiveUsageRows(
    dbRows,
    steps,
    live ? liveActivity : null,
    todo.latestBuildId,
  );
  const context = mergeLiveContext(todo.context, live ? liveActivity : null);
  const modelOptions = toModelOptions(
    Array.isArray(sourcesQuery.data?.sources) ? sourcesQuery.data.sources : [],
  );
  const summary = threadUsageSummary(
    mergedRows,
    seeded?.machines ?? machineNames,
    steps,
    Date.now(),
    {
      machineDetails: machinesQuery.data,
      modelOptions,
    },
  );
  const state: 'ready' | 'loading' | 'error' =
    !live || !hasRuns
      ? 'ready'
      : teamUnavailable || queries.some((query) => query.isError) || machinesQuery.isError
        ? 'error'
        : queries.some((query) => query.isPending || query.isFetching) || machinesQuery.isPending
          ? 'loading'
          : 'ready';
  return {
    summary,
    context,
    state,
    hasRuns,
    retry: () => {
      for (const query of queries) void query.refetch();
      if (teamId === undefined) void teamsQuery.refetch();
      else void machinesQuery.refetch();
    },
  };
}
