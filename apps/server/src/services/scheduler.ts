import { join } from 'node:path';
import { ACTIVE_STEP_STATUSES, ENV_VARS, type Scheduler, WAITING_PHASES } from '@cairn/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ServerConfig } from '../config.js';
import { build, chief, dueEvent, project, schedule, step, todo } from '../db/schema.js';
import type { FetchLike } from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import { exportTrajectories } from '../trajectory-export.js';
import {
  OUTCOME_BACKFILL_INTERVAL_MS,
  type OutcomeBackfillLogger,
  sweepOutcomeBackfill,
} from '../trajectory-outcome-backfill.js';
import type { ReflectorEndpoint } from '../trajectory-reflect.js';
import {
  openGuardCandidateIssues,
  REFLECT_CURATE_INTERVAL_MS,
  type ReflectCurateLogger,
  sweepReflectCurate,
} from '../trajectory-reflect-curate.js';
import { dispatchActionWakes, sweepExpiredActionProposals } from './action-proposals.js';
import {
  ATTACHMENT_GC_INTERVAL_MS,
  type GcLogger,
  sweepAttachmentBatches,
  sweepStepSessions,
} from './attachment-gc.js';
import { releaseBlockedSteps } from './blockers.js';
import { sweepAbandonedBuildSteps, sweepAbandonedShipSteps } from './build-abandoned-sweep.js';
import {
  BuildContinuationPhaseError,
  type BuildDeps,
  sendBuildSteer,
  startBuilds,
  sweepPlanAutoConfirm,
  sweepZombieQueuedTodos,
  toBuildRecord,
} from './builds.js';
import { fireDueChiefWakes, sweepAbandonedChiefSteps } from './chief.js';
import { planChiefDigests } from './chief-digest.js';
import { sweepOverlongChiefTurns } from './chief-turns.js';
import { CI_POLL_INTERVAL_MS, type CiPollLogger, createCiPoller } from './ci-loop.js';
import { sweepIdleComposerDrafts } from './composer-drafts.js';
import {
  COORDINATOR_SNAPSHOT_CLEANUP_INTERVAL_MS,
  sweepCoordinatorTurnSnapshots,
} from './coordinator-turn-snapshot.js';
import { createDueRunner, type DueClock } from './due-events.js';
import { projectOfTodo } from './git.js';
import { autonomousToken } from './github-autonomous-token.js';
import { dispatchHostedCleanup } from './hosted-cleanup.js';
import {
  createIssueIntake,
  ISSUE_INTAKE_INTERVAL_MS,
  type IssueIntakeLogger,
} from './issue-intake.js';
import { sweepStaleMachines } from './machines.js';
import { purgeExpiredMemoryVersions } from './memory.js';
import { sweepFailedRetries } from './needs-you.js';
import { sweepIdleChiefUnread } from './notifications.js';
import { handoffUnclaimedOwnershipWake, ownershipHandoffEventId } from './owner.js';
import { PhaseTransitionError } from './phase.js';
import { createPrWatch, PR_WATCH_INTERVAL_MS } from './pr-watch.js';
import { digestSlotDueAt, digestSlotsDue, sweepPushDigest } from './push.js';
import { sweepPendingPushAlerts } from './push-alerts.js';
import { sweepQuotaWaitSteps } from './quota-wait.js';
import { planResearchIntake } from './research-intake.js';
import {
  ARCHIVED_SCHEDULE_PAUSE_REASON,
  assertWorkerScheduleInterval,
  computeNextRunAt,
  dueSchedules,
  isRecurring,
  isWorkerSchedule,
  pauseSchedule,
  recordScheduleFailure,
  setScheduleClockListener,
  updateNextRunAt,
  WORKER_SCHEDULE_MIN_INTERVAL_MS,
  WORKER_SCHEDULE_RUN_LIMIT,
  workerScheduleRunHistory,
} from './schedules.js';
import { createScheduling, SCHEDULE_INTERVAL_MS, type SchedulingRun } from './scheduling/sweep.js';
import { sweepSnoozeExpiry } from './snooze.js';
import { createTaskIssueSync } from './task-issue-sync.js';
import { insertMessageRow } from './transcript.js';
import { sweepUnplaceableSteps } from './unplaceable-steps.js';

