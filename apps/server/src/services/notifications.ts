import {
  type NeedsYouReason,
  type NotificationRecord,
  SILENT_NOTIFICATION_TYPES,
  type UserRecord,
} from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type CommitEffects, runAfterCommit } from '../db/commit-effects.js';
import {
  chiefMessage,
  chiefThread,
  noticeMark,
  notification,
  todo as todoTable,
} from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import type { TeamStreamHub } from './events.js';
import { imNotice } from './im/runtime.js';
import {
  cancelPendingNotificationDelivery,
  routeNotificationDelivery,
} from './notification-router.js';
import { activeNotificationProject, canDeliverNotification } from './project-visibility.js';
import type { VapidKeys } from './push.js';

export interface NotificationDeps extends CommitEffects {
  db: Db;
  hub: TeamStreamHub;
  user: UserRecord;
  vapidKeys?: VapidKeys | null;
}

type NotificationRow = typeof notification.$inferSelect;

export function toNotificationRecord(row: NotificationRow): NotificationRecord {
  return {
    teamId: row.teamId,
    userId: row.userId,
    type: row.type,
    entityId: row.entityId,
    entityRef: row.entityRef,
    agent: { name: row.agentName, avatarUrl: row.agentAvatarUrl },
    snippet: row.snippet,
    id: row.id,
    readAt: row.readAt,
    createdAt: row.createdAt,
    channels: row.channels,
  };
}

interface NotificationInput {
  teamId: string;
  type: NotificationRecord['type'];
  entityId: string;
  entityRef: NotificationRecord['entityRef'];
  agent: { name: string; avatarUrl: string | null };
  snippet: string | null;
}

function upsertAndPublish(
  deps: NotificationDeps,
  input: NotificationInput,
  options?: { skipAwayDispatch?: boolean },
): NotificationRecord {
  const id = `${deps.user.id}:${input.entityId}`;
  const createdAt = nowMs();
  const existing = deps.db.select().from(notification).where(eq(notification.id, id)).get();
  const isSilent = SILENT_NOTIFICATION_TYPES.includes(input.type);

  if (isSilent) {
    if (
      (input.type === 'todo_done' || input.type === 'todo_failed') &&
      existing !== undefined &&
      existing.readAt === null &&
      existing.type === 'schedule_run' &&
      (existing.deliveryStatus === 'desktop' ||
        existing.deliveryStatus === 'pending_away' ||
        existing.deliveryStatus === 'away')
    ) {
      return toNotificationRecord(existing);
    }
    if (existing !== undefined && existing.deliveryStatus === 'pending_away') {
      cancelPendingNotificationDelivery(deps.db, id, existing.deliveryId);
    }
    deps.db
      .insert(notification)
      .values({
        id,
        teamId: input.teamId,
        userId: deps.user.id,
        type: input.type,
        entityId: input.entityId,
        entityRef: input.entityRef,
        agentName: input.agent.name,
        agentAvatarUrl: input.agent.avatarUrl,
        snippet: input.snippet,
        readAt: null,
        createdAt,
        channels: ['in_app'],
        deliveryId: null,
        deliveryStatus: 'none',
        deliveryTarget: null,
        deliveryDueAt: null,
      })
      .onConflictDoUpdate({
        target: notification.id,
        set: {
          type: input.type,
          entityRef: input.entityRef,
          agentName: input.agent.name,
          agentAvatarUrl: input.agent.avatarUrl,
          snippet: input.snippet,
          readAt: null,
          createdAt,
          deliveryId: null,
          deliveryStatus: 'none',
          deliveryTarget: null,
          deliveryDueAt: null,
        },
      })
      .run();
    const row = deps.db.select().from(notification).where(eq(notification.id, id)).get();
    if (!row) throw new Error(`notification ${id} missing after upsert`);
    const record = toNotificationRecord(row);
    if (canDeliverNotification(deps.db, id)) {
      deps.hub.publishNotification(record.teamId, record, { id: '', targetClientId: null });
    }
    return record;
  }

  if (existing !== undefined) {
    cancelPendingNotificationDelivery(deps.db, id, existing.deliveryId);
  }
  const deliveryId = newRecordId();
  deps.db
    .insert(notification)
    .values({
      id,
      teamId: input.teamId,
      userId: deps.user.id,
      type: input.type,
      entityId: input.entityId,
      entityRef: input.entityRef,
      agentName: input.agent.name,
      agentAvatarUrl: input.agent.avatarUrl,
      snippet: input.snippet,
      readAt: null,
      createdAt,
      channels: ['in_app'],
      deliveryId,
      deliveryStatus: 'none',
      deliveryTarget: null,
      deliveryDueAt: null,
    })
    .onConflictDoUpdate({
      target: notification.id,
      set: {
        type: input.type,
        entityRef: input.entityRef,
        agentName: input.agent.name,
        agentAvatarUrl: input.agent.avatarUrl,
        snippet: input.snippet,
        readAt: null,
        createdAt,
        deliveryId,
        deliveryStatus: 'none',
        deliveryTarget: null,
        deliveryDueAt: null,
      },
    })
    .run();
  const row = deps.db.select().from(notification).where(eq(notification.id, id)).get();
  if (!row) throw new Error(`notification ${id} missing after upsert`);
  const record = toNotificationRecord(row);
  if (!canDeliverNotification(deps.db, id)) return record;
  const routed = routeNotificationDelivery(deps, record, deliveryId, options);
  deps.hub.publishNotification(routed.record.teamId, routed.record, routed.delivery);
  return routed.record;
}

