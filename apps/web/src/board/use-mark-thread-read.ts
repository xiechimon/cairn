import { useEffect, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations, useNotifications } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { isFixtureUnread, setFixtureUnread, subscribeFixtureUnread } from '../fixtures/unread.js';

function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === 'visible');
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  return visible;
}

export function useMarkThreadRead(todoId: string | undefined): void {
  const { live, teamId } = useLiveData();
  const [searchParams] = useSearchParams();
  const fixtureUnreadIds = resolveScenario(searchParams).unreadThreadIds;
  const notificationsQ = useNotifications(teamId, live);
  const mutations = useApiMutations(teamId);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const visible = useDocumentVisible();
  const autoReadFor = useRef<string | null>(null);

  useEffect(() => subscribeFixtureUnread(refresh), []);

  const unread =
    todoId !== undefined &&
    (live
      ? (notificationsQ.data?.unreadThreadIds ?? []).includes(todoId)
      : isFixtureUnread(todoId, fixtureUnreadIds));

  useEffect(() => {
    if (!unread) {
      autoReadFor.current = null;
      return;
    }
    if (!visible || todoId === undefined) return;
    if (autoReadFor.current === todoId) return;
    autoReadFor.current = todoId;
    if (live) mutations.setThreadRead.mutate({ id: todoId, read: true });
    else setFixtureUnread(todoId, false);
  });
}
