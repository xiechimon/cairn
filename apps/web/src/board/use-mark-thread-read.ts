import { useEffect, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useApiMutations, useNotifications } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { isFixtureUnread, setFixtureUnread, subscribeFixtureUnread } from '../fixtures/unread.js';
import { isServerUnreachable } from '../lib/error-copy.js';

const UNREACHABLE_ATTEMPTS = 3;

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
  const autoRead = useRef({ todoId, pending: false, failures: 0 });

  useEffect(() => subscribeFixtureUnread(refresh), []);

  const unread =
    todoId !== undefined &&
    (live
      ? (notificationsQ.data?.unreadThreadIds ?? []).includes(todoId)
      : isFixtureUnread(todoId, fixtureUnreadIds));

  useEffect(() => {
    if (autoRead.current.todoId !== todoId)
      autoRead.current = { todoId, pending: false, failures: 0 };
    if (!unread || !visible || todoId === undefined) return;
    if (!live) {
      setFixtureUnread(todoId, false);
      return;
    }
    const mark = autoRead.current;
    if (mark.pending || mark.failures >= UNREACHABLE_ATTEMPTS) return;
    mark.pending = true;
    mutations.setThreadRead
      .mutateAsync({ id: todoId, read: true })
      .then(
        () => {
          mark.failures = 0;
        },
        (error: unknown) => {
          mark.failures = isServerUnreachable(error) ? mark.failures + 1 : UNREACHABLE_ATTEMPTS;
        },
      )
      .finally(() => {
        mark.pending = false;
        refresh();
      });
  });
}