interface TodoNoticeSource {
  id: string;
  teamId: string;
  title: string;
  projectId: string | null;
  seqNum: number | null;
}

function todoNoticeAgent(deps: NotificationDeps): { name: string; avatarUrl: string | null } {
  return { name: deps.user.displayName, avatarUrl: deps.user.avatarUrl };
}

export function notifyTodo(
  deps: NotificationDeps,
  todo: TodoNoticeSource,
  type: NotificationRecord['type'],
  snippet: string | null = null,
): NotificationRecord {
  return upsertAndPublish(deps, {
    teamId: todo.teamId,
    type,
    entityId: todo.id,
    entityRef: { title: todo.title, projectId: todo.projectId, seqNum: todo.seqNum },
    agent: todoNoticeAgent(deps),
    snippet,
  });
}

const OWNERSHIP_NOTIFICATION_TYPE = {
  question: 'build_review',
  confirm: 'plan_ready',
  review: 'build_review',
  handoff: 'coordinator_handoff',
} as const satisfies Record<NeedsYouReason, NotificationRecord['type']>;

export function notifyOwnership(
  deps: NotificationDeps,
  todo: TodoNoticeSource,
  reason: NeedsYouReason,
): NotificationRecord {
  return notifyTodo(deps, todo, OWNERSHIP_NOTIFICATION_TYPE[reason]);
}

export function notifyScheduleRun(
  deps: NotificationDeps,
  targetRow: TodoNoticeSource,
  snippet: string | null,
): NotificationRecord {
  return upsertAndPublish(deps, {
    teamId: targetRow.teamId,
    type: 'schedule_run',
    entityId: targetRow.id,
    entityRef: { title: targetRow.title, projectId: targetRow.projectId, seqNum: targetRow.seqNum },
    agent: todoNoticeAgent(deps),
    snippet,
  });
}

export function notifyWatchdogFlag(
  deps: NotificationDeps,
  todoRow: TodoNoticeSource,
  snippet: string,
): NotificationRecord {
  return upsertAndPublish(deps, {
    teamId: todoRow.teamId,
    type: 'watchdog_flag',
    entityId: todoRow.id,
    entityRef: { title: todoRow.title, projectId: todoRow.projectId, seqNum: todoRow.seqNum },
    agent: todoNoticeAgent(deps),
    snippet,
  });
}

export function listUnreadEntityIds(deps: NotificationDeps, teamId: string): string[] {
  return deps.db
    .selectDistinct({ entityId: notification.entityId })
    .from(notification)
    .where(
      and(
        eq(notification.teamId, teamId),
        eq(notification.userId, deps.user.id),
        isNull(notification.readAt),
        activeNotificationProject(deps.db),
      ),
    )
    .all()
    .map((r) => r.entityId);
}

