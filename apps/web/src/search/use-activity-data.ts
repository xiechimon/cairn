import { useRef, useState } from 'react';
import { useProjects, useSearchResults, useTeams, useTodos } from '../api/hooks.js';
import { activityDataState, retryActivityData } from './activity-data.js';

export function useActivityData(live: boolean, query: string) {
  const teams = useTeams(live);
  const teamId = teams.isSuccess ? teams.data[0]?.id : undefined;
  const enabled = live && teamId !== undefined;
  const todos = useTodos(teamId, enabled);
  const projects = useProjects(teamId, enabled);
  const search = useSearchResults(query, enabled);
  const dependencies = query.trim() === '' ? [todos, projects] : [todos, projects, search];
  const [refreshing, setRefreshing] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const retryInFlight = useRef(false);
  const retryBusy =
    retrying ||
    (teams.isSuccess && teamId !== undefined
      ? dependencies.some((dependency) => dependency.isFetching)
      : teams.isFetching);
  const boundaryRefresh = useRef<Promise<unknown> | null>(null);
  const state = activityDataState(live, teams, teamId, dependencies);
  return {
    todos,
    projects,
    search,
    state: live && state === 'ready' && refreshing ? 'loading' : state,
    retryBusy,
    retry: () => {
      if (!live || retryBusy || retryInFlight.current) return;
      retryInFlight.current = true;
      setRetrying(true);
      void retryActivityData(teams, teamId, dependencies).finally(() => {
        retryInFlight.current = false;
        setRetrying(false);
      });
    },
    refreshAtBoundary: () => {
      if (!enabled || boundaryRefresh.current !== null) return;
      setRefreshing(true);
      const pending = Promise.all(
        dependencies.map((dependency) => dependency.refetch({ cancelRefetch: false })),
      );
      boundaryRefresh.current = pending;
      void pending.finally(() => {
        boundaryRefresh.current = null;
        setRefreshing(false);
      });
    },
  };
}
