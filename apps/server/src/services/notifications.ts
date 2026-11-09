import type { NeedsYouReason, NotificationRecord, UserRecord } from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { chiefThread, notification, todo as todoTable } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import type { TeamStreamHub } from './events.js';

export interface NotificationDeps {
  db: Db;
  hub: TeamStreamHub;
  user: UserRecord;
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

function upsertAndPublish(deps: NotificationDeps, input: NotificationInput): NotificationRecord {
  const id = `${deps.user.id}:${input.entityId}`;
  const createdAt = nowMs();
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
      },
    })
    .run();
  const row = deps.db.select().from(notification).where(eq(notification.id, id)).get();
  if (!row) throw new Error(`notification ${id} missing after upsert`);
  const record = toNotificationRecord(row);
  deps.hub.publishNotification(record.teamId, record);
  return record;
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
  handoff: 'build_review',
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
  todoRow: TodoNoticeSource,
  snippet: string | null,
): NotificationRecord {
  return upsertAndPublish(deps, {
    teamId: todoRow.teamId,
    type: 'schedule_run',
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
  deps.db.update(notification).set({ readAt: nowMs() }).where(eq(notification.id, row.id)).run();
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
    if (row.readAt === null) return toNotificationRecord(row);
    deps.db.update(notification).set({ readAt: null }).where(eq(notification.id, row.id)).run();
    return republish(deps, row.id);
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

function republish(deps: NotificationDeps, id: string): NotificationRecord {
  const row = deps.db.select().from(notification).where(eq(notification.id, id)).get();
  if (!row) throw new Error(`notification ${id} missing after update`);
  const record = toNotificationRecord(row);
  deps.hub.publishNotification(record.teamId, record);
  return record;
}

export function notifyChiefMessage(
  deps: NotificationDeps,
  input: {
    threadId: string;
    message: string;
    agent: { name: string; avatarUrl: string | null };
  },
): NotificationRecord {
  const thread = deps.db.select().from(chiefThread).where(eq(chiefThread.id, input.threadId)).get();
  if (!thread) throw notFound(`chief thread ${input.threadId}`);
  return upsertAndPublish(deps, {
    teamId: thread.teamId,
    type: 'chief_message',
    entityId: thread.id,
    entityRef: { title: thread.title, projectId: null, seqNum: null },
    agent: input.agent,
    snippet: input.message,
  });
}

export const CHIEF_UNREAD_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

export function sweepIdleChiefUnread(deps: { db: Db }, now: number): void {
  const rows = deps.db
    .select({
      id: notification.id,
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
    deps.db.update(notification).set({ readAt: now }).where(eq(notification.id, row.id)).run();
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
    snippet: `${lane} ${kindText}：任务挂起等额度，额度恢复后自动续跑`,
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