export function markNotificationRead(
  deps: NotificationDeps,
  teamId: string,
  entityId: string,
): NotificationRecord {
  const row = deps.db
    .select()
    .from(notification)
    .where(and(eq(notification.id, `${deps.user.id}:${entityId}`), eq(notification.teamId, teamId)))
    .get();
  if (!row) throw notFound(`notification ${entityId}`);
  if (row.readAt !== null) return toNotificationRecord(row);
  deps.db
    .update(notification)
    .set({ readAt: nowMs(), deliveryStatus: 'read', deliveryDueAt: null })
    .where(eq(notification.id, row.id))
    .run();
  cancelPendingNotificationDelivery(deps.db, row.id, row.deliveryId);
  return republish(deps, row.id);
}

export function markNotificationUnread(
  deps: NotificationDeps,
  teamId: string,
  entityId: string,
): NotificationRecord {
  const row = deps.db
    .select()
    .from(notification)
    .where(and(eq(notification.id, `${deps.user.id}:${entityId}`), eq(notification.teamId, teamId)))
    .get();
  if (row) {
    cancelPendingNotificationDelivery(deps.db, row.id, row.deliveryId);
    if (row.readAt === null && row.deliveryStatus === 'none') return toNotificationRecord(row);
    deps.db
      .update(notification)
      .set({
        readAt: null,
        deliveryStatus: 'none',
        deliveryTarget: null,
        deliveryDueAt: null,
      })
      .where(eq(notification.id, row.id))
      .run();
    return republish(deps, row.id, { id: '', targetClientId: null });
  }
  const todoRow = deps.db
    .select()
    .from(todoTable)
    .where(and(eq(todoTable.id, entityId), eq(todoTable.teamId, teamId)))
    .get();
  if (!todoRow) throw notFound(`notification ${entityId}`);
  return upsertAndPublish(deps, {
    teamId,
    type: 'marked_unread',
    entityId,
    entityRef: { title: todoRow.title, projectId: todoRow.projectId, seqNum: todoRow.seqNum },
    agent: todoNoticeAgent(deps),
    snippet: null,
  });
}

function republish(
  deps: NotificationDeps,
  id: string,
  delivery?: { id: string; targetClientId: string | null },
): NotificationRecord {
  const row = deps.db.select().from(notification).where(eq(notification.id, id)).get();
  if (!row) throw new Error(`notification ${id} missing after update`);
  const record = toNotificationRecord(row);
  deps.hub.publishNotification(record.teamId, record, delivery);
  return record;
}

export function notifyChiefMessage(
  deps: NotificationDeps,
  input: {
    threadId: string;
    message: string;
    agent: { name: string; avatarUrl: string | null };
    card?: { requestId: string };
    projectId?: string | null;
    skipAwayDispatch?: boolean;
  },
): NotificationRecord {
  const thread = deps.db.select().from(chiefThread).where(eq(chiefThread.id, input.threadId)).get();
  if (!thread) throw notFound(`chief thread ${input.threadId}`);
  const questionProject =
    input.card === undefined
      ? null
      : deps.db
          .select({ id: chiefMessage.projectId })
          .from(chiefMessage)
          .where(
            and(eq(chiefMessage.id, input.card.requestId), eq(chiefMessage.threadId, thread.id)),
          )
          .get()?.id;
  const record = upsertAndPublish(
    deps,
    {
      teamId: thread.teamId,
      type: 'chief_message',
      entityId: thread.id,
      entityRef: {
        title: thread.title,
        projectId: questionProject ?? input.projectId ?? thread.projectId,
        seqNum: null,
      },
      agent: input.agent,
      snippet: input.message,
    },
    { skipAwayDispatch: input.skipAwayDispatch },
  );
  if (canDeliverNotification(deps.db, record.id)) {
    runAfterCommit(deps, 'imNotice', () =>
      imNotice(input.threadId, input.message, input.card, deps.db),
    );
  }
  return record;
}

export const CHIEF_UNREAD_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

export function sweepIdleChiefUnread(deps: { db: Db; hub?: TeamStreamHub }, now: number): void {
  const rows = deps.db
    .select({
      id: notification.id,
      teamId: notification.teamId,
      deliveryId: notification.deliveryId,
      updatedAt: chiefThread.updatedAt,
      lastTurnAt: chiefThread.lastTurnAt,
    })
    .from(notification)
    .innerJoin(chiefThread, eq(notification.entityId, chiefThread.id))
    .where(and(eq(notification.type, 'chief_message'), isNull(notification.readAt)))
    .all();
  for (const row of rows) {
    const last = Math.max(row.updatedAt, row.lastTurnAt ?? 0);
    if (now - last <= CHIEF_UNREAD_IDLE_MS) continue;
    deps.db
      .update(notification)
      .set({ readAt: now, deliveryStatus: 'read', deliveryDueAt: null })
      .where(eq(notification.id, row.id))
      .run();
    cancelPendingNotificationDelivery(deps.db, row.id, row.deliveryId);
    if (deps.hub !== undefined) {
      const updated = deps.db.select().from(notification).where(eq(notification.id, row.id)).get();
      if (updated !== undefined) {
        deps.hub.publishNotification(updated.teamId, toNotificationRecord(updated));
      }
    }
  }
}

