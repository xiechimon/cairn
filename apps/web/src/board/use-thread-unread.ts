import { useEffect, useMemo, useReducer } from 'react';
import { useSearchParams } from 'react-router';
import { useNotifications } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { isFixtureUnread, subscribeFixtureUnread } from '../fixtures/unread.js';

export function useUnreadThreadIds(threads: ReadonlyMap<string, unknown>): ReadonlySet<string> {
  const { live, teamId } = useLiveData();
  const [searchParams] = useSearchParams();
  const notificationsQ = useNotifications(teamId, live);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeFixtureUnread(refresh), []);
  const initial = resolveScenario(searchParams).unreadThreadIds;
  const fixtureUnread = live
    ? ''
    : [...threads.keys()].filter((id) => isFixtureUnread(id, initial)).join('\n');
  const liveUnread = notificationsQ.data?.unreadThreadIds;
  return useMemo(
    () => new Set(live ? (liveUnread ?? []) : fixtureUnread.split('\n').filter(Boolean)),
    [live, liveUnread, fixtureUnread],
  );
}
