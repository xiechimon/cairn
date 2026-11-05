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
  const boundaryRefresh = useRef<Promise<unknown> | null>(null);
  const state = activityDataState(live, teams, teamId, dependencies);
  return {
    todos,
    projects,
    search,
    state: live && state === 'ready' && refreshing ? 'loading' : state,
    retry: () => {
      void retryActivityData(teams, teamId, dependencies);
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
