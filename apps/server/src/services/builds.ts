import type {
  BuildMergePermission,
  BuildRecord,
  GithubRepoRef,
  GitIdentity,
  MachineDoneBody,
  MergeReadiness,
  ReviewGate,
  ReviewVerdict,
  SecretBox,
  StepJournalRow,
  StepKind,
  StepPromptOrigin,
  StepRecord,
  TriggerSource,
  UserRecord,
} from '@cairn/shared';
import {
  ACTIVE_STEP_STATUSES,
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  ANSWERS_CONTINUE_PROMPT,
  BUILD_FAILURE_ROW_KIND,
  buildFailureRowContent,
  buildPlanContractRewritePrompt,
  buildPlanRewritePrompt,
  buildReplanPrompt,
  buildReviewRejectPrompt,
  buildReviewStepPrompt,
  buildTaskPromptText,
  buildVerifyStepPrompt,
  CONFIRM_ANNOUNCEMENT,
  DEFAULT_SHIP_ROUTE,
  isActiveStepStatus,
  isBuildStepKind,
  isPlanContractRewritePrompt,
  MERGE_ANNOUNCEMENT,
  type PlanContractCheck,
  parseReviewPromptMeta,
  planVerificationItems,
  REVIEW_ANNOUNCEMENT,
  type RouteOverride,
  SESSION_BRIEF,
  SESSION_REWORK_BRIEF,
  systemRowOf,
  type TodoOutputKind,
  UNSTARTED_STEP_STATUSES,
  VERIFY_ANNOUNCEMENT,
  type VerifyVerdict,
} from '@cairn/shared';
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  build,
  machine,
  message,
  plan as planTable,
  project,
  steerPending,
  step,
  stopPending,
  todo,
} from '../db/schema.js';
import { HttpError } from '../lib/errors.js';
import { systemGitOps } from '../lib/git.js';
import { type FetchLike, isFullSha } from '../lib/github.js';
import { newRecordId, newUuidv7, nowMs } from '../lib/ids.js';
import { emitRuntimeBuildSpan } from '../runtime-otel.js';
import { receivesAnswers, undeliveredAnswers } from './answer-delivery.js';
import { BLOCKED_STEP_KINDS, blockedHold, blockedNow } from './blockers.js';
import { settleReviewStep, settleVerifyStep } from './build-gate-steps.js';
import {
  persistGateVerdict,
  reportedVerdictHeads,
  ticketRefOf,
  type VerdictReport,
} from './build-gate-verdict.js';
import { mergeThroughGithub } from './build-github-merge.js';
import { mergedPrElsewhere } from './build-pr-probe.js';
import { recordBuildFeedback } from './build-provenance.js';
import { restartFailedBuild } from './build-restart.js';
import { type BuildSteerResult, sendBuildSteer } from './build-steer.js';
import {
  applyStoppedStep,
  hasLeftExecution,
  landReservedPhase,
  releaseUnissuedMergeAdmission,
  releaseZombieQueued,
  settleAfterStopPhase,
  stopStepKeepPhase,
  stopUnclaimedGateSteps,
} from './build-stop.js';
import { askUndeliveredOnce, undeliveredEnd } from './build-undelivered.js';
import { claimClientMessage, findClientMessage } from './client-message.js';
import { DONE_ROW } from './delivery-rows.js';
import { stepActivityAt } from './dispatch-timeouts.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import { markFirstPrPromptDue } from './first-pr-report.js';
import {
  githubRepoOfProject,
  hasRepoBinding,
  projectOfTodo,
  readBuildChanges,
  repoDirFor,
} from './git.js';
import type { HarnessEvalDispatchPort } from './harness-eval-coordinator.js';
import { buildHostedMergeInstruction } from './hosted-merge-instruction.js';
import { storeInfoReport } from './info-handoff.js';
import { enqueueLocalMerge } from './local-merge.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { isCodexReviewModel } from './merge-gate/model-identity.js';
import { effectiveModel } from './model-fallback.js';
import { resolveNamedPrompt } from './named-prompts.js';
import type { OAuthClientConfig } from './oauth.js';
import { assertPhaseTransition, canTransitionPhase } from './phase.js';
import {
  latestPlanRow,
  planAutoApproveAt,
  planAutoConfirmation,
  planAwaitsAutoConfirm,
  planContractOfStep,
} from './plan-auto-confirm.js';
import { projectMergeConfigOf, projectShipRouteOf } from './projects.js';
import type { VapidKeys } from './push.js';
import { publishStepRow, toQuotaWait } from './quota-wait.js';
import { holdSecondRejectionRework } from './research-stuck.js';
import { retryLessonsOf } from './retry-lessons.js';
import { assertAutomaticRetryAllowed, parkFailedBuild, retryIsParked } from './retry-parking.js';
import { policyForStep, profileForStep, routeForStep } from './routing-rules.js';
import { finishScheduledStep } from './schedules.js';
import {
  appendShipGateInstruction,
  CUSTOM_NEEDS_PR,
  hasGithubPr,
  judgeShip,
  parseShipGateInstruction,
  settleAbandonedShip,
} from './ship-gate.js';
import { assertSplitProposalExecutable } from './split-proposal.js';
import { stepQueueProjector } from './step-queue.js';
import { type BuildStepRoute, listBuildStepRoutes } from './step-route.js';
import { childrenOfTodo, getTodo, setTodoPhase } from './todos.js';
import { insertGateAnnouncement, insertMessageRow } from './transcript.js';
import { blockingWorkerQuestions, pendingWorkerQuestions } from './worker-question-store.js';
import type { QuestionAnswer } from './worker-questions.js';

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
type TodoRow = typeof todo.$inferSelect;

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