export interface SchedulerOptions {
  tickMs: number;
  pushDigestTimes?: readonly string[];
  researchIntakeProjectId?: string | null;
  clock?: DueClock;
}

export interface CiPollRun {
  githubFetch: FetchLike;
  logger: CiPollLogger;
}

export interface IssueIntakeRun {
  githubFetch: FetchLike;
  logger: IssueIntakeLogger;
}

export function issueIntakeRunOf(
  config: { issueIntake: boolean },
  run: IssueIntakeRun,
): IssueIntakeRun | null {
  run.logger.info(
    { issueIntake: config.issueIntake },
    config.issueIntake
      ? `github issue intake on (${ENV_VARS.issueIntake})`
      : `github issue intake off (set ${ENV_VARS.issueIntake}=1 to enable)`,
  );
  return config.issueIntake ? run : null;
}

export function schedulingRunOf(
  config: { scheduling: boolean },
  run: SchedulingRun,
): SchedulingRun | null {
  run.logger?.info(
    { scheduling: config.scheduling },
    config.scheduling
      ? `weekly schedule report on (${ENV_VARS.scheduling})`
      : `weekly schedule report off (set ${ENV_VARS.scheduling}=1 to enable)`,
  );
  return config.scheduling ? run : null;
}

export interface AttachmentGcRun {
  attachmentsDir: string;
  logger: GcLogger;
}

export interface TrajectoryOutcomeRun {
  logger: OutcomeBackfillLogger;
}

export interface TrajectoryExportRun {
  logger: OutcomeBackfillLogger;
  config: ServerConfig;
}

export function trajectoryExportRunOf(
  config: ServerConfig,
  run: { logger: OutcomeBackfillLogger },
): TrajectoryExportRun {
  return { logger: run.logger, config };
}

export function trajectoryOutcomeRunOf(
  config: { trajectoryOutcomeBackfill: boolean },
  run: TrajectoryOutcomeRun,
): TrajectoryOutcomeRun | null {
  run.logger.info(
    { trajectoryOutcomeBackfill: config.trajectoryOutcomeBackfill },
    config.trajectoryOutcomeBackfill
      ? `trajectory outcome backfill on (${ENV_VARS.trajectoryOutcomeBackfill})`
      : `trajectory outcome backfill off (set ${ENV_VARS.trajectoryOutcomeBackfill}=1 to enable)`,
  );
  return config.trajectoryOutcomeBackfill ? run : null;
}

export interface TrajectoryReflectCurateRun {
  logger: ReflectCurateLogger;
  config: ServerConfig;
  model: string;
  endpoint: ReflectorEndpoint;
  openGuardIssues: boolean;
}

export function trajectoryReflectCurateRunOf(
  config: {
    trajectoryReflectCurate: boolean;
    trajectoryReflectOpenGuardIssues: boolean;
  },
  run: {
    logger: ReflectCurateLogger;
    config: ServerConfig;
    model: string;
    endpoint: ReflectorEndpoint;
  },
): TrajectoryReflectCurateRun | null {
  if (!config.trajectoryReflectCurate) {
    run.logger.info(
      { trajectoryReflectCurate: false },
      `trajectory reflect-curate off (set ${ENV_VARS.trajectoryReflectCurate}=1 to enable)`,
    );
    return null;
  }
  if (run.model === '' || run.endpoint.baseUrl === '' || run.endpoint.apiKey === '') {
    run.logger.info(
      { trajectoryReflectCurate: true },
      'trajectory reflect-curate off (missing reflector model, CAIRN_REFLECTOR_BASE_URL, or CAIRN_REFLECTOR_API_KEY)',
    );
    return null;
  }
  run.logger.info(
    {
      trajectoryReflectCurate: true,
      openGuardIssues: config.trajectoryReflectOpenGuardIssues,
    },
    `trajectory reflect-curate on (${ENV_VARS.trajectoryReflectCurate})`,
  );
  return {
    logger: run.logger,
    config: run.config,
    model: run.model,
    endpoint: run.endpoint,
    openGuardIssues: config.trajectoryReflectOpenGuardIssues,
  };
}

