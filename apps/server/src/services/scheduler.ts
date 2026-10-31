import { join } from 'node:path';
import { ENV_VARS, type Scheduler } from '@cairn/shared';
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { ServerConfig } from '../config.js';
import { build, schedule, step, todo } from '../db/schema.js';
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
import {
  ATTACHMENT_GC_INTERVAL_MS,
  type GcLogger,
  sweepAttachmentBatches,
  sweepStepSessions,
} from './attachment-gc.js';
import {
  BuildContinuationPhaseError,
  type BuildDeps,
  sendBuildSteer,
  startBuilds,
  sweepAbandonedBuildSteps,
  sweepPlanAutoConfirm,
  sweepZombieQueuedTodos,
  toBuildRecord,
} from './builds.js';
import { fireDueChiefWakes, sweepAbandonedChiefSteps } from './chief.js';
import { planChiefDigests } from './chief-digest.js';
import { CI_POLL_INTERVAL_MS, type CiPollLogger, createCiPoller } from './ci-loop.js';
import { projectOfTodo } from './git.js';
import { githubTokenOrNull } from './github-connection.js';
import {
  createIssueIntake,
  ISSUE_INTAKE_INTERVAL_MS,
  type IssueIntakeLogger,
} from './issue-intake.js';
import { sweepStaleMachines } from './machines.js';
import { sweepFailedRetries } from './needs-you.js';
import { sweepIdleChiefUnread } from './notifications.js';
import { PhaseTransitionError } from './phase.js';
import { createPrFeedbackPoller, PR_FEEDBACK_INTERVAL_MS } from './pr-feedback.js';
import { digestSlotDueAt, digestSlotsDue, sweepPushDigest } from './push.js';
import { sweepPendingPushAlerts } from './push-alerts.js';
import { sweepQuotaWaitSteps } from './quota-wait.js';
import {
  ARCHIVED_SCHEDULE_PAUSE_REASON,
  assertWorkerScheduleInterval,
  computeNextRunAt,
  dueSchedules,
  isRecurring,
  isWorkerSchedule,
  pauseSchedule,
  recordScheduleFailure,
  updateNextRunAt,
  WORKER_SCHEDULE_MIN_INTERVAL_MS,
  WORKER_SCHEDULE_RUN_LIMIT,
  workerScheduleRunHistory,
} from './schedules.js';
import { createScheduling, SCHEDULE_INTERVAL_MS, type SchedulingRun } from './scheduling/sweep.js';
import { insertMessageRow } from './transcript.js';

export interface SchedulerOptions {
  tickMs: number;
  pushDigestTimes?: readonly string[];
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

const SCHEDULE_GATE_PHASES = new Set(['confirm', 'review']);

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
  let timer: NodeJS.Timeout | null = null;
  const lastDigestRun = new Map<string, number>();
  let digestSweeping = false;
  let alertsSweeping = false;
  const ciPoller =
    ci !== undefined && ci !== null
      ? createCiPoller(deps, { githubFetch: ci.githubFetch, logger: ci.logger })
      : null;
  let ciTimer: NodeJS.Timeout | null = null;
  const feedbackPoller = ci ? createPrFeedbackPoller(deps, ci) : null;
  let feedbackTimer: NodeJS.Timeout | null = null;
  const correctionIntake = intake
    ? createIssueIntake(deps, { ...intake, label: 'correction' })
    : null;
  const issueIntake =
    intake !== undefined && intake !== null
      ? createIssueIntake(deps, { githubFetch: intake.githubFetch, logger: intake.logger })
      : null;
  let intakeTimer: NodeJS.Timeout | null = null;
  const schedulingSweep =
    scheduling !== undefined && scheduling !== null
      ? createScheduling(deps, {
          githubFetch: scheduling.githubFetch,
          logger: scheduling.logger,
        })
      : null;
  let scheduleTimer: NodeJS.Timeout | null = null;
  let lastGcAt = 0;
  let gcImmediate: NodeJS.Immediate | null = null;
  let gcBatches: ReturnType<typeof sweepAttachmentBatches> | null = null;
  let outcomeTimer: NodeJS.Timeout | null = null;
  let outcomeSweeping = false;
  let exportTimer: NodeJS.Timeout | null = null;
  let exportSweeping = false;
  let reflectCurateTimer: NodeJS.Timeout | null = null;
  let reflectCurateSweeping = false;

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
            inArray(step.status, ['pending', 'claimed', 'waiting_quota']),
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
        assignment: todoRow.assignment ?? { plan: null, build: null },
        withPlan: false,
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