function clearStop(db: Db, buildId: string): void {
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

export function maybeEnqueueVerifyStep(
  deps: BuildDeps,
  todoRow: typeof todo.$inferSelect,
  buildId: string,
  opts: { reverify?: boolean } = {},
): void {
  if (routeForStep(deps.db, todoRow, 'verify') === null) return;
  const expectedHeadSha = dispatchHeadSha(deps, buildId);
  if (expectedHeadSha === null) return;
  if (blockingWorkerQuestions(deps.db, buildId).length > 0) return;
  const existing = deps.db
    .select({ id: step.id })
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        eq(step.kind, 'verify'),
        opts.reverify === true
          ? inArray(step.status, [...ACTIVE_STEP_STATUSES])
          : or(
              inArray(step.status, [...ACTIVE_STEP_STATUSES]),
              gte(step.createdAt, roundStart(deps, buildId)),
            ),
      ),
    )
    .get();
  if (existing !== undefined) return;
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (buildRow === undefined) return;
  if (githubPrOf(deps, todoRow, buildRow.prNumber) === null) return;
  const projectRow = projectOfTodo(deps.db, todoRow);
  if (projectRow === undefined) return;
  const planRow = latestPlanRow(deps, buildId);
  deps.db.transaction(() => {
    deps.db
      .update(build)
      .set({ evidenceStore: projectRow.evidenceStore })
      .where(and(eq(build.id, buildId), isNull(build.evidenceStore)))
      .run();
    const snapshot = deps.db
      .select({ evidenceStore: build.evidenceStore })
      .from(build)
      .where(eq(build.id, buildId))
      .get();
    if (snapshot?.evidenceStore == null) throw new Error('Verify evidence snapshot unavailable');
    const prompt = buildVerifyStepPrompt({
      ticketRef: ticketRefOf(todoRow),
      taskText: buildTaskPromptText(todoRow.title, todoRow.spec, todoRow),
      planText: planRow?.content ?? '',
      verificationItems: planVerificationItems(planRow?.content ?? ''),
      pr: buildRow.prNumber !== null ? { number: buildRow.prNumber, url: buildRow.prUrl } : null,
      expectedHeadSha,
      evidenceStore: snapshot.evidenceStore,
    });
    insertGateAnnouncement(deps, buildId, VERIFY_ANNOUNCEMENT, deps.user.displayName);
    enqueueStep(deps, buildId, 'verify', todoRow.teamId, prompt);
  });
}

function authorModelOf(deps: BuildDeps, todoRow: TodoRow, buildId: string): string | null {
  const authorStep = deps.db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildId), eq(step.status, 'done')))
    .all()
    .filter((row) => isBuildStepKind(row.kind))
    .sort((a, b) => (a.finishedAt ?? a.createdAt) - (b.finishedAt ?? b.createdAt))
    .at(-1);
  if (authorStep === undefined) return null;
  const authorAgent = profileForStep(deps.db, todoRow, authorStep.kind, authorStep.id);
  return authorAgent === null ? null : effectiveModel(authorAgent, authorStep).modelId;
}

export function maybeEnqueueIndependentReview(
  deps: BuildDeps,
  todoRow: TodoRow,
  buildId: string,
): void {
  if (blockingWorkerQuestions(deps.db, buildId).length > 0) return;
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (buildRow === undefined || githubPrOf(deps, todoRow, buildRow.prNumber) === null) return;
  const head = dispatchHeadSha(deps, buildId);
  if (head === null) return;
  const reviews = deps.db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildId), eq(step.kind, 'review')))
    .all();
  if (reviews.some((row) => isActiveStepStatus(row.status))) return;
  const since = roundStart(deps, buildId);
  if (
    reviews.some(
      (row) =>
        row.createdAt >= since && parseReviewPromptMeta(row.prompt)?.expectedHeadSha === head,
    )
  )
    return;
  const reviewRoute = routeForStep(deps.db, todoRow, 'review');
  if (reviewRoute === null) return;
  const authorModel = authorModelOf(deps, todoRow, buildId);
  if (authorModel === null || !isCodexReviewModel(reviewRoute.modelId)) return;
  const agentId = reviewRoute.id;
  const plan = latestPlanRow(deps, buildId);
  const reviewInstruction = reviewInstructionOf(deps, todoRow.teamId, 'review');
  const prompt = buildReviewStepPrompt({
    agentId,
    gate: 'review',
    planText: plan?.content ?? '',
    changes: [],
    checkout: hasRepoBinding(projectOfTodo(deps.db, todoRow)),
    expectedHeadSha: head,
    ...(reviewInstruction !== undefined ? { instruction: reviewInstruction } : {}),
  });
  insertGateAnnouncement(deps, buildId, REVIEW_ANNOUNCEMENT, deps.user.displayName);
  enqueueStep(deps, buildId, 'review', todoRow.teamId, prompt);
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

function applyBuildConfirm(deps: BuildDeps, buildId: string, actorName: string): void {
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row) throw new NotFoundError(`build ${buildId}`);
  assertSplitProposalExecutable(row.errorMessage);
  const todoRecord = getTodo(deps, row.todoId);
  if (!todoRecord) throw new NotFoundError(`todo ${row.todoId}`);
  if (todoRecord.archivedAt != null) throw new HttpError(409, 'Unarchive to continue');
  if (todoRecord.phase !== 'confirm') {
    throw new HttpError(409, `确认仅适用于待确认（confirm）关口，当前相位 ${todoRecord.phase}`);
  }
  insertGateAnnouncement(deps, buildId, CONFIRM_ANNOUNCEMENT, actorName);
  if (childrenOfTodo(deps.db, todoRecord.id).length > 0) {
    dispatchSplitChildren(deps, todoRecord.id);
    setTodoPhase(deps, todoRecord.id, 'building');
    return;
  }
  setTodoPhase(deps, todoRecord.id, 'building');
  enqueueStep(deps, buildId, 'build', todoRecord.teamId);
}

