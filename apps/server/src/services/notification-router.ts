import {
  isChiefConversationId,
  type NotificationDelivery,
  type NotificationRecord,
  type UserRecord,
} from '@cairn/shared';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type CommitEffects, runAfterCommit } from '../db/commit-effects.js';
import { databaseIdentity } from '../db/identity.js';
import { dueEvent, externalEffect, notification } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import type { TeamStreamHub } from './events.js';
import {
  cancelPendingEffects,
  drainEffects,
  effectDedupeKey,
  effectRegistry,
  failEffect,
  recordEffect,
  retryEffect,
  runEffectRow,
} from './external-effects.js';
import { imHasActiveOrigin, imSendAwayNotice } from './im/runtime.js';
import { pendingQuestionInThread } from './chief-question-store.js';
import { canDeliverNotification } from './project-visibility.js';
import { type PushMessage, sendPushToUser, type VapidKeys } from './push.js';
import { evaluatePresenceRouting } from './thread-presence.js';

export interface NotificationRoutingDeps extends CommitEffects {
  db: Db;
  hub: TeamStreamHub;
  user: UserRecord;
  vapidKeys?: VapidKeys | null;
}

const NOTIFICATION_AWAY_KIND = 'notification-away';
const vapidKeysByDb = new WeakMap<Db, VapidKeys | null>();
const clockListeners = new WeakMap<Db, () => void>();

export function registerNotificationDelivery(db: Db, vapidKeys: VapidKeys | null): void {
  if (db == null || typeof db !== 'object') return;
  const rootDb = databaseIdentity(db);
  vapidKeysByDb.set(rootDb, vapidKeys);
  ensureAwayPushEffectRegistered();
}

export function setNotificationVapidKeys(db: Db, keys: VapidKeys | null): void {
  registerNotificationDelivery(db, keys);
}

export function resolveNotificationVapidKeys(
  deps: Pick<NotificationRoutingDeps, 'db' | 'vapidKeys'>,
): VapidKeys | null {
  if (deps.vapidKeys !== undefined) return deps.vapidKeys;
  if (deps.db == null || typeof deps.db !== 'object') return null;
  return vapidKeysByDb.get(databaseIdentity(deps.db)) ?? null;
}

export function setNotificationClockListener(db: Db, listener: (() => void) | null): void {
  if (db == null || typeof db !== 'object') return;
  const root = databaseIdentity(db);
  if (listener === null) clockListeners.delete(root);
  else clockListeners.set(root, listener);
}

export function notifyNotificationClock(db: Db): void {
  if (db == null || typeof db !== 'object') return;
  clockListeners.get(databaseIdentity(db))?.();
}

export function notificationAwayEventId(notificationId: string): string {
  return `notification-away:${notificationId}`;
}

export function notificationHref(entityId: string): string {
  return isChiefConversationId(entityId)
    ? `/app?chief=${encodeURIComponent(entityId)}`
    : `/app/todo/${encodeURIComponent(entityId)}`;
}

export function notificationDisplayText(record: NotificationRecord): {
  title: string;
  body: string;
  href: string;
} {
  const href = notificationHref(record.entityId);
  const taskTitle = record.entityRef.title;
  const snippet = record.snippet ?? '';
  switch (record.type) {
    case 'plan_ready':
      return { title: '方案已就绪', body: snippet || taskTitle, href };
    case 'build_review':
      return { title: '构建待审核', body: snippet ? `${taskTitle} · ${snippet}` : taskTitle, href };
    case 'coordinator_handoff':
      return { title: '协调者交给你处理', body: snippet || taskTitle, href };
    case 'chief_message':
      return { title: taskTitle || record.agent.name || 'Coordinator', body: snippet, href };
    case 'schedule_run':
      return { title: taskTitle, body: snippet || 'Scheduled run finished', href };
    case 'quota_wait':
      return { title: taskTitle, body: snippet || 'Waiting for quota', href };
    case 'model_fallback':
      return { title: taskTitle, body: snippet || 'Switched to fallback model', href };
    case 'no_machine':
      return { title: taskTitle, body: snippet || 'No runner online', href };
    case 'watchdog_flag':
      return { title: taskTitle, body: snippet || 'Needs attention', href };
    default:
      return { title: taskTitle, body: snippet, href };
  }
}

