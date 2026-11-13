import type {
  BuildRecord,
  GitIdentity,
  MergeReadiness,
  SecretBox,
  StepJournalRow,
  StepPromptOrigin,
  StepRecord,
  TriggerSource,
  UserRecord,
} from '@cairn/shared';
import {
  ACTIVE_STEP_STATUSES,
  isBuildStepKind,
  type RouteOverride,
  SESSION_BRIEF,
} from '@cairn/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { build, machine, project, steerPending, step, todo } from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import type { systemGitOps } from '../lib/git.js';
import type { FetchLike } from '../lib/github.js';
import { newRecordId, newUuidv7, nowMs } from '../lib/ids.js';
import { BLOCKED_STEP_KINDS, blockedHold, blockedNow } from './blockers.js';
import { mergedPrElsewhere } from './build-pr-probe.js';
import { type BuildSteerResult, sendBuildSteer } from './build-steer.js';
import {
  applyStoppedStep,
  releaseZombieQueued,
  settleAfterStopPhase,
  stopUnclaimedGateSteps,
} from './build-stop.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import type { HarnessEvalDispatchPort } from './harness-eval-coordinator.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import type { OAuthClientConfig } from './oauth.js';
import { assertPhaseTransition } from './phase.js';
import { planAutoApproveAt, planAwaitsAutoConfirm } from './plan-auto-confirm.js';
import type { VapidKeys } from './push.js';
import { toQuotaWait } from './quota-wait.js';
import { retryLessonsOf } from './retry-lessons.js';
import { assertAutomaticRetryAllowed, retryIsParked } from './retry-parking.js';
import { profileForStep } from './routing-rules.js';
import { assertSplitProposalExecutable } from './split-proposal.js';
import { stepQueueProjector } from './step-queue.js';
import { type BuildStepRoute, listBuildStepRoutes } from './step-route.js';
import { childrenOfTodo, getTodo, setTodoPhase } from './todos.js';
import type { QuestionAnswer } from './worker-questions.js';

export {
  githubPrOf,
  INFO_CARD_MERGE_REFUSAL,
  reviewInstructionOf,
  STEP_KIND_TEXT,
} from './build-lookups.js';
export {
  cancelBuild,
  prepareStopForDone,
  requestStop,
  type StopAndMarkDoneResult,
  stopActiveStepsAfterExit,
  stopActiveStepsForArchive,
  stoppedBeforeFirstRun,
} from './build-stop.js';
export { applyStoppedStep, type BuildSteerResult, sendBuildSteer, stopUnclaimedGateSteps };

export interface BuildDeps {
  githubAppTokenSocket?: string | null | undefined;
  githubAppIdentity?: GitIdentity | null | undefined;
  steerOptions?: Pick<BuildSteerOptions, 'human'>;
  db: Db;
  hub: TeamStreamHub;
  machineHub?: MachineWakeHub;
  user: UserRecord;
  vapidKeys?: VapidKeys | null;
  convHub?: ConversationStreamHub;
  reposDir?: string;
  box?: SecretBox;
  githubFetch?: FetchLike;
  oauthClient?: OAuthClientConfig | null;
  attachmentsDir?: string;
  gitOps?: typeof systemGitOps;
  mergeVerdict?: (buildId: string) => Promise<MergeReadiness | null>;
  harnessEval?: {
    dispatch: HarnessEvalDispatchPort;
    attemptTimeoutMs?: number;
    now?: () => number;
    dispatchAuthorized?: boolean;
  };
}

type BuildRow = typeof build.$inferSelect;

export {
  applyBuildConfirm,
  confirmPlanAutomatically,
  sweepPlanAutoConfirm,
} from './build-confirm.js';
export { assertDeliveredBuild, buildRunsSession, restoreFailedReview } from './build-delivery.js';
export { assertMergeTools, buildMergePermission } from './build-merge-permission.js';
export { requestMerge } from './build-merge-request.js';
export { finishTodoDone, hasFailureRow, hasMessageRow, roundStart } from './build-rows.js';
export { applyBuildStepAction } from './build-step-action.js';
export { type CompleteStepOutcome, completeStep } from './build-step-complete.js';
export {
  assertParkedBuildIdle,
  dispatchHeadSha,
  hasActiveStep,
  lastPushedCheckpoint,
  mergingBuilds,
  stepKindInFlight,
} from './build-step-state.js';
export { mergedPrElsewhere, planAutoApproveAt, planAwaitsAutoConfirm };

