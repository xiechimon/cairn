import { isChiefSideThreadId } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefThread, project, schedule, todo } from '../db/schema.js';
import { sha256Hex } from '../lib/crypto.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { webhookTokenMatches } from '../lib/webhook-token.js';
import type { TeamStreamHub } from './events.js';
import { projectOfTodo } from './git.js';
import { notifyScheduleClock } from './schedules.js';

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
    !webhookTokenMatches(row.webhookTokenHash, token)
  ) {
    return { result: 'unknown', deliveryId: null };
  }
  const deliveryId =
    deliveryIdHeader !== undefined && deliveryIdHeader !== '' ? deliveryIdHeader : newRecordId();
  let targetActive = false;
  if (row.chiefThreadId !== null) {
    const threadRow = deps.db
      .select()
      .from(chiefThread)
      .where(eq(chiefThread.id, row.chiefThreadId))
      .get();
    const projectRow =
      threadRow?.projectId != null
        ? deps.db.select().from(project).where(eq(project.id, threadRow.projectId)).get()
        : undefined;
    targetActive =
      threadRow !== undefined &&
      !isChiefSideThreadId(threadRow.id) &&
      threadRow.teamId === row.teamId &&
      threadRow.archivedAt === null &&
      (threadRow.projectId === null ||
        (projectRow !== undefined &&
          projectRow.teamId === row.teamId &&
          projectRow.archivedAt === null));
  } else if (row.todoId !== null) {
    const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
    const projectRow = todoRow !== undefined ? projectOfTodo(deps.db, todoRow) : undefined;
    targetActive =
      todoRow !== undefined &&
      todoRow.teamId === row.teamId &&
      todoRow.archivedAt === null &&
      projectRow !== undefined &&
      projectRow.teamId === row.teamId &&
      projectRow.archivedAt === null;
  }
  if (row.kind !== 'webhook' || !row.enabled || !targetActive) {
    return { result: 'ignored', deliveryId };
  }
  const result = deps.db.transaction(
    (tx) => {
      const fresh = tx.select().from(schedule).where(eq(schedule.id, row.id)).get();
      if (!fresh || fresh.kind !== 'webhook' || !fresh.enabled) {
        return 'ignored' as const;
      }
      const deliveries = fresh.webhookDeliveries ?? [];
      if (deliveries.includes(deliveryId)) return 'duplicate' as const;
      const now = nowMs();
      tx.update(schedule)
        .set({
          webhookDeliveries: [...deliveries, deliveryId].slice(-DELIVERY_HISTORY_LIMIT),
          webhookLastUsedAt: now,
          nextRunAt: now,
        })
        .where(eq(schedule.id, row.id))
        .run();
      return 'fired' as const;
    },
    { behavior: 'immediate' },
  );
  if (result === 'fired') notifyScheduleClock(deps.db);
  return { result, deliveryId };
}
