import { useEffect } from 'react';
import { api } from '../api/client.js';

const browserTabId = crypto.randomUUID();
const presenceWrites = new Map<string, Promise<unknown>>();

export function startThreadPresence(
  teamId: string,
  todoId: string,
  tabId: string = browserTabId,
): () => void {
  const path = `/api/teams/${encodeURIComponent(teamId)}/presence`;
  const key = JSON.stringify([teamId, todoId, tabId]);
  let present = false;
  const send = (visible: boolean) => {
    const pending = (presenceWrites.get(key) ?? Promise.resolve())
      .then(() => (visible ? api.post(path, { todoId, tabId }) : api.del(path, { todoId, tabId })))
      .catch(() => {});
    presenceWrites.set(key, pending);
    void pending.then(() => {
      if (presenceWrites.get(key) === pending) presenceWrites.delete(key);
    });
  };
  const heartbeat = () => {
    const visible = document.visibilityState === 'visible';
    if (!visible && !present) return;
    present = visible;
    send(visible);
  };
  heartbeat();
  const timer = setInterval(heartbeat, 30_000);
  document.addEventListener('visibilitychange', heartbeat);
  return () => {
    clearInterval(timer);
    document.removeEventListener('visibilitychange', heartbeat);
    if (present) {
      present = false;
      send(false);
    }
  };
}

export function useThreadPresence(
  teamId: string | null | undefined,
  todoId: string | undefined,
  enabled: boolean,
): void {
  useEffect(() => {
    if (!enabled || teamId == null || todoId === undefined) return;
    return startThreadPresence(teamId, todoId);
  }, [teamId, todoId, enabled]);
}