const AWAY_STATE_HEADLINE: Partial<Record<NotificationRecord['type'], (title: string) => string>> = {
  todo_done: (title) => `任务「${title}」已完成`,
  todo_failed: (title) => `任务「${title}」运行失败`,
  schedule_run: (title) => `任务「${title}」计划运行结束`,
  build_review: (title) => `任务「${title}」等你审核`,
  plan_ready: (title) => `任务「${title}」的方案等你确认`,
  coordinator_handoff: (title) => `任务「${title}」交给你处理`,
  watchdog_flag: (title) => `任务「${title}」需要你处理`,
  no_machine: (title) => `任务「${title}」没有可用的执行机`,
  quota_wait: (title) => `任务「${title}」在等额度`,
  model_fallback: (title) => `任务「${title}」换用了备用模型`,
};

const IN_APP_ONLY = 'in_app';

function awayHeadline(record: NotificationRecord): string {
  const title = record.entityRef.title || record.agent.name || '任务';
  const line = AWAY_STATE_HEADLINE[record.type];
  return line === undefined ? `「${title}」需要你回答` : line(title);
}

function awayQuestion(
  deps: NotificationRoutingDeps,
  record: NotificationRecord,
): ReturnType<typeof pendingQuestionInThread> {
  return record.type === 'chief_message'
    ? pendingQuestionInThread(deps.db, record.entityId)
    : null;
}

interface AwayPushPayload {
  notificationId: string;
  userId: string;
  teamId: string;
  msg: PushMessage;
  deliveryId: string;
}

function awayPushPayload(payload: unknown): AwayPushPayload | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const p = payload as Partial<AwayPushPayload>;
  if (
    typeof p.notificationId !== 'string' ||
    typeof p.userId !== 'string' ||
    typeof p.teamId !== 'string' ||
    typeof p.deliveryId !== 'string' ||
    typeof p.msg !== 'object' ||
    p.msg === null ||
    typeof p.msg.title !== 'string' ||
    typeof p.msg.body !== 'string' ||
    typeof p.msg.href !== 'string' ||
    typeof p.msg.tag !== 'string'
  ) {
    return null;
  }
  return {
    notificationId: p.notificationId,
    userId: p.userId,
    teamId: p.teamId,
    msg: p.msg,
    deliveryId: p.deliveryId,
  };
}

function ensureAwayPushEffectRegistered(): void {
  effectRegistry.set('away-push', {
    policy: 'unsafe',
    scopeGone: (d, effectRow) => {
      const p = awayPushPayload(effectRow.payload);
      if (p === null) return true;
      const row = databaseIdentity(d)
        .select({ readAt: notification.readAt, deliveryId: notification.deliveryId })
        .from(notification)
        .where(eq(notification.id, p.notificationId))
        .get();
      return (
        row === undefined ||
        row.readAt !== null ||
        row.deliveryId !== p.deliveryId ||
        !canDeliverNotification(d, p.notificationId)
      );
    },
    send: async (effectRow, db) => {
      const p = awayPushPayload(effectRow.payload);
      if (p === null) throw failEffect('away-push payload is malformed');
      const rootDb = databaseIdentity(db);
      const vapidKeys = vapidKeysByDb.get(rootDb) ?? null;
      if (vapidKeys === null) {
        throw failEffect('vapid keys not configured', false);
      }
      const outcome = await sendPushToUser(
        rootDb,
        vapidKeys,
        p.userId,
        p.teamId,
        p.msg,
        { id: p.deliveryId, required: false },
        { singleDevice: true },
      );
      if (outcome.status === 'delivered') return outcome;
      if (outcome.status === 'no-subscription' || outcome.status === 'all-expired') {
        throw failEffect(`away push ${outcome.status}`, false);
      }
      throw retryEffect(`away push ${outcome.status}`);
    },
  });
}

