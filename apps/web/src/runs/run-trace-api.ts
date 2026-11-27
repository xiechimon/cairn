import {
  RUN_TURN_PAGE_SIZE,
  type RunTrace,
  type RunTurnPage,
  type RunTurnRow,
} from '@cairn/shared';
import { type InfiniteData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { fetchWithSession } from '../api/auth.js';
import { ApiError, api } from '../api/client.js';
import { useLiveData } from '../api/provider.js';
import { resolveScenario } from '../fixtures/scenario.js';

import { RUN_PATH_PREFIX } from '../resources/hrefs.js';

export function useRunLinkTo(): (runId: string) => { pathname: string; search: string } {
  const [params] = useSearchParams();
  const scenario = params.get('scenario');
  const search = scenario === null ? '' : `?${new URLSearchParams({ scenario })}`;
  return (runId) => ({ pathname: `${RUN_PATH_PREFIX}${encodeURIComponent(runId)}`, search });
}

function fixtureTurnPage(
  rows: readonly RunTurnRow[],
  problems: boolean,
  before: string | null,
): RunTurnPage {
  const kept = problems ? rows.filter((row) => row.problem !== null) : rows;
  const start = before === null ? 0 : kept.findIndex((row) => row.stepId === before) + 1;
  const turns = kept.slice(start, start + RUN_TURN_PAGE_SIZE);
  const more = start + RUN_TURN_PAGE_SIZE < kept.length;
  return { turns, nextCursor: more ? (turns.at(-1)?.stepId ?? null) : null };
}

export function useRunTurns(threadId: string | null, problems: boolean, enabled: boolean) {
  const { live, teamId } = useLiveData();
  const [params] = useSearchParams();
  const fixture = resolveScenario(params);
  return useInfiniteQuery<RunTurnPage, Error, InfiniteData<RunTurnPage>, unknown[], string | null>({
    queryKey: ['run-turns', live ? teamId : 'fixture', threadId, problems],
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor,
    queryFn: ({ pageParam, signal }) => {
      if (!live)
        return Promise.resolve(fixtureTurnPage(fixture.runTurns ?? [], problems, pageParam));
      const query = new URLSearchParams({ problems: problems ? '1' : '0' });
      if (pageParam !== null) query.set('before', pageParam);
      return api.get<RunTurnPage>(
        `/api/teams/${teamId}/chief/threads/${threadId}/turns?${query}`,
        signal,
      );
    },
    enabled: enabled && threadId !== null && (!live || teamId !== undefined),
    staleTime: 0,
  });
}

export function useRunTrace(runId: string) {
  const { live, teamId } = useLiveData();
  const [params] = useSearchParams();
  const fixture = resolveScenario(params);
  return useQuery<RunTrace>({
    queryKey: ['run-trace', live ? teamId : 'fixture', runId],
    queryFn: ({ signal }) => {
      if (live)
        return api.get<RunTrace>(`/api/teams/${teamId}/runs/${encodeURIComponent(runId)}`, signal);
      const trace = fixture.runTraces?.[runId];
      return trace === undefined
        ? Promise.reject(new ApiError(404, 'not found'))
        : Promise.resolve(trace);
    },
    enabled: !live || teamId !== undefined,
    retry: false,
  });
}

export async function downloadRunTrace(teamId: string | undefined, trace: RunTrace): Promise<void> {
  const blob =
    teamId === undefined
      ? new Blob([`${JSON.stringify(trace, null, 2)}\n`], { type: 'application/json' })
      : await fetchWithSession(
          `/api/teams/${teamId}/runs/${encodeURIComponent(trace.id)}?download=1`,
        ).then((res) => {
          if (!res.ok) throw new Error(res.statusText);
          return res.blob();
        });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `cairn-run-${trace.id}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
