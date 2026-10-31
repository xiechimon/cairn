import {
  askUserQuestionContentSchema,
  type MergeReadiness,
  type Phase,
  type TodoRecord,
  type UserRecord,
} from '@cairn/shared';
import { and, desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  build,
  gateState,
  message,
  plan,
  project,
  pushDelivery,
  pushDigestItem,
  schedule,
  step,
  todo,
} from '../db/schema.js';
import type { TeamStreamHub } from './events.js';
import { planHasOpenDecisions } from './plan-decisions.js';
import { projectMergeConfigOf } from './projects.js';
import { isSilencedTodoPush, pushToUserSafely, queuePushDigest, type VapidKeys } from './push.js';
import { endSnoozeOn } from './snooze.js';

type ThreadPushDeps = {
  db: Db;
  hub?: TeamStreamHub;
  user: UserRecord;
  vapidKeys?: VapidKeys | null;
};

export function pendingWorkerQuestion(content: unknown): string | null {
  let value = content;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const parsed = askUserQuestionContentSchema.safeParse(value);
  return parsed.success && parsed.data.status === 'pending'
    ? parsed.data.questions
        .map((question) =>
          [question.question, ...question.options.map((option) => option.label)].join('\n'),
        )
        .join('\n')
    : null;
}

export function pushWorkerQuestion(
  deps: ThreadPushDeps,
  conversationId: string,
  body: string,
): void {
  const row = deps.db
    .select({ todo })
    .from(build)
    .innerJoin(todo, eq(todo.id, build.todoId))
    .where(eq(build.id, conversationId))
    .get()?.todo;
  if (
    !row ||
    row.latestBuildId !== conversationId ||
    row.phase === 'done' ||
    row.phase === 'closed'
  )
    return;
  if (deps.hub) endSnoozeOn({ ...deps, hub: deps.hub }, row.id, 'needs-you');
  pushToUserSafely(deps.db, deps.vapidKeys ?? null, deps.user.id, row.teamId, {
    title: '需要你决定',
    body,
    href: `/app/todo/${row.id}`,
    tag: `${deps.user.id}:${row.id}`,
  });
}

function reviewPushId(userId: string, buildId: string): string {
  return `review:${userId}:${buildId}`;
}

export function pendingReviewPushEntry(deps: ThreadPushDeps, buildId: string): string | null {
  const row = deps.db
    .select()
    .from(pushDelivery)
    .where(eq(pushDelivery.id, reviewPushId(deps.user.id, buildId)))
    .get();
  return row?.pushStatus === 'review-pending' ? (row.message?.tag ?? null) : null;
}

export function notifyEvaluatedReview(
  deps: ThreadPushDeps,
  buildId: string,
  readiness: MergeReadiness,
  entryTag: string | null,
): void {
  if (entryTag === null) return;
  const needsYou =
    readiness.blockers.every((blocker) => blocker.class !== 'transient') &&
    (readiness.blockers.some((blocker) => blocker.class === 'human') ||
      (readiness.policy === 'human' &&
        readiness.blockers.every((blocker) => blocker.code === 'policy-human')));
  if (!needsYou) return;
  const row = deps.db
    .select({ todo })
    .from(build)
    .innerJoin(todo, eq(todo.id, build.todoId))
    .where(eq(build.id, buildId))
    .get()?.todo;
  if (
    row?.phase !== 'review' ||
    row.latestBuildId !== buildId ||
    row.archivedAt !== null ||
    row.snoozeMode !== null
  )
    return;
  const marker = deps.db
    .select()
    .from(pushDelivery)
    .where(eq(pushDelivery.id, reviewPushId(deps.user.id, buildId)))
    .get();
  if (!marker?.message || marker.message.tag !== entryTag || marker.createdAt !== row.phaseAt)
    return;
  const payload = marker.message;
  const claimed = deps.db.transaction(() => {
    const claimed = deps.db
      .update(pushDelivery)
      .set({ pushStatus: 'review-notified' })
      .where(
        and(
          eq(pushDelivery.id, marker.id),
          eq(pushDelivery.pushStatus, 'review-pending'),
          eq(pushDelivery.message, payload),
        ),
      )
      .returning({ id: pushDelivery.id })
      .get();
    if (claimed)
      deps.db
        .delete(pushDigestItem)
        .where(
          and(
            eq(pushDigestItem.id, payload.tag),
            eq(pushDigestItem.userId, deps.user.id),
            eq(pushDigestItem.teamId, row.teamId),
          ),
        )
        .run();
    return claimed;
  });
  if (!claimed) return;
  pushToUserSafely(deps.db, deps.vapidKeys ?? null, deps.user.id, row.teamId, payload);
}