export async function applyBuildStepAction(
  deps: BuildDeps,
  buildId: string,
  body:
    | { action: 'confirm' }
    | { action: 'revision'; side: 'plan'; feedback: string; clientMessageId: string }
    | { action: 'review'; focus?: string }
    | { action: 'restart'; feedback: string; clientMessageId: string },
  actor?: string,
  origin: 'person' | 'automatic' = 'person',
  beforeCommit?: () => void,
): Promise<void> {
  if (
    (body.action === 'revision' || body.action === 'restart') &&
    findClientMessage(deps.db, buildId, body.clientMessageId) !== undefined
  ) {
    return;
  }
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row) throw new NotFoundError(`build ${buildId}`);
  assertSplitProposalExecutable(row.errorMessage);
  let todoRecord = getTodo(deps, row.todoId);
  if (!todoRecord) throw new NotFoundError(`todo ${row.todoId}`);
  if (todoRecord.archivedAt != null) throw new HttpError(409, 'Unarchive to continue');
  const actorName = actor ?? deps.user.displayName;
  if (origin === 'automatic') assertAutomaticRetryAllowed(deps, row.todoId);
  else assertParkedBuildIdle(deps, row);

  if (body.action === 'restart') {
    await restartFailedBuild(deps, row, todoRecord, body, actorName, origin, beforeCommit);
    return;
  }

  if (body.action === 'confirm') {
    if (origin === 'automatic' && todoRecord.phase === 'confirm') {
      const eligibility = planAutoConfirmation(deps, buildId);
      if (!eligibility.eligible) throw new HttpError(409, eligibility.reason);
    }
    applyBuildConfirm(deps, buildId, actorName);
    return;
  }
  if (body.action === 'review') {
    const reviewRoute = routeForStep(deps.db, todoRecord, 'review');
    if (reviewRoute === null) {
      throw new HttpError(
        400,
        'No review routing rule: add a `review` routing rule in routing settings before requesting an AI review.',
      );
    }
    restoreFailedReview(deps, row);
    if (todoRecord.phase === 'failed') {
      const restored = getTodo(deps, row.todoId);
      if (restored) todoRecord = restored;
    }
    if (todoRecord.phase !== 'confirm' && todoRecord.phase !== 'review') {
      throw new HttpError(409, `AI 审核仅在待确认/审核关口允许，当前相位 ${todoRecord.phase}`);
    }
    const plan = deps.db
      .select({ content: planTable.content })
      .from(planTable)
      .where(eq(planTable.buildId, buildId))
      .orderBy(asc(planTable.version))
      .all();
    const planText = plan.map((p) => p.content).join('\n\n---\n\n');
    const gate: ReviewGate = todoRecord.phase === 'review' ? 'review' : 'confirm';
    const projectRow = projectOfTodo(deps.db, todoRecord);
    const checkout = hasRepoBinding(projectRow);
    const changes =
      gate === 'review'
        ? deps.reposDir !== undefined
          ? (await readBuildChanges({ db: deps.db, reposDir: deps.reposDir }, buildId)).files
          : []
        : undefined;
    const after = getTodo(deps, row.todoId);
    if (after?.phase !== todoRecord.phase) {
      throw new HttpError(
        409,
        `读取变更期间任务相位已变为 ${after?.phase ?? '（任务已删除）'}，未发起 AI 审核`,
      );
    }
    insertGateAnnouncement(deps, buildId, REVIEW_ANNOUNCEMENT, actorName);
    const expectedHeadSha = gate === 'review' ? dispatchHeadSha(deps, buildId) : null;
    const reviewInstruction = reviewInstructionOf(deps, todoRecord.teamId, gate);
    const promptArgs = {
      gate,
      planText,
      ...(reviewInstruction !== undefined ? { instruction: reviewInstruction } : {}),
      ...(changes !== undefined ? { changes } : {}),
      checkout,
      ...(expectedHeadSha !== null ? { expectedHeadSha } : {}),
    } as const;
    const reviewPrompt = buildReviewStepPrompt({
      agentId: reviewRoute.id,
      ...promptArgs,
      ...(body.focus !== undefined ? { focus: body.focus } : {}),
    });
    enqueueStep(deps, buildId, 'review', todoRecord.teamId, reviewPrompt);
    return;
  }
  if (todoRecord.phase !== 'confirm' && todoRecord.phase !== 'review') {
    throw new HttpError(409, `revision 仅在待确认/审核关口允许，当前相位 ${todoRecord.phase}`);
  }
  const revising = todoRecord;
  const afterCommit: (() => void)[] = [];
  const transcriptDeps = { ...deps, afterCommit };
  deps.db.transaction(() => {
    claimClientMessage(deps.db, buildId, body.clientMessageId, {
      delegated: true,
      delivered: 'revision',
      conversationId: buildId,
    });
    recordBuildFeedback(
      deps.db,
      buildId,
      'revision',
      revising.phase === 'confirm' ? 'plan' : 'build',
      body.feedback,
      actorName,
    );
    insertMessageRow(transcriptDeps, buildId, {
      id: newRecordId(),
      role: 'user',
      content: body.feedback,
      createdAt: nowMs(),
    });
    beforeCommit?.();
    if (revising.phase === 'review' && buildRunsSession(deps, buildId)) {
      deps.db.update(build).set({ prevPhase: 'review' }).where(eq(build.id, buildId)).run();
      setTodoPhase(deps, revising.id, 'queued');
      enqueueStep(
        deps,
        buildId,
        'session',
        revising.teamId,
        `${SESSION_REWORK_BRIEF}\n\n${body.feedback}`,
        false,
        origin === 'person',
        { kind: 'rework' },
      );
      holdSecondRejectionRework(deps, buildId);
      return;
    }
    setTodoPhase(deps, revising.id, 'planning');
    const replanPrompt =
      revising.phase === 'review'
        ? buildReviewRejectPrompt(body.feedback)
        : buildReplanPrompt(body.feedback);
    enqueueStep(deps, buildId, 'plan', revising.teamId, replanPrompt, false, origin === 'person');
    holdSecondRejectionRework(deps, buildId);
  });
  for (const publish of afterCommit) publish();
}

function restoreFailedReview(deps: BuildDeps, row: BuildRow): void {
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (todoRow?.phase !== 'failed') return;
  assertDeliveredBuild(deps, row);
  setTodoPhase(deps, todoRow.id, 'review');
}

export function buildRunsSession(deps: BuildDeps, buildId: string): boolean {
  return (
    deps.db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, buildId), eq(step.kind, 'session')))
      .get() !== undefined
  );
}

export function assertDeliveredBuild(deps: BuildDeps, row: BuildRow): void {
  const { db } = deps;
  const buildStep = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, row.id), inArray(step.kind, ['build', 'session'])))
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  const legDone = buildStep?.status === 'done';
  const artifactIn =
    (buildStep?.checkpointCommit ?? null) !== null || row.prUrl !== null || row.prNumber !== null;
  if (!legDone || !artifactIn) {
    const reason = !legDone ? '执行步未完成交付' : '执行步无交付产物（分支/PR 不在）';
    throw new HttpError(
      409,
      `failed 任务的审核关口恢复仅对本轮已交付的 build 开放（${reason}），请重新运行任务`,
    );
  }
}

function reviewInstructionOf(
  deps: BuildDeps,
  teamId: string,
  gate: ReviewGate,
): string | undefined {
  if (gate !== 'review') return undefined;
  const prompt = resolveNamedPrompt(deps.db, teamId, 'review');
  return prompt.overridden ? prompt.text : undefined;
}

