import { createHash } from 'node:crypto';
import {
  CHIEF_NOTICE_KIND,
  isAcceptanceNudgePrompt,
  isBackendRuntimeId,
  isChiefSideThreadId,
  type MachineDoneBody,
  type Phase,
  parseMissingEvidenceLine,
} from '@cairn/shared';
import { and, eq, isNull, lte, or } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { runAfterCommit } from '../db/commit-effects.js';
import {
  build,
  chiefThread,
  machine,
  type StepStallCause,
  type StepStallMeta,
  step,
  stopPending,
  todo,
} from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { failStepWithEvents } from './build-step-failure.js';
import type { BuildDeps } from './builds.js';
import { endChiefStepAsStopped } from './chief-turns.js';
import { wakeCoordinator } from './coordinator-context.js';
import { signalCoordinator } from './coordinator-signal.js';
import { stepRuntimeFor } from './dispatch-eligibility.js';
import { stepActivityAt } from './dispatch-timeouts.js';
import {
  isChiefConversation,
  stepTeamId,
  upsertChiefRow,
  upsertMessage,
  withFencedTransaction,
} from './machine-deps.js';
import { memoryEditIdOfPrompt } from './memory-edit-turns.js';
import { planModelFallback } from './model-fallback.js';
import { notifyWatchdogFlag } from './notifications.js';
import { stepScopeProjectId } from './picked-project.js';
import { applyQuotaWaitStep, publishStepRow, QUOTA_PROBE_BASE_MS } from './quota-wait.js';
import { coordinatorProfile, profileForStep, type RouteProfile } from './routing-rules.js';
import { readQuota, type StepQuota, writeQuota } from './step-groups/quota.js';
import { pendingPermissionWaitIds } from './step-permission-wait.js';

export { isStepWaitingPermission, pendingPermissionWaitIds } from './step-permission-wait.js';

export const STALL_STOP_SETTLE_MS = 35_000;
export const DEAD_RUNNER_GRACE_MS = 60_000;
export const MISSING_TOOLS_GRACE_MS = 30_000;
export const QUOTA_LOOP_GRACE_MS = 60_000;

const STALL_RECOVERY_HOLD_REASON = 'stall_recovery';
const QUOTA_HOLD_REASON = 'quota';
const WATCHED_PHASES: readonly Phase[] = ['queued', 'planning', 'building', 'review'];

type RuntimeWindowKey = 'antigravity' | 'devin' | 'doubao' | 'claude-code' | 'pi' | 'default';

const CHIEF_QUIET_MS: Record<RuntimeWindowKey, number> = {
  antigravity: 180_000,
  devin: 180_000,
  doubao: 180_000,
  'claude-code': 240_000,
  pi: 180_000,
  default: 300_000,
};

const WORKER_QUIET_MS: Record<RuntimeWindowKey, number> = {
  antigravity: 360_000,
  devin: 360_000,
  doubao: 360_000,
  'claude-code': 480_000,
  pi: 360_000,
  default: 900_000,
};

type StepRow = typeof step.$inferSelect;
type BuildRow = typeof build.$inferSelect;
type TodoRow = typeof todo.$inferSelect;
type ThreadRow = typeof chiefThread.$inferSelect;

type StepContext =
  | {
      kind: 'worker';
      buildRow: BuildRow;
      todoRow: TodoRow;
      teamId: string;
      agentRow: RouteProfile | null;
    }
  | {
      kind: 'chief';
      thread: ThreadRow;
      teamId: string;
      agentRow: RouteProfile | null;
    };

type Diagnosis =
  | { cause: 'permission_wait'; waitIds: string[]; progressAt: number }
  | { cause: 'missing_tools'; detail: string | undefined; progressAt: number }
  | {
      cause: 'quota';
      signal: 'quota' | 'capacity';
      detail: string | undefined;
      progressAt: number;
    }
  | { cause: 'dead_turn'; progressAt: number }
  | { cause: 'silent_turn'; progressAt: number };

function shortHash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function stepProgressAt(row: StepRow): number {
  return row.lastProgressAt ?? row.claimedAt ?? row.createdAt;
}

