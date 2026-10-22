// 通知服务面（02 §9.1 + r5 §7.2 三事件矩阵；04 §5 divergence 口径：in-app 层
// 1:1——SSE notification 事件 + 未读联动 GET notifications → unreadThreadIds；
// Web Push/VAPID 不进 spec（已裁决登记），桌面弹出 = web 页层 document.hidden
// 时 new Notification()，非本面）。
// 触发矩阵（r5 §7.2 实测照抄）：
// - plan_ready：进 confirm（plan 就绪）
// - build_review：进 review（含定时轮停 review——无独立「定时轮结束」类型，
//   triggerSource:"schedule" 仅在 build doc 上）
// - chief_message：Chief 线程消息，snippet=消息全文（relay 挂接面归 M4）
// - 进 done、进 failed 无 in-app 通知事件
// 行 id = 组合键 "<userId>:<entityId>"（r5 §7.2 原样）→ 同键 upsert：同一
// todo 的第二次业务事件覆盖行并重置 readAt（站内未读按 thread 非按事件）。
// channels 恒 ["in_app"]（r5 §7.2 实测值；复刻按 R1 divergence 恒定，04 §5）。

import type { NotificationRecord, TodoRecord, UserRecord } from '@pacman/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agent, chiefThread, notification } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { nowMs } from '../lib/ids.js';
import type { TeamStreamHub } from './events.js';

export interface NotificationDeps {
  db: Db;
  hub: TeamStreamHub;
  /** 收件人 = seed 单用户（02 §2.1；多租户不在复刻范围，A2）。 */
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
  /** 缺省 null = 未读。机器回合传当前时刻，落库即已读。 */
  readAt?: number | null;
}

/** 落行（组合键 upsert）+ SSE 事件（hub.publishNotification）。 */
function upsertAndPublish(deps: NotificationDeps, input: NotificationInput): NotificationRecord {
  const id = `${deps.user.id}:${input.entityId}`; // 组合键（r5 §7.2 原样）
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
        readAt: input.readAt ?? null, // 新事件重置未读（thread 粒度）；机器回合保持已读
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

/** todo 类事件（plan_ready/build_review）——phase 流转漏斗统一挂接
 * （services/todos.ts setTodoPhase/updateTodo）。
 * agent 归因 = assignment 对应槽 → agent 行：plan_ready 取 plan 槽、
 * build_review 取 build 槽，缺则互备；两槽皆空 = 属主代行 [推断]
 * （观测窗样本均带 Agent，未指派形态无外部真值）。 */
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
    // todo 类事件 entityRef = title/projectId/seqNum（r5 §7.2）。
    entityRef: { title: todo.title, projectId: todo.projectId, seqNum: todo.seqNum },
    agent: agentRow
      ? { name: agentRow.displayName, avatarUrl: agentRow.avatarUrl }
      : { name: deps.user.displayName, avatarUrl: deps.user.avatarUrl },
    snippet: null,
  });
}

/** chief_message（r5 §7.2：snippet=消息全文；entityRef = thread title，
 * projectId/seqNum null [推断]，records/notification.ts 注同）。
 * 调用方 = Chief relay（M4 挂接面）；agent = Chief 绑定 Agent。 */
export function notifyChiefMessage(
  deps: NotificationDeps,
  input: {
    threadId: string;
    message: string;
    agent: { name: string; avatarUrl: string | null };
    /** 非空 = 机器回合。没有既有未读行时落库即已读；既有未读原样返回，不覆盖、不重发。 */
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

/** 总管未读闲置窗口（#1303）。最后活动严格早于该值才置读，正好 7 天仍未读。 */
export const CHIEF_UNREAD_IDLE_MS = 7 * 24 * 60 * 60 * 1000;

/** 闲置超过 7 天的 chief_message 未读置 readAt=now（扫，不删行）。
 * 最后活动 = max(thread.updatedAt, thread.lastTurnAt ?? 0)。线程已不在则跳过。
 * 只动 chief_message。不发 SSE：notification 事件在 document.hidden 时会弹桌面通知，
 * 过期置读不是一条新消息；未读集在下次查询（焦点重取 / 真正的新通知）收敛。 */
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

/** quota_wait（#1261）：任务因 relay 额度空/限流挂起「等额度」——不是失败
 * （失败不通知的原判不破）；挂起是「需要你知道但无需你动手」的新一类。
 * snippet = 哪一路 relay + 事件类型 + 自动续跑指引；agent 归因 = assignment
 * build 槽（挂起的是执行步），缺则属主代行（notifyTodoPhase 同律）。 */
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

/** model_fallback（#1493）：降级链把任务换到备用模型接着跑——quota_wait 同类
 * （需要你知道，无需你动手）。组合键 = userId:todoId，与 quota_wait 共用一行
 * （同一任务最新的那件事覆盖旧的）。agent 归因 = 换了模型的那一步的 agent
 * （调用方已解析），缺则属主代行。 */
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
