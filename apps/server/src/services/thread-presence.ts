import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { databaseIdentity } from '../db/identity.js';
import { user } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';

export const PRESENCE_TTL_MS = 75_000;
export const LEGACY_THREAD_PRESENCE_TTL_MS = 60_000;
export const DESKTOP_IDLE_THRESHOLD_SEC = 600;
export const SCREEN_LOCK_GRACE_MS = 60_000;
export const DESKTOP_OFFLINE_GRACE_MS = 600_000;

export interface ClientPresenceInput {
  userId: string;
  teamId: string;
  clientId: string;
  kind: 'desktop' | 'web';
  focused: boolean;
  activeThreadId: string | null;
  screenLocked: boolean;
  systemIdleSec: number;
  canNotify: boolean;
  seq: number;
}

export interface ClientPresenceRecord extends ClientPresenceInput {
  lockedSince: number | null;
  updatedAt: number;
}

export type PresenceRoutingDecision =
  | { kind: 'read' }
  | { kind: 'suppressed' }
  | { kind: 'desktop'; clientId: string }
  | { kind: 'pending_away'; dueAt: number }
  | { kind: 'away' };

const clientsByDb = new WeakMap<Db, Map<string, ClientPresenceRecord>>();

function clientMap(db: Db): Map<string, ClientPresenceRecord> {
  const root = databaseIdentity(db);
  let map = clientsByDb.get(root);
  if (map === undefined) {
    map = new Map();
    clientsByDb.set(root, map);
  }
  return map;
}

function presenceKey(userId: string, clientId: string): string {
  return `${userId}\0${clientId}`;
}

function ttlFor(record: ClientPresenceRecord): number {
  return record.clientId.startsWith('legacy:') ? LEGACY_THREAD_PRESENCE_TTL_MS : PRESENCE_TTL_MS;
}

function purgeExpired(map: Map<string, ClientPresenceRecord>, now: number): void {
  for (const [key, entry] of map) {
    if (now - entry.updatedAt >= ttlFor(entry)) map.delete(key);
  }
}

function activeEntries(db: Db, userId: string, now: number): ClientPresenceRecord[] {
  const map = clientMap(db);
  purgeExpired(map, now);
  const out: ClientPresenceRecord[] = [];
  for (const entry of map.values()) {
    if (entry.userId === userId) out.push(entry);
  }
  return out;
}

export function recordClientPresence(
  db: Db,
  input: ClientPresenceInput,
): { accepted: boolean; shouldReconcile: boolean } {
  const now = nowMs();
  const map = clientMap(db);
  purgeExpired(map, now);
  const key = presenceKey(input.userId, input.clientId);
  const existing = map.get(key);
  if (existing !== undefined && input.seq < existing.seq) {
    return { accepted: false, shouldReconcile: false };
  }
  const lockedSince = input.screenLocked ? (existing?.lockedSince ?? now) : null;
  const record: ClientPresenceRecord = {
    ...input,
    lockedSince,
    updatedAt: now,
  };
  map.set(key, record);
  const activeNotifiableDesktop =
    input.kind === 'desktop' &&
    !input.screenLocked &&
    input.systemIdleSec < DESKTOP_IDLE_THRESHOLD_SEC &&
    input.canNotify;
  if (activeNotifiableDesktop) {
    databaseIdentity(db)
      .update(user)
      .set({ lastDesktopActiveAt: now })
      .where(eq(user.id, input.userId))
      .run();
  }
  const activelyFocused =
    input.focused && !input.screenLocked && input.systemIdleSec < DESKTOP_IDLE_THRESHOLD_SEC;
  return { accepted: true, shouldReconcile: activeNotifiableDesktop || activelyFocused };
}

export function clearClientPresence(
  db: Db,
  userId: string,
  clientId: string,
  seq?: number,
): boolean {
  const map = clientMap(db);
  const key = presenceKey(userId, clientId);
  const existing = map.get(key);
  if (existing === undefined) return false;
  if (seq !== undefined && seq < existing.seq) return false;
  return map.delete(key);
}

export function recordThreadPresence(
  db: Db,
  userId: string,
  teamId: string,
  todoId: string,
  tabId: string,
): void {
  const now = nowMs();
  const map = clientMap(db);
  purgeExpired(map, now);
  const clientId = `legacy:${tabId}\0${todoId}`;
  const key = presenceKey(userId, clientId);
  const existing = map.get(key);
  map.set(key, {
    userId,
    teamId,
    clientId,
    kind: 'web',
    focused: false,
    activeThreadId: todoId,
    screenLocked: false,
    systemIdleSec: 0,
    canNotify: false,
    seq: (existing?.seq ?? 0) + 1,
    lockedSince: null,
    updatedAt: now,
  });
}

export function clearThreadPresence(
  db: Db,
  userId: string,
  teamId: string,
  todoId: string,
  tabId: string,
): void {
  const map = clientMap(db);
  const clientId = `legacy:${tabId}\0${todoId}`;
  const key = presenceKey(userId, clientId);
  const existing = map.get(key);
  if (existing !== undefined && existing.teamId === teamId && existing.activeThreadId === todoId) {
    map.delete(key);
  }
}

