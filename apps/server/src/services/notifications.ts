import type { NotificationRecord, TodoRecord, UserRecord } from '@cairn/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agent, chiefThread, notification } from '../db/schema.js';
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
  readAt?: number | null;
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
      readAt: input.readAt ?? null,
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
        readAt: input.readAt ?? null,
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

export function notifyTodoPhase(
  deps: NotificationDeps,
  todo: TodoRecord,
  to: 'confirm' | 'review',
): NotificationRecord {
  const agentId =
    to === 'confirm'
      ? (todo.assignment?.plan?.agentId ?? todo.assignment?.build?.agentId)
      : (todo.assignment?.build?.agentId ?? todo.assignment?.plan?.agentId);
  const agentRow = agentId
    ? deps.db.select().from(agent).where(eq(agent.id, agentId)).get()
    : undefined;
  return upsertAndPublish(deps, {
    teamId: todo.teamId,
    type: to === 'confirm' ? 'plan_ready' : 'build_review',
    entityId: todo.id,
    entityRef: { title: todo.title, projectId: todo.projectId, seqNum: todo.seqNum },
    agent: agentRow
      ? { name: agentRow.displayName, avatarUrl: agentRow.avatarUrl }
      : { name: deps.user.displayName, avatarUrl: deps.user.avatarUrl },
    snippet: null,
  });
}

export function notifyChiefMessage(
  deps: NotificationDeps,
  input: {
    threadId: string;
    message: string;
    agent: { name: string; avatarUrl: string | null };
    readAt?: number | null;
  },
): NotificationRecord {
  const thread = deps.db.select().from(chiefThread).where(eq(chiefThread.id, input.threadId)).get();
  if (!thread) throw notFound(`chief thread ${input.threadId}`);
  const readAt = input.readAt ?? null;
  if (readAt !== null) {
    const existing = deps.db
      .select()
      .from(notification)
      .where(eq(notification.id, `${deps.user.id}:${thread.id}`))
      .get();
    if (existing !== undefined && existing.readAt === null) return toNotificationRecord(existing);
  }
  return upsertAndPublish(deps, {
    teamId: thread.teamId,
    type: 'chief_message',
    entityId: thread.id,
    entityRef: { title: thread.title, projectId: null, seqNum: null },
    agent: input.agent,
    snippet: input.message,
    readAt,
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
    assignment?: { plan?: { agentId?: string } | null; build?: { agentId?: string } | null } | null;
  },
  block: { kind: 'quota' | 'capacity'; providerId: string; label: string | null },
): NotificationRecord {
  const agentId = todoRow.assignment?.build?.agentId ?? todoRow.assignment?.plan?.agentId ?? null;
  const agentRow = agentId
    ? deps.db.select().from(agent).where(eq(agent.id, agentId)).get()
    : undefined;
  const lane = block.label ?? block.providerId;
  const kindText = block.kind === 'quota' ? '额度空' : '限流';
  return upsertAndPublish(deps, {
    teamId: todoRow.teamId,
    type: 'quota_wait',
    entityId: todoRow.id,
    entityRef: { title: todoRow.title, projectId: todoRow.projectId, seqNum: todoRow.seqNum },
    agent: agentRow
      ? { name: agentRow.displayName, avatarUrl: agentRow.avatarUrl }
      : { name: deps.user.displayName, avatarUrl: deps.user.avatarUrl },
    snippet: `${lane} ${kindText}：任务挂起等额度，额度恢复后自动续跑`,
  });
}

export function notifyModelFallback(
  deps: NotificationDeps,
  todoRow: { id: string; teamId: string; title: string; projectId: string; seqNum: number },
  agentRow: { displayName: string; avatarUrl: string | null } | null,
  snippet: string,
): NotificationRecord {
  return upsertAndPublish(deps, {
    teamId: todoRow.teamId,
    type: 'model_fallback',
    entityId: todoRow.id,
    entityRef: { title: todoRow.title, projectId: todoRow.projectId, seqNum: todoRow.seqNum },
    agent: agentRow
      ? { name: agentRow.displayName, avatarUrl: agentRow.avatarUrl }
      : { name: deps.user.displayName, avatarUrl: deps.user.avatarUrl },
    snippet,
  });
}