function runtimeWindowKey(row: StepRow & StepQuota): RuntimeWindowKey {
  const provider = row.ranModel?.provider ?? row.fallback?.model?.provider ?? null;
  if (provider === null || provider === '' || provider === 'unknown') return 'default';
  if (provider === 'antigravity') return 'antigravity';
  if (provider === 'devin') return 'devin';
  if (provider === 'doubao') return 'doubao';
  if (isBackendRuntimeId(provider)) return 'claude-code';
  const runtime = stepRuntimeFor(provider);
  return runtime === 'gemini' ? 'default' : runtime;
}

function quietWindowFor(row: StepRow & StepQuota, kind: 'worker' | 'chief'): number {
  const key = runtimeWindowKey(row);
  return kind === 'chief' ? CHIEF_QUIET_MS[key] : WORKER_QUIET_MS[key];
}

function resolveContext(db: Db, row: StepRow): StepContext | null {
  if (row.kind === 'chief') {
    if (
      !isChiefConversation(row.buildId) ||
      isChiefSideThreadId(row.buildId) ||
      memoryEditIdOfPrompt(row.prompt) !== null
    ) {
      return null;
    }
    const thread = db.select().from(chiefThread).where(eq(chiefThread.id, row.buildId)).get();
    if (thread === undefined) return null;
    return {
      kind: 'chief',
      thread,
      teamId: thread.teamId,
      agentRow: coordinatorProfile(db, thread.teamId, thread.projectId),
    };
  }
  if (!['plan', 'build', 'session', 'merge', 'review', 'verify'].includes(row.kind)) {
    return null;
  }
  const buildRow = db.select().from(build).where(eq(build.id, row.buildId)).get();
  if (buildRow === undefined) return null;
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (
    todoRow === undefined ||
    todoRow.archivedAt !== null ||
    todoRow.latestBuildId !== buildRow.id ||
    !WATCHED_PHASES.includes(todoRow.phase)
  ) {
    return null;
  }
  return {
    kind: 'worker',
    buildRow,
    todoRow,
    teamId: todoRow.teamId,
    agentRow: profileForStep(db, todoRow, row.kind, row.id),
  };
}

function hasPendingUserStop(db: Db, row: StepRow): boolean {
  return (
    db
      .select({ stepId: stopPending.stepId })
      .from(stopPending)
      .where(or(eq(stopPending.stepId, row.id), eq(stopPending.conversationId, row.buildId)))
      .get() !== undefined
  );
}

function diagnoseStep(
  deps: Pick<BuildDeps, 'db' | 'machineHub'>,
  row: StepRow,
  context: StepContext,
  now: number,
): Diagnosis | null {
  const progressAt = stepProgressAt(row);
  const quietMs = quietWindowFor({ ...row, ...readQuota(deps.db, row.id) }, context.kind);
  const waitIds = pendingPermissionWaitIds(deps.db, row);
  if (waitIds.length > 0) {
    return now - progressAt >= quietMs ? { cause: 'permission_wait', waitIds, progressAt } : null;
  }
  if (row.machineId !== null) {
    const act = row.stallState?.activity;
    if (act?.stallSignal === 'missing_tools' && now - act.firstSeenAt >= MISSING_TOOLS_GRACE_MS) {
      return { cause: 'missing_tools', detail: act.detail, progressAt };
    }
    if (
      (act?.stallSignal === 'quota' || act?.stallSignal === 'capacity') &&
      now - act.firstSeenAt >= QUOTA_LOOP_GRACE_MS
    ) {
      return { cause: 'quota', signal: act.stallSignal, detail: act.detail, progressAt };
    }
    const runner = deps.db
      .select({ online: machine.online, retiredAt: machine.retiredAt })
      .from(machine)
      .where(eq(machine.id, row.machineId))
      .get();
    const dead =
      runner === undefined ||
      !runner.online ||
      runner.retiredAt !== null ||
      deps.machineHub?.silentSinceDrop(row.machineId) === true;
    if (dead && now - stepActivityAt(row) >= DEAD_RUNNER_GRACE_MS) {
      return { cause: 'dead_turn', progressAt };
    }
  }
  if (now - progressAt >= quietMs) {
    return { cause: 'silent_turn', progressAt };
  }
  return null;
}

function claimedMatchPredicate(row: StepRow) {
  return and(
    eq(step.id, row.id),
    eq(step.status, 'claimed'),
    row.claimedAt === null ? isNull(step.claimedAt) : eq(step.claimedAt, row.claimedAt),
  );
}