export function entityIdFromHref(href: string): string | null {
  const todoPath = /^\/app\/todo\/([^/?#]+)$/.exec(href);
  if (todoPath?.[1] !== undefined) return decodeURIComponent(todoPath[1]);
  const threadQuery = /^\/app\?(?:.*&)?thread=([^&#]+)/.exec(href);
  if (threadQuery?.[1] !== undefined) return decodeURIComponent(threadQuery[1]);
  const chiefQuery = /^\/app\?(?:.*&)?chief=([^&#]+)/.exec(href);
  if (chiefQuery?.[1] !== undefined) return decodeURIComponent(chiefQuery[1]);
  return null;
}

export function isViewingThread(db: Db, userId: string, teamId: string, href: string): boolean {
  const entityId = entityIdFromHref(href);
  if (entityId === null) return false;
  const entries = activeEntries(db, userId, nowMs());
  return entries.some(
    (entry) =>
      entry.teamId === teamId &&
      (entry.focused || entry.clientId.startsWith('legacy:')) &&
      !entry.screenLocked &&
      entry.systemIdleSec < DESKTOP_IDLE_THRESHOLD_SEC &&
      entry.activeThreadId === entityId,
  );
}

function pickBestTarget(candidates: readonly ClientPresenceRecord[]): ClientPresenceRecord | null {
  if (candidates.length === 0) return null;
  const sorted = [...candidates].sort((a, b) => {
    if (a.systemIdleSec !== b.systemIdleSec) return a.systemIdleSec - b.systemIdleSec;
    if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
    return a.clientId.localeCompare(b.clientId);
  });
  return sorted[0] ?? null;
}

export function evaluatePresenceRouting(
  db: Db,
  userId: string,
  entityId: string,
  now = nowMs(),
): PresenceRoutingDecision {
  const entries = activeEntries(db, userId, now);
  const activeFocused = entries.filter(
    (entry) =>
      !entry.clientId.startsWith('legacy:') &&
      entry.focused &&
      !entry.screenLocked &&
      entry.systemIdleSec < DESKTOP_IDLE_THRESHOLD_SEC,
  );
  const legacyViewingThread = entries.some(
    (entry) => entry.clientId.startsWith('legacy:') && entry.activeThreadId === entityId,
  );
  if (activeFocused.some((entry) => entry.activeThreadId === entityId) || legacyViewingThread) {
    return { kind: 'read' };
  }
  if (activeFocused.length > 0) {
    return { kind: 'suppressed' };
  }

  const desktops = entries.filter((entry) => entry.kind === 'desktop');
  const activeDesktops = desktops.filter(
    (entry) =>
      !entry.screenLocked && entry.systemIdleSec < DESKTOP_IDLE_THRESHOLD_SEC && entry.canNotify,
  );
  const bestDesktop = pickBestTarget(activeDesktops);
  if (bestDesktop !== null) {
    return { kind: 'desktop', clientId: bestDesktop.clientId };
  }

  if (desktops.length === 0) {
    const activeWebs = entries.filter(
      (entry) =>
        entry.kind === 'web' &&
        !entry.focused &&
        !entry.screenLocked &&
        entry.systemIdleSec < DESKTOP_IDLE_THRESHOLD_SEC &&
        entry.canNotify,
    );
    const bestWeb = pickBestTarget(activeWebs);
    if (bestWeb !== null) {
      return { kind: 'desktop', clientId: bestWeb.clientId };
    }
  }

  const unlockedNonNotifiableDesktop = desktops.some(
    (entry) =>
      !entry.screenLocked && entry.systemIdleSec < DESKTOP_IDLE_THRESHOLD_SEC && !entry.canNotify,
  );
  if (unlockedNonNotifiableDesktop) {
    return { kind: 'away' };
  }

  let dueAt: number | null = null;
  for (const entry of desktops) {
    if (entry.screenLocked && entry.lockedSince !== null && entry.canNotify) {
      const candidate = entry.lockedSince + SCREEN_LOCK_GRACE_MS;
      if (dueAt === null || candidate > dueAt) dueAt = candidate;
    }
  }
  if (desktops.length === 0) {
    const row = databaseIdentity(db)
      .select({ lastDesktopActiveAt: user.lastDesktopActiveAt })
      .from(user)
      .where(eq(user.id, userId))
      .get();
    if (row?.lastDesktopActiveAt != null) {
      const candidate = row.lastDesktopActiveAt + DESKTOP_OFFLINE_GRACE_MS;
      if (dueAt === null || candidate > dueAt) dueAt = candidate;
    }
  }

  if (dueAt !== null && dueAt > now) {
    return { kind: 'pending_away', dueAt };
  }
  return { kind: 'away' };
}

export function isDesktopActive(db: Db, userId: string, now = nowMs()): boolean {
  const entries = activeEntries(db, userId, now);
  const desktops = entries.filter((entry) => entry.kind === 'desktop');
  if (
    desktops.some(
      (entry) =>
        !entry.screenLocked && entry.systemIdleSec < DESKTOP_IDLE_THRESHOLD_SEC && entry.canNotify,
    )
  ) {
    return true;
  }
  if (desktops.length === 0) {
    const row = databaseIdentity(db)
      .select({ lastDesktopActiveAt: user.lastDesktopActiveAt })
      .from(user)
      .where(eq(user.id, userId))
      .get();
    if (
      row?.lastDesktopActiveAt != null &&
      row.lastDesktopActiveAt + DESKTOP_OFFLINE_GRACE_MS > now
    ) {
      return true;
    }
  }
  return false;
}
