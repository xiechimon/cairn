import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { schedule, todo } from '../db/schema.js';
import { sha256Hex } from '../lib/crypto.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { scheduleWebhookTokenMatches } from '../lib/webhook-token.js';
import type { TeamStreamHub } from './events.js';
import { projectOfTodo } from './git.js';
import { updateNextRunAt } from './schedules.js';

export interface ScheduleWebhookDeps {
  db: Db;
  hub: TeamStreamHub;
}

export type ScheduleWebhookResult =
  | { result: 'fired' | 'duplicate' | 'ignored'; deliveryId: string }
  | { result: 'unknown'; deliveryId: null };

const DELIVERY_HISTORY_LIMIT = 50;

export function fireScheduleWebhook(
  deps: ScheduleWebhookDeps,
  token: string,
  deliveryIdHeader: string | undefined,
): ScheduleWebhookResult {
  const row = deps.db
    .select()
    .from(schedule)
    .where(eq(schedule.webhookTokenHash, sha256Hex(token)))
    .get();
  if (
    row === undefined ||
    row.webhookTokenHash === null ||
    !scheduleWebhookTokenMatches(row.webhookTokenHash, token)
  ) {
    return { result: 'unknown', deliveryId: null };
  }
  const deliveryId =
    deliveryIdHeader !== undefined && deliveryIdHeader !== '' ? deliveryIdHeader : newRecordId();
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  const projectRow = todoRow !== undefined ? projectOfTodo(deps.db, todoRow) : undefined;
  if (
    row.kind !== 'webhook' ||
    !row.enabled ||
    todoRow === undefined ||
    todoRow.archivedAt !== null ||
    projectRow === undefined ||
    projectRow.archivedAt !== null
  ) {
    return { result: 'ignored', deliveryId };
  }
  const deliveries = row.webhookDeliveries ?? [];
  if (deliveries.includes(deliveryId)) return { result: 'duplicate', deliveryId };
  const now = nowMs();
  deps.db.transaction(() => {
    deps.db
      .update(schedule)
      .set({
        webhookDeliveries: [...deliveries, deliveryId].slice(-DELIVERY_HISTORY_LIMIT),
        webhookLastUsedAt: now,
        nextRunAt: now,
      })
      .where(eq(schedule.id, row.id))
      .run();
    updateNextRunAt(deps, row.id, now);
  });
  return { result: 'fired', deliveryId };
}
