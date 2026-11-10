import { useEffect, useReducer } from 'react';
import { useSearchParams } from 'react-router';
import { useNotifications } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { isFixtureUnread, subscribeFixtureUnread } from '../fixtures/unread.js';

export function useThreadUnread(todoId: string): boolean {
  const { live, teamId } = useLiveData();
  const [searchParams] = useSearchParams();
  const notificationsQ = useNotifications(teamId, live);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeFixtureUnread(refresh), []);
  return live
    ? (notificationsQ.data?.unreadThreadIds ?? []).includes(todoId)
    : isFixtureUnread(todoId, resolveScenario(searchParams).unreadThreadIds);
}