export function notifyThreadPhase(deps: ThreadPushDeps, record: TodoRecord, to: Phase): void {
  if (to !== 'confirm' && to !== 'review' && to !== 'done' && to !== 'failed') return;
  if (isSilencedTodoPush(deps.db, record.teamId, `/app/todo/${record.id}`)) return;
  const latest = deps.db
    .select()
    .from(build)
    .where(
      record.latestBuildId === null
        ? eq(build.todoId, record.id)
        : and(eq(build.id, record.latestBuildId), eq(build.todoId, record.id)),
    )
    .orderBy(desc(build.createdAt))
    .get();
  const msg = {
    title:
      to === 'confirm'
        ? '方案已就绪'
        : to === 'review'
          ? '构建待审核'
          : to === 'done'
            ? latest?.prNumber != null
              ? 'PR 已合并'
              : '任务已完成'
            : '任务失败',
    body:
      to === 'done' && latest?.prNumber != null
        ? `PR #${latest.prNumber}: #${record.seqNum} ${record.title}`
        : `#${record.seqNum} ${record.title}`,
    href: `/app/todo/${record.id}`,
    tag: `${deps.user.id}:${record.id}`,
  };
  let immediate = false;
  if (latest !== undefined) {
    if (to === 'done' || to === 'failed') {
      const wakeStep = deps.db
        .select({ scheduledBy: step.scheduledBy })
        .from(step)
        .where(eq(step.buildId, latest.id))
        .orderBy(desc(step.createdAt))
        .get();
      const scheduled =
        latest.triggerSource === 'schedule'
          ? deps.db.select().from(schedule).where(eq(schedule.todoId, record.id)).get()
          : undefined;
      immediate =
        record.sourceKind !== 'github-issue' &&
        (wakeStep?.scheduledBy != null
          ? wakeStep.scheduledBy === deps.user.id
          : latest.triggerSource === 'user' ||
            latest.triggerSource === 'chief' ||
            (latest.triggerSource === 'schedule' &&
              (latest.scheduledBy ?? scheduled?.createdBy) === deps.user.id));
    } else {
      const projectRow = deps.db
        .select()
        .from(project)
        .where(eq(project.id, record.projectId))
        .get();
      const humanGate =
        projectRow !== undefined && projectMergeConfigOf(projectRow).mergePolicy === 'human';
      const questions = deps.db
        .select()
        .from(message)
        .where(eq(message.conversationId, latest.id))
        .all()
        .some((row) => row.role === 'assistant' && pendingWorkerQuestion(row.content) !== null);
      const prGate =
        to === 'review' &&
        latest.prNumber !== null &&
        projectRow?.repoKind === 'github' &&
        projectRow.githubRepo !== null;
      if (prGate && !questions) {
        const marker = {
          message: { ...msg, tag: `${msg.tag}:review:${record.v}` },
          pushStatus: 'review-pending',
          createdAt: record.phaseAt,
        };
        deps.db
          .insert(pushDelivery)
          .values({
            id: reviewPushId(deps.user.id, latest.id),
            userId: deps.user.id,
            teamId: record.teamId,
            ...marker,
          })
          .onConflictDoUpdate({ target: pushDelivery.id, set: marker })
          .run();
        deps.db
          .insert(pushDigestItem)
          .values({
            id: marker.message.tag,
            userId: deps.user.id,
            teamId: record.teamId,
            title: msg.title,
            body: msg.body,
            href: msg.href,
            createdAt: record.phaseAt,
          })
          .onConflictDoNothing()
          .run();
        return;
      }
      const latestPlan =
        to === 'confirm'
          ? deps.db
              .select()
              .from(plan)
              .where(eq(plan.buildId, latest.id))
              .orderBy(desc(plan.version))
              .get()
          : undefined;
      const gate =
        to === 'review'
          ? deps.db.select().from(gateState).where(eq(gateState.buildId, latest.id)).get()
          : undefined;
      const blockers = gate?.blockers ?? [];
      const humanBlocker = blockers.some((blocker) => blocker.class === 'human');
      const machineGated =
        gate !== undefined &&
        !gate.ready &&
        blockers.some((blocker) => blocker.class === 'transient');
      immediate =
        !questions &&
        !machineGated &&
        (humanGate ||
          humanBlocker ||
          (to === 'confirm' &&
            latestPlan !== undefined &&
            planHasOpenDecisions(latestPlan.content)));
    }
  }
  if (immediate)
    pushToUserSafely(deps.db, deps.vapidKeys ?? null, deps.user.id, record.teamId, msg);
  else queuePushDigest(deps.db, deps.user.id, record.teamId, msg);
}