export async function requestMerge(
  deps: BuildDeps,
  buildId: string,
  actor?: string,
): Promise<{ delegated: true }> {
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row) throw new NotFoundError(`build ${buildId}`);
  let todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${row.todoId}`);
  if (todoRow.archivedAt !== null) throw new HttpError(409, 'Unarchive to continue');
  if (todoRow.output === 'info') throw new HttpError(409, INFO_CARD_MERGE_REFUSAL);
  assertNoMergeStepInFlight(deps, buildId);
  const projectRow = projectOfTodo(deps.db, todoRow);
  const shipRoute = projectRow === undefined ? DEFAULT_SHIP_ROUTE : projectShipRouteOf(projectRow);
  if (shipRoute === 'local-merge' && projectRow?.repoKind !== 'local') {
    throw new HttpError(409, 'local-merge requires a local repository project');
  }
  if (shipRoute === 'custom' && !hasGithubPr(deps, buildId))
    throw new HttpError(409, CUSTOM_NEEDS_PR);
  const judged = shipRoute === 'merge-gate' ? null : await judgeShip(deps, buildId);
  const pr = shipRoute === 'custom' ? null : githubPrOf(deps, todoRow, row.prNumber);
  if (pr !== null) {
    return mergeThroughGithub(deps, row, pr.prNumber, pr.repoRef, actor ?? deps.user.displayName);
  }
  if (
    projectRow?.repoKind === 'local' &&
    shipRoute !== 'custom' &&
    (shipRoute === 'local-merge' || projectMergeConfigOf(projectRow).mergePolicy === 'autonomous')
  ) {
    if (todoRow.phase === 'failed') assertDeliveredBuild(deps, row);
    else assertPhaseTransition(todoRow.phase, 'done');
    assertMergeTools(deps, todoRow);
    const git = deps.gitOps ?? systemGitOps;
    const localPath = projectRow.localPath;
    if (localPath === null) {
      throw new HttpError(409, '本地项目没有仓库路径，拒绝走未受控合并');
    }
    const listing = await git.listBranches(localPath).catch(() => null);
    if (listing === null || listing.defaultBranch === null) {
      throw new HttpError(409, '无法读取本地仓库默认分支，拒绝走未受控合并');
    }
    const local = await enqueueLocalMerge(
      deps,
      buildId,
      projectRow.baseBranch ?? listing.defaultBranch,
      shipRoute === 'local-merge',
      todoRow.phase === 'failed',
    );
    if (local.enqueued) {
      insertGateAnnouncement(deps, buildId, MERGE_ANNOUNCEMENT, actor ?? deps.user.displayName);
      return { delegated: true };
    }
    const blocking = local.readiness?.blockers ?? [];
    if (blocking.length > 0) {
      throw new HttpError(
        409,
        `本地合并未通过关口判定，无法落地：${blocking.map((b) => b.label).join('；')}`,
      );
    }
    throw new HttpError(409, '本地合并未通过关口判定，无法落地');
  }
  restoreFailedReview(deps, row);
  if (todoRow.phase === 'failed') {
    const restored = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
    if (!restored) throw new NotFoundError(`todo ${row.todoId}`);
    todoRow = restored;
  }
  assertPhaseTransition(todoRow.phase, 'done');
  assertMergeTools(deps, todoRow);
  insertGateAnnouncement(deps, buildId, MERGE_ANNOUNCEMENT, actor ?? deps.user.displayName);
  let prompt: string | undefined;
  if (shipRoute === 'custom' && judged !== null) {
    prompt = appendShipGateInstruction(resolveNamedPrompt(deps.db, todoRow.teamId, 'ship').text, {
      buildId,
      judgedHead: judged.headSha,
    });
  } else if (projectRow?.repoKind === 'hosted' && projectRow.repoName !== null) {
    if (deps.reposDir === undefined) throw new HttpError(409, 'Hosted repository unavailable');
    const dir = repoDirFor(deps.reposDir, todoRow.teamId, projectRow.repoName);
    const { defaultBranch } = await systemGitOps.listBranches(dir);
    prompt = buildHostedMergeInstruction({
      projectId: projectRow.id,
      repoName: projectRow.repoName,
      baseBranch: projectRow.baseBranch ?? defaultBranch ?? 'main',
      configuredBaseBranch: projectRow.baseBranch,
    });
  }
  if (prompt !== undefined) assertNoMergeStepInFlight(deps, buildId);
  enqueueStep(deps, buildId, 'merge', todoRow.teamId, prompt);
  return { delegated: true };
}

function assertNoMergeStepInFlight(deps: BuildDeps, buildId: string): void {
  const inFlight = deps.db
    .select({ id: step.id })
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        eq(step.kind, 'merge'),
        inArray(step.status, [...ACTIVE_STEP_STATUSES]),
      ),
    )
    .get();
  if (inFlight) throw new HttpError(409, '这个构建已有一个合并步在排队或在跑，等它结束再发起');
}

export const INFO_CARD_MERGE_REFUSAL =
  '信息卡的产出是报告附件，不进合并：要把内容落进仓库，请建下游代码卡走正常流程';

export function githubPrOf(
  deps: BuildDeps,
  todoRow: { projectId: string; teamId: string },
  prNumber: number | null,
): { repoRef: GithubRepoRef; prNumber: number } | null {
  if (prNumber === null) return null;
  const repoRef = githubRepoOfProject(projectOfTodo(deps.db, todoRow));
  return repoRef === null ? null : { repoRef, prNumber };
}

export function buildMergePermission(deps: BuildDeps, buildId: string): BuildMergePermission {
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!buildRow) throw new NotFoundError(`build ${buildId}`);
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${buildRow.todoId}`);
  const missingTools = missingMergeTools(deps, todoRow);
  return { permitted: missingTools.length === 0, missingTools, prUrl: buildRow.prUrl };
}

function missingMergeTools(deps: BuildDeps, todoRow: TodoRow): string[] {
  const policy = policyForStep(deps.db, todoRow, 'session');
  if (policy === null || policy.seededFromAgentId === null) return [];
  return [AGENT_TOOL_MERGE, AGENT_TOOL_PUSH].filter((tool) => !policy.tools.includes(tool));
}

export function assertMergeTools(deps: BuildDeps, todoRow: TodoRow): void {
  const missingTools = missingMergeTools(deps, todoRow);
  if (missingTools.length > 0) {
    throw new HttpError(
      403,
      `The session work policy lacks 「${missingTools.join('」「')}」, so it cannot start a merge (routing settings, work policies)`,
    );
  }
}

export const STEP_KIND_TEXT: Record<StepKind, string> = {
  plan: '规划',
  build: '执行',
  session: '会话',
  merge: '合并',
  chief: '编排',
  review: '审核',
  verify: '验证',
};

export const mergingBuilds = new Set<string>();

export function stepKindInFlight(deps: BuildDeps, buildId: string): StepKind | null {
  return (
    deps.db
      .select({ kind: step.kind })
      .from(step)
      .where(
        and(
          eq(step.buildId, buildId),
          or(
            eq(step.status, 'claimed'),
            and(
              inArray(step.status, [...UNSTARTED_STEP_STATUSES]),
              notInArray(step.kind, ['verify', 'review']),
            ),
          ),
        ),
      )
      .get()?.kind ?? null
  );
}