function postStallNote(
  deps: BuildDeps,
  context: StepContext,
  stepRow: StepRow,
  id: string,
  text: string,
  now: number,
  notifyWorker = false,
): void {
  if (context.kind === 'worker') {
    upsertMessage(deps, {
      id,
      conversationId: context.buildRow.id,
      role: 'system',
      content: text,
      createdAt: now,
    });
    if (notifyWorker) notifyWatchdogFlag(deps, context.todoRow, text);
    return;
  }
  upsertChiefRow(deps, {
    id,
    threadId: context.thread.id,
    projectId: stepScopeProjectId(stepRow),
    role: 'system',
    content: JSON.stringify({
      kind: CHIEF_NOTICE_KIND,
      message: text,
      provenance: 'stall-monitor',
    }),
    createdAt: now,
  });
}

function emitStopSignals(deps: BuildDeps, context: StepContext, stepRow: StepRow): void {
  if (stepRow.machineId !== null) {
    deps.machineHub?.stopSignal(context.teamId, stepRow.id);
  } else {
    runAfterCommit(deps, 'stallStopCoordinator', () => signalCoordinator(stepRow.buildId, 'stop'));
  }
}

function emitWakeSignals(deps: BuildDeps, context: StepContext, stepRow: StepRow): void {
  if (context.kind === 'chief') {
    runAfterCommit(deps, 'stallWakeCoordinator', () => wakeCoordinator(stepRow.buildId));
  }
  deps.machineHub?.wake(context.teamId);
}

function cleanedBaseMeta(prev: StepStallMeta | null | undefined): StepStallMeta {
  const next: StepStallMeta = {};
  if (prev?.recoveryCount !== undefined) next.recoveryCount = prev.recoveryCount;
  if (prev?.lastCause !== undefined) next.lastCause = prev.lastCause;
  if (prev?.lastRecoveredAt !== undefined) next.lastRecoveredAt = prev.lastRecoveredAt;
  if (prev?.lastRecoveredFromMachineId !== undefined) {
    next.lastRecoveredFromMachineId = prev.lastRecoveredFromMachineId;
  }
  return next;
}

function fingerprintFor(
  diagnosis: Diagnosis,
  recoveryCount: number,
  isLocalMerge: boolean,
): string {
  if (diagnosis.cause === 'permission_wait') {
    return `permission_wait:${diagnosis.waitIds.join(',')}`;
  }
  const tag = isLocalMerge ? 'local-merge' : String(recoveryCount);
  return `${diagnosis.cause}:${tag}:${Math.floor(diagnosis.progressAt)}`;
}

function reportOnce(
  deps: BuildDeps,
  current: StepRow,
  context: StepContext,
  diagnosis: Diagnosis,
  now: number,
  text: string,
  isLocalMerge: boolean,
): void {
  const recoveryCount = current.stallState?.recoveryCount ?? 0;
  const fingerprint = fingerprintFor(diagnosis, recoveryCount, isLocalMerge);
  if (current.stallState?.reportedFingerprint === fingerprint) return;
  const nextMeta: StepStallMeta = {
    ...cleanedBaseMeta(current.stallState),
    lastCause: diagnosis.cause,
    reportedAt: now,
    reportedFingerprint: fingerprint,
  };
  const updated = deps.db
    .update(step)
    .set({ stallState: nextMeta })
    .where(claimedMatchPredicate(current))
    .run();
  if (updated.changes === 0) return;
  const id = `stall-report-${current.id}-${diagnosis.cause}-${shortHash(fingerprint)}`;
  postStallNote(deps, context, current, id, text, now, context.kind === 'worker');
}

