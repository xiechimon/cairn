import type { StepJournalRow, TokenUsage } from '@cairn/shared';
import { useQueries } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { api } from '../api/client.js';
import { useMachines, useTeams } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import type { TodoRecord } from '../fixtures/records.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { useI18n } from '../i18n/provider.js';
import { threadUsageBuildIds, threadUsageSummary } from './thread-usage-model.js';

export function useThreadUsage(todo: TodoRecord) {
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
  const teamUnavailable = teamId === undefined && (teamsQuery.isError || teamsQuery.isSuccess);
  const queries = [...usageQueries, ...stepQueries];
  const usageComplete =
    live &&
    usageQueries.every((query) => query.isSuccess && !query.isFetching && query.data.length > 0);
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
    (id) => machinesQuery.data?.find((machine) => machine.id === id)?.name ?? t('未知机器'),
  );
  const stepsComplete = live && stepQueries.every((query) => query.isSuccess);
  const summary = threadUsageSummary(
    usageComplete ? usageQueries.flatMap((query) => query.data ?? []) : (seeded?.rows ?? null),
    seeded?.machines ?? machineNames,
    stepsComplete ? stepQueries.flatMap((query) => query.data ?? []) : null,
    Date.now(),
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
    state,
    hasRuns,
    retry: () => {
      for (const query of queries) void query.refetch();
      if (teamId === undefined) void teamsQuery.refetch();
      else void machinesQuery.refetch();
    },
  };
}