  function runTick(now: number): Promise<void> {
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
    for (const row of dueSchedules(deps, now)) {
      if (firing.has(row.id)) continue;
      firing.add(row.id);
      pending.push(
        fireSchedule(row, now)
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
          .finally(() => firing.delete(row.id)),
      );
    }
    sweepIdleChiefUnread(deps, now);
    fireDueChiefWakes(deps, now);
    planChiefDigests(deps, now);
    sweepStaleMachines(deps);
    sweepAbandonedChiefSteps(deps, now);
    sweepAbandonedBuildSteps(deps, now);
    sweepZombieQueuedTodos(deps, now);
    sweepPlanAutoConfirm(deps, now);
    sweepQuotaWaitSteps(deps, now);
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

  return {
    tick,
    start() {
      if (timer !== null) return;
      void tick();
      timer = setInterval(() => void tick(), opts.tickMs);
      timer.unref?.();
      if (ciPoller !== null) {
        void ciPoller.sweep().catch(() => {});
        ciTimer = setInterval(() => {
          void ciPoller.sweep().catch(() => {});
        }, CI_POLL_INTERVAL_MS);
        ciTimer.unref?.();
      }
      if (feedbackPoller !== null) {
        void feedbackPoller.sweep().catch(() => {});
        feedbackTimer = setInterval(() => {
          void feedbackPoller.sweep().catch(() => {});
        }, PR_FEEDBACK_INTERVAL_MS);
        feedbackTimer.unref?.();
      }
      if (issueIntake !== null) {
        void issueIntake
          .sweep()
          .then(() => correctionIntake?.sweep())
          .catch(() => {});
        intakeTimer = setInterval(() => {
          void issueIntake
            .sweep()
            .then(() => correctionIntake?.sweep())
            .catch(() => {});
        }, ISSUE_INTAKE_INTERVAL_MS);
        intakeTimer.unref?.();
      }
      if (schedulingSweep !== null) {
        void schedulingSweep.sweep().catch(() => {});
        scheduleTimer = setInterval(() => {
          void schedulingSweep.sweep().catch(() => {});
        }, SCHEDULE_INTERVAL_MS);
        scheduleTimer.unref?.();
      }
      if (outcome !== undefined && outcome !== null && deps.reposDir !== undefined) {
        const reposDir = deps.reposDir;
        const sweep = () => {
          if (outcomeSweeping) return;
          outcomeSweeping = true;
          void sweepOutcomeBackfill({ db: deps.db, reposDir, logger: outcome.logger })
            .catch(() => {})
            .finally(() => {
              outcomeSweeping = false;
            });
        };
        sweep();
        outcomeTimer = setInterval(sweep, OUTCOME_BACKFILL_INTERVAL_MS);
        outcomeTimer.unref?.();
      }
      if (exportRun !== undefined && exportRun !== null) {
        const cfg = exportRun.config;
        const sweep = () => {
          if (exportSweeping) return;
          exportSweeping = true;
          const date = new Date().toISOString().slice(0, 10);
          const out = join(cfg.dataDir, 'trajectory-exports', `${date}.jsonl`);
          try {
            const res = exportTrajectories(cfg, { out });
            exportRun.logger.info({ ...res, date }, 'trajectory daily export');
          } catch (err) {
            exportRun.logger.info(
              { err: err instanceof Error ? err.message : String(err), date },
              'trajectory daily export failed (scheduler continues)',
            );
          } finally {
            exportSweeping = false;
          }
        };
        sweep();
        exportTimer = setInterval(sweep, OUTCOME_BACKFILL_INTERVAL_MS);
        exportTimer.unref?.();
      }
      if (reflectCurate !== undefined && reflectCurate !== null) {
        const run = reflectCurate;
        const openNewGuards =
          run.openGuardIssues && deps.githubFetch !== undefined
            ? (guards: Parameters<typeof openGuardCandidateIssues>[1]) =>
                openGuardCandidateIssues(
                  {
                    db: deps.db,
                    githubFetch: deps.githubFetch as FetchLike,
                    tokenForTeam: (teamId) => githubTokenOrNull(deps, teamId),
                    logger: run.logger,
                  },
                  guards,
                )
            : undefined;
        const sweep = () => {
          if (reflectCurateSweeping) return;
          reflectCurateSweeping = true;
          void sweepReflectCurate({
            config: run.config,
            db: deps.db,
            logger: run.logger,
            model: run.model,
            endpoint: run.endpoint,
            openNewGuards,
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
        };
        sweep();
        reflectCurateTimer = setInterval(sweep, REFLECT_CURATE_INTERVAL_MS);
        reflectCurateTimer.unref?.();
      }
    },
    stop() {
      if (feedbackTimer !== null) {
        clearInterval(feedbackTimer);
        feedbackTimer = null;
      }
      if (reflectCurateTimer !== null) {
        clearInterval(reflectCurateTimer);
        reflectCurateTimer = null;
      }
      if (exportTimer !== null) {
        clearInterval(exportTimer);
        exportTimer = null;
      }
      if (outcomeTimer !== null) {
        clearInterval(outcomeTimer);
        outcomeTimer = null;
      }
      if (gcImmediate !== null) clearImmediate(gcImmediate);
      gcImmediate = null;
      gcBatches = null;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (ciTimer !== null) {
        clearInterval(ciTimer);
        ciTimer = null;
      }
      if (intakeTimer !== null) {
        clearInterval(intakeTimer);
        intakeTimer = null;
      }
      if (scheduleTimer !== null) {
        clearInterval(scheduleTimer);
        scheduleTimer = null;
      }
    },
  };
}