function requeueTurn(
  deps: BuildDeps,
  current: StepRow,
  context: StepContext,
  cause: Exclude<StepStallCause, 'permission_wait'>,
  now: number,
  note: string,
  opts: {
    freshSession: boolean;
    incrementRecovery: boolean;
    fallback?: StepQuota['fallback'];
    holdSettle: boolean;
  },
): void {
  const prevCount = current.stallState?.recoveryCount ?? 0;
  const nextCount = opts.incrementRecovery ? prevCount + 1 : prevCount;
  const nextMeta: StepStallMeta = {
    ...cleanedBaseMeta(current.stallState),
    ...(opts.incrementRecovery || current.stallState?.recoveryCount !== undefined
      ? { recoveryCount: nextCount }
      : {}),
    lastCause: cause,
    lastRecoveredAt: now,
    lastRecoveredFromMachineId: current.machineId,
  };
  const updated = deps.db
    .update(step)
    .set({
      status: 'pending',
      machineId: null,
      sessionId: null,
      mcpGrant: null,
      lastProgressAt: null,
      freshSession: opts.freshSession || current.freshSession,
      holdReason: opts.holdSettle ? STALL_RECOVERY_HOLD_REASON : null,
      holdUntil: opts.holdSettle ? now + STALL_STOP_SETTLE_MS : null,
      stallState: nextMeta,
    })
    .where(claimedMatchPredicate(current))
    .run();
  if (updated.changes === 0) return;
  deps.db.transaction((tx) =>
    writeQuota(tx, current.id, {
      ranModel: null,
      ...(opts.fallback !== undefined ? { fallback: opts.fallback } : {}),
    }),
  );
  const fresh = deps.db.select().from(step).where(eq(step.id, current.id)).get();
  if (fresh !== undefined) publishStepRow(deps, fresh);
  if (opts.holdSettle || cause === 'missing_tools' || cause === 'quota') {
    emitStopSignals(deps, context, current);
  }
  const id = opts.incrementRecovery
    ? `stall-recover-${current.id}-${nextCount}`
    : `stall-recover-${current.id}-${cause}-${now}`;
  postStallNote(deps, context, current, id, note, now, false);
  emitWakeSignals(deps, context, current);
}

function releaseExpiredRecoveryHolds(deps: BuildDeps, now: number): void {
  const expired = deps.db
    .select()
    .from(step)
    .where(
      and(
        eq(step.status, 'pending'),
        eq(step.holdReason, STALL_RECOVERY_HOLD_REASON),
        lte(step.holdUntil, now),
      ),
    )
    .all();
  for (const row of expired) {
    withFencedTransaction(deps, (txDeps) => {
      const res = txDeps.db
        .update(step)
        .set({ holdReason: null, holdUntil: null })
        .where(
          and(
            eq(step.id, row.id),
            eq(step.status, 'pending'),
            eq(step.holdReason, STALL_RECOVERY_HOLD_REASON),
          ),
        )
        .run();
      if (res.changes === 0) return;
      if (row.kind === 'chief') {
        runAfterCommit(txDeps, 'stallWakeCoordinator', () => wakeCoordinator(row.buildId));
      }
      const teamId = stepTeamId(txDeps, row);
      if (teamId !== null) txDeps.machineHub?.wake(teamId);
    });
  }
}

