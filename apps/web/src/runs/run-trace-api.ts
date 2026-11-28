import {
  RUN_LIST_PAGE_SIZE,
  RUN_PROBLEM_STATUSES,
  type RunListPage,
  type RunListRow,
  type RunTrace,
} from '@cairn/shared';
import { type InfiniteData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { fetchWithSession } from '../api/auth.js';
import { ApiError, api } from '../api/client.js';
import { useLiveData } from '../api/provider.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { RUN_PATH_PREFIX } from '../resources/hrefs.js';

const RUN_SEARCH_KEYS = ['thread', 'scope', 'problems', 'scenario'] as const;
type RunSearchKey = (typeof RUN_SEARCH_KEYS)[number];

export type RunLinkTo = (
  runId: string | null,
  change?: Partial<Record<RunSearchKey, string | null>>,
) => { pathname: string; search: string };

export function useRunLinkTo(): RunLinkTo {
  const [params] = useSearchParams();
  return (runId, change = {}) => {
    const next = new URLSearchParams();
    for (const key of RUN_SEARCH_KEYS) {
      const value = key in change ? change[key] : params.get(key);
      if (value != null) next.set(key, value);
    }
    const search = next.toString();
    return {
      pathname: runId === null ? RUN_PATH_PREFIX : `${RUN_PATH_PREFIX}${encodeURIComponent(runId)}`,
      search: search === '' ? '' : `?${search}`,
    };
  };
}

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

export function useRunList(threadId: string | null, problems: boolean, enabled: boolean) {
  const { live, teamId } = useLiveData();
  const [params] = useSearchParams();
  const fixture = resolveScenario(params);
  return useInfiniteQuery<RunListPage, Error, InfiniteData<RunListPage>, unknown[], string | null>({
    queryKey: [
      'run-list',
      live ? teamId : `fixture:${params.get('scenario') ?? ''}`,
      threadId,
      problems,
    ],
    initialPageParam: null,
    getNextPageParam: (page) => page.nextCursor,
    queryFn: ({ pageParam, signal }) => {
      if (!live)
        return Promise.resolve(fixtureRunPage(fixture.runs ?? [], threadId, problems, pageParam));
      const query = new URLSearchParams({ problems: problems ? '1' : '0' });
      if (threadId !== null) query.set('thread', threadId);
      if (pageParam !== null) query.set('before', pageParam);
      return api.get<RunListPage>(`/api/teams/${teamId}/runs?${query}`, signal);
    },
    enabled: enabled && (!live || teamId !== undefined),
    staleTime: 0,
  });
}

export function useRunTrace(runId: string | null) {
  const { live, teamId } = useLiveData();
  const [params] = useSearchParams();
  const fixture = resolveScenario(params);
  return useQuery<RunTrace>({
    queryKey: ['run-trace', live ? teamId : `fixture:${params.get('scenario') ?? ''}`, runId],
    queryFn: ({ signal }) => {
      if (runId === null) return Promise.reject(new ApiError(404, 'not found'));
      if (live)
        return api.get<RunTrace>(`/api/teams/${teamId}/runs/${encodeURIComponent(runId)}`, signal);
      const trace = fixture.runTraces?.[runId];
      return trace === undefined
        ? Promise.reject(new ApiError(404, 'not found'))
        : Promise.resolve(trace);
    },
    enabled: runId !== null && (!live || teamId !== undefined),
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