export function toBuildRecord(row: BuildRow): BuildRecord {
  return {
    id: row.id,
    todoId: row.todoId,
    withPlan: row.withPlan,
    prevPhase: row.prevPhase ?? null,
    triggerSource: row.triggerSource,
    planDocId: row.planDocId,
    errorMessage: row.errorMessage,
    prUrl: row.prUrl,
    prNumber: row.prNumber,
    diffHash: row.diffHash,
    reportAttachmentId: row.reportAttachmentId,
    stop: row.stop,
    createdAt: row.createdAt,
  };
}

export function clearStop(db: Db, buildId: string): void {
  db.update(build).set({ stop: null }).where(eq(build.id, buildId)).run();
}

export function publishBuild(deps: BuildDeps, row: BuildRow): BuildRecord {
  const record = toBuildRecord(row);
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (todoRow) deps.hub.publishBuildDoc(todoRow.teamId, record);
  return record;
}

export class BuildContinuationPhaseError extends HttpError {
  constructor() {
    super(409, 'Conversation phase cannot accept a continuation');
  }
}

export interface BuildSteerOptions {
  allowReviewContinuation?: boolean;
  afterTurn?: boolean;
  human?: boolean;
  actor?: string;
  schedule?: { id: string; createdBy: string; at: number };
  answer?: QuestionAnswer;
  beforeCommit?: () => void;
}

export async function messageTodo(
  deps: BuildDeps,
  teamId: string,
  todoId: string,
  content: string,
) {
  const row = deps.db
    .select()
    .from(todo)
    .where(and(eq(todo.id, todoId), eq(todo.teamId, teamId)))
    .get();
  if (!row) throw new HttpError(404, `todo ${todoId}`);
  if (row.latestBuildId === null) {
    return {
      todoId,
      conversationId: null,
      posted: false,
      error: 'This todo has no build. Start a build before messaging its worker.',
    };
  }
  const result = await sendBuildSteer(
    deps,
    row.latestBuildId,
    { content },
    { allowReviewContinuation: true },
  );
  return {
    todoId,
    conversationId: result.conversationId,
    posted: true,
    delivered: result.delivered,
  };
}

export function readSteerPending(db: Db, conversationId: string): string[] {
  const pending = db
    .select()
    .from(steerPending)
    .where(eq(steerPending.conversationId, conversationId))
    .get();
  return pending ? [pending.content] : [];
}

export function sweepZombieQueuedTodos(deps: BuildDeps, _now: number = nowMs()): number {
  const rows = deps.db
    .select()
    .from(todo)
    .where(and(eq(todo.phase, 'queued'), isNull(todo.archivedAt)))
    .all();
  let released = 0;
  for (const todoRow of rows) {
    if (todoRow.latestBuildId === null) continue;
    const buildRow = deps.db.select().from(build).where(eq(build.id, todoRow.latestBuildId)).get();
    if (!buildRow) continue;
    const active = deps.db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, buildRow.id), inArray(step.status, [...ACTIVE_STEP_STATUSES])))
      .all();
    if (active.length > 0) continue;
    releaseZombieQueued(deps, buildRow, todoRow, {
      actor: 'system',
      reason: 'queued build had no active step left',
    });
    released += 1;
  }
  return released;
}

export function enqueueStep(
  deps: BuildDeps,
  buildId: string,
  kind: StepRecord['kind'],
  teamId: string,
  prompt?: string,
  freshSession?: boolean,
  byPerson?: boolean,
  promptOrigin?: StepPromptOrigin,
): StepRecord {
  const current = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (byPerson !== true && current && retryIsParked(current.errorMessage ?? ''))
    throw new HttpError(409, current.errorMessage ?? 'Task parked');
  const id = newRecordId();
  const createdAt = nowMs();
  const owner =
    current === undefined || !BLOCKED_STEP_KINDS.includes(kind)
      ? undefined
      : deps.db.select().from(todo).where(eq(todo.id, current.todoId)).get();
  deps.db
    .insert(step)
    .values({
      id,
      buildId,
      kind,
      machineId: null,
      status: 'pending',
      prompt: prompt ?? null,
      promptOrigin: promptOrigin ?? null,
      freshSession: freshSession === true,
      byPerson: byPerson === true,
      createdAt,
      ...(owner !== undefined && blockedNow(deps.db, owner) ? blockedHold() : {}),
    })
    .run();
  clearStop(deps.db, buildId);
  settleAfterStopPhase(deps, buildId);
  if (isBuildStepKind(kind)) {
    deps.db.update(build).set({ reportLine: null }).where(eq(build.id, buildId)).run();
  }
  deps.machineHub?.wake(teamId);
  deps.convHub?.publishStep(buildId, {
    id,
    buildId,
    kind,
    machineId: null,
    createdAt,
    status: 'pending',
    checkpointCommit: null,
    skillInjection: null,
  });
  return { id, buildId, kind, machineId: null, createdAt };
}

