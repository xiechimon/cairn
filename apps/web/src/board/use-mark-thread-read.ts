import { useEffect, useReducer, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useConnected } from '../api/connection-state.js';
import { useApiMutations, useNotifications } from '../api/hooks.js';
import { useLiveData } from '../api/provider.js';
import { resolveScenario } from '../fixtures/scenario.js';
import { isFixtureUnread, setFixtureUnread, subscribeFixtureUnread } from '../fixtures/unread.js';
import { isServerUnreachable } from '../lib/error-copy.js';

const UNREACHABLE_ATTEMPTS = 3;

export function isWindowFocusedAndVisible(
  doc: { visibilityState: string; hasFocus?: () => boolean } = document,
): boolean {
  return (
    doc.visibilityState === 'visible' && (typeof doc.hasFocus !== 'function' || doc.hasFocus())
  );
}

function useWindowFocusedAndVisible(): boolean {
  const [visible, setVisible] = useState(() => isWindowFocusedAndVisible());
  useEffect(() => {
    const sync = () => setVisible(isWindowFocusedAndVisible());
    sync();
    document.addEventListener('visibilitychange', sync);
    window.addEventListener('focus', sync);
    window.addEventListener('blur', sync);
    return () => {
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('focus', sync);
      window.removeEventListener('blur', sync);
    };
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
  const visible = useWindowFocusedAndVisible();
  const connected = useConnected();
  const autoRead = useRef({ todoId, pending: false, failures: 0, returns: 0 });

  useEffect(() => subscribeFixtureUnread(refresh), []);

  useEffect(() => {
    if (!visible || !connected) return;
    autoRead.current.failures = 0;
    autoRead.current.returns += 1;
  }, [visible, connected]);

  const unread =
    todoId !== undefined &&
    (live
      ? (notificationsQ.data?.unreadThreadIds ?? []).includes(todoId)
      : isFixtureUnread(todoId, fixtureUnreadIds));

  useEffect(() => {
    if (autoRead.current.todoId !== todoId)
      autoRead.current = { todoId, pending: false, failures: 0, returns: 0 };
    if (!unread || !visible || todoId === undefined) return;
    if (!live) {
      setFixtureUnread(todoId, false);
      return;
    }
    const mark = autoRead.current;
    if (mark.pending || mark.failures >= UNREACHABLE_ATTEMPTS) return;
    mark.pending = true;
    const sentAfterReturn = mark.returns;
    mutations.setThreadRead
      .mutateAsync({ id: todoId, read: true })
      .then(
        () => {
          mark.failures = 0;
        },
        (error: unknown) => {
          if (mark.returns !== sentAfterReturn) return;
          mark.failures = isServerUnreachable(error) ? mark.failures + 1 : UNREACHABLE_ATTEMPTS;
        },
      )
      .finally(() => {
        mark.pending = false;
        refresh();
      });
  });
}
