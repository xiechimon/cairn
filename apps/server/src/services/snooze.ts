import {
  SNOOZE_EVENT_ENDS_SNOOZE,
  type SnoozeEvent,
  type SnoozeTodoBody,
  type TodoRecord,
  type UserRecord,
} from '@cairn/shared';
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { todo } from '../db/schema.js';
import { conflict } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import { resolveSnooze } from '../lib/snooze-time.js';
import type { TeamStreamHub } from './events.js';
import { markNotificationUnread } from './notifications.js';
import { getTodo } from './todos.js';

export interface SnoozeDeps {
  db: Db;
  hub: TeamStreamHub;
  user: UserRecord;
}

type TodoRow = typeof todo.$inferSelect;

function publish(deps: SnoozeDeps, id: string): TodoRecord | null {
  const record = getTodo(deps, id);
  if (record) deps.hub.publishTodoDoc(record.teamId, record);
  return record;
}

export function snoozeTodo(
  deps: SnoozeDeps,
  id: string,
  body: SnoozeTodoBody,
  now = nowMs(),
): TodoRecord | null {
  const row = deps.db.select().from(todo).where(eq(todo.id, id)).get();
  if (!row) return null;
  if (row.archivedAt !== null) throw conflict('Unarchive to snooze');
  const resolved = resolveSnooze(body.until, now, body.tz);
  deps.db
    .update(todo)
    .set({ snoozeMode: resolved.mode, snoozedUntil: resolved.until, v: row.v + 1 })
    .where(eq(todo.id, id))
    .run();
  return publish(deps, id);
}

export function unsnoozeTodo(deps: SnoozeDeps, id: string): TodoRecord | null {
  const row = deps.db.select().from(todo).where(eq(todo.id, id)).get();
  if (!row) return null;
  if (row.snoozeMode === null) return getTodo(deps, id);
  clearSnooze(deps, row);
  return publish(deps, id);
}

function clearSnooze(deps: SnoozeDeps, row: TodoRow): void {
  deps.db
    .update(todo)
    .set({ snoozeMode: null, snoozedUntil: null, v: row.v + 1 })
    .where(eq(todo.id, row.id))
    .run();
}

function returnThread(deps: SnoozeDeps, row: TodoRow): void {
  clearSnooze(deps, row);
  markNotificationUnread(deps, row.teamId, row.id);
  publish(deps, row.id);
}

export function endSnoozeOn(deps: SnoozeDeps, todoId: string, event: SnoozeEvent): boolean {
  if (!SNOOZE_EVENT_ENDS_SNOOZE[event]) return false;
  const row = deps.db
    .select()
    .from(todo)
    .where(and(eq(todo.id, todoId), isNotNull(todo.snoozeMode)))
    .get();
  if (!row) return false;
  returnThread(deps, row);
  return true;
}

export function sweepSnoozeExpiry(deps: SnoozeDeps, now: number): number {
  const due = deps.db
    .select()
    .from(todo)
    .where(
      and(eq(todo.snoozeMode, 'until'), isNotNull(todo.snoozedUntil), lte(todo.snoozedUntil, now)),
    )
    .all();
  for (const row of due) returnThread(deps, row);
  return due.length;
}