export function getBuild(deps: BuildDeps, id: string): BuildRecord | null {
  const row = deps.db.select().from(build).where(eq(build.id, id)).get();
  return row ? toBuildRecord(row) : null;
}

export function listSteps(deps: BuildDeps, buildId: string): StepJournalRow[] {
  const rows = deps.db
    .select()
    .from(step)
    .where(eq(step.buildId, buildId))
    .orderBy(asc(step.createdAt))
    .all();
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  const pendingIds = rows.filter((r) => r.status === 'pending').map((r) => r.id);
  let queueById: Map<string, StepJournalRow['queue']> | null = null;
  if (pendingIds.length > 0 && buildRow !== undefined) {
    const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    if (todoRow !== undefined) {
      const projector = stepQueueProjector(deps.db, todoRow.teamId);
      queueById = new Map(
        rows.map((r) => {
          if (r.status !== 'pending') return [r.id, undefined];
          const projected = projector.project({
            id: r.id,
            createdAt: r.createdAt,
            homeMachineId: profileForStep(deps.db, todoRow, r.kind, r.id)?.machineId ?? null,
            holdReason: r.holdReason,
            holdUntil: r.holdUntil,
          });
          return [r.id, projected ?? undefined];
        }),
      );
    }
  }
  const routeById = new Map(
    listBuildStepRoutes(deps.db, [buildId]).map((route) => [route.stepId, route]),
  );
  return rows.map((r) => ({
    id: r.id,
    buildId: r.buildId,
    kind: r.kind,
    machineId: r.machineId,
    createdAt: r.createdAt,
    status: r.status,
    checkpointCommit: r.checkpointCommit,
    ...(queueById?.get(r.id) !== undefined ? { queue: queueById.get(r.id) } : {}),
    skillInjection: r.skillInjection ?? null,
    ...(r.blockerHandoff !== null ? { blockerHandoff: r.blockerHandoff } : {}),
    ...(r.status === 'waiting_quota' && r.quotaBlock !== null
      ? { quotaWait: toQuotaWait(r.quotaBlock) }
      : {}),
    ...(r.promptOrigin !== null ? { promptOrigin: r.promptOrigin } : {}),
    ...(r.claimedAt !== null ? { startedAt: r.claimedAt } : {}),
    ...(r.finishedAt !== null ? { finishedAt: r.finishedAt } : {}),
    route: stepRouteView(routeById.get(r.id)),
  }));
}

function stepRouteView(route: BuildStepRoute | undefined): StepJournalRow['route'] {
  return route === undefined ? null : { harness: route.harness, modelId: route.modelId };
}

export function assertNamedMachineForNewTask(deps: BuildDeps, teamId: string): void {
  namedMachineForStart(deps, { teamId }, undefined);
}

function namedMachineForStart(
  deps: BuildDeps,
  todoRecord: { teamId: string; routeOverride?: { machineId?: string } | null },
  routeOverride: { machineId?: string } | undefined,
): { machineId: string; pin: boolean } | null {
  const profile = profileForStep(deps.db, todoRecord, 'session', null);
  const named =
    routeOverride?.machineId ?? todoRecord.routeOverride?.machineId ?? profile?.machineId ?? null;
  if (named !== null) return { machineId: named, pin: false };
  const registered = deps.db
    .select({ id: machine.id, online: machine.online })
    .from(machine)
    .where(eq(machine.teamId, todoRecord.teamId))
    .all();
  const online = registered.filter((row) => row.online);
  const onlyOnline = online[0];
  if (online.length === 1 && onlyOnline !== undefined)
    return { machineId: onlyOnline.id, pin: true };
  const onlyRegistered = registered[0];
  if (registered.length === 1 && onlyRegistered !== undefined) {
    return { machineId: onlyRegistered.id, pin: true };
  }
  throw new HttpError(409, 'Name a machine before starting this task');
}