export function notifyQuotaWait(
  deps: NotificationDeps,
  todoRow: {
    id: string;
    teamId: string;
    title: string;
    projectId: string;
    seqNum: number;
  },
  block: { kind: 'quota' | 'capacity'; providerId: string; label: string | null },
): NotificationRecord {
  const lane = block.label ?? block.providerId;
  const kindText = block.kind === 'quota' ? '额度空' : '限流';
  return upsertAndPublish(deps, {
    teamId: todoRow.teamId,
    type: 'quota_wait',
    entityId: todoRow.id,
    entityRef: { title: todoRow.title, projectId: todoRow.projectId, seqNum: todoRow.seqNum },
    agent: todoNoticeAgent(deps),
    snippet: `${lane} ${kindText}：任务挂起等额度，额度恢复后自动继续运行`,
  });
}

export function notifyNoMachine(
  deps: NotificationDeps,
  todoRow: { id: string; teamId: string; title: string; projectId: string; seqNum: number },
  snippet: string,
): NotificationRecord {
  return upsertAndPublish(deps, {
    teamId: todoRow.teamId,
    type: 'no_machine',
    entityId: todoRow.id,
    entityRef: { title: todoRow.title, projectId: todoRow.projectId, seqNum: todoRow.seqNum },
    agent: { name: deps.user.displayName, avatarUrl: deps.user.avatarUrl },
    snippet,
  });
}

export function notifyModelFallback(
  deps: NotificationDeps,
  todoRow: { id: string; teamId: string; title: string; projectId: string; seqNum: number },
  agentRow: { displayName: string } | null,
  snippet: string,
): NotificationRecord {
  return upsertAndPublish(deps, {
    teamId: todoRow.teamId,
    type: 'model_fallback',
    entityId: todoRow.id,
    entityRef: { title: todoRow.title, projectId: todoRow.projectId, seqNum: todoRow.seqNum },
    agent: agentRow
      ? { name: agentRow.displayName, avatarUrl: null }
      : { name: deps.user.displayName, avatarUrl: deps.user.avatarUrl },
    snippet,
  });
}

export type NoticeCondition = (typeof noticeMark.$inferSelect)['condition'];

export interface ActiveCondition {
  subjectId: string;
  fingerprint: string;
  notify: () => void;
}

export function raiseConditionNotices(
  deps: NotificationDeps,
  condition: NoticeCondition,
  active: readonly ActiveCondition[],
  now: number,
): number {
  const marks = new Map(
    deps.db
      .select()
      .from(noticeMark)
      .where(and(eq(noticeMark.userId, deps.user.id), eq(noticeMark.condition, condition)))
      .all()
      .map((mark) => [mark.subjectId, mark]),
  );
  const activeSubjects = new Set<string>();
  let raised = 0;
  for (const entry of active) {
    if (activeSubjects.has(entry.subjectId)) continue;
    activeSubjects.add(entry.subjectId);
    if (marks.get(entry.subjectId)?.fingerprint === entry.fingerprint) continue;
    deps.db.transaction((tx) => {
      entry.notify();
      tx.insert(noticeMark)
        .values({
          id: `${deps.user.id}:${condition}:${entry.subjectId}`,
          userId: deps.user.id,
          condition,
          subjectId: entry.subjectId,
          fingerprint: entry.fingerprint,
          notedAt: now,
        })
        .onConflictDoUpdate({
          target: noticeMark.id,
          set: { fingerprint: entry.fingerprint, notedAt: now },
        })
        .run();
    });
    raised += 1;
  }
  for (const mark of marks.values()) {
    if (!activeSubjects.has(mark.subjectId)) {
      deps.db.delete(noticeMark).where(eq(noticeMark.id, mark.id)).run();
    }
  }
  return raised;
}