export function hasActiveStep(deps: BuildDeps, buildId: string): boolean {
  return mergingBuilds.has(buildId) || stepKindInFlight(deps, buildId) !== null;
}

export function assertParkedBuildIdle(deps: BuildDeps, row: BuildRow): void {
  if (retryIsParked(row.errorMessage ?? '') && hasActiveStep(deps, row.id))
    throw new HttpError(
      409,
      `${row.errorMessage} Wait for active steps to finish before retrying.`,
    );
}

export function lastPushedCheckpoint(
  deps: BuildDeps,
  buildId: string,
  opts: { mergeSteps: boolean },
): string | null {
  return (
    deps.db
      .select({ commit: step.checkpointCommit })
      .from(step)
      .where(
        and(
          eq(step.buildId, buildId),
          notInArray(step.kind, opts.mergeSteps ? ['review'] : ['review', 'merge']),
          eq(step.status, 'done'),
          isNotNull(step.checkpointCommit),
        ),
      )
      .orderBy(
        desc(
          sql`coalesce(${step.finishedAt}, ${step.lastHeartbeatAt}, ${step.claimedAt}, ${step.createdAt})`,
        ),
        desc(step.createdAt),
      )
      .get()?.commit ?? null
  );
}

function dispatchHeadSha(deps: BuildDeps, buildId: string): string | null {
  const rows = deps.db
    .select({ commit: step.checkpointCommit })
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        notInArray(step.kind, ['review', 'merge', 'verify']),
        eq(step.status, 'done'),
        isNotNull(step.checkpointCommit),
      ),
    )
    .orderBy(
      desc(
        sql`coalesce(${step.finishedAt}, ${step.lastHeartbeatAt}, ${step.claimedAt}, ${step.createdAt})`,
      ),
      desc(step.createdAt),
    )
    .all();
  for (const row of rows) {
    if (row.commit !== null && isFullSha(row.commit)) return row.commit;
  }
  return null;
}

const PLAN_REWRITE_PROMPT = buildPlanRewritePrompt();

export function noteDeliveredPlanResidual(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  reason: string,
): boolean {
  if (stepRow.kind !== 'plan') return false;
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return false;
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (todoRow?.phase !== 'confirm') return false;
  const planRow = deps.db
    .select({ id: planTable.id })
    .from(planTable)
    .where(eq(planTable.buildId, stepRow.buildId))
    .get();
  if (planRow === undefined) return false;
  const id = `plan-residual-${stepRow.id}`;
  const content = `Plan step ${stepRow.id} reported a failure after the plan was delivered and the confirm gate was parked: ${reason}. The delivered plan and the confirm gate are unchanged.`;
  const createdAt = nowMs();
  const inserted = deps.db
    .insert(message)
    .values({
      id,
      conversationId: stepRow.buildId,
      role: 'system',
      content,
      createdAt,
      actor: null,
    })
    .onConflictDoNothing()
    .run();
  if (inserted.changes > 0) {
    deps.convHub?.publishMessage(stepRow.buildId, {
      id,
      role: 'system',
      content,
      createdAt,
      actor: null,
    });
  }
  finishScheduledStep(deps, stepRow, { status: 'failed', error: reason });
  return true;
}

export function settleParkedStep(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  outcome: Pick<MachineDoneBody, 'status' | 'errorMessage'>,
): boolean {
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow || !retryIsParked(buildRow.errorMessage ?? '')) return false;
  parkFailedBuild(deps, buildRow.id);
  const owner = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (
    owner &&
    owner.latestBuildId === buildRow.id &&
    owner.archivedAt === null &&
    owner.phase !== 'failed' &&
    canTransitionPhase(owner.phase, 'failed')
  )
    setTodoPhase(deps, owner.id, 'failed');
  const status = outcome.status === 'success' ? 'done' : outcome.status;
  const finishedAt = nowMs();
  if (outcome.status !== 'success') releaseUnissuedMergeAdmission(deps.db, stepRow);
  deps.db
    .update(step)
    .set({ status, finishedAt, archiveStop: null })
    .where(eq(step.id, stepRow.id))
    .run();
  deps.db.delete(stopPending).where(eq(stopPending.stepId, stepRow.id)).run();
  settleAfterStopPhase(deps, stepRow.buildId);
  finishScheduledStep(
    deps,
    stepRow,
    outcome.status === 'failed'
      ? { status: 'failed', error: outcome.errorMessage ?? buildRow.errorMessage ?? 'Task parked' }
      : { status: outcome.status === 'success' ? 'completed' : 'stopped' },
  );
  publishStepRow(deps, { ...stepRow, status, finishedAt, archiveStop: null });
  return true;
}

export function applyStepFailure(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  rawErrorMessage: string,
  report?: VerdictReport,
  preservedCommits?: readonly string[],
): void {
  const { db } = deps;
  if (settleParkedStep(deps, stepRow, { status: 'failed', errorMessage: rawErrorMessage })) return;
  db.delete(stopPending).where(eq(stopPending.stepId, stepRow.id)).run();
  if (
    db.select({ archiveStop: step.archiveStop }).from(step).where(eq(step.id, stepRow.id)).get()
      ?.archiveStop != null
  ) {
    applyStoppedStep(deps, stepRow.id);
    return;
  }
  clearStop(db, stepRow.buildId);
  settleAfterStopPhase(deps, stepRow.buildId);
  releaseUnissuedMergeAdmission(db, stepRow);
  const errorMessage =
    rawErrorMessage.trim() === '' ? `${stepRow.kind} 步异常结束，未上报原因` : rawErrorMessage;
  db.update(step)
    .set({ status: 'failed', finishedAt: nowMs() })
    .where(eq(step.id, stepRow.id))
    .run();
  const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return;
  if (
    noteDeliveredPlanResidual(
      deps,
      stepRow,
      rawErrorMessage.trim() === '' ? 'no reason reported' : rawErrorMessage,
    )
  ) {
    return;
  }
  finishScheduledStep(deps, stepRow, { status: 'failed', error: errorMessage });
  db.update(build).set({ errorMessage }).where(eq(build.id, buildRow.id)).run();
  if (isBuildStepKind(stepRow.kind)) {
    const changes = buildRow.changes;
    const files =
      changes == null
        ? undefined
        : (Array.isArray(changes) ? changes : changes.files).map((f) => f.path);
    insertMessageRow(deps, buildRow.id, {
      id: newRecordId(),
      role: 'system',
      content: buildFailureRowContent({
        reason: errorMessage,
        ...(preservedCommits !== undefined ? { commits: preservedCommits } : {}),
        ...(files !== undefined ? { files } : {}),
        pr: buildRow.prNumber !== null ? { number: buildRow.prNumber, url: buildRow.prUrl } : null,
      }),
      createdAt: nowMs(),
    });
  }
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  const finished = db.select().from(step).where(eq(step.id, stepRow.id)).get();
  const failedStep = finished ?? stepRow;
  emitRuntimeBuildSpan(db, buildRow.id, 'failed');
  persistGateVerdict(deps, failedStep, {
    stepFailed: true,
    extracted: false,
    blocked: false,
    report: report ?? reportedVerdictHeads(failedStep, { commit: failedStep.checkpointCommit }),
  });
  parkFailedBuild(deps, buildRow.id);
  if (
    todoRow &&
    todoRow.latestBuildId === buildRow.id &&
    todoRow.archivedAt === null &&
    canTransitionPhase(todoRow.phase, 'failed')
  ) {
    setTodoPhase(deps, todoRow.id, 'failed');
  }
}