function deleteAwayDueEvent(db: Db, notificationId: string): void {
  databaseIdentity(db)
    .delete(dueEvent)
    .where(eq(dueEvent.id, notificationAwayEventId(notificationId)))
    .run();
}

function upsertAwayDueEvent(db: Db, notificationId: string, dueAt: number): void {
  databaseIdentity(db)
    .insert(dueEvent)
    .values({
      id: notificationAwayEventId(notificationId),
      kind: NOTIFICATION_AWAY_KIND,
      dueAt,
      intervalMs: null,
      attempts: 0,
      lastError: null,
    })
    .onConflictDoUpdate({
      target: dueEvent.id,
      set: { kind: NOTIFICATION_AWAY_KIND, dueAt, intervalMs: null, attempts: 0, lastError: null },
    })
    .run();
  notifyNotificationClock(db);
}

export function cancelPendingNotificationDelivery(
  db: Db,
  notificationId: string,
  deliveryId?: string | null,
): void {
  deleteAwayDueEvent(db, notificationId);
  if (deliveryId !== undefined && deliveryId !== null && deliveryId !== '') {
    cancelPendingEffects(
      databaseIdentity(db),
      sql`json_extract(${externalEffect.payload}, '$.deliveryId') = ${deliveryId}`,
    );
  }
}

function dispatchAwayInsideTx(
  deps: NotificationRoutingDeps,
  record: NotificationRecord,
  deliveryId: string,
  question: ReturnType<typeof pendingQuestionInThread>,
): string | null {
  if (!canDeliverNotification(deps.db, record.id)) return null;
  if (record.type === 'chief_message' && question === null) return IN_APP_ONLY;
  const { title, body, href } = notificationDisplayText(record);
  const imResult = imSendAwayNotice(
    {
      teamId: record.teamId,
      entityId: record.entityId,
      type: record.type,
      title: awayHeadline(record),
      body: record.snippet ?? '',
      href,
      deliveryId,
      ...(question !== null ? { question } : {}),
      effects: deps,
    },
    deps.db,
  );
  if (imResult.sent) {
    return `im:${imResult.connectionId ?? 'unknown'}`;
  }
  const vapidKeys = resolveNotificationVapidKeys(deps);
  if (vapidKeys === null) return null;
  ensureAwayPushEffectRegistered();
  const rootDb = databaseIdentity(deps.db);
  vapidKeysByDb.set(rootDb, vapidKeys);
  const msg: PushMessage = {
    title,
    body,
    href,
    tag: `${record.userId}:${record.entityId}`,
  };
  const scopeKind = isChiefConversationId(record.entityId) ? 'chiefThread' : 'todo';
  const { row } = recordEffect(rootDb, {
    teamId: record.teamId,
    scopeKind,
    scopeId: record.entityId,
    kind: 'away-push',
    dedupeKey: effectDedupeKey('away-push', record.id, deliveryId),
    payload: {
      notificationId: record.id,
      userId: record.userId,
      teamId: record.teamId,
      msg,
      deliveryId,
    } satisfies AwayPushPayload,
  });
  runAfterCommit(deps, 'dispatchAwayPush', () => {
    void runEffectRow(rootDb, effectRegistry, row.id).catch(() => {
      process.stderr.write('away push delivery failed\n');
    });
    void drainEffects(rootDb, effectRegistry).catch(() => {
      process.stderr.write('away push drain failed\n');
    });
  });
  return 'push';
}

