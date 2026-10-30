import type { Db } from '../db/client.js';

const viewing = new WeakMap<Db, Map<string, number>>();

export function recordThreadPresence(
  db: Db,
  userId: string,
  teamId: string,
  todoId: string,
  tabId: string,
): void {
  const now = Date.now();
  const entries = viewing.get(db) ?? new Map<string, number>();
  for (const [key, at] of entries) {
    if (now - at >= 60_000) entries.delete(key);
  }
  entries.set(JSON.stringify([userId, teamId, todoId, tabId]), now);
  viewing.set(db, entries);
}

export function clearThreadPresence(
  db: Db,
  userId: string,
  teamId: string,
  todoId: string,
  tabId: string,
): void {
  viewing.get(db)?.delete(JSON.stringify([userId, teamId, todoId, tabId]));
}

export function isViewingThread(db: Db, userId: string, teamId: string, href: string): boolean {
  const match = /^\/app\/todo\/([^/?#]+)$/.exec(href);
  if (match?.[1] === undefined) return false;
  const entries = viewing.get(db);
  const now = Date.now();
  for (const [key, at] of entries ?? []) {
    if (now - at >= 60_000) {
      entries?.delete(key);
      continue;
    }
    const [viewerId, viewerTeamId, todoId] = JSON.parse(key) as string[];
    if (viewerId === userId && viewerTeamId === teamId && todoId === match[1]) return true;
  }
  return false;
}