export function failStepWithEvents(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  reason: string,
): void {
  applyStepFailure(deps, stepRow, reason);
  const failedBuild = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (failedBuild) publishBuild(deps, failedBuild);
  const failedStep = deps.db.select().from(step).where(eq(step.id, stepRow.id)).get();
  if (failedStep) {
    deps.convHub?.publishStep(stepRow.buildId, {
      id: failedStep.id,
      buildId: failedStep.buildId,
      kind: failedStep.kind,
      machineId: failedStep.machineId,
      createdAt: failedStep.createdAt,
      status: failedStep.status,
      checkpointCommit: failedStep.checkpointCommit,
      skillInjection: failedStep.skillInjection ?? null,
    });
  }
}

export const BUILD_ABANDONED_STEP_MS = 120_000;
export const ABANDONED_CLAIM_QUARANTINE_LIMIT = 3;

export function sweepAbandonedBuildSteps(deps: BuildDeps, now: number = nowMs()): void {
  const exitedLeftovers = deps.db
    .select({ id: step.id })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(
      and(
        or(isNotNull(todo.archivedAt), inArray(todo.phase, ['closed', 'done'])),
        inArray(step.status, [...UNSTARTED_STEP_STATUSES]),
      ),
    )
    .all();
  for (const { id } of exitedLeftovers) stopStepKeepPhase(deps, id);
  const candidates = deps.db
    .select()
    .from(step)
    .where(
      and(
        inArray(step.kind, ['plan', 'build', 'session', 'merge', 'review', 'verify']),
        inArray(step.status, ['pending', 'claimed']),
      ),
    )
    .all();
  for (const row of candidates) {
    if (row.status === 'pending') continue;
    const buildRow = deps.db.select().from(build).where(eq(build.id, row.buildId)).get();
    if (!buildRow) continue;
    const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    if (!todoRow) continue;
    const ending = abandonedEnding(deps, row, todoRow, now);
    if (ending === null || parseShipGateInstruction(row.prompt) !== null) continue;
    applyAbandonedEnding(deps, row, todoRow, ending);
  }
}

type AbandonedEnding = 'stop' | 'release';

function abandonedEnding(
  deps: BuildDeps,
  row: typeof step.$inferSelect,
  todoRow: typeof todo.$inferSelect,
  now: number,
): AbandonedEnding | null {
  if (now - stepActivityAt(row) <= BUILD_ABANDONED_STEP_MS) return null;
  const machineRow = row.machineId
    ? deps.db.select().from(machine).where(eq(machine.id, row.machineId)).get()
    : undefined;
  const progressed =
    row.lastHeartbeatAt !== null && row.lastHeartbeatAt > (row.claimedAt ?? row.createdAt);
  if (machineRow?.online && progressed) return null;
  return row.archiveStop !== null ||
    todoRow.archivedAt !== null ||
    todoRow.phase === 'closed' ||
    todoRow.phase === 'done'
    ? 'stop'
    : 'release';
}

function applyAbandonedEnding(
  deps: BuildDeps,
  row: typeof step.$inferSelect,
  todoRow: typeof todo.$inferSelect,
  ending: AbandonedEnding,
): void {
  if (ending === 'stop') stopStepKeepPhase(deps, row.id);
  else releaseClaimedStep(deps, row, todoRow);
}

export async function sweepAbandonedShipSteps(
  deps: BuildDeps,
  now: number = nowMs(),
): Promise<void> {
  const candidates = deps.db
    .select()
    .from(step)
    .where(and(eq(step.kind, 'merge'), eq(step.status, 'claimed')))
    .all()
    .filter((row) => parseShipGateInstruction(row.prompt) !== null);
  for (const row of candidates) {
    const todoRow = todoOfBuild(deps, row.buildId);
    if (todoRow === undefined || abandonedEnding(deps, row, todoRow, now) === null) continue;
    const violation = await settleAbandonedShip(deps, row);
    const current = deps.db.select().from(step).where(eq(step.id, row.id)).get();
    const currentTodo = todoOfBuild(deps, row.buildId);
    if (
      current?.status !== 'claimed' ||
      current.claimedAt !== row.claimedAt ||
      currentTodo === undefined
    )
      continue;
    if (violation !== null) {
      applyStepFailure(deps, current, violation);
      continue;
    }
    const ending = abandonedEnding(deps, current, currentTodo, now);
    if (ending !== null) applyAbandonedEnding(deps, current, currentTodo, ending);
  }
}

function todoOfBuild(deps: BuildDeps, buildId: string): typeof todo.$inferSelect | undefined {
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  return buildRow && deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
}

function releaseClaimedStep(
  deps: BuildDeps,
  row: typeof step.$inferSelect,
  todoRow: typeof todo.$inferSelect,
): void {
  if (row.archiveStop !== null) {
    applyStoppedStep(deps, row.id);
    return;
  }
  if (row.kind === 'merge' && row.prompt?.includes('"local-merge"')) {
    const projectRow = projectOfTodo(deps.db, todoRow);
    if (projectRow && projectMergeConfigOf(projectRow).mergePolicy === 'autonomous') return;
  }
  const noProgress =
    row.lastHeartbeatAt === null || row.lastHeartbeatAt <= (row.claimedAt ?? row.createdAt);
  const claims = noProgress ? row.claimCount + 1 : row.claimCount;
  if (noProgress && claims >= ABANDONED_CLAIM_QUARANTINE_LIMIT) {
    applyStepFailure(
      deps,
      row,
      `crashed ${claims} times after being claimed without progress; quarantined`,
    );
  } else {
    deps.db
      .update(step)
      .set({ status: 'pending', machineId: null, claimCount: claims })
      .where(eq(step.id, row.id))
      .run();
  }
  const released = deps.db.select().from(step).where(eq(step.id, row.id)).get();
  if (released) {
    deps.convHub?.publishStep(row.buildId, {
      id: released.id,
      buildId: released.buildId,
      kind: released.kind,
      machineId: released.machineId,
      createdAt: released.createdAt,
      status: released.status,
      checkpointCommit: released.checkpointCommit,
      skillInjection: released.skillInjection ?? null,
    });
  }
  deps.machineHub?.wake(todoRow.teamId);
}