function handleQuotaDiagnosis(
  txDeps: BuildDeps,
  current: StepRow,
  context: StepContext,
  diagnosis: Extract<Diagnosis, { cause: 'quota' }>,
  now: number,
  holdSettle: boolean,
): void {
  const quota = readQuota(txDeps.db, current.id);
  const currentModel = quota.ranModel ?? quota.fallback?.model;
  const providerId = currentModel?.provider ?? context.agentRow?.provider ?? 'unknown';
  const outcome: MachineDoneBody = {
    status: 'failed',
    errorMessage:
      diagnosis.detail ?? (diagnosis.signal === 'capacity' ? 'rate limit' : 'quota exceeded'),
    quotaBlock: {
      kind: diagnosis.signal,
      providerId,
      reason: diagnosis.detail ?? diagnosis.signal,
    },
  };
  const fallback = planModelFallback(txDeps, { ...current, ...quota }, context.agentRow, outcome);
  if (fallback !== null) {
    requeueTurn(txDeps, current, context, 'quota', now, fallback.note, {
      freshSession: true,
      incrementRecovery: false,
      fallback: fallback.row,
      holdSettle,
    });
    return;
  }
  const nextMeta: StepStallMeta = {
    ...cleanedBaseMeta(current.stallState),
    lastCause: 'quota',
    lastRecoveredAt: now,
    lastRecoveredFromMachineId: current.machineId,
  };
  if (context.kind === 'worker') {
    const claimedCas = txDeps.db
      .update(step)
      .set({
        machineId: null,
        sessionId: null,
        mcpGrant: null,
        stallState: nextMeta,
      })
      .where(claimedMatchPredicate(current))
      .run();
    if (claimedCas.changes === 0) return;
    txDeps.db.transaction((tx) => writeQuota(tx, current.id, { ranModel: null }));
    emitStopSignals(txDeps, context, current);
    applyQuotaWaitStep(
      txDeps,
      {
        ...current,
        machineId: null,
        sessionId: null,
        mcpGrant: null,
        stallState: nextMeta,
      },
      {
        kind: diagnosis.signal,
        providerId,
        reason: diagnosis.detail ?? diagnosis.signal,
      },
    );
    postStallNote(
      txDeps,
      context,
      current,
      `stall-report-${current.id}-quota-${now}`,
      `模型 ${providerId} 额度或限流持续重试超过 60 秒且无可用备用模型，已挂起等待恢复。`,
      now,
      false,
    );
    return;
  }
  const holdUntil = now + QUOTA_PROBE_BASE_MS;
  const parked = txDeps.db
    .update(step)
    .set({
      status: 'pending',
      machineId: null,
      sessionId: null,
      mcpGrant: null,
      holdReason: QUOTA_HOLD_REASON,
      holdUntil,
      holdCount: current.holdCount + 1,
      freshSession: true,
      lastProgressAt: null,
      stallState: nextMeta,
    })
    .where(claimedMatchPredicate(current))
    .run();
  if (parked.changes === 0) return;
  txDeps.db.transaction((tx) => writeQuota(tx, current.id, { ranModel: null }));
  const fresh = txDeps.db.select().from(step).where(eq(step.id, current.id)).get();
  if (fresh !== undefined) publishStepRow(txDeps, fresh);
  emitStopSignals(txDeps, context, current);
  postStallNote(
    txDeps,
    context,
    current,
    `stall-report-${current.id}-quota-${now}`,
    `模型 ${providerId} 额度或限流持续重试超过 60 秒且无可用备用模型，已暂停等待恢复。`,
    now,
    false,
  );
}

function handleTerminalStall(
  txDeps: BuildDeps,
  current: StepRow,
  context: StepContext,
  cause: 'missing_tools' | 'dead_turn',
  now: number,
  reason: string,
): void {
  const nextMeta: StepStallMeta = {
    ...cleanedBaseMeta(current.stallState),
    lastCause: cause,
    reportedAt: now,
    reportedFingerprint: `${cause}:exhausted:${current.claimedAt ?? current.createdAt}`,
  };
  const marked = txDeps.db
    .update(step)
    .set({ stallState: nextMeta })
    .where(claimedMatchPredicate(current))
    .run();
  if (marked.changes === 0) return;
  const currentMarked = txDeps.db.select().from(step).where(eq(step.id, current.id)).get();
  if (currentMarked === undefined) return;
  if (context.kind === 'worker') {
    emitStopSignals(txDeps, context, currentMarked);
    failStepWithEvents(txDeps, currentMarked, reason);
    postStallNote(
      txDeps,
      context,
      currentMarked,
      `stall-report-${currentMarked.id}-${cause}-failed`,
      reason,
      now,
      false,
    );
    return;
  }
  endChiefStepAsStopped(txDeps, context.thread, currentMarked, now, reason);
  postStallNote(
    txDeps,
    context,
    currentMarked,
    `stall-report-${currentMarked.id}-${cause}-stopped`,
    reason,
    now,
    false,
  );
}

function withAcceptanceMissingContext(row: StepRow, note: string): string {
  if (!isAcceptanceNudgePrompt(row.prompt)) return note;
  const missing = parseMissingEvidenceLine(row.prompt ?? '');
  return missing === null ? note : `${note}（还缺：${missing}）`;
}