export function startBuilds(
  deps: BuildDeps,
  input: {
    projectId: string;
    todoIds: string[];
    routeOverride?: RouteOverride;
    triggerSource?: TriggerSource;
    scheduledBy?: string;
    prompt?: string;
  },
): BuildRecord[] {
  const triggerSource = input.triggerSource ?? 'user';
  const projectRow = deps.db.select().from(project).where(eq(project.id, input.projectId)).get();
  for (const todoId of input.todoIds) {
    const todoRecord = getTodo(deps, todoId);
    if (!todoRecord || todoRecord.projectId !== input.projectId) {
      throw new NotFoundError(`todo ${todoId}`);
    }
    if (projectRow?.teamId !== todoRecord.teamId) {
      throw new NotFoundError(`project ${input.projectId}`);
    }
    const overrideMachine = input.routeOverride?.machineId;
    if (
      overrideMachine !== undefined &&
      deps.db
        .select({ id: machine.id })
        .from(machine)
        .where(and(eq(machine.id, overrideMachine), eq(machine.teamId, todoRecord.teamId)))
        .get() === undefined
    ) {
      throw new NotFoundError(`machine ${overrideMachine}`);
    }
    const previous =
      todoRecord.latestBuildId === null
        ? undefined
        : deps.db
            .select({ errorMessage: build.errorMessage })
            .from(build)
            .where(eq(build.id, todoRecord.latestBuildId))
            .get();
    if (todoRecord.archivedAt != null) throw new HttpError(409, 'Unarchive to continue');
    if (triggerSource !== 'user') assertAutomaticRetryAllowed(deps, todoId);
    assertSplitProposalExecutable(previous?.errorMessage ?? null);
    namedMachineForStart(deps, todoRecord, input.routeOverride);
  }
  const created: BuildRecord[] = [];
  for (const todoId of input.todoIds) {
    const todoRecord = getTodo(deps, todoId);
    if (!todoRecord) throw new NotFoundError(`todo ${todoId}`);
    assertPhaseTransition(todoRecord.phase, 'queued');
    const named = namedMachineForStart(deps, todoRecord, input.routeOverride);
    const routeOverride =
      input.routeOverride === undefined
        ? named?.pin === true
          ? { machineId: named.machineId }
          : undefined
        : {
            ...input.routeOverride,
            ...(input.routeOverride.machineId === undefined && named !== null
              ? { machineId: named.machineId }
              : {}),
          };
    const id = newUuidv7();
    const createdAt = nowMs();
    deps.db
      .insert(build)
      .values({
        id,
        todoId,
        withPlan: false,
        prevPhase: todoRecord.phase,
        triggerSource,
        scheduledBy: input.scheduledBy ?? null,
        planDocId: null,
        errorMessage: null,
        prUrl: null,
        prNumber: null,
        changes: null,
        diffHash: null,
        createdAt,
      })
      .run();
    const lessons =
      todoRecord.phase === 'failed' && todoRecord.latestBuildId !== null
        ? retryLessonsOf(deps.db, todoRecord.latestBuildId)
        : null;
    enqueueStep(
      deps,
      id,
      'session',
      todoRecord.teamId,
      [SESSION_BRIEF, input.prompt, lessons].filter((part) => part != null).join('\n\n'),
    );
    setTodoPhase(deps, todoId, 'queued', {
      ...(routeOverride !== undefined ? { routeOverride } : {}),
      latestBuildId: id,
      lastRunAt: createdAt,
    });
    const row = deps.db.select().from(build).where(eq(build.id, id)).get();
    if (!row) throw new Error('build missing after insert');
    created.push(publishBuild(deps, row));
  }
  return created;
}

export function dispatchSplitChildren(deps: BuildDeps, parentId: string): number {
  let dispatched = 0;
  for (const child of childrenOfTodo(deps.db, parentId).filter((c) => c.phase === 'todo')) {
    try {
      startBuilds(deps, {
        projectId: child.projectId,
        todoIds: [child.id],
        triggerSource: 'chief',
      });
      dispatched += 1;
    } catch (error) {
      console.warn('Split child not dispatched', { parentId, childId: child.id, error });
    }
  }
  return dispatched;
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}

export {
  maybeEnqueueIndependentReview,
  maybeEnqueueVerifyStep,
} from './build-review-enqueue.js';
export {
  applyStepFailure,
  failStepWithEvents,
  noteDeliveredPlanResidual,
  settleParkedStep,
} from './build-step-failure.js';