function stepArtifactGate(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  outcome: {
    hasChanges?: boolean;
    workBranchDrift?: { expected: string; actual: string };
    report?: string;
    output?: TodoOutputKind;
  },
  planContract: PlanContractCheck | null,
): string | null {
  if (stepRow.kind === 'plan') {
    const planRow = deps.db
      .select({ id: planTable.id })
      .from(planTable)
      .where(eq(planTable.buildId, stepRow.buildId))
      .get();
    if (planRow !== undefined) {
      if (
        planContract !== null &&
        !planContract.ok &&
        isPlanContractRewritePrompt(stepRow.prompt)
      ) {
        return `方案结构不合格：${planContract.problem}`;
      }
      return null;
    }
    const priorPlanStep = deps.db
      .select({ id: step.id })
      .from(step)
      .where(and(eq(step.buildId, stepRow.buildId), eq(step.kind, 'plan'), ne(step.id, stepRow.id)))
      .get();
    if (priorPlanStep === undefined) return null;
    return '规划未产出方案';
  }
  if (isBuildStepKind(stepRow.kind)) {
    if (blockingWorkerQuestions(deps.db, stepRow.buildId).length > 0) return null;
    if (outcome.output === 'info') {
      return outcome.report === undefined ? '信息卡未产出报告' : null;
    }
    const drift = outcome.workBranchDrift;
    if (drift !== undefined) {
      if (outcome.hasChanges === false) {
        return `agent 偏离工作分支且步窗口内未见任何提交：收尾时 HEAD 在「${drift.actual}」，契约工作分支是「${drift.expected}」`;
      }
      return `agent 偏离工作分支交付，已拒绝自动收工：收尾时 HEAD 在「${drift.actual}」，契约工作分支是「${drift.expected}」`;
    }
  }
  return null;
}

function confirmPlanAutomatically(deps: BuildDeps, buildId: string): void {
  try {
    applyBuildConfirm(deps, buildId, 'server');
  } catch (error) {
    if (
      !(
        error instanceof HttpError &&
        error.status === 409 &&
        (error.message.startsWith('agent-label-privileged:') ||
          error.message.startsWith('intake-label-assignment-failed:'))
      )
    )
      throw error;
  }
}

function confirmDeliveredPlan(deps: BuildDeps, buildId: string): void {
  try {
    deps.db.transaction(() => {
      if (planAutoConfirmation(deps, buildId).eligible) confirmPlanAutomatically(deps, buildId);
    });
  } catch {
    return;
  }
}

export function sweepPlanAutoConfirm(deps: BuildDeps): void {
  const waiting = deps.db.select().from(todo).where(eq(todo.phase, 'confirm')).all();
  for (const todoRow of waiting) {
    if (todoRow.latestBuildId === null) continue;
    if (planAutoConfirmation(deps, todoRow.latestBuildId).eligible)
      confirmPlanAutomatically(deps, todoRow.latestBuildId);
  }
}

export function hasFailureRow(deps: BuildDeps, buildId: string, reason: string): boolean {
  return deps.db
    .select({ content: message.content })
    .from(message)
    .where(and(eq(message.conversationId, buildId), eq(message.role, 'system')))
    .all()
    .some((row) => {
      const parsed = systemRowOf(row.content);
      return parsed?.kind === BUILD_FAILURE_ROW_KIND && parsed.reason === reason;
    });
}

export interface CompleteStepOutcome {
  hasChanges?: boolean;
  workBranchDrift?: { expected: string; actual: string };
  findings?: ReviewVerdict;
  findingsError?: string;
  verifyVerdict?: VerifyVerdict;
  verifyVerdictError?: string;
  report?: string;
  verdictReport?: VerdictReport;
}

