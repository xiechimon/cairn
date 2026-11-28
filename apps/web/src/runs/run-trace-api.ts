import {
  RUN_LIST_PAGE_SIZE,
  RUN_PROBLEM_STATUSES,
  type RunListPage,
  type RunListRow,
  type RunTrace,
} from '@cairn/shared';
import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { fetchWithSession } from '../api/auth.js';
import { ApiError, api } from '../api/client.js';
import { useLiveData } from '../api/provider.js';
import { resolveScenario } from '../fixtures/scenario.js';
import type { TraceScope } from './run-items.js';

function fixtureRunPage(
  rows: readonly RunListRow[],
  threadId: string | null,
  problems: boolean,
  before: string | null,
): RunListPage {
  const kept = rows.filter(
    (row) =>
      (threadId === null || row.threadId === threadId) &&
      (!problems || RUN_PROBLEM_STATUSES.includes(row.status)),
  );
  const start = before === null ? 0 : kept.findIndex((row) => row.id === before) + 1;
  const runs = kept.slice(start, start + RUN_LIST_PAGE_SIZE);
  const more = start + RUN_LIST_PAGE_SIZE < kept.length;
  return { runs, nextCursor: more ? (runs.at(-1)?.id ?? null) : null };
}

const ACTIVE_REFRESH_MAX_MS = 10 * 60_000;

function refreshing(activeSince: number | null): boolean {
  return activeSince !== null && Date.now() - activeSince < ACTIVE_REFRESH_MAX_MS;
}

export function useRunList(
  threadOrScope: string | null | TraceScope,
  problems: boolean,
  enabled: boolean,
  includeCounts = false,
) {
  const scope = typeof threadOrScope === 'object' && threadOrScope !== null ? threadOrScope : null;
  const threadId =
    scope?.kind === 'coordinator'
      ? scope.threadId
      : scope
        ? null
        : (threadOrScope as string | null);
  const todoId = scope?.kind === 'task' ? scope.todoId : null;
  const { live, teamId } = useLiveData();
  const [params] = useSearchParams();
  const fixture = resolveScenario(params);
  return useInfiniteQuery<RunListPage, Error, InfiniteData<RunListPage>, unknown[], string | null>({
    queryKey: [
      'run-list',
      live ? teamId : `fixture:${params.get('scenario') ?? ''}`,
      threadId,
      todoId,
      problems,
      includeCounts,
    ],
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor,
    queryFn: ({ pageParam, signal }) => {
      if (!live)
        return Promise.resolve(
          fixtureRunPage(
            todoId === null
              ? (fixture.runs ?? [])
              : (fixture.runs ?? []).filter(
                  (row) => fixture.runTraces?.[row.id]?.todoId === todoId,
                ),
            threadId,
            problems,
            pageParam,
          ),
        );
      const query = new URLSearchParams({ problems: problems ? '1' : '0' });
      if (threadId !== null) query.set('thread', threadId);
      if (todoId !== null) query.set('todo', todoId);
      if (includeCounts && pageParam === null) query.set('includeCounts', '1');
      if (pageParam !== null) query.set('before', pageParam);
      return api.get<RunListPage>(`/api/teams/${teamId}/runs?${query}`, signal);
    },
    enabled:
      enabled &&
      !(scope?.kind === 'coordinator' && scope.threadId === null) &&
      (!live || teamId !== undefined),
    staleTime: 0,
    refetchInterval: (query) => {
      const running = (query.state.data?.pages ?? []).flatMap((page) =>
        page.runs.filter((row) => row.status === 'running'),
      );
      const since = running.length === 0 ? null : Math.min(...running.map((row) => row.at));
      return refreshing(since) ? 8000 : false;
    },
    refetchIntervalInBackground: false,
  });
}

const detailEtags = new Map<string, string>();

export function useRunTrace(runId: string | null) {
  const { live, teamId } = useLiveData();
  const [params] = useSearchParams();
  const fixture = resolveScenario(params);
  const queryClient = useQueryClient();
  const scopeKey = live ? teamId : `fixture:${params.get('scenario') ?? ''}`;
  const queryKey = ['run-trace', scopeKey, runId];
  return useQuery<RunTrace>({
    queryKey,
    queryFn: async ({ signal }) => {
      if (runId === null) throw new ApiError(404, 'not found');
      if (!live) {
        const trace = fixture.runTraces?.[runId];
        if (trace === undefined) throw new ApiError(404, 'not found');
        return trace;
      }
      const path = `/api/teams/${teamId}/runs/${encodeURIComponent(runId)}`;
      const etagKey = `${String(scopeKey)}:${runId}`;
      const read = (conditional: boolean) => {
        const etag = detailEtags.get(etagKey);
        return fetchWithSession(path, {
          signal,
          ...(conditional && etag !== undefined ? { headers: { 'if-none-match': etag } } : {}),
        });
      };
      let response = await read(true);
      if (response.status === 304) {
        const cached = queryClient.getQueryData<RunTrace>(queryKey);
        if (cached !== undefined) return cached;
        response = await read(false);
      }
      if (!response.ok) throw new ApiError(response.status, response.statusText);
      const etag = response.headers.get('etag');
      if (etag !== null) detailEtags.set(etagKey, etag);
      return (await response.json()) as RunTrace;
    },
    enabled: runId !== null && (!live || teamId !== undefined),
    retry: false,
    refetchInterval: (query) => {
      const trace = query.state.data;
      if (trace?.status !== 'running' || !refreshing(trace.startedAt)) return false;
      return trace.items.length >= 100 ? 8000 : 2000;
    },
    refetchIntervalInBackground: false,
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
