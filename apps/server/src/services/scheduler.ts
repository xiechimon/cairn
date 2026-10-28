import { join } from 'node:path';
import { ENV_VARS, type Scheduler } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { ServerConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { build, schedule, todo } from '../db/schema.js';
import type { FetchLike } from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import { exportTrajectories } from '../trajectory-export.js';
import {
  OUTCOME_BACKFILL_INTERVAL_MS,
  type OutcomeBackfillLogger,
  sweepOutcomeBackfill,
} from '../trajectory-outcome-backfill.js';
import {
  ATTACHMENT_GC_INTERVAL_MS,
  type GcLogger,
  sweepAttachmentBatches,
  sweepStepSessions,
} from './attachment-gc.js';
import {
  type BuildDeps,
  startBuilds,
  sweepAbandonedBuildSteps,
  sweepPlanAutoConfirm,
  sweepZombieQueuedTodos,
  toBuildRecord,
} from './builds.js';
import { fireDueChiefWakes, sweepAbandonedChiefSteps } from './chief.js';
import { planChiefDigests } from './chief-digest.js';
import { CI_POLL_INTERVAL_MS, type CiPollLogger, createCiPoller } from './ci-loop.js';
import type { TeamStreamHub } from './events.js';
import { projectOfTodo } from './git.js';
import {
  createIssueIntake,
  ISSUE_INTAKE_INTERVAL_MS,
  type IssueIntakeLogger,
} from './issue-intake.js';
import { sweepStaleMachines } from './machines.js';
import { sweepFailedRetries } from './needs-you.js';
import { sweepIdleChiefUnread } from './notifications.js';
import { PhaseTransitionError } from './phase.js';
import { digestSlotDueAt, digestSlotsDue, sweepPushDigest } from './push.js';
import { sweepQuotaWaitSteps } from './quota-wait.js';
import { computeNextRunAt, dueSchedules, isRecurring, updateNextRunAt } from './schedules.js';

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

const CANCEL_GATE_PHASES = new Set(['confirm', 'review']);

export function createScheduler(
  deps: BuildDeps,
  opts: SchedulerOptions,
  gc?: AttachmentGcRun | null,
  ci?: CiPollRun | null,
  intake?: IssueIntakeRun | null,
  outcome?: TrajectoryOutcomeRun | null,
  exportRun?: TrajectoryExportRun | null,
): Scheduler {
  let timer: NodeJS.Timeout | null = null;
  const lastDigestRun = new Map<string, number>();
  let digestSweeping = false;
  const ciPoller =
    ci !== undefined && ci !== null
      ? createCiPoller(deps, { githubFetch: ci.githubFetch, logger: ci.logger })
      : null;
  let ciTimer: NodeJS.Timeout | null = null;
  const issueIntake =
    intake !== undefined && intake !== null
      ? createIssueIntake(deps, { githubFetch: intake.githubFetch, logger: intake.logger })
      : null;
  let intakeTimer: NodeJS.Timeout | null = null;
  let lastGcAt = 0;
  let gcImmediate: NodeJS.Immediate | null = null;
  let gcBatches: ReturnType<typeof sweepAttachmentBatches> | null = null;
  let outcomeTimer: NodeJS.Timeout | null = null;
  let outcomeSweeping = false;
  let exportTimer: NodeJS.Timeout | null = null;
  let exportSweeping = false;

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

  function cancelGateBuild(db: Db, hub: TeamStreamHub, todoId: string): void {
    const todoRow = db.select().from(todo).where(eq(todo.id, todoId)).get();
    if (!todoRow || !CANCEL_GATE_PHASES.has(todoRow.phase) || todoRow.latestBuildId === null) {
      return;
    }
    const buildId = todoRow.latestBuildId;
    db.update(build).set({ errorMessage: 'Cancelled' }).where(eq(build.id, buildId)).run();
    const row = db.select().from(build).where(eq(build.id, buildId)).get();
    if (row) hub.publishBuildDoc(todoRow.teamId, toBuildRecord(row));
  }

  function tick(now = nowMs()): void {
    const due = dueSchedules(deps, now);
    for (const row of due) {
      const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
      const projectRow = todoRow ? projectOfTodo(deps.db, todoRow) : undefined;
      if (!todoRow || todoRow.projectId !== row.projectId || !projectRow) {
        deps.db.delete(schedule).where(eq(schedule.id, row.id)).run();
        continue;
      }
      try {
        cancelGateBuild(deps.db, deps.hub, row.todoId);
        startBuilds(deps, {
          projectId: row.projectId,
          todoIds: [row.todoId],
          assignment: todoRow.assignment ?? { plan: null, build: null },
          withPlan: false,
          triggerSource: 'schedule',
        });
      } catch (err) {
        if (err instanceof PhaseTransitionError) {
          if (isRecurring(row.kind) && row.at !== null) {
            updateNextRunAt(deps, row.id, computeNextRunAt(row.kind, row.at, row.tz, now));
          }
          continue;
        }
        throw err;
      }
      if (!isRecurring(row.kind)) {
        deps.db.delete(schedule).where(eq(schedule.id, row.id)).run();
      } else if (row.at !== null) {
        updateNextRunAt(deps, row.id, computeNextRunAt(row.kind, row.at, row.tz, now));
      }
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
  }

  return {
    tick,
    start() {
      if (timer !== null) return;
      tick();
      timer = setInterval(() => tick(), opts.tickMs);
      timer.unref?.();
      if (ciPoller !== null) {
        void ciPoller.sweep().catch(() => {});
        ciTimer = setInterval(() => {
          void ciPoller.sweep().catch(() => {});
        }, CI_POLL_INTERVAL_MS);
        ciTimer.unref?.();
      }
      if (issueIntake !== null) {
        void issueIntake.sweep().catch(() => {});
        intakeTimer = setInterval(() => {
          void issueIntake.sweep().catch(() => {});
        }, ISSUE_INTAKE_INTERVAL_MS);
        intakeTimer.unref?.();
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
    },
    stop() {
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
    },
  };
}