export function completeStep(
  deps: BuildDeps,
  stepId: string,
  outcome: CompleteStepOutcome = {},
): void {
  const stepRow = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow) throw new NotFoundError(`step ${stepId}`);
  deps.db.delete(stopPending).where(eq(stopPending.stepId, stepId)).run();
  if (stepRow.archiveStop !== null) {
    applyStoppedStep(deps, stepId);
    return;
  }
  clearStop(deps.db, stepRow.buildId);
  if (settleParkedStep(deps, stepRow, { status: 'success' })) return;
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) {
    deps.db
      .update(step)
      .set({ status: 'done', finishedAt: nowMs() })
      .where(eq(step.id, stepId))
      .run();
    finishScheduledStep(deps, stepRow);
    return;
  }
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) {
    deps.db
      .update(step)
      .set({ status: 'done', finishedAt: nowMs() })
      .where(eq(step.id, stepId))
      .run();
    finishScheduledStep(deps, stepRow);
    return;
  }
  const reserved = buildRow.afterStopPhase;
  const staleBuild = todoRow.latestBuildId !== null && todoRow.latestBuildId !== buildRow.id;
  if (
    (todoRow.archivedAt !== null && stepRow.kind !== 'merge') ||
    reserved !== null ||
    staleBuild ||
    hasLeftExecution(todoRow.phase)
  ) {
    deps.db
      .update(step)
      .set({ status: 'done', finishedAt: nowMs() })
      .where(eq(step.id, stepId))
      .run();
    finishScheduledStep(deps, stepRow);
    settleAfterStopPhase(
      deps,
      buildRow.id,
      reserved === 'done' ? () => landReservedPhase(deps, todoRow, 'done') : undefined,
    );
    return;
  }
  const undelivered = undeliveredEnd(deps, stepRow, todoRow, buildRow, outcome);
  if (undelivered !== null && pendingWorkerQuestions(deps.db, buildRow.id).length === 0)
    askUndeliveredOnce(deps, buildRow, undelivered);
  const planContract = stepRow.kind === 'plan' ? planContractOfStep(deps, stepRow) : null;
  const gateFailure = stepArtifactGate(
    deps,
    stepRow,
    { ...outcome, output: todoRow.output },
    planContract,
  );
  if (gateFailure !== null) {
    const refuseDriftRecord =
      isBuildStepKind(stepRow.kind) &&
      outcome.workBranchDrift !== undefined &&
      outcome.hasChanges !== false;
    if (refuseDriftRecord) {
      deps.db
        .update(build)
        .set({ prUrl: null, prNumber: null })
        .where(eq(build.id, stepRow.buildId))
        .run();
    }
    applyStepFailure(deps, stepRow, gateFailure, outcome.verdictReport);
    if (refuseDriftRecord) {
      const cleared = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
      if (cleared) publishBuild(deps, cleared);
    }
    return;
  }
  deps.db
    .update(step)
    .set({ status: 'done', finishedAt: nowMs() })
    .where(eq(step.id, stepId))
    .run();

  finishScheduledStep(deps, stepRow);

  if (
    receivesAnswers(stepRow.kind) &&
    pendingWorkerQuestions(deps.db, stepRow.buildId).length === 0 &&
    undeliveredAnswers(deps.db, stepRow.buildId).length > 0
  ) {
    const working = stepRow.kind === 'plan' ? 'planning' : 'building';
    if (todoRow.phase !== working && canTransitionPhase(todoRow.phase, working)) {
      setTodoPhase(deps, todoRow.id, working);
    }
    enqueueStep(
      deps,
      stepRow.buildId,
      stepRow.kind,
      todoRow.teamId,
      ANSWERS_CONTINUE_PROMPT,
      false,
      true,
    );
    return;
  }
  if (stepRow.kind === 'plan') {
    const planDoc = deps.db
      .select({ id: planTable.id })
      .from(planTable)
      .where(eq(planTable.buildId, stepRow.buildId))
      .get();
    if (!planDoc) {
      enqueueStep(deps, stepRow.buildId, 'plan', todoRow.teamId, PLAN_REWRITE_PROMPT);
      return;
    }
    if (planContract !== null && !planContract.ok) {
      enqueueStep(
        deps,
        stepRow.buildId,
        'plan',
        todoRow.teamId,
        buildPlanContractRewritePrompt(planContract.problem),
      );
      return;
    }
    setTodoPhase(deps, todoRow.id, 'confirm', { hasPlan: true });
    confirmDeliveredPlan(deps, stepRow.buildId);
    return;
  }
  if (
    isBuildStepKind(stepRow.kind) &&
    canTransitionPhase(todoRow.phase, 'needs_input') &&
    pendingWorkerQuestions(deps.db, stepRow.buildId).length > 0
  ) {
    setTodoPhase(
      deps,
      todoRow.id,
      'needs_input',
      outcome.hasChanges !== undefined ? { hasChanges: outcome.hasChanges } : {},
    );
    return;
  }
  if (isBuildStepKind(stepRow.kind) && todoRow.output === 'info') {
    if (outcome.report !== undefined && deps.attachmentsDir !== undefined) {
      storeInfoReport(
        { db: deps.db, attachmentsDir: deps.attachmentsDir },
        {
          buildId: stepRow.buildId,
          teamId: todoRow.teamId,
          createdBy: deps.user.id,
          report: outcome.report,
        },
      );
      const stored = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
      if (stored) publishBuild(deps, stored);
    }
    setTodoPhase(deps, todoRow.id, 'review', { hasChanges: false });
    return;
  }
  if (isBuildStepKind(stepRow.kind)) {
    const deliveredGithubPr = githubPrOf(deps, todoRow, buildRow.prNumber) !== null;
    if (!deliveredGithubPr) {
      setTodoPhase(deps, todoRow.id, 'review', {
        hasChanges: outcome.hasChanges ?? true,
      });
      return;
    }
    if (todoRow.phase === 'building' || canTransitionPhase(todoRow.phase, 'building')) {
      setTodoPhase(deps, todoRow.id, 'building', {
        hasChanges: outcome.hasChanges ?? true,
      });
    }
    const freshTodo = deps.db.select().from(todo).where(eq(todo.id, todoRow.id)).get();
    if (freshTodo) maybeEnqueueIndependentReview(deps, freshTodo, stepRow.buildId);
    return;
  }
  if (stepRow.kind === 'review') {
    settleReviewStep(deps, stepRow, todoRow, buildRow, outcome);
    return;
  }
  if (stepRow.kind === 'verify') {
    settleVerifyStep(deps, stepRow, buildRow, outcome);
    return;
  }
  const pr = githubPrOf(deps, todoRow, buildRow.prNumber);
  if (pr !== null) {
    assertPhaseTransition(todoRow.phase, 'done');
    insertMessageRow(deps, buildRow.id, {
      id: newRecordId(),
      role: 'system',
      content: `合并步跑完了；本任务以 PR #${pr.prNumber} 在 GitHub 上合并为准，cairn 对账读到它合并后收尾。它若还开着：在审核关口点「合并」由 cairn 经 GitHub 合并，或直接在 GitHub 上合并。`,
      createdAt: nowMs(),
    });
    return;
  }
  finishTodoDone(deps, todoRow.id, buildRow.id);
}

export function roundStart(deps: BuildDeps, buildId: string): number {
  return (
    deps.db
      .select({ at: step.createdAt })
      .from(step)
      .where(and(eq(step.buildId, buildId), inArray(step.kind, ['build', 'session', 'plan'])))
      .orderBy(desc(step.createdAt))
      .get()?.at ?? 0
  );
}

export function hasMessageRow(
  deps: BuildDeps,
  buildId: string,
  role: 'system' | 'user',
  content: string,
  since = 0,
): boolean {
  return (
    deps.db
      .select({ id: message.id })
      .from(message)
      .where(
        and(
          eq(message.conversationId, buildId),
          eq(message.role, role),
          eq(message.content, content),
          gte(message.createdAt, since),
        ),
      )
      .get() !== undefined
  );
}

export function finishTodoDone(deps: BuildDeps, todoId: string, buildId: string): void {
  const current = deps.db
    .select({ phase: todo.phase })
    .from(todo)
    .where(eq(todo.id, todoId))
    .get()?.phase;
  if (current !== undefined) assertPhaseTransition(current, 'done');
  stopUnclaimedGateSteps(deps, buildId);
  setTodoPhase(deps, todoId, 'done', {}, { landedMerge: true });
  insertMessageRow(deps, buildId, {
    id: newRecordId(),
    role: 'system',
    content: DONE_ROW,
    createdAt: nowMs(),
  });
  emitRuntimeBuildSpan(deps.db, buildId, 'done');
  markFirstPrPromptDue(deps.db, buildId);
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}