export function sweepStallMonitor(deps: BuildDeps, now: number = nowMs()): void {
  releaseExpiredRecoveryHolds(deps, now);
  const claimed = deps.db.select().from(step).where(eq(step.status, 'claimed')).all();
  for (const candidate of claimed) {
    const context = resolveContext(deps.db, candidate);
    if (context === null) continue;
    if (hasPendingUserStop(deps.db, candidate)) continue;
    const preDiagnosis = diagnoseStep(deps, candidate, context, now);
    if (preDiagnosis === null) continue;

    withFencedTransaction(deps, (txDeps) => {
      const current = txDeps.db.select().from(step).where(eq(step.id, candidate.id)).get();
      if (
        current === undefined ||
        current.status !== 'claimed' ||
        current.claimedAt !== candidate.claimedAt
      ) {
        return;
      }
      if (hasPendingUserStop(txDeps.db, current)) return;
      const freshContext = resolveContext(txDeps.db, current);
      if (freshContext === null) return;
      const diagnosis = diagnoseStep(txDeps, current, freshContext, now);
      if (diagnosis === null) return;

      const isLocalMerge =
        current.kind === 'merge' && current.prompt?.includes('"local-merge"') === true;
      const recoveryCount = current.stallState?.recoveryCount ?? 0;

      if (diagnosis.cause === 'permission_wait') {
        const text =
          freshContext.kind === 'chief'
            ? '正在等待你确认一个问题或审批操作，尚未收到回复。'
            : '任务正在等待你的确认或权限授权，尚未收到回复。';
        reportOnce(txDeps, current, freshContext, diagnosis, now, text, false);
        return;
      }

      if (isLocalMerge) {
        reportOnce(
          txDeps,
          current,
          freshContext,
          diagnosis,
          now,
          '本地合并步骤长时间无新进展，未自动重启，请检查是否卡在本地冲突或终端确认。',
          true,
        );
        return;
      }

      const runnerOnline =
        current.machineId !== null &&
        txDeps.db
          .select({ online: machine.online })
          .from(machine)
          .where(eq(machine.id, current.machineId))
          .get()?.online === true;
      const holdSettle =
        current.machineId === null ||
        runnerOnline ||
        txDeps.machineHub?.isConnected(current.machineId) === true;

      if (diagnosis.cause === 'missing_tools') {
        if (recoveryCount < 1) {
          requeueTurn(
            txDeps,
            current,
            freshContext,
            'missing_tools',
            now,
            withAcceptanceMissingContext(
              current,
              '检测到 Cairn 宿主工具未挂载，已停止旧会话并新建会话重试一次。',
            ),
            { freshSession: true, incrementRecovery: true, holdSettle },
          );
        } else {
          handleTerminalStall(
            txDeps,
            current,
            freshContext,
            'missing_tools',
            now,
            withAcceptanceMissingContext(
              current,
              '重新发起会话后 Cairn 宿主工具仍未挂载，已停止当前运行，请检查运行器或 MCP 配置。',
            ),
          );
        }
        return;
      }

      if (diagnosis.cause === 'quota') {
        handleQuotaDiagnosis(txDeps, current, freshContext, diagnosis, now, holdSettle);
        return;
      }

      if (diagnosis.cause === 'dead_turn') {
        if (recoveryCount < 1) {
          requeueTurn(
            txDeps,
            current,
            freshContext,
            'dead_turn',
            now,
            withAcceptanceMissingContext(
              current,
              '原运行器已失联且心跳中断，已自动重新排队继续执行。',
            ),
            { freshSession: false, incrementRecovery: true, holdSettle: false },
          );
        } else {
          handleTerminalStall(
            txDeps,
            current,
            freshContext,
            'dead_turn',
            now,
            withAcceptanceMissingContext(
              current,
              '重派后的运行器再次失联中断，已结束本轮避免循环，请检查执行机状态。',
            ),
          );
        }
        return;
      }

      if (recoveryCount < 1) {
        requeueTurn(
          txDeps,
          current,
          freshContext,
          'silent_turn',
          now,
          freshContext.kind === 'chief'
            ? '对话已有一段时间无新工具调用或输出，已自动停止旧回合并重启本轮。'
            : withAcceptanceMissingContext(
                current,
                '步骤已有一段时间无新工具调用或输出，已自动停止旧会话并新建会话重试一次。',
              ),
          { freshSession: true, incrementRecovery: true, holdSettle },
        );
      } else {
        reportOnce(
          txDeps,
          current,
          freshContext,
          diagnosis,
          now,
          withAcceptanceMissingContext(
            current,
            '自动重启后本轮仍无新进展，未继续重启，请查看当前执行状态。',
          ),
          false,
        );
      }
    });
  }
}
