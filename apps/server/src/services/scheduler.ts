import { ACTIVE_STEP_STATUSES, type Scheduler, WAITING_PHASES } from '@cairn/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { build, chief, dueEvent, project, schedule, step, todo } from '../db/schema.js';
import type { FetchLike } from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import { dispatchActionWakes, sweepExpiredActionProposals } from './action-proposals.js';
import {
  ATTACHMENT_GC_INTERVAL_MS,
  type GcLogger,
  sweepAttachmentBatches,
  sweepStepSessions,
  sweepUploadParts,
} from './attachment-gc.js';
import { releaseBlockedSteps } from './blockers.js';
import { sweepAbandonedBuildSteps } from './build-abandoned-sweep.js';
import { sweepStalledRunningTodos } from './build-stalled-sweep.js';
import {
  BuildContinuationPhaseError,
  type BuildDeps,
  sendBuildSteer,
  startBuilds,
  sweepPlanAutoConfirm,
  sweepZombieQueuedTodos,
  toBuildRecord,
} from './builds.js';
import { fireDueChiefWakes, scheduleChiefThreadTurn, sweepAbandonedChiefSteps } from './chief.js';
import { sweepOverlongChiefTurns } from './chief-turns.js';
import { CI_POLL_INTERVAL_MS, type CiPollLogger, createCiPoller } from './ci-loop.js';
import { sweepIdleComposerDrafts } from './composer-drafts.js';
import { createDueRunner, type DueClock } from './due-events.js';
import { drainEffects, effectRegistry, reconcileEffects } from './external-effects.js';
import { projectOfTodo } from './git.js';
import { dispatchHostedCleanup } from './hosted-cleanup.js';
import {
  MACHINE_TOKEN_ROTATION_EVENT_KIND,
  processMachineTokenRotationDue,
  setMachineTokenRotationClockListener,
  syncMachineTokenRotationDueEvents,
} from './machine-rotate-token.js';
import { sweepStaleMachines } from './machines.js';
import { purgeExpiredMemoryVersions } from './memory.js';
import { sweepAbandonedMemoryEditSteps } from './memory-edit-turns.js';
import { sweepFailedRetries } from './needs-you.js';
import {
  notificationAwayEventId,
  processNotificationAwayDue,
  registerNotificationDelivery,
  setNotificationClockListener,
} from './notification-router.js';
import { sweepIdleChiefUnread } from './notifications.js';
import { handoffUnclaimedOwnershipWake, ownershipHandoffEventId } from './owner.js';
import { PhaseTransitionError } from './phase.js';
import { createPrWatch, PR_WATCH_INTERVAL_MS } from './pr-watch.js';
import { digestSlotDueAt, digestSlotsDue, sweepPushDigest } from './push.js';
import { sweepPendingPushAlerts } from './push-alerts.js';
import { sweepQuotaWaitSteps } from './quota-wait.js';
import { releaseResearchReworkHolds } from './research-stuck.js';
import { sweepOfflineRunners } from './runner-offline.js';
import {
  ARCHIVED_SCHEDULE_PAUSE_REASON,
  applyMissedRunWindow,
  assertWorkerScheduleInterval,
  computeNextRunAt,
  dueSchedules,
  formatScheduleFailureSnippet,
  isRecurring,
  isTriggerKind,
  isWorkerSchedule,
  notifyScheduleClock,
  notifyScheduleTarget,
  pauseSchedule,
  recordScheduleFailure,
  setScheduleClockListener,
  updateNextRunAt,
  WORKER_SCHEDULE_MIN_INTERVAL_MS,
  WORKER_SCHEDULE_RUN_LIMIT,
  workerScheduleRunHistory,
} from './schedules.js';
import { sweepStallMonitor } from './stall-monitor.js';
import { sweepUnplaceableSteps } from './unplaceable-steps.js';
import { sweepWorkerWatchdog } from './worker-watchdog.js';

export interface SchedulerOptions {
  tickMs: number;
  pushDigestTimes?: readonly string[];
  clock?: DueClock;
  tokenRotationIntervalMs?: number;
  tokenRotationRetryMs?: number;
  tokenRotationTimeoutMs?: number;
  logger?: {
    info?: (obj: object, msg?: string) => void;
    warn?: (obj: object, msg?: string) => void;
  };
}

export interface CiPollRun {
  githubFetch: FetchLike;
  logger: CiPollLogger;
}