const SCHEDULE_GATE_PHASES: ReadonlySet<string> = new Set(WAITING_PHASES);

export function createScheduler(
  deps: BuildDeps,
  opts: SchedulerOptions,
  gc?: AttachmentGcRun | null,
  ci?: CiPollRun | null,
  intake?: IssueIntakeRun | null,
  outcome?: TrajectoryOutcomeRun | null,
  exportRun?: TrajectoryExportRun | null,
  reflectCurate?: TrajectoryReflectCurateRun | null,
  scheduling?: SchedulingRun | null,
): Scheduler {
  const lastDigestRun = new Map<string, number>();
  let digestSweeping = false;
  let lastResearchIntakeFailure: string | null = null;
  let alertsSweeping = false;
  const ciPoller =
    ci !== undefined && ci !== null
      ? createCiPoller(deps, {
          githubFetch: ci.githubFetch,
          logger: ci.logger,
          threadPrWakes: true,
        })
      : null;
  const prWatch = ci ? createPrWatch(deps, ci) : null;
  const taskIssueSync = ci ? createTaskIssueSync(deps, ci) : null;
  const correctionIntake = intake
    ? createIssueIntake(deps, { ...intake, label: 'correction' })
    : null;
  const issueIntake =
    intake !== undefined && intake !== null ? createIssueIntake(deps, intake) : null;
  const schedulingSweep =
    scheduling !== undefined && scheduling !== null
      ? createScheduling(deps, {
          githubFetch: scheduling.githubFetch,
          logger: scheduling.logger,
        })
      : null;
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
  let outcomeSweeping = false;
  let exportSweeping = false;
  let reflectCurateSweeping = false;
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
    const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
    const projectRow = todoRow ? projectOfTodo(deps.db, todoRow) : undefined;
    if (!todoRow || todoRow.projectId !== row.projectId || !projectRow) {
      deps.db.delete(schedule).where(eq(schedule.id, row.id)).run();
      return;
    }
    if (todoRow.archivedAt !== null) {
      pauseSchedule(deps, row.id, ARCHIVED_SCHEDULE_PAUSE_REASON);
      return;
    }
    const workerCreated = isWorkerSchedule(row.createdBy);
    if (workerCreated) {
      const history = workerScheduleRunHistory(deps, row.todoId);
      if (history.consecutive >= WORKER_SCHEDULE_RUN_LIMIT) {
        pauseSchedule(
          deps,
          row.id,
          'Paused after 10 consecutive scheduled runs without a human message',
        );
        return;
      }
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
    let nextRunAt: number | null = row.nextRunAt;
    if (isRecurring(row.kind)) {
      try {
        nextRunAt = computeNextRunAt(row.kind, row.at, row.tz, now, row.cron);
      } catch (err) {
        pauseSchedule(deps, row.id, err instanceof Error ? err.message : String(err));
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
        if (isRecurring(row.kind)) updateNextRunAt(deps, row.id, nextRunAt);
        return;
      }
    }
    const prompt = workerCreated
      ? `Scheduled follow-up you set earlier:\n\n${row.prompt}`
      : row.prompt || 'Continue this task.';
    let buildId = todoRow.latestBuildId;
    const freshAtConfirm = !workerCreated && todoRow.phase === 'confirm';
    if (buildId !== null && !freshAtConfirm) {
      await sendBuildSteer(
        deps,
        buildId,
        { content: prompt },
        {
          afterTurn: true,
          human: false,
          schedule: { id: row.id, createdBy: row.createdBy, at: now },
        },
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
      });
      buildId = started?.id ?? null;
    }
    const fired =
      buildId === null
        ? undefined
        : deps.db
            .select()
            .from(step)
            .where(and(eq(step.buildId, buildId), eq(step.status, 'pending')))
            .orderBy(desc(step.createdAt))
            .get();
    if (!fired) throw new Error('Scheduled continuation did not enqueue a step');
    deps.db.update(step).set({ scheduleId: row.id }).where(eq(step.id, fired.id)).run();
    if (todoRow.latestBuildId === null || freshAtConfirm) {
      insertMessageRow(deps, fired.buildId, {
        id: `schedule-wake-${fired.id}`,
        role: 'system',
        content: JSON.stringify({ kind: 'schedule-wake', stepId: fired.id }),
        createdAt: fired.createdAt,
      });
    }
    deps.db
      .update(schedule)
      .set({
        lastRunAt: now,
        lastRunStatus: 'started',
        lastRunError: null,
        retryNotBefore: null,
        lastRunStepId: fired.id,
      })
      .where(eq(schedule.id, row.id))
      .run();
    updateNextRunAt(deps, row.id, isRecurring(row.kind) ? nextRunAt : null);
  }

  function runSchedule(row: ReturnType<typeof dueSchedules>[number], now: number): Promise<void> {
    if (firing.has(row.id)) return Promise.resolve();
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
        const task = deps.db
          .select({ phase: todo.phase })
          .from(todo)
          .where(eq(todo.id, row.todoId))
          .get();
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
          else
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
        process.stderr.write(`Schedule ${row.id} failed: ${reason}\n`);
      })
      .catch(() => {
        process.stderr.write(`Schedule ${row.id} failure could not be recorded\n`);
      })
      .finally(() => firing.delete(row.id));
  }

  function runTick(now: number): Promise<void> {
    sweepExpiredActionProposals(deps.db, now);
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
    for (const row of dueSchedules(deps, now)) pending.push(runSchedule(row, now));
    sweepIdleChiefUnread(deps, now);
    sweepSnoozeExpiry(deps, now);
    fireDueChiefWakes(deps, now);
    try {
      planResearchIntake(deps, opts.researchIntakeProjectId ?? null, now);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (reason !== lastResearchIntakeFailure) {
        lastResearchIntakeFailure = reason;
        process.stderr.write(`Research intake failed: ${reason}\n`);
      }
    }
    releaseBlockedSteps(deps);
    planChiefDigests(deps, now);
    sweepStaleMachines(deps);
    sweepAbandonedChiefSteps(deps, now);
    sweepOverlongChiefTurns(deps, now);
    sweepAbandonedBuildSteps(deps, now);
    void sweepAbandonedShipSteps(deps, now).catch(() => {});
    sweepZombieQueuedTodos(deps, now);
    sweepPlanAutoConfirm(deps);
    sweepQuotaWaitSteps(deps, now);
    sweepUnplaceableSteps(deps, now);
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
  const openReflectGuards =
    reflectCurate?.openGuardIssues && deps.githubFetch !== undefined
      ? (guards: Parameters<typeof openGuardCandidateIssues>[1]) =>
          openGuardCandidateIssues(
            {
              db: deps.db,
              githubFetch: deps.githubFetch as FetchLike,
              tokenForTeam: (teamId, repo) => autonomousToken(deps, teamId, repo),
              logger: reflectCurate.logger,
            },
            guards,
          )
      : undefined;

  function scheduleDeadline(row: { nextRunAt: number; retryNotBefore: number | null }): number {
    if (row.retryNotBefore !== null && row.retryNotBefore > row.nextRunAt)
      return row.retryNotBefore;
    return row.nextRunAt;
  }

  function archivedProject(projectId: string): boolean {
    const projectRow = deps.db.select().from(project).where(eq(project.id, projectId)).get();
    return projectRow?.archivedAt != null;
  }

  function syncDueSources(): void {
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
      'coordinator-snapshot-gc': (_event, now) => {
        sweepCoordinatorTurnSnapshots(deps.db, now);
      },
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
        if (!after?.enabled || after.nextRunAt === null) return { rescheduleAt: null };
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
        await taskIssueSync?.sweep();
      },
      intake: async () => {
        await issueIntake?.sweep();
        await correctionIntake?.sweep();
      },
      scheduling: () => schedulingSweep?.sweep(),
      outcome: () => {
        if (outcome === undefined || outcome === null || deps.reposDir === undefined) return;
        if (outcomeSweeping) return;
        const reposDir = deps.reposDir;
        outcomeSweeping = true;
        return sweepOutcomeBackfill({ db: deps.db, reposDir, logger: outcome.logger })
          .catch(() => undefined)
          .finally(() => {
            outcomeSweeping = false;
          });
      },
      export: () => {
        if (exportRun === undefined || exportRun === null || exportSweeping) return;
        exportSweeping = true;
        const date = new Date().toISOString().slice(0, 10);
        const out = join(exportRun.config.dataDir, 'trajectory-exports', `${date}.jsonl`);
        try {
          const res = exportTrajectories(exportRun.config, { out });
          exportRun.logger.info({ ...res, date }, 'trajectory daily export');
        } catch (err) {
          exportRun.logger.info(
            { err: err instanceof Error ? err.message : String(err), date },
            'trajectory daily export failed (scheduler continues)',
          );
        } finally {
          exportSweeping = false;
        }
      },
      reflect: () => {
        if (reflectCurate === undefined || reflectCurate === null || reflectCurateSweeping) return;
        const run = reflectCurate;
        reflectCurateSweeping = true;
        return sweepReflectCurate({
          config: run.config,
          db: deps.db,
          logger: run.logger,
          model: run.model,
          endpoint: run.endpoint,
          openNewGuards: openReflectGuards,
        })
          .then((summary) => {
            run.logger.info(summary, 'trajectory reflect-curate');
          })
          .catch((err) => {
            run.logger.info(
              { err: err instanceof Error ? err.message : String(err) },
              'trajectory reflect-curate failed (scheduler continues)',
            );
          })
          .finally(() => {
            reflectCurateSweeping = false;
          });
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
      sweepExpiredActionProposals(deps.db);
      dispatchActionWakes(deps);
      if (deps.reposDir) dispatchHostedCleanup(deps.db, deps.reposDir);
      setScheduleClockListener(() => dueRunner.arm());
      ensureDue('sweep:main', 'sweep', opts.tickMs);
      ensureDue(
        'gc:coordinator-snapshots',
        'coordinator-snapshot-gc',
        COORDINATOR_SNAPSHOT_CLEANUP_INTERVAL_MS,
      );
      if (ciPoller !== null) ensureDue('poll:ci', 'ci', CI_POLL_INTERVAL_MS);
      if (prWatch !== null) ensureDue('poll:pr-watch', 'pr-watch', PR_WATCH_INTERVAL_MS);
      if (issueIntake !== null) ensureDue('poll:intake', 'intake', ISSUE_INTAKE_INTERVAL_MS);
      if (schedulingSweep !== null) {
        ensureDue('poll:scheduling', 'scheduling', SCHEDULE_INTERVAL_MS);
      }
      if (outcome !== undefined && outcome !== null && deps.reposDir !== undefined) {
        ensureDue('poll:outcome', 'outcome', OUTCOME_BACKFILL_INTERVAL_MS);
      }
      if (exportRun !== undefined && exportRun !== null) {
        ensureDue('poll:export', 'export', OUTCOME_BACKFILL_INTERVAL_MS);
      }
      if (reflectCurate !== undefined && reflectCurate !== null) {
        ensureDue('poll:reflect', 'reflect', REFLECT_CURATE_INTERVAL_MS);
      }
      dueRunner.arm();
    },
    stop() {
      dueStarted = false;
      setScheduleClockListener(null);
      dueRunner.stop();
      if (gcImmediate !== null) clearImmediate(gcImmediate);
      gcImmediate = null;
      gcBatches = null;
    },
  };
}