export function routeNotificationDelivery(
  deps: NotificationRoutingDeps,
  record: NotificationRecord,
  deliveryId: string,
  options?: { skipAwayDispatch?: boolean },
): { record: NotificationRecord; delivery: NotificationDelivery } {
  const now = nowMs();
  const rootDb = databaseIdentity(deps.db);
  const imOriginActive =
    isChiefConversationId(record.entityId) && imHasActiveOrigin(record.entityId, deps.db);
  if (imOriginActive) {
    deleteAwayDueEvent(deps.db, record.id);
    rootDb
      .update(notification)
      .set({
        deliveryId,
        deliveryStatus: 'away',
        deliveryTarget: 'im:origin',
        deliveryDueAt: null,
      })
      .where(and(eq(notification.id, record.id), eq(notification.deliveryId, deliveryId)))
      .run();
    return { record, delivery: { id: deliveryId, targetClientId: null } };
  }

  const decision = evaluatePresenceRouting(deps.db, deps.user.id, record.entityId, now);
  if (decision.kind === 'read') {
    deleteAwayDueEvent(deps.db, record.id);
    rootDb
      .update(notification)
      .set({
        readAt: now,
        deliveryId,
        deliveryStatus: 'read',
        deliveryTarget: null,
        deliveryDueAt: null,
      })
      .where(and(eq(notification.id, record.id), eq(notification.deliveryId, deliveryId)))
      .run();
    return {
      record: { ...record, readAt: now },
      delivery: { id: deliveryId, targetClientId: null },
    };
  }

  if (decision.kind === 'suppressed') {
    deleteAwayDueEvent(deps.db, record.id);
    rootDb
      .update(notification)
      .set({
        deliveryId,
        deliveryStatus: 'suppressed',
        deliveryTarget: null,
        deliveryDueAt: null,
      })
      .where(and(eq(notification.id, record.id), eq(notification.deliveryId, deliveryId)))
      .run();
    return { record, delivery: { id: deliveryId, targetClientId: null } };
  }

  if (decision.kind === 'desktop') {
    deleteAwayDueEvent(deps.db, record.id);
    rootDb
      .update(notification)
      .set({
        deliveryId,
        deliveryStatus: 'desktop',
        deliveryTarget: `client:${decision.clientId}`,
        deliveryDueAt: null,
      })
      .where(and(eq(notification.id, record.id), eq(notification.deliveryId, deliveryId)))
      .run();
    return { record, delivery: { id: deliveryId, targetClientId: decision.clientId } };
  }

  if (options?.skipAwayDispatch) {
    deleteAwayDueEvent(deps.db, record.id);
    rootDb
      .update(notification)
      .set({
        deliveryId,
        deliveryStatus: 'away',
        deliveryTarget: null,
        deliveryDueAt: null,
      })
      .where(and(eq(notification.id, record.id), eq(notification.deliveryId, deliveryId)))
      .run();
    return { record, delivery: { id: deliveryId, targetClientId: null } };
  }

  if (decision.kind === 'pending_away') {
    rootDb
      .update(notification)
      .set({
        deliveryId,
        deliveryStatus: 'pending_away',
        deliveryTarget: null,
        deliveryDueAt: decision.dueAt,
      })
      .where(and(eq(notification.id, record.id), eq(notification.deliveryId, deliveryId)))
      .run();
    upsertAwayDueEvent(deps.db, record.id, decision.dueAt);
    return { record, delivery: { id: deliveryId, targetClientId: null } };
  }

  return withTxEffects(deps, (txDeps) => {
    const target = dispatchAwayInsideTx(txDeps, record, deliveryId, awayQuestion(deps, record));
    deleteAwayDueEvent(deps.db, record.id);
    rootDb
      .update(notification)
      .set({
        deliveryId,
        deliveryStatus: target === IN_APP_ONLY ? 'suppressed' : 'away',
        deliveryTarget: target,
        deliveryDueAt: null,
      })
      .where(and(eq(notification.id, record.id), eq(notification.deliveryId, deliveryId)))
      .run();
    return { record, delivery: { id: deliveryId, targetClientId: null } };
  });
}

function withTxEffects<T>(
  deps: NotificationRoutingDeps,
  fn: (txDeps: NotificationRoutingDeps) => T,
): T {
  const rootDb = databaseIdentity(deps.db);
  if (deps.commitEffects !== undefined) {
    return rootDb.transaction(() => fn(deps), { behavior: 'immediate' });
  }
  const scheduled: Array<() => void> = [];
  const txDeps: NotificationRoutingDeps = {
    ...deps,
    commitEffects: {
      hubs: { hub: deps.hub },
      schedule: (_name, run) => scheduled.push(run),
      defer: undefined,
    },
  };
  const out = rootDb.transaction(() => fn(txDeps), { behavior: 'immediate' });
  for (const run of scheduled) {
    try {
      run();
    } catch (err) {
      console.error('post-commit notification effect failed', err);
    }
  }
  return out;
}