export interface AttachmentGcRun {
  attachmentsDir: string;
  logger: GcLogger;
}

const SCHEDULE_GATE_PHASES: ReadonlySet<string> = new Set(WAITING_PHASES);

export function createScheduler(
  deps: BuildDeps,
  opts: SchedulerOptions,
  gc?: AttachmentGcRun | null,
  ci?: CiPollRun | null,
): Scheduler {
  registerNotificationDelivery(deps.db, deps.vapidKeys ?? null);
  const lastDigestRun = new Map<string, number>();
  let digestSweeping = false;
  let lastResearchFailure: string | null = null;
  let alertsSweeping = false;
  let effectsSweeping = false;
  const ciPoller =
    ci !== undefined && ci !== null
      ? createCiPoller(deps, {
          githubFetch: ci.githubFetch,
          logger: ci.logger,
          threadPrWakes: true,
        })
      : null;
  const prWatch = ci ? createPrWatch(deps, ci) : null;
  let prSweep: Promise<void> | null = null;
  let prSweepAt = Number.NEGATIVE_INFINITY;
  function watchPrs() {
    const now = clock.now();
    if (prSweep === null || now - prSweepAt >= PR_WATCH_INTERVAL_MS) {
      prSweepAt = now;
      prSweep = prWatch?.sweep(now).then(() => undefined) ?? Promise.resolve();
    }
    return prSweep;
  }
  let lastGcAt = 0;
  let gcImmediate: NodeJS.Immediate | null = null;
  let gcBatches: ReturnType<typeof sweepAttachmentBatches> | null = null;
  let dueStarted = false;

  function advanceGc(): void {
    if (!gc || !gcBatches) return;
    try {
      if (gcBatches.next().done) {
        gcBatches = null;
        gcImmediate = null;
        return;
      }
      gcImmediate = setImmediate(advanceGc);
      gcImmediate.unref();
    } catch (err) {
      gcBatches = null;
      gcImmediate = null;
      gc.logger.info(
        { err: err instanceof Error ? err.message : String(err) },
        'attachment gc failed (scheduler continues)',
      );
    }
  }

  const firing = new Set<string>();

  async function fireSchedule(
    row: ReturnType<typeof dueSchedules>[number],
    now: number,
  ): Promise<void> {
    let nextRunAt: number | null = row.nextRunAt;
    if (isRecurring(row.kind)) {
      try {
        nextRunAt = computeNextRunAt(row.kind, row.at, row.tz, now, row.cron);
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        pauseSchedule(deps, row.id, reason);
        notifyScheduleTarget(deps, row, formatScheduleFailureSnippet(reason));
        return;
      }
    }
    if (row.chiefThreadId !== null) {
      scheduleChiefThreadTurn(deps, {
        scheduleId: row.id,
        teamId: row.teamId,
        threadId: row.chiefThreadId,
        prompt: row.prompt,
        createdBy: row.createdBy,
        now,
        expectedNextRunAt: row.nextRunAt,
        nextRunAt: isRecurring(row.kind) ? nextRunAt : null,
        recurring: isRecurring(row.kind),
      });
      notifyScheduleClock(deps.db);
      return;
    }
    if (row.todoId === null || row.projectId === null) {
      deps.db.delete(schedule).where(eq(schedule.id, row.id)).run();
      notifyScheduleClock(deps.db);
      return;
    }
    const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
    const projectRow = todoRow ? projectOfTodo(deps.db, todoRow) : undefined;
    if (
      !todoRow ||
      todoRow.teamId !== row.teamId ||
      todoRow.projectId !== row.projectId ||
      !projectRow ||
      projectRow.teamId !== row.teamId
    ) {
      deps.db.delete(schedule).where(eq(schedule.id, row.id)).run();
      return;
    }
    if (todoRow.archivedAt !== null) {
      pauseSchedule(deps, row.id, ARCHIVED_SCHEDULE_PAUSE_REASON);
      return;
    }
    const workerCreated = isWorkerSchedule(row.createdBy);
    const runLimited = workerCreated || isTriggerKind(row.kind);
    const history = runLimited ? workerScheduleRunHistory(deps, row.todoId) : null;
    if (history !== null && history.consecutive >= WORKER_SCHEDULE_RUN_LIMIT) {
      pauseSchedule(
        deps,
        row.id,
        'Paused after 10 consecutive scheduled runs without a human message',
      );
      return;
    }
    if (workerCreated && history !== null) {
      if (SCHEDULE_GATE_PHASES.has(todoRow.phase)) {
        try {
          const next = isRecurring(row.kind)
            ? computeNextRunAt(row.kind, row.at, row.tz, now, row.cron)
            : now + WORKER_SCHEDULE_MIN_INTERVAL_MS;
          updateNextRunAt(deps, row.id, next);
        } catch (err) {
          pauseSchedule(deps, row.id, err instanceof Error ? err.message : String(err));
        }
        return;
      }
      try {
        assertWorkerScheduleInterval(row, now, false);
      } catch (err) {
        pauseSchedule(deps, row.id, err instanceof Error ? err.message : String(err));
        return;
      }
      if (history.lastRunAt !== null && now - history.lastRunAt < WORKER_SCHEDULE_MIN_INTERVAL_MS) {
        updateNextRunAt(deps, row.id, history.lastRunAt + WORKER_SCHEDULE_MIN_INTERVAL_MS);
        return;
      }
    }
    if (todoRow.latestBuildId !== null) {
      const active = deps.db
        .select({ id: step.id })
        .from(step)
        .where(
          and(
            eq(step.buildId, todoRow.latestBuildId),
            inArray(step.status, [...ACTIVE_STEP_STATUSES]),
          ),
        )
        .get();
      if (active) {
        updateNextRunAt(deps, row.id, isRecurring(row.kind) ? nextRunAt : now);
        return;
      }
    }
    const prompt = workerCreated
      ? `Scheduled follow-up you set earlier:\n\n${row.prompt}`
      : row.prompt || 'Continue this task.';
    let buildId = todoRow.latestBuildId;
    const freshAtConfirm = !workerCreated && todoRow.phase === 'confirm';
    const wake = {
      id: row.id,
      createdBy: row.createdBy,
      at: now,
      expected: row.nextRunAt,
      next: isRecurring(row.kind) ? nextRunAt : null,
      triggered: isTriggerKind(row.kind),
    };
    if (buildId !== null && !freshAtConfirm) {
      await sendBuildSteer(
        deps,
        buildId,
        { content: prompt },
        { afterTurn: true, human: false, schedule: wake },
      );
    } else {
      if (freshAtConfirm && buildId !== null) {
        deps.db.update(build).set({ errorMessage: 'Cancelled' }).where(eq(build.id, buildId)).run();
        const cancelled = deps.db.select().from(build).where(eq(build.id, buildId)).get();
        if (cancelled) deps.hub.publishBuildDoc(todoRow.teamId, toBuildRecord(cancelled));
      }
      const [started] = startBuilds(deps, {
        projectId: row.projectId,
        todoIds: [row.todoId],
        triggerSource: 'schedule',
        scheduledBy: row.createdBy,
        prompt: workerCreated ? prompt : row.prompt || undefined,
        schedule: {
          id: wake.id,
          expected: wake.expected,
          at: wake.at,
          next: wake.next,
          triggered: wake.triggered,
        },
      });
      buildId = started?.id ?? null;
    }
    notifyScheduleClock(deps.db);
  }

  function targetIsBusy(row: ReturnType<typeof dueSchedules>[number]): boolean {
    if (row.chiefThreadId !== null) {
      return (
        deps.db
          .select({ id: step.id })
          .from(step)
          .where(
            and(
              eq(step.buildId, row.chiefThreadId),
              eq(step.kind, 'chief'),
              inArray(step.status, [...ACTIVE_STEP_STATUSES]),
            ),
          )
          .get() !== undefined
      );
    }
    if (row.todoId === null) return false;
    const targetTodo = deps.db
      .select({ latestBuildId: todo.latestBuildId })
      .from(todo)
      .where(eq(todo.id, row.todoId))
      .get();
    if (!targetTodo?.latestBuildId) return false;
    return (
      deps.db
        .select({ id: step.id })
        .from(step)
        .where(
          and(
            eq(step.buildId, targetTodo.latestBuildId),
            inArray(step.status, [...ACTIVE_STEP_STATUSES]),
          ),
        )
        .get() !== undefined
    );
  }

  function runSchedule(row: ReturnType<typeof dueSchedules>[number], now: number): Promise<void> {
    if (firing.has(row.id)) return Promise.resolve();
    if (!targetIsBusy(row) && applyMissedRunWindow(deps, row, now)) return Promise.resolve();
    firing.add(row.id);
    return fireSchedule(row, now)
      .catch((err: unknown) => {
        const current = deps.db.select().from(schedule).where(eq(schedule.id, row.id)).get();
        if (
          !current?.enabled ||
          current.lastRunStepId !== row.lastRunStepId ||
          current.nextRunAt !== row.nextRunAt
        )
          return;
        const task =
          row.todoId === null
            ? undefined
            : deps.db.select({ phase: todo.phase }).from(todo).where(eq(todo.id, row.todoId)).get();
        if (isWorkerSchedule(row.createdBy) && task && SCHEDULE_GATE_PHASES.has(task.phase)) {
          updateNextRunAt(
            deps,
            row.id,
            isRecurring(row.kind)
              ? computeNextRunAt(row.kind, row.at, row.tz, now, row.cron)
              : now + WORKER_SCHEDULE_MIN_INTERVAL_MS,
          );
          return;
        }
        if (
          !isWorkerSchedule(row.createdBy) &&
          (err instanceof BuildContinuationPhaseError || err instanceof PhaseTransitionError)
        ) {
          if (isRecurring(row.kind))
            updateNextRunAt(
              deps,
              row.id,
              computeNextRunAt(row.kind, row.at, row.tz, now, row.cron),
            );
          else if (!isTriggerKind(row.kind))
            deps.db
              .update(schedule)
              .set({
                nextRunAt: null,
                lastRunStatus: 'skipped',
                lastRunError: err.message,
                retryNotBefore: null,
              })
              .where(eq(schedule.id, row.id))
              .run();
          return;
        }
        const reason = err instanceof Error ? err.message : String(err);
        recordScheduleFailure(deps, row.id, reason, now);
        notifyScheduleTarget(deps, row, formatScheduleFailureSnippet(reason));
        process.stderr.write(`Schedule ${row.id} failed: ${reason}\n`);
      })
      .catch(() => {
        process.stderr.write(`Schedule ${row.id} failure could not be recorded\n`);
      })
      .finally(() => firing.delete(row.id));
  }

  function runTick(now: number): Promise<void> {
    sweepExpiredActionProposals(deps.db, now, deps.convHub);
    dispatchActionWakes(deps);
    if (deps.reposDir) dispatchHostedCleanup(deps.db, deps.reposDir, now);
    const pending: Promise<void>[] = [];
    if (!alertsSweeping) {
      alertsSweeping = true;
      void sweepPendingPushAlerts(deps.db, undefined, now)
        .catch(() => {
          process.stderr.write('Push alert recovery failed\n');
        })
        .finally(() => {
          alertsSweeping = false;
        });
    }
    if (!effectsSweeping) {
      effectsSweeping = true;
      void (async () => {
        await reconcileEffects(deps.db, effectRegistry, now);
        await drainEffects(deps.db, effectRegistry, { now });
      })()
        .catch(() => {
          process.stderr.write('External effects recovery failed\n');
        })
        .finally(() => {
          effectsSweeping = false;
        });
    }
    for (const row of dueSchedules(deps, now)) pending.push(runSchedule(row, now));
    sweepIdleChiefUnread(deps, now);
    fireDueChiefWakes(deps, now);
    try {
      releaseResearchReworkHolds(deps, now);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (reason !== lastResearchFailure) {
        lastResearchFailure = reason;
        process.stderr.write(`Research maintenance failed: ${reason}\n`);
      }
    }
    releaseBlockedSteps(deps);
    sweepStaleMachines(deps);
    sweepAbandonedMemoryEditSteps(deps, now);
    sweepOverlongChiefTurns(deps, now);
    sweepStallMonitor(deps, now);
    sweepAbandonedChiefSteps(deps, now);
    sweepAbandonedBuildSteps(deps, now);
    sweepZombieQueuedTodos(deps, now);
    sweepStalledRunningTodos(deps, now);
    sweepPlanAutoConfirm(deps);
    sweepQuotaWaitSteps(deps, now);
    sweepOfflineRunners(deps, now);
    sweepUnplaceableSteps(deps, now);
    sweepWorkerWatchdog(deps, now);
    void sweepFailedRetries(deps).catch(() => {});
    const digestTimes = opts.pushDigestTimes ?? [];
    if (digestTimes.length > 0 && !digestSweeping) {
      const due = digestSlotsDue(now, digestTimes, lastDigestRun);
      if (due.length > 0) {
        for (const slot of due) {
          const at = digestSlotDueAt(now, slot);
          if (at !== null) lastDigestRun.set(slot, at);
        }
        digestSweeping = true;
        void sweepPushDigest(deps.db, deps.vapidKeys ?? null)
          .catch(() => {})
          .finally(() => {
            digestSweeping = false;
          });
      }
    }
    if (
      gc !== undefined &&
      gc !== null &&
      gcBatches === null &&
      now - lastGcAt >= ATTACHMENT_GC_INTERVAL_MS
    ) {
      lastGcAt = now;
      try {
        gcBatches = sweepAttachmentBatches(
          { db: deps.db, attachmentsDir: gc.attachmentsDir, logger: gc.logger },
          now,
        );
        sweepIdleComposerDrafts(deps.db, now);
        purgeExpiredMemoryVersions(deps.db, now);
        advanceGc();
        sweepStepSessions(
          { db: deps.db, attachmentsDir: gc.attachmentsDir, logger: gc.logger },
          now,
        );
        sweepUploadParts({ attachmentsDir: gc.attachmentsDir, logger: gc.logger }, now);
      } catch (err) {
        gc.logger.info(
          { err: err instanceof Error ? err.message : String(err) },
          'attachment gc failed (scheduler continues)',
        );
      }
    }
    return Promise.all(pending).then(() => undefined);
  }

  function tick(now = nowMs()): Promise<void> {
    try {
      return runTick(now);
    } catch (err) {
      process.stderr.write(
        `Scheduler tick failed: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      return Promise.resolve();
    }
  }

  const clock: DueClock = opts.clock ?? {
    now: nowMs,
    setTimer(callback, delayMs) {
      const handle = setTimeout(() => void callback(), delayMs);
      handle.unref?.();
      return handle;
    },
    clearTimer(handle) {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
  };
  function scheduleDeadline(row: { nextRunAt: number; retryNotBefore: number | null }): number {
    if (row.retryNotBefore !== null && row.retryNotBefore > row.nextRunAt)
      return row.retryNotBefore;
    return row.nextRunAt;
  }

  function archivedProject(projectId: string | null): boolean {
    if (projectId === null) return false;
    const projectRow = deps.db.select().from(project).where(eq(project.id, projectId)).get();
    return projectRow?.archivedAt != null;
  }

  function syncDueSources(): void {
    syncMachineTokenRotationDueEvents(deps.db, clock.now(), opts.tokenRotationIntervalMs);
    const liveSchedules = new Set<string>();
    for (const row of deps.db.select().from(schedule).all()) {
      if (!row.enabled || row.nextRunAt === null || archivedProject(row.projectId)) continue;
      const id = `schedule:${row.id}`;
      liveSchedules.add(id);
      const deadline = scheduleDeadline({
        nextRunAt: row.nextRunAt,
        retryNotBefore: row.retryNotBefore,
      });
      const existing = deps.db.select().from(dueEvent).where(eq(dueEvent.id, id)).get();
      const now = clock.now();
      const deferred = existing !== undefined && deadline <= now && existing.dueAt > now;
      if (!deferred && (!existing || existing.dueAt !== deadline)) {
        dueRunner.upsert({ id, kind: 'schedule', dueAt: deadline });
      }
    }
    for (const event of deps.db.select().from(dueEvent).all()) {
      if (event.kind === 'schedule' && !liveSchedules.has(event.id)) {
        deps.db.delete(dueEvent).where(eq(dueEvent.id, event.id)).run();
      }
    }
    let wakeAt: number | null = null;
    for (const row of deps.db.select().from(chief).all()) {
      for (const wake of row.wakes) {
        const at = wake.at;
        if (typeof at !== 'number') continue;
        if (wakeAt === null || at < wakeAt) wakeAt = at;
      }
    }
    if (wakeAt === null) {
      deps.db.delete(dueEvent).where(eq(dueEvent.id, 'wake:next')).run();
      return;
    }
    const existingWake = deps.db.select().from(dueEvent).where(eq(dueEvent.id, 'wake:next')).get();
    const now = clock.now();
    const backedOff =
      existingWake !== undefined && existingWake.attempts > 0 && existingWake.dueAt > now;
    if (
      !backedOff &&
      (!existingWake ||
        wakeAt < existingWake.dueAt ||
        (existingWake.attempts === 0 && existingWake.dueAt !== wakeAt))
    ) {
      dueRunner.upsert({ id: 'wake:next', kind: 'wake', dueAt: wakeAt });
    }
  }

  const dueRunner = createDueRunner(
    deps.db,
    clock,
    {
      sweep: (_event, now) => runTick(now),
      schedule: async (event, now) => {
        const id = event.id.slice('schedule:'.length);
        const row = deps.db.select().from(schedule).where(eq(schedule.id, id)).get();
        if (!row?.enabled || row.nextRunAt === null || archivedProject(row.projectId)) {
          return { rescheduleAt: null };
        }
        if (row.retryNotBefore !== null && row.retryNotBefore > now) {
          return { rescheduleAt: row.retryNotBefore };
        }
        if (row.nextRunAt > now) return { rescheduleAt: row.nextRunAt };
        await runSchedule(row, now);
        const after = deps.db.select().from(schedule).where(eq(schedule.id, id)).get();
        if (!after?.enabled || after.nextRunAt === null || archivedProject(after.projectId)) {
          return { rescheduleAt: null };
        }
        if (after.retryNotBefore !== null && after.retryNotBefore > now) {
          return { rescheduleAt: Math.max(after.nextRunAt, after.retryNotBefore) };
        }
        if (after.nextRunAt <= now) return { rescheduleAt: now + opts.tickMs };
        return { rescheduleAt: after.nextRunAt };
      },
      'ownership-handoff': (event, now) => {
        const prefix = ownershipHandoffEventId('');
        if (!event.id.startsWith(prefix)) return { rescheduleAt: null };
        return {
          rescheduleAt: handoffUnclaimedOwnershipWake(deps, event.id.slice(prefix.length), now),
        };
      },
      'notification-away': (event, now) => {
        const prefix = notificationAwayEventId('');
        if (!event.id.startsWith(prefix)) return { rescheduleAt: null };
        return processNotificationAwayDue(deps, event.id.slice(prefix.length), now);
      },
      wake: (_event, now) => {
        fireDueChiefWakes(deps, now);
        return { rescheduleAt: null };
      },
      ci: async () => {
        await watchPrs();
        await ciPoller?.sweep();
      },
      feedback: async () => {
        await watchPrs();
      },
      'pr-watch': async () => {
        await watchPrs();
      },
      [MACHINE_TOKEN_ROTATION_EVENT_KIND]: (event, now) => {
        if (deps.machineHub === undefined) return { rescheduleAt: null };
        return processMachineTokenRotationDue(
          {
            db: deps.db,
            hub: deps.hub,
            machineHub: deps.machineHub,
            ...(opts.logger !== undefined ? { logger: opts.logger } : {}),
          },
          event,
          now,
          {
            intervalMs: opts.tokenRotationIntervalMs,
            retryMs: opts.tokenRotationRetryMs,
            timeoutMs: opts.tokenRotationTimeoutMs,
          },
        );
      },
    },
    syncDueSources,
  );

  function ensureDue(id: string, kind: string, intervalMs: number): void {
    const existing = deps.db.select().from(dueEvent).where(eq(dueEvent.id, id)).get();
    if (existing) return;
    dueRunner.upsert({ id, kind, dueAt: clock.now(), intervalMs });
  }

  return {
    tick,
    start() {
      if (dueStarted) return;
      dueStarted = true;
      deps.db.delete(dueEvent).where(eq(dueEvent.id, 'gc:coordinator-snapshots')).run();
      sweepExpiredActionProposals(deps.db, nowMs(), deps.convHub);
      dispatchActionWakes(deps);
      if (deps.reposDir) dispatchHostedCleanup(deps.db, deps.reposDir);
      setScheduleClockListener(deps.db, () => dueRunner.arm());
      setNotificationClockListener(deps.db, () => dueRunner.arm());
      setMachineTokenRotationClockListener(deps.db, () => dueRunner.arm());
      ensureDue('sweep:main', 'sweep', opts.tickMs);
      if (ciPoller !== null) ensureDue('poll:ci', 'ci', CI_POLL_INTERVAL_MS);
      if (prWatch !== null) ensureDue('poll:pr-watch', 'pr-watch', PR_WATCH_INTERVAL_MS);
      dueRunner.arm();
    },
    stop() {
      dueStarted = false;
      setScheduleClockListener(deps.db, null);
      setNotificationClockListener(deps.db, null);
      setMachineTokenRotationClockListener(deps.db, null);
      dueRunner.stop();
      if (gcImmediate !== null) clearImmediate(gcImmediate);
      gcImmediate = null;
      gcBatches = null;
    },
  };
}