function rowToRecord(row: typeof notification.$inferSelect): NotificationRecord {
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

function promotePendingRowToLiveOrAway(
  deps: NotificationRoutingDeps,
  row: typeof notification.$inferSelect,
  now: number,
): { rescheduleAt: number | null } {
  if (
    row.readAt !== null ||
    row.deliveryStatus !== 'pending_away' ||
    row.deliveryId === null ||
    !canDeliverNotification(deps.db, row.id)
  ) {
    return { rescheduleAt: null };
  }
  const deliveryId = row.deliveryId;
  const record = rowToRecord(row);
  const decision = evaluatePresenceRouting(deps.db, row.userId, row.entityId, now);
  const rootDb = databaseIdentity(deps.db);

  if (decision.kind === 'read') {
    const res = rootDb
      .update(notification)
      .set({
        readAt: now,
        deliveryStatus: 'read',
        deliveryTarget: null,
        deliveryDueAt: null,
      })
      .where(
        and(
          eq(notification.id, row.id),
          eq(notification.deliveryStatus, 'pending_away'),
          eq(notification.deliveryId, deliveryId),
          isNull(notification.readAt),
        ),
      )
      .run();
    if (res.changes > 0) {
      deleteAwayDueEvent(deps.db, row.id);
      runAfterCommit(deps, 'publishReadPromotion', () => {
        deps.hub.publishNotification(
          row.teamId,
          { ...record, readAt: now },
          { id: deliveryId, targetClientId: null },
        );
      });
    }
    return { rescheduleAt: null };
  }

  if (decision.kind === 'suppressed') {
    const res = rootDb
      .update(notification)
      .set({
        deliveryStatus: 'suppressed',
        deliveryTarget: null,
        deliveryDueAt: null,
      })
      .where(
        and(
          eq(notification.id, row.id),
          eq(notification.deliveryStatus, 'pending_away'),
          eq(notification.deliveryId, deliveryId),
          isNull(notification.readAt),
        ),
      )
      .run();
    if (res.changes > 0) deleteAwayDueEvent(deps.db, row.id);
    return { rescheduleAt: null };
  }

  if (decision.kind === 'desktop') {
    const res = rootDb
      .update(notification)
      .set({
        deliveryStatus: 'desktop',
        deliveryTarget: `client:${decision.clientId}`,
        deliveryDueAt: null,
      })
      .where(
        and(
          eq(notification.id, row.id),
          eq(notification.deliveryStatus, 'pending_away'),
          eq(notification.deliveryId, deliveryId),
          isNull(notification.readAt),
        ),
      )
      .run();
    if (res.changes > 0) {
      deleteAwayDueEvent(deps.db, row.id);
      runAfterCommit(deps, 'publishDesktopPromotion', () => {
        deps.hub.publishNotification(row.teamId, record, {
          id: deliveryId,
          targetClientId: decision.clientId,
        });
      });
    }
    return { rescheduleAt: null };
  }

  if (decision.kind === 'pending_away' && decision.dueAt > now) {
    rootDb
      .update(notification)
      .set({ deliveryDueAt: decision.dueAt })
      .where(
        and(
          eq(notification.id, row.id),
          eq(notification.deliveryStatus, 'pending_away'),
          eq(notification.deliveryId, deliveryId),
          isNull(notification.readAt),
        ),
      )
      .run();
    return { rescheduleAt: decision.dueAt };
  }

  const question = awayQuestion(deps, record);
  if (record.type === 'chief_message' && question === null) {
    rootDb
      .update(notification)
      .set({ deliveryStatus: 'suppressed', deliveryTarget: IN_APP_ONLY, deliveryDueAt: null })
      .where(
        and(
          eq(notification.id, row.id),
          eq(notification.deliveryStatus, 'pending_away'),
          eq(notification.deliveryId, deliveryId),
          isNull(notification.readAt),
        ),
      )
      .run();
    deleteAwayDueEvent(deps.db, row.id);
    return { rescheduleAt: null };
  }

  const claimed = withTxEffects(deps, (txDeps) => {
    const claimRes = rootDb
      .update(notification)
      .set({
        deliveryStatus: 'away',
        deliveryDueAt: null,
      })
      .where(
        and(
          eq(notification.id, row.id),
          eq(notification.deliveryStatus, 'pending_away'),
          eq(notification.deliveryId, deliveryId),
          isNull(notification.readAt),
        ),
      )
      .run();
    if (claimRes.changes === 0) return { won: false, target: null as string | null };
    const target = dispatchAwayInsideTx(txDeps, record, deliveryId, question);
    rootDb
      .update(notification)
      .set({
        deliveryTarget: target,
        ...(target === IN_APP_ONLY ? { deliveryStatus: 'suppressed' } : {}),
      })
      .where(and(eq(notification.id, row.id), eq(notification.deliveryId, deliveryId)))
      .run();
    return { won: true, target };
  });
  void claimed;
  return { rescheduleAt: null };
}

export function processNotificationAwayDue(
  deps: NotificationRoutingDeps,
  notificationId: string,
  now: number,
): { rescheduleAt: number | null } {
  const row = databaseIdentity(deps.db)
    .select()
    .from(notification)
    .where(eq(notification.id, notificationId))
    .get();
  if (row === undefined) return { rescheduleAt: null };
  return promotePendingRowToLiveOrAway(deps, row, now);
}

export function reconcilePendingAwayNotifications(
  deps: NotificationRoutingDeps,
  userId: string,
  now = nowMs(),
): void {
  const pendingRows = databaseIdentity(deps.db)
    .select()
    .from(notification)
    .where(
      and(
        eq(notification.userId, userId),
        eq(notification.deliveryStatus, 'pending_away'),
        isNull(notification.readAt),
      ),
    )
    .all();
  for (const row of pendingRows) {
    const decision = evaluatePresenceRouting(deps.db, userId, row.entityId, now);
    if (decision.kind === 'read' || decision.kind === 'suppressed' || decision.kind === 'desktop') {
      promotePendingRowToLiveOrAway(deps, row, now);
    }
  }
}

export function handleDeliveryFailed(
  deps: NotificationRoutingDeps,
  teamId: string,
  entityId: string,
  deliveryId: string,
): { handled: boolean } {
  const id = `${deps.user.id}:${entityId}`;
  const rootDb = databaseIdentity(deps.db);
  return withTxEffects(deps, (txDeps) => {
    const row = rootDb
      .select()
      .from(notification)
      .where(and(eq(notification.id, id), eq(notification.teamId, teamId)))
      .get();
    if (
      row === undefined ||
      row.readAt !== null ||
      row.deliveryStatus !== 'desktop' ||
      row.deliveryId !== deliveryId
    ) {
      return { handled: false };
    }
    const claimRes = rootDb
      .update(notification)
      .set({
        deliveryStatus: 'away',
        deliveryDueAt: null,
      })
      .where(
        and(
          eq(notification.id, row.id),
          eq(notification.deliveryStatus, 'desktop'),
          eq(notification.deliveryId, deliveryId),
          isNull(notification.readAt),
        ),
      )
      .run();
    if (claimRes.changes === 0) return { handled: false };
    const record = rowToRecord(row);
    const target = dispatchAwayInsideTx(txDeps, record, deliveryId, awayQuestion(deps, record));
    rootDb
      .update(notification)
      .set({
        deliveryTarget: target,
        ...(target === IN_APP_ONLY ? { deliveryStatus: 'suppressed' } : {}),
      })
      .where(and(eq(notification.id, row.id), eq(notification.deliveryId, deliveryId)))
      .run();
    return { handled: true };
  });
}
