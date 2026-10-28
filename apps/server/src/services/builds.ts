import type {
  Assignment,
  BuildRecord,
  GithubRepoRef,
  Phase,
  ReviewGate,
  ReviewVerdict,
  SecretBox,
  StepJournalRow,
  StepKind,
  StepRecord,
  TriggerSource,
  UserRecord,
} from '@cairn/shared';
import {
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  buildFallbackReport,
  buildPlanContractRewritePrompt,
  buildPlanRewritePrompt,
  buildReplanPrompt,
  buildRestartPrompt,
  buildReviewRejectPrompt,
  buildReviewStepPrompt,
  buildReworkNewBranchNote,
  buildReworkReuseNote,
  buildTaskPromptText,
  buildVerifyStepPrompt,
  CONFIRM_ANNOUNCEMENT,
  checkPlanContract,
  conversationBranch,
  EVIDENCE_PREFIX,
  GATE_LIMITS,
  hasBlockingFinding,
  isPlanContractRewritePrompt,
  MERGE_ANNOUNCEMENT,
  PLAN_PRIOR_ART_RULE,
  type PlanContractCheck,
  parseGithubIssueSourceRef,
  parseReviewPromptMeta,
  parseVerifyPromptMeta,
  personaByRole,
  planVerificationItems,
  projectMergeConfigSchema,
  REVIEW_ANNOUNCEMENT,
  REVIEW_FANOUT_ROLES,
  REVIEW_VERDICT_KIND,
  reconcileVerifyVerdict,
  STOP_MESSAGE,
  type TodoOutputKind,
  VERIFY_ANNOUNCEMENT,
  VERIFY_VERDICT_KIND,
  type VerifyVerdict,
  withRetryLessons,
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
  agent,
  build,
  buildFeedback,
  chief,
  chiefMessage,
  gateVerdict,
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
import {
  type FetchLike,
  type GithubMergeResult,
  githubMergePull,
  githubPull,
  githubPullState,
  hasPullFields,
  isFullSha,
  isOwnPull,
  WRITE_AUTHOR_ASSOCIATIONS,
} from '../lib/github.js';
import { newRecordId, newUuidv7, nowMs } from '../lib/ids.js';
import { emitRuntimeBuildSpan } from '../runtime-otel.js';
import { addUserMessageAttachmentGrants } from './attachment-authorization.js';
import { recordBuildFeedback } from './build-provenance.js';
import { askQuestionContentOf } from './chief-questions.js';
import { DONE_ROW } from './delivery-rows.js';
import { agentForStep } from './dispatch-eligibility.js';
import { stepActivityAt } from './dispatch-timeouts.js';
import type { ConversationStreamHub, TeamStreamHub } from './events.js';
import { markFirstPrPromptDue } from './first-pr-report.js';
import { githubRepoOfProject, hasRepoBinding, projectOfTodo, readBuildChanges } from './git.js';
import { githubTokenOrNull, teamGithubToken } from './github-connection.js';
import { githubText } from './github-text.js';
import type { HarnessEvalDispatchPort } from './harness-eval-coordinator.js';
import { storeInfoReport } from './info-handoff.js';
import { enqueueLocalMerge } from './local-merge.js';
import type { MachineWakeHub } from './machine-wake-hub.js';
import { readCompareAt } from './merge-gate/github-facts.js';
import { bindGateVerdict } from './merge-gate/verdict.js';
import { githubGatePort } from './merge-gate-github.js';
import type { OAuthClientConfig } from './oauth.js';
import { assertPhaseTransition, canTransitionPhase } from './phase.js';
import { projectMergeConfigOf } from './projects.js';
import { queuePushDigest, type VapidKeys } from './push.js';
import { publishStepRow, toQuotaWait } from './quota-wait.js';
import { retryLessonsOf } from './retry-lessons.js';
import { assertSplitProposalExecutable } from './split-proposal.js';
import { stepQueueProjector } from './step-queue.js';
import {
  childrenOfTodo,
  getTodo,
  setTodoPhase,
  settleSplitOnDone,
  splitBlockersSatisfied,
} from './todos.js';
import { insertGateAnnouncement, insertMessageRow } from './transcript.js';

export interface BuildDeps {
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
  harnessEval?: {
    dispatch: HarnessEvalDispatchPort;
    attemptTimeoutMs?: number;
    now?: () => number;
    dispatchAuthorized?: boolean;
  };
}

type BuildRow = typeof build.$inferSelect;
type TodoRow = typeof todo.$inferSelect;

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
    createdAt: row.createdAt,
  };
}

function publishBuild(deps: BuildDeps, row: BuildRow): BuildRecord {
  const record = toBuildRecord(row);
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (todoRow) deps.hub.publishBuildDoc(todoRow.teamId, record);
  return record;
}

export function sendBuildSteer(
  deps: BuildDeps,
  conversationId: string,
  body: { content: string },
): { message: { id: string; role: 'user'; content: string; createdAt: number } } {
  const { db } = deps;
  const buildRow = db.select().from(build).where(eq(build.id, conversationId)).get();
  if (!buildRow) throw new HttpError(404, `conversation ${conversationId}`);
  const running = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, conversationId), eq(step.status, 'claimed')))
    .all()
    .at(-1);
  if (!running) {
    throw new HttpError(409, 'no active step on this conversation (steer 只对运行中的会话生效)');
  }
  const now = nowMs();
  const messageRow = {
    id: newRecordId(),
    role: 'user' as const,
    content: body.content,
    createdAt: now,
  };
  insertMessageRow(deps, conversationId, messageRow);
  db.insert(steerPending)
    .values({ conversationId, stepId: running.id, content: body.content, createdAt: now })
    .onConflictDoUpdate({
      target: steerPending.conversationId,
      set: { stepId: running.id, content: body.content, createdAt: now },
    })
    .run();
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (todoRow) {
    addUserMessageAttachmentGrants(db, todoRow.id, todoRow.teamId, body.content);
    deps.machineHub?.steerSignal(todoRow.teamId, running.id);
  }
  return { message: messageRow };
}

export function readSteerPending(db: Db, conversationId: string): string[] {
  const pending = db
    .select()
    .from(steerPending)
    .where(eq(steerPending.conversationId, conversationId))
    .get();
  return pending ? [pending.content] : [];
}

const afterStopPhaseByBuild = new Map<string, Phase | 'keep'>();

function hasLeftExecution(phase: Phase): boolean {
  return phase === 'closed' || phase === 'done' || phase === 'todo';
}

function landReservedPhase(
  deps: BuildDeps,
  todoRow: typeof todo.$inferSelect,
  desired: Phase,
): void {
  if (todoRow.phase !== desired) {
    deps.db
      .update(todo)
      .set({ phase: desired, phaseAt: nowMs(), v: todoRow.v + 1 })
      .where(eq(todo.id, todoRow.id))
      .run();
    const record = getTodo(deps, todoRow.id);
    if (record) deps.hub.publishTodoDoc(record.teamId, record);
  }
  if (desired === 'done') {
    settleSplitOnDone(deps, todoRow.id);
    advanceSplitWaves(deps, todoRow.id);
  }
}

export function requestStop(
  deps: BuildDeps,
  buildId: string,
  body: { discard: boolean },
): { delegated: boolean } {
  const { db } = deps;
  const buildRow = db.select().from(build).where(eq(build.id, buildId)).get();
  if (!buildRow) throw new NotFoundError(`build ${buildId}`);
  const active = db
    .select()
    .from(step)
    .where(
      and(eq(step.buildId, buildId), inArray(step.status, ['pending', 'claimed', 'waiting_quota'])),
    )
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  if (!active) {
    throw new HttpError(409, 'no active step on this build (stop 只对运行中的任务生效)');
  }
  if (active.status === 'pending' || active.status === 'waiting_quota') {
    applyStoppedStep(deps, active.id);
    return { delegated: false };
  }
  const now = nowMs();
  db.insert(stopPending)
    .values({ conversationId: buildId, stepId: active.id, discard: body.discard, createdAt: now })
    .onConflictDoUpdate({
      target: stopPending.conversationId,
      set: { stepId: active.id, discard: body.discard, createdAt: now },
    })
    .run();
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (todoRow) deps.machineHub?.stopSignal(todoRow.teamId, active.id);
  return { delegated: true };
}

function stopFallbackPhase(db: Db, buildRow: BuildRow): Phase {
  const lastDone = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildRow.id), eq(step.status, 'done')))
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  if (lastDone) return lastDone.kind === 'plan' ? 'confirm' : 'review';
  return buildRow.prevPhase ?? 'todo';
}

export function applyStoppedStep(deps: BuildDeps, stepId: string): void {
  const { db } = deps;
  const stepRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow) throw new NotFoundError(`step ${stepId}`);
  db.update(step).set({ status: 'stopped', finishedAt: nowMs() }).where(eq(step.id, stepId)).run();
  db.delete(stopPending).where(eq(stopPending.conversationId, stepRow.buildId)).run();
  const stoppedRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (stoppedRow) publishStepRow(deps, stoppedRow);
  const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return;
  db.update(build).set({ errorMessage: STOP_MESSAGE }).where(eq(build.id, buildRow.id)).run();
  const cancelledRow = db.select().from(build).where(eq(build.id, buildRow.id)).get();
  if (cancelledRow) publishBuild(deps, cancelledRow);
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) return;
  const desired = afterStopPhaseByBuild.get(buildRow.id);
  afterStopPhaseByBuild.delete(buildRow.id);
  if (desired === 'keep') return;
  if (desired != null) {
    landReservedPhase(deps, todoRow, desired);
    return;
  }
  if (hasLeftExecution(todoRow.phase)) return;
  const target = stopFallbackPhase(db, buildRow);
  if (todoRow.phase === target) return;
  db.update(todo)
    .set({ phase: target, phaseAt: nowMs(), v: todoRow.v + 1 })
    .where(eq(todo.id, todoRow.id))
    .run();
  const record = getTodo(deps, todoRow.id);
  if (record) deps.hub.publishTodoDoc(record.teamId, record);
}

function releaseZombieQueued(
  deps: BuildDeps,
  buildRow: BuildRow,
  todoRow: typeof todo.$inferSelect,
): void {
  const { db } = deps;
  if (todoRow.phase !== 'queued') return;
  if (buildRow.errorMessage === null) {
    db.update(build).set({ errorMessage: STOP_MESSAGE }).where(eq(build.id, buildRow.id)).run();
  }
  const target = stopFallbackPhase(db, buildRow);
  if (todoRow.phase === target) return;
  db.update(todo)
    .set({ phase: target, phaseAt: nowMs(), v: todoRow.v + 1 })
    .where(eq(todo.id, todoRow.id))
    .run();
  const fresh = db.select().from(build).where(eq(build.id, buildRow.id)).get();
  if (fresh) publishBuild(deps, fresh);
  const record = getTodo(deps, todoRow.id);
  if (record) deps.hub.publishTodoDoc(record.teamId, record);
}

export function cancelBuild(
  deps: BuildDeps,
  buildId: string,
): 'stopped' | 'delegated' | 'released' | 'not-found' {
  const { db } = deps;
  const buildRow = db.select().from(build).where(eq(build.id, buildId)).get();
  if (!buildRow) return 'not-found';
  const active = db
    .select()
    .from(step)
    .where(
      and(eq(step.buildId, buildId), inArray(step.status, ['pending', 'claimed', 'waiting_quota'])),
    )
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  if (!active) {
    const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    if (!todoRow) return 'released';
    releaseZombieQueued(deps, buildRow, todoRow);
    return 'released';
  }
  if (active.status === 'pending' || active.status === 'waiting_quota') {
    applyStoppedStep(deps, active.id);
    emitRuntimeBuildSpan(deps.db, buildId, 'cancelled');
    return 'stopped';
  }
  const now = nowMs();
  db.insert(stopPending)
    .values({ conversationId: buildId, stepId: active.id, discard: true, createdAt: now })
    .onConflictDoUpdate({
      target: stopPending.conversationId,
      set: { stepId: active.id, discard: true, createdAt: now },
    })
    .run();
  const todoRow = db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (todoRow) deps.machineHub?.stopSignal(todoRow.teamId, active.id);
  emitRuntimeBuildSpan(deps.db, buildId, 'cancelled');
  return 'delegated';
}

function stopStepKeepPhase(deps: BuildDeps, stepId: string): void {
  const { db } = deps;
  const stepRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow) throw new NotFoundError(`step ${stepId}`);
  db.update(step).set({ status: 'stopped', finishedAt: nowMs() }).where(eq(step.id, stepId)).run();
  db.delete(stopPending).where(eq(stopPending.conversationId, stepRow.buildId)).run();
  const stoppedRow = db.select().from(step).where(eq(step.id, stepId)).get();
  if (stoppedRow) publishStepRow(deps, stoppedRow);
  const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return;
  db.update(build).set({ errorMessage: STOP_MESSAGE }).where(eq(build.id, buildRow.id)).run();
  const cancelledRow = db.select().from(build).where(eq(build.id, buildRow.id)).get();
  if (cancelledRow) publishBuild(deps, cancelledRow);
}

export function stopUnclaimedGateSteps(
  deps: BuildDeps,
  buildId: string,
): (typeof step.$inferSelect)['kind'][] {
  const rows = deps.db
    .select()
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        inArray(step.status, ['pending', 'waiting_quota']),
        inArray(step.kind, ['verify', 'review']),
      ),
    )
    .all();
  for (const row of rows) {
    const finishedAt = nowMs();
    deps.db.update(step).set({ status: 'stopped', finishedAt }).where(eq(step.id, row.id)).run();
    publishStepRow(deps, { ...row, status: 'stopped', finishedAt });
  }
  return rows.map((r) => r.kind);
}

export type StopAndMarkDoneResult = { state: 'ready' } | { state: 'stopping' };

export function prepareStopForDone(deps: BuildDeps, todoId: string): StopAndMarkDoneResult {
  return prepareStopFor(deps, todoId, 'done');
}

export function stopActiveStepsAfterExit(deps: BuildDeps, todoId: string): void {
  prepareStopFor(deps, todoId, 'exit');
}

function prepareStopFor(
  deps: BuildDeps,
  todoId: string,
  after: 'done' | 'exit',
): StopAndMarkDoneResult {
  const { db } = deps;
  const todoRow = db.select().from(todo).where(eq(todo.id, todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${todoId}`);
  if (todoRow.latestBuildId == null) return { state: 'ready' };
  const buildId = todoRow.latestBuildId;
  if (after === 'exit') afterStopPhaseByBuild.delete(buildId);
  const active = db
    .select()
    .from(step)
    .where(
      and(eq(step.buildId, buildId), inArray(step.status, ['pending', 'claimed', 'waiting_quota'])),
    )
    .orderBy(asc(step.createdAt))
    .all()
    .at(-1);
  if (!active) return { state: 'ready' };
  if (active.status === 'pending' || active.status === 'waiting_quota') {
    stopStepKeepPhase(deps, active.id);
    return { state: 'ready' };
  }
  const now = nowMs();
  afterStopPhaseByBuild.set(buildId, after === 'done' ? 'done' : 'keep');
  db.insert(stopPending)
    .values({ conversationId: buildId, stepId: active.id, discard: true, createdAt: now })
    .onConflictDoUpdate({
      target: stopPending.conversationId,
      set: { stepId: active.id, discard: true, createdAt: now },
    })
    .run();
  deps.machineHub?.stopSignal(todoRow.teamId, active.id);
  return { state: 'stopping' };
}

export function sweepZombieQueuedTodos(deps: BuildDeps, _now: number = nowMs()): number {
  const rows = deps.db.select().from(todo).where(eq(todo.phase, 'queued')).all();
  let released = 0;
  for (const todoRow of rows) {
    if (todoRow.latestBuildId === null) continue;
    const buildRow = deps.db.select().from(build).where(eq(build.id, todoRow.latestBuildId)).get();
    if (!buildRow) continue;
    const active = deps.db
      .select({ id: step.id })
      .from(step)
      .where(
        and(
          eq(step.buildId, buildRow.id),
          inArray(step.status, ['pending', 'claimed', 'waiting_quota']),
        ),
      )
      .all();
    if (active.length > 0) continue;
    releaseZombieQueued(deps, buildRow, todoRow);
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
): StepRecord {
  const id = newRecordId();
  const createdAt = nowMs();
  deps.db
    .insert(step)
    .values({
      id,
      buildId,
      kind,
      machineId: null,
      status: 'pending',
      prompt: prompt ?? null,
      freshSession: freshSession === true,
      createdAt,
    })
    .run();
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
            homeMachineId: agentForStep(deps.db, todoRow, r.kind, r.prompt)?.machineId ?? null,
            holdReason: r.holdReason,
            holdUntil: r.holdUntil,
          });
          return [r.id, projected ?? undefined];
        }),
      );
    }
  }
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
  }));
}

export function startBuilds(
  deps: BuildDeps,
  input: {
    projectId: string;
    todoIds: string[];
    assignment: Assignment;
    withPlan: boolean;
    triggerSource?: TriggerSource;
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
    const previous =
      todoRecord.latestBuildId === null
        ? undefined
        : deps.db
            .select({ errorMessage: build.errorMessage })
            .from(build)
            .where(eq(build.id, todoRecord.latestBuildId))
            .get();
    assertSplitProposalExecutable(previous?.errorMessage ?? null);
  }
  const created: BuildRecord[] = [];
  for (const todoId of input.todoIds) {
    const todoRecord = getTodo(deps, todoId);
    if (!todoRecord) throw new NotFoundError(`todo ${todoId}`);
    assertPhaseTransition(todoRecord.phase, 'queued');
    const id = newUuidv7();
    const createdAt = nowMs();
    deps.db
      .insert(build)
      .values({
        id,
        todoId,
        withPlan: input.withPlan,
        prevPhase: todoRecord.phase,
        triggerSource,
        planDocId: null,
        errorMessage: null,
        prUrl: null,
        prNumber: null,
        changes: null,
        diffHash: null,
        createdAt,
      })
      .run();
    const firstKind = input.withPlan ? 'plan' : 'build';
    const lessons =
      todoRecord.phase === 'failed' && todoRecord.latestBuildId !== null
        ? retryLessonsOf(deps.db, todoRecord.latestBuildId)
        : null;
    enqueueStep(
      deps,
      id,
      firstKind,
      todoRecord.teamId,
      withRetryLessons(undefined, firstKind, lessons),
    );
    setTodoPhase(deps, todoId, 'queued', {
      assignment: input.assignment,
      latestBuildId: id,
      lastRunAt: createdAt,
    });
    const row = deps.db.select().from(build).where(eq(build.id, id)).get();
    if (!row) throw new Error('build missing after insert');
    created.push(publishBuild(deps, row));
  }
  return created;
}

function ticketRefOf(todoRow: { sourceRef: string | null; seqNum: number }): string {
  const linked = todoRow.sourceRef !== null ? parseGithubIssueSourceRef(todoRow.sourceRef) : null;
  return String(linked?.issueNumber ?? todoRow.seqNum);
}

export function maybeEnqueueVerifyStep(
  deps: BuildDeps,
  todoRow: typeof todo.$inferSelect,
  buildId: string,
  opts: { reverify?: boolean } = {},
): void {
  const verifyAgentId = todoRow.assignment?.verify?.agentId;
  if (verifyAgentId == null) return;
  const existing = deps.db
    .select({ id: step.id })
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        eq(step.kind, 'verify'),
        ...(opts.reverify === true
          ? [inArray(step.status, ['pending', 'claimed', 'waiting_quota'])]
          : []),
      ),
    )
    .get();
  if (existing !== undefined) return;
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (buildRow === undefined) return;
  const ticketRef = ticketRefOf(todoRow);
  const planRow = latestPlanRow(deps, buildId);
  const expectedHeadSha = dispatchHeadSha(deps, buildId);
  const prompt = buildVerifyStepPrompt({
    ticketRef,
    taskText: buildTaskPromptText(todoRow.title, todoRow.spec, todoRow),
    planText: planRow?.content ?? '',
    verificationItems: planVerificationItems(planRow?.content ?? ''),
    pr: buildRow.prNumber !== null ? { number: buildRow.prNumber, url: buildRow.prUrl } : null,
    ...(expectedHeadSha !== null ? { expectedHeadSha } : {}),
  });
  insertGateAnnouncement(deps, buildId, VERIFY_ANNOUNCEMENT, deps.user.displayName);
  enqueueStep(deps, buildId, 'verify', todoRow.teamId, prompt);
}

const REVIEW_IN_FLIGHT = ['pending', 'claimed', 'waiting_quota'] as const;

export function maybeEnqueueIndependentReview(
  deps: BuildDeps,
  todoRow: TodoRow,
  buildId: string,
): void {
  const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (buildRow === undefined || githubPrOf(deps, todoRow, buildRow.prNumber) === null) return;
  const head = dispatchHeadSha(deps, buildId);
  if (head === null) return;
  const reviews = deps.db
    .select()
    .from(step)
    .where(and(eq(step.buildId, buildId), eq(step.kind, 'review')))
    .all();
  if (reviews.some((row) => (REVIEW_IN_FLIGHT as readonly string[]).includes(row.status))) return;
  if (reviews.some((row) => parseReviewPromptMeta(row.prompt)?.expectedHeadSha === head)) return;
  const slotted = todoRow.assignment?.review?.agentId ?? null;
  const personaReviewer = deps.db
    .select({ id: agent.id })
    .from(agent)
    .where(and(eq(agent.teamId, todoRow.teamId), eq(agent.persona, 'code_reviewer')))
    .get();
  const agentId = slotted ?? personaReviewer?.id ?? null;
  if (agentId === null) return;
  const reviewer = deps.db.select().from(agent).where(eq(agent.id, agentId)).get();
  const focus = reviewer?.persona != null ? personaByRole(reviewer.persona).reviewFocus : undefined;
  const plan = latestPlanRow(deps, buildId);
  const prompt = buildReviewStepPrompt({
    agentId,
    gate: 'review',
    planText: plan?.content ?? '',
    changes: [],
    checkout: hasRepoBinding(projectOfTodo(deps.db, todoRow)),
    expectedHeadSha: head,
    ...(focus !== undefined && focus !== '' ? { focus } : {}),
  });
  insertGateAnnouncement(deps, buildId, REVIEW_ANNOUNCEMENT, deps.user.displayName);
  enqueueStep(deps, buildId, 'review', todoRow.teamId, prompt);
}

export function advanceSplitWaves(deps: BuildDeps, childTodoId: string): void {
  const row = deps.db.select().from(todo).where(eq(todo.id, childTodoId)).get();
  if (row === undefined || row.sourceTodo === null) return;
  const ready = childrenOfTodo(deps.db, row.sourceTodo).filter(
    (c) => c.phase === 'todo' && splitBlockersSatisfied(deps.db, c),
  );
  for (const child of ready) {
    const assignment = child.assignment ?? { plan: null, build: null };
    if (assignment.build == null) continue;
    try {
      startBuilds(deps, {
        projectId: child.projectId,
        todoIds: [child.id],
        assignment,
        withPlan: false,
        triggerSource: 'chief',
      });
    } catch {}
  }
}

export function dispatchSplitChildren(deps: BuildDeps, parentId: string): number {
  const ready = childrenOfTodo(deps.db, parentId).filter(
    (c) => c.phase === 'todo' && splitBlockersSatisfied(deps.db, c),
  );
  let dispatched = 0;
  for (const child of ready) {
    const assignment = child.assignment ?? { plan: null, build: null };
    if (assignment.build == null) continue;
    try {
      startBuilds(deps, {
        projectId: child.projectId,
        todoIds: [child.id],
        assignment,
        withPlan: false,
        triggerSource: 'chief',
      });
      dispatched += 1;
    } catch {}
  }
  return dispatched;
}

function latestPrBuild(db: Db, todoId: string): BuildRow | null {
  return (
    db
      .select()
      .from(build)
      .where(and(eq(build.todoId, todoId), or(isNotNull(build.prUrl), isNotNull(build.prNumber))))
      .orderBy(desc(build.createdAt))
      .all()
      .at(0) ?? null
  );
}

async function probePullState(
  deps: BuildDeps,
  teamId: string,
  projectId: string,
  prNumber: number,
  timeoutMs?: number,
): Promise<{ state: 'open' | 'closed'; merged: boolean } | null> {
  const projRow = projectOfTodo(deps.db, { projectId, teamId });
  const repoRef = githubRepoOfProject(projRow);
  if (repoRef === null) return null;
  const { owner, repo } = repoRef;
  const token = await githubTokenOrNull(deps, teamId);
  return githubPullState(deps.githubFetch ?? fetch, token, owner, repo, prNumber, timeoutMs);
}

async function probeReworkTargetPr(
  deps: BuildDeps,
  target: BuildRow,
  todo: { projectId: string; teamId: string },
): Promise<'merged' | 'closed' | null> {
  if (target.prNumber === null) return null;
  const state = await probePullState(deps, todo.teamId, todo.projectId, target.prNumber);
  if (state === null || state.state === 'open') return null;
  return state.merged ? 'merged' : 'closed';
}

const MERGED_PR_GUARD_PROBE_TIMEOUT_MS = 5_000;

export async function mergedPrElsewhere(
  deps: BuildDeps,
  todoId: string,
  excludeBuildId: string,
): Promise<{ prNumber: number; prUrl: string | null } | null> {
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, todoId)).get();
  if (todoRow === undefined) return null;
  const prior = deps.db
    .select()
    .from(build)
    .where(
      and(
        eq(build.todoId, todoId),
        ne(build.id, excludeBuildId),
        or(isNotNull(build.prUrl), isNotNull(build.prNumber)),
      ),
    )
    .orderBy(desc(build.createdAt))
    .all();
  for (const row of prior) {
    if (row.prNumber === null) continue;
    const state = await probePullState(
      deps,
      todoRow.teamId,
      todoRow.projectId,
      row.prNumber,
      MERGED_PR_GUARD_PROBE_TIMEOUT_MS,
    );
    if (state?.merged) return { prNumber: row.prNumber, prUrl: row.prUrl };
  }
  return null;
}

async function assertNoMergedPrElsewhere(
  deps: BuildDeps,
  row: BuildRow,
  prNumber: number,
): Promise<void> {
  const priorMerged = await mergedPrElsewhere(deps, row.todoId, row.id);
  if (priorMerged !== null) {
    throw new HttpError(
      409,
      `本任务已有已合并的 PR #${priorMerged.prNumber}，本 build 又开了 PR #${prNumber}——疑似重复交付，拒绝发起合并（请人工复核后处理）`,
    );
  }
}

function applyBuildConfirm(deps: BuildDeps, buildId: string, actorName: string): void {
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row) throw new NotFoundError(`build ${buildId}`);
  assertSplitProposalExecutable(row.errorMessage);
  const todoRecord = getTodo(deps, row.todoId);
  if (!todoRecord) throw new NotFoundError(`todo ${row.todoId}`);
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
    | { action: 'review'; agentId?: string; focus?: string }
    | { action: 'restart'; feedback: string; clientMessageId: string },
  actor?: string,
): Promise<void> {
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row) throw new NotFoundError(`build ${buildId}`);
  assertSplitProposalExecutable(row.errorMessage);
  let todoRecord = getTodo(deps, row.todoId);
  if (!todoRecord) throw new NotFoundError(`todo ${row.todoId}`);
  const actorName = actor ?? deps.user.displayName;

  if (body.action === 'restart') {
    if (todoRecord.phase !== 'failed') {
      throw new HttpError(409, `restart 仅适用于 failed 相位（当前 ${todoRecord.phase}）`);
    }
    const assignment = todoRecord.assignment ?? { plan: null, build: null };
    const feedbackText = body.feedback.trim() === '' ? null : body.feedback;
    const preservedStep = deps.db
      .select({ id: step.id })
      .from(step)
      .where(
        and(
          eq(step.buildId, row.id),
          eq(step.kind, 'build'),
          eq(step.status, 'failed'),
          isNotNull(step.checkpointCommit),
        ),
      )
      .get();
    const reworkTarget = preservedStep !== undefined ? row : latestPrBuild(deps.db, row.todoId);
    const prClosed: 'merged' | 'closed' | null =
      reworkTarget !== null ? await probeReworkTargetPr(deps, reworkTarget, todoRecord) : null;
    if (reworkTarget !== null && prClosed === null) {
      const now = nowMs();
      const reuseLessons = feedbackText !== null ? retryLessonsOf(deps.db, buildId) : null;
      recordBuildFeedback(deps.db, buildId, 'restart', 'build', body.feedback, actorName);
      if (feedbackText !== null) {
        insertMessageRow(deps, reworkTarget.id, {
          id: newRecordId(),
          role: 'user',
          content: feedbackText,
          createdAt: now,
        });
      }
      insertMessageRow(deps, reworkTarget.id, {
        id: newRecordId(),
        role: 'system',
        content: buildReworkReuseNote({
          prNumber: reworkTarget.prNumber,
          prUrl: reworkTarget.prUrl,
          failureReason: reworkTarget.errorMessage,
        }),
        createdAt: now,
      });
      const restartPrompt = feedbackText !== null ? buildRestartPrompt(feedbackText) : undefined;
      const reuseKind = reworkTarget.withPlan ? 'plan' : 'build';
      enqueueStep(
        deps,
        reworkTarget.id,
        reuseKind,
        todoRecord.teamId,
        withRetryLessons(restartPrompt, reuseKind, reuseLessons),
        true,
      );
      deps.db
        .update(build)
        .set({
          errorMessage: null,
          prevPhase: 'failed',
        })
        .where(eq(build.id, reworkTarget.id))
        .run();
      setTodoPhase(deps, todoRecord.id, 'queued', {
        assignment,
        latestBuildId: reworkTarget.id,
        lastRunAt: now,
      });
      const reusedRow = deps.db.select().from(build).where(eq(build.id, reworkTarget.id)).get();
      if (!reusedRow) throw new Error('build missing after update');
      publishBuild(deps, reusedRow);
      return;
    }
    const priorLessons = feedbackText !== null ? retryLessonsOf(deps.db, buildId) : null;
    recordBuildFeedback(deps.db, buildId, 'restart', 'build', body.feedback, actorName);
    const newId = newUuidv7();
    const createdAt = nowMs();
    deps.db
      .insert(build)
      .values({
        id: newId,
        todoId: todoRecord.id,
        withPlan: row.withPlan,
        prevPhase: todoRecord.phase,
        triggerSource: 'user',
        planDocId: null,
        errorMessage: null,
        prUrl: null,
        prNumber: null,
        changes: null,
        diffHash: null,
        createdAt,
      })
      .run();
    if (feedbackText !== null) {
      insertMessageRow(deps, newId, {
        id: newRecordId(),
        role: 'user',
        content: feedbackText,
        createdAt,
      });
    }
    if (prClosed !== null && reworkTarget !== null) {
      insertMessageRow(deps, newId, {
        id: newRecordId(),
        role: 'system',
        content: buildReworkNewBranchNote({
          prNumber: reworkTarget.prNumber,
          prUrl: reworkTarget.prUrl,
          branch: conversationBranch(newId),
          outcome: prClosed,
        }),
        createdAt,
      });
    }
    const restartPrompt = feedbackText !== null ? buildRestartPrompt(feedbackText) : undefined;
    const firstKind = row.withPlan ? 'plan' : 'build';
    enqueueStep(
      deps,
      newId,
      firstKind,
      todoRecord.teamId,
      withRetryLessons(restartPrompt, firstKind, priorLessons),
    );
    setTodoPhase(deps, todoRecord.id, 'queued', {
      assignment,
      latestBuildId: newId,
      lastRunAt: createdAt,
    });
    const newRow = deps.db.select().from(build).where(eq(build.id, newId)).get();
    if (!newRow) throw new Error('build missing after insert');
    publishBuild(deps, newRow);
    return;
  }

  if (body.action === 'confirm') {
    applyBuildConfirm(deps, buildId, actorName);
    return;
  }
  if (body.action === 'review') {
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
    const promptArgs = {
      gate,
      planText,
      ...(changes !== undefined ? { changes } : {}),
      checkout,
      ...(expectedHeadSha !== null ? { expectedHeadSha } : {}),
    } as const;
    if (body.agentId === undefined) {
      const currentTodo = todoRecord;
      const fanout = REVIEW_FANOUT_ROLES.map((role) => ({
        row: deps.db
          .select({ id: agent.id })
          .from(agent)
          .where(and(eq(agent.teamId, currentTodo.teamId), eq(agent.persona, role)))
          .get(),
        focus: personaByRole(role).reviewFocus ?? '',
      })).filter((p): p is { row: { id: string }; focus: string } => p.row !== undefined);
      if (fanout.length > 0) {
        for (const perspective of fanout) {
          const focus =
            body.focus !== undefined && body.focus.trim() !== ''
              ? `${body.focus.trim()}\n\n本视角重点：${perspective.focus}`
              : `本视角重点：${perspective.focus}`;
          const prompt = buildReviewStepPrompt({
            agentId: perspective.row.id,
            ...promptArgs,
            focus,
          });
          enqueueStep(deps, buildId, 'review', todoRecord.teamId, prompt);
        }
        return;
      }
      const fallback = todoRecord.assignment?.review?.agentId ?? null;
      if (fallback === null) {
        throw new HttpError(
          400,
          '无可用审核人：团队未播种 persona（CodeReviewer/SecurityAuditor/TestEngineer）且任务的 assignment.review 槽为空。指派审核 Agent（assignment.review 槽）或在请求里携带 agentId。',
        );
      }
      const prompt = buildReviewStepPrompt({ agentId: fallback, ...promptArgs });
      enqueueStep(deps, buildId, 'review', todoRecord.teamId, prompt);
      return;
    }
    const reviewPrompt = buildReviewStepPrompt({
      agentId: body.agentId,
      ...promptArgs,
      ...(body.focus !== undefined ? { focus: body.focus } : {}),
    });
    enqueueStep(deps, buildId, 'review', todoRecord.teamId, reviewPrompt);
    return;
  }
  if (todoRecord.phase !== 'confirm' && todoRecord.phase !== 'review') {
    throw new HttpError(409, `revision 仅在待确认/审核关口允许，当前相位 ${todoRecord.phase}`);
  }
  recordBuildFeedback(
    deps.db,
    buildId,
    'revision',
    todoRecord.phase === 'confirm' ? 'plan' : 'build',
    body.feedback,
    actorName,
  );
  insertMessageRow(deps, buildId, {
    id: newRecordId(),
    role: 'user',
    content: body.feedback,
    createdAt: nowMs(),
  });
  setTodoPhase(deps, todoRecord.id, 'planning');
  const replanPrompt =
    todoRecord.phase === 'review'
      ? buildReviewRejectPrompt(body.feedback)
      : buildReplanPrompt(body.feedback);
  enqueueStep(deps, buildId, 'plan', todoRecord.teamId, replanPrompt);
}

function restoreFailedReview(deps: BuildDeps, row: BuildRow): void {
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (todoRow?.phase !== 'failed') return;
  assertDeliveredBuild(deps, row);
  setTodoPhase(deps, todoRow.id, 'review');
}

function assertDeliveredBuild(deps: BuildDeps, row: BuildRow): void {
  const { db } = deps;
  const buildStep = db
    .select()
    .from(step)
    .where(and(eq(step.buildId, row.id), eq(step.kind, 'build')))
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

export async function requestMerge(
  deps: BuildDeps,
  buildId: string,
  actor?: string,
): Promise<{ delegated: true }> {
  const row = deps.db.select().from(build).where(eq(build.id, buildId)).get();
  if (!row) throw new NotFoundError(`build ${buildId}`);
  let todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${row.todoId}`);
  if (todoRow.output === 'info') throw new HttpError(409, INFO_CARD_MERGE_REFUSAL);
  const inFlight = deps.db
    .select({ id: step.id })
    .from(step)
    .where(
      and(
        eq(step.buildId, buildId),
        eq(step.kind, 'merge'),
        inArray(step.status, ['pending', 'claimed', 'waiting_quota']),
      ),
    )
    .get();
  if (inFlight) throw new HttpError(409, '这个构建已有一个合并步在排队或在跑，等它结束再发起');
  const pr = githubPrOf(deps, todoRow, row.prNumber);
  if (pr !== null) {
    return mergeThroughGithub(deps, row, pr.prNumber, pr.repoRef, actor ?? deps.user.displayName);
  }
  restoreFailedReview(deps, row);
  if (todoRow.phase === 'failed') {
    // biome-ignore lint/style/noNonNullAssertion: restoreFailedReview transitions phase in place, never deletes the row; second get() must match the first
    todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get()!;
  }
  assertPhaseTransition(todoRow.phase, 'done');
  assertMergeTools(deps, todoRow);
  insertGateAnnouncement(deps, buildId, MERGE_ANNOUNCEMENT, actor ?? deps.user.displayName);
  const projectRow = projectOfTodo(deps.db, todoRow);
  if (
    projectRow?.repoKind === 'local' &&
    projectMergeConfigOf(projectRow).mergePolicy === 'autonomous'
  ) {
    const git = deps.gitOps ?? systemGitOps;
    const localPath = projectRow.localPath;
    if (localPath === null) {
      throw new HttpError(409, '本地项目没有仓库路径，拒绝走未受控合并');
    }
    const listing = await git.listBranches(localPath).catch(() => null);
    if (listing === null || listing.defaultBranch === null) {
      throw new HttpError(409, '无法读取本地仓库默认分支，拒绝走未受控合并');
    }
    const local = await enqueueLocalMerge(deps, buildId, listing.defaultBranch);
    if (local.enqueued) return { delegated: true };
    const blocking = local.readiness?.blockers ?? [];
    if (blocking.length > 0) {
      throw new HttpError(
        409,
        `本地合并未通过关口判定，无法落地：${blocking.map((b) => b.label).join('；')}`,
      );
    }
    throw new HttpError(409, '本地合并未通过关口判定，无法落地');
  }
  enqueueStep(deps, buildId, 'merge', todoRow.teamId);
  return { delegated: true };
}

export const INFO_CARD_MERGE_REFUSAL =
  '信息卡的产出是报告附件，不进合并：要把内容落进仓库，请建下游代码卡走正常流程';

function githubPrOf(
  deps: BuildDeps,
  todoRow: { projectId: string; teamId: string },
  prNumber: number | null,
): { repoRef: GithubRepoRef; prNumber: number } | null {
  if (prNumber === null) return null;
  const repoRef = githubRepoOfProject(projectOfTodo(deps.db, todoRow));
  return repoRef === null ? null : { repoRef, prNumber };
}

function assertMergeTools(deps: BuildDeps, todoRow: TodoRow): void {
  const buildAgentId = todoRow.assignment?.build?.agentId;
  if (!buildAgentId) return;
  const agentRow = deps.db.select().from(agent).where(eq(agent.id, buildAgentId)).get();
  if (!agentRow) return;
  const missing = [AGENT_TOOL_MERGE, AGENT_TOOL_PUSH].filter((t) => !agentRow.tools.includes(t));
  if (missing.length > 0) {
    throw new HttpError(
      403,
      `Agent ${agentRow.displayName} 未获「${missing.join('」「')}」授权（Agent 详情页权限 tab），无法发起合并`,
    );
  }
}

const STEP_KIND_TEXT: Record<StepKind, string> = {
  plan: '规划',
  build: '执行',
  merge: '合并',
  chief: '编排',
  review: '审核',
  verify: '验证',
};

const mergingBuilds = new Set<string>();

function stepKindInFlight(deps: BuildDeps, buildId: string): StepKind | null {
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
              inArray(step.status, ['pending', 'waiting_quota']),
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

export interface VerdictReport {
  reportedHeadSha: string | null;
  driftedHeads: readonly string[];
}

function expectedHeadOf(stepRow: typeof step.$inferSelect): string | null {
  const expected =
    stepRow.kind === 'review'
      ? (parseReviewPromptMeta(stepRow.prompt)?.expectedHeadSha ?? null)
      : stepRow.kind === 'verify'
        ? (parseVerifyPromptMeta(stepRow.prompt)?.expectedHeadSha ?? null)
        : null;
  return expected !== null && isFullSha(expected) ? expected : null;
}

export function reportedVerdictHeads(
  stepRow: typeof step.$inferSelect,
  reported: { gateHeadSha?: string | undefined; commit?: string | null | undefined },
): VerdictReport {
  const candidates = [reported.gateHeadSha, reported.commit].filter(
    (sha): sha is string => typeof sha === 'string' && isFullSha(sha),
  );
  const expected = expectedHeadOf(stepRow);
  const driftedHeads = expected === null ? [] : candidates.filter((sha) => sha !== expected);
  const pick = stepRow.kind === 'verify' ? driftedHeads.at(-1) : driftedHeads[0];
  return { reportedHeadSha: pick ?? candidates[0] ?? null, driftedHeads };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const verdictDigestsInFlight = new Set<Promise<void>>();

export async function flushVerdictDigests(): Promise<void> {
  await Promise.all([...verdictDigestsInFlight]);
}

function persistGateVerdict(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
  todoRow: typeof todo.$inferSelect | undefined,
  facts: { stepFailed: boolean; extracted: boolean; blocked: boolean; report: VerdictReport },
): void {
  if (stepRow.kind !== 'review' && stepRow.kind !== 'verify') return;
  const expectedHeadSha = expectedHeadOf(stepRow);
  if (expectedHeadSha === null) return;
  const perspective =
    stepRow.kind === 'review' && todoRow !== undefined
      ? (agentForStep(deps.db, todoRow, 'review', stepRow.prompt)?.persona ?? null)
      : null;
  const bound = bindGateVerdict({
    kind: stepRow.kind,
    perspective,
    expectedHeadSha,
    reportedHeadSha: facts.report.reportedHeadSha,
    stepFailed: facts.stepFailed,
    extracted: facts.extracted,
    blocked: facts.blocked,
  });
  if (bound === null) return;
  const inserted = deps.db
    .insert(gateVerdict)
    .values({
      stepId: stepRow.id,
      buildId: stepRow.buildId,
      kind: bound.kind,
      perspective: bound.perspective,
      outcome: bound.outcome,
      patchDigest: null,
      headSha: bound.headSha,
      expectedHeadSha: bound.expectedHeadSha,
      createdAt: nowMs(),
    })
    .onConflictDoNothing({ target: gateVerdict.stepId })
    .run();
  if (inserted.changes === 0) return;
  const driftedHeads = facts.report.driftedHeads;
  const pending = (async (): Promise<void> => {
    const row = deps.db.select().from(gateVerdict).where(eq(gateVerdict.stepId, stepRow.id)).get();
    if (row === undefined || row.patchDigest !== null || row.headSha === null) return;
    const expected = row.expectedHeadSha;
    const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
    if (buildRow?.prNumber == null) return;
    const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
    if (todoRow === undefined) return;
    const repo = githubRepoOfProject(projectOfTodo(deps.db, todoRow));
    if (repo === null) return;
    const access = await teamGithubToken(deps, todoRow.teamId);
    if (!('token' in access)) return;
    const port = githubGatePort(
      deps.githubFetch ?? fetch,
      access.token,
      repo.owner,
      repo.repo,
      10_000,
    );
    let pathsAfterExpected: string[] | null = null;
    if (row.kind === 'verify' && driftedHeads.length > 0) {
      const names = new Set<string>();
      for (const head of driftedHeads) {
        const read = await readCompareAt(port, expected, head);
        const files = typeof read.compare === 'object' ? read.compare.files : null;
        if (files === null || files.length === 0 || files.length >= GATE_LIMITS.compareFileCap) {
          return;
        }
        for (const f of files) {
          names.add(f.filename);
          if (f.previousFilename !== null) names.add(f.previousFilename);
        }
      }
      pathsAfterExpected = [...names];
    } else if (row.headSha !== expected) {
      return;
    }
    let baseSha: string | null = null;
    const pull = await port.pull(buildRow.prNumber, { etag: null });
    const base = asRecord(pull.kind === 'ok' ? asRecord(pull.body)?.base : null);
    if (typeof base?.sha === 'string' && isFullSha(base.sha)) {
      baseSha = base.sha;
    } else if (typeof base?.ref === 'string' && base.ref !== '') {
      const branch = await port.branch(base.ref, { etag: null });
      const commit = asRecord(branch.kind === 'ok' ? asRecord(branch.body)?.commit : null);
      if (typeof commit?.sha === 'string' && isFullSha(commit.sha)) baseSha = commit.sha;
    }
    if (baseSha === null) return;
    const delivery = await readCompareAt(port, baseSha, expected);
    if (typeof delivery.compare !== 'object') return;
    const bound = bindGateVerdict({
      kind: row.kind,
      perspective: row.perspective,
      expectedHeadSha: expected,
      reportedHeadSha: row.headSha,
      stepFailed: false,
      extracted: true,
      blocked: false,
      compareFiles: delivery.compare.files,
      pathsAfterExpected,
      evidenceDir: `${EVIDENCE_PREFIX}${ticketRefOf(todoRow)}/`,
    });
    if (bound?.patchDigest == null) return;
    deps.db
      .update(gateVerdict)
      .set({ patchDigest: bound.patchDigest })
      .where(
        and(
          eq(gateVerdict.stepId, row.stepId),
          eq(gateVerdict.createdAt, row.createdAt),
          isNull(gateVerdict.patchDigest),
        ),
      )
      .run();
  })()
    .catch(() => undefined)
    .finally(() => verdictDigestsInFlight.delete(pending));
  verdictDigestsInFlight.add(pending);
}
function apiMergeGate(deps: BuildDeps, row: BuildRow): { todoRow: TodoRow; failed: boolean } {
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, row.todoId)).get();
  if (!todoRow) throw new NotFoundError(`todo ${row.todoId}`);
  const failed = todoRow.phase === 'failed';
  if (failed) {
    assertDeliveredBuild(deps, row);
  } else {
    assertPhaseTransition(todoRow.phase, 'done');
    if (todoRow.phase !== 'review') {
      throw new HttpError(409, `合并只在审核关口发起，当前相位 ${todoRow.phase}`);
    }
  }
  if (todoRow.latestBuildId !== null && todoRow.latestBuildId !== row.id) {
    throw new HttpError(
      409,
      `这次运行已不是任务的当前运行（任务重跑过），cairn 不经它合并 PR #${row.prNumber}`,
    );
  }
  const busy = stepKindInFlight(deps, row.id);
  if (busy !== null) {
    throw new HttpError(
      409,
      busy === 'review'
        ? '本任务还有一个审核步在跑：等审核结论出来再合并。'
        : `本任务还有一个${STEP_KIND_TEXT[busy]}步在排队或在跑，它收尾时还会推送提交：等它跑完再合并。`,
    );
  }
  return { todoRow, failed };
}

function closingLine(todoRow: TodoRow, repoRef: GithubRepoRef): string | null {
  if (todoRow.sourceKind !== 'github-issue' && todoRow.sourceKind !== 'github-issue-self') {
    return null;
  }
  const issue = todoRow.sourceRef === null ? null : parseGithubIssueSourceRef(todoRow.sourceRef);
  if (issue === null) return null;
  const sameRepo =
    issue.owner.toLowerCase() === repoRef.owner.toLowerCase() &&
    issue.repo.toLowerCase() === repoRef.repo.toLowerCase();
  return sameRepo ? `closes #${issue.issueNumber}` : null;
}

const CLOSING_SHAPE = /(?<![a-z])(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s*:?\s*\S*\d/i;

const PLAIN_MERGE_BODY = 'Merged by cairn.';

function unclearReason(result: Extract<GithubMergeResult, { kind: 'unknown' }>): string {
  switch (result.reason) {
    case 'timeout':
      return '请求超时';
    case 'network':
      return '网络错误';
    case 'malformed':
      return `HTTP ${result.status}，应答读不出`;
    case 'status':
      return `HTTP ${result.status}`;
  }
}

async function mergeThroughGithub(
  deps: BuildDeps,
  row: BuildRow,
  prNumber: number,
  repoRef: GithubRepoRef,
  actor: string,
): Promise<{ delegated: true }> {
  apiMergeGate(deps, row);
  await assertNoMergedPrElsewhere(deps, row, prNumber);
  const gate = apiMergeGate(deps, row);
  assertMergeTools(deps, gate.todoRow);
  const hint = gate.failed
    ? '在 GitHub 上合并后再点一次合并：cairn 把卡恢复到审核关口，由对账核对后收尾'
    : 'cairn 对账读到合并后核对并收尾（核对不上时在时间线说明，由人处理，例如完成时不勾合并）';
  const access = await teamGithubToken(deps, gate.todoRow.teamId);
  if ('reason' in access) {
    if (access.reason === 'no-secret-box') {
      throw new HttpError(
        409,
        `PR #${prNumber} 要经 GitHub 合并，但 server 没有配置密钥（secret box），读不了团队的 GitHub 连接：请检查 server 的密钥配置。`,
      );
    }
    const reconnect = access.reason === 'token-unreadable';
    const connect = reconnect ? '重新连接 GitHub' : '连接 GitHub';
    const next = gate.failed
      ? `任务处于失败态：${connect} 后再点合并`
      : `请${connect} 后再点合并，或直接在 GitHub 上合并这张 PR（${hint}；私有仓库没有连接时对账读不到它）`;
    throw new HttpError(
      409,
      reconnect
        ? `PR #${prNumber} 要经 GitHub 合并，但团队的 GitHub 连接解不开（密钥换过或密文损坏）：${next}。`
        : `PR #${prNumber} 要经 GitHub 合并，但团队没有连接 GitHub：${next}。`,
    );
  }
  const token = access.token;
  if (mergingBuilds.has(row.id)) {
    throw new HttpError(409, `PR #${prNumber} 的合并请求正在进行，等它返回后再试。`);
  }
  mergingBuilds.add(row.id);
  try {
    const fetchImpl = deps.githubFetch ?? fetch;
    const page = await githubPull(fetchImpl, token, repoRef.owner, repoRef.repo, prNumber);
    const before = apiMergeGate(deps, row);
    if (before.todoRow.phase !== gate.todoRow.phase) {
      throw new HttpError(409, `读取 PR 期间任务相位已变为 ${before.todoRow.phase}，没有发起合并`);
    }
    const pull = page?.pull ?? null;
    const branch = conversationBranch(row.id);
    if (pull === null || !hasPullFields(pull) || pull.title === null || pull.headSha === null) {
      throw new HttpError(
        409,
        `读不到 PR #${prNumber} 在 GitHub 上的状态（网络、限流或 GitHub 连接失效），没有发起合并：稍后再试。`,
      );
    }
    if (pull.state === 'closed' && !pull.merged) {
      throw new HttpError(
        409,
        `PR #${prNumber} 在 GitHub 上已关闭且未合并，无法合并：重新打开它，或重新运行任务。`,
      );
    }
    if (!isOwnPull(pull, branch)) {
      throw new HttpError(
        409,
        `PR #${prNumber} 的 head 不是本任务在 ${repoRef.owner}/${repoRef.repo} 的工作分支「${branch}」，cairn 不合并它：请在 GitHub 上核对这张 PR。`,
      );
    }
    if (!WRITE_AUTHOR_ASSOCIATIONS.has(pull.authorAssociation ?? '')) {
      throw new HttpError(
        409,
        `PR #${prNumber} 的作者对仓库没有写权限（author_association ${githubText(pull.authorAssociation ?? '缺失')}），cairn 不经 API 合并它：请在 GitHub 上核对后合并（${hint}）。`,
      );
    }
    if (pull.baseRef !== pull.defaultBranch) {
      throw new HttpError(
        409,
        `PR #${prNumber} 的目标分支「${githubText(pull.baseRef)}」不是默认分支「${githubText(pull.defaultBranch)}」，cairn 只把改动合进默认分支：请在 GitHub 上核对这张 PR。`,
      );
    }
    if (pull.merged) {
      if (!gate.failed) {
        throw new HttpError(409, `PR #${prNumber} 已在 GitHub 合并，没有再发起合并：${hint}。`);
      }
      setTodoPhase(deps, row.todoId, 'review');
      insertMessageRow(deps, row.id, {
        id: newRecordId(),
        role: 'system',
        content: `PR #${prNumber} 已在 GitHub 合并：任务回到审核关口，cairn 对账核对后收尾（核对不上时在时间线说明）。`,
        createdAt: nowMs(),
      });
      return { delegated: true };
    }
    if (
      repoRef.owner.toLowerCase() === 'xiechimon' &&
      repoRef.repo.toLowerCase() === 'cairn' &&
      (pull.openerType !== 'User' ||
        !pull.openerLogin?.trim() ||
        pull.openerLogin.toLowerCase().endsWith('[bot]'))
    ) {
      throw new HttpError(
        409,
        `PR #${prNumber} cannot be squash merged by cairn: xiechimon/cairn requires a verified human opener. Return bot-opened PRs to the dispatcher for identity preparation and rebase via ~/.cairn/tools/merge-pr.sh; restore missing opener identity before retrying.`,
      );
    }
    const checkpoint = lastPushedCheckpoint(deps, row.id, { mergeSteps: true });
    if (checkpoint === null || !isFullSha(checkpoint)) {
      throw new HttpError(
        409,
        `本任务没有可核对的推送提交（执行步没回报有效的提交 SHA），cairn 不经 GitHub 合并 PR #${prNumber}：请在 GitHub 上核对后合并（${hint}），或重新运行任务。`,
      );
    }
    if (pull.headSha !== checkpoint) {
      throw new HttpError(
        409,
        `PR #${prNumber} 的 head 是 ${githubText(pull.headSha).slice(0, 7)}，不是本任务最后推送的提交 ${checkpoint.slice(0, 7)}：GitHub 可能还没同步刚推的提交（稍后再点），或分支上有了别的提交（有人推送，或点了 Update branch）。cairn 只合并它推送过的提交；请在 GitHub 上核对后合并（${hint}），或让任务再跑一轮。`,
      );
    }
    const titled = `${pull.title} (#${prNumber})`;
    const result = await githubMergePull(fetchImpl, token, repoRef.owner, repoRef.repo, prNumber, {
      sha: checkpoint,
      commitTitle: CLOSING_SHAPE.test(pull.title) ? `Merge pull request #${prNumber}` : titled,
      commitMessage: closingLine(before.todoRow, repoRef) ?? PLAIN_MERGE_BODY,
    });
    if (result.kind === 'rate-limited') {
      const { limit } = result;
      const when =
        limit.retryAfterSeconds !== null
          ? `，${limit.retryAfterSeconds} 秒后再试`
          : limit.resetAt !== null
            ? `，限流在 ${new Date(limit.resetAt).toISOString()} 解除`
            : '';
      throw new HttpError(
        409,
        `GitHub 限流，没有处理合并 PR #${prNumber} 的请求（HTTP ${limit.status}${when}）${result.message === '' ? '' : `：${githubText(result.message)}`}——稍后再点合并，或直接在那里合并（${hint}）`,
      );
    }
    if (result.kind === 'refused') {
      throw new HttpError(
        409,
        result.status === 401
          ? `GitHub 不认团队的 GitHub 连接（HTTP 401），PR #${prNumber} 没有合并：请重新连接 GitHub 后再点合并。`
          : `GitHub 拒绝合并 PR #${prNumber}（HTTP ${result.status}）${result.message === '' ? '' : `：${githubText(result.message)}`}——可在 GitHub 上处理后直接在那里合并（${hint}）`,
      );
    }
    const now = deps.db
      .select({ phase: todo.phase })
      .from(todo)
      .where(eq(todo.id, row.todoId))
      .get();
    const atGate = now?.phase === gate.todoRow.phase;
    if (atGate && gate.failed) setTodoPhase(deps, row.todoId, 'review');
    insertGateAnnouncement(deps, row.id, MERGE_ANNOUNCEMENT, actor);
    insertMessageRow(deps, row.id, {
      id: newRecordId(),
      role: 'system',
      content:
        result.kind === 'merged'
          ? `PR #${prNumber} 已由 cairn 经 GitHub 合并（squash，合并提交 ${githubText(result.sha).slice(0, 7)}）`
          : `已请 GitHub 合并 PR #${prNumber}，GitHub 没有明确答复（${unclearReason(result)}）。cairn 对账会读这张 PR：已合并就收尾；还开着就留在审核关口，可以再点合并。`,
      createdAt: nowMs(),
    });
    if (result.kind === 'merged' && atGate) finishTodoDone(deps, row.todoId, row.id);
    return { delegated: true };
  } finally {
    mergingBuilds.delete(row.id);
  }
}

const PLAN_REWRITE_PROMPT = buildPlanRewritePrompt();

const REVIEW_REVISE_PROMPT = `用户对方案提出审核反馈，结论含 blocking findings。审核结论：<{conclusion}>。\n\nBlocking findings（必须逐条修复）：\n{blockings}\n\n请忠实按反馈调整方案，输出更新后的 plan.md（覆盖 Context/Changes/Edge cases/Verification 四段），并在结尾一句话摘要本次调整了什么。${PLAN_PRIOR_ART_RULE}`;

function enqueueReviewRevision(
  deps: BuildDeps,
  args: { buildId: string; todoId: string; teamId: string; note: string; revisePrompt: string },
): void {
  setTodoPhase(deps, args.todoId, 'planning');
  insertMessageRow(deps, args.buildId, {
    id: newRecordId(),
    role: 'system',
    content: args.note,
    createdAt: nowMs(),
  });
  enqueueStep(deps, args.buildId, 'plan', args.teamId, args.revisePrompt);
}

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
  db.update(build).set({ errorMessage }).where(eq(build.id, buildRow.id)).run();
  if (stepRow.kind === 'build') {
    const changes = buildRow.changes;
    const files =
      changes == null
        ? undefined
        : (Array.isArray(changes) ? changes : changes.files).map((f) => f.path);
    insertMessageRow(deps, buildRow.id, {
      id: newRecordId(),
      role: 'system',
      content: buildFallbackReport({
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
  persistGateVerdict(deps, failedStep, todoRow, {
    stepFailed: true,
    extracted: false,
    blocked: false,
    report: report ?? reportedVerdictHeads(failedStep, { commit: failedStep.checkpointCommit }),
  });
  if (todoRow && canTransitionPhase(todoRow.phase, 'failed')) {
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

export function sweepAbandonedBuildSteps(deps: BuildDeps, now: number = nowMs()): void {
  const exitedLeftovers = deps.db
    .select({ id: step.id })
    .from(step)
    .innerJoin(build, eq(step.buildId, build.id))
    .innerJoin(todo, eq(build.todoId, todo.id))
    .where(
      and(
        inArray(todo.phase, ['closed', 'done']),
        inArray(step.status, ['pending', 'waiting_quota']),
      ),
    )
    .all();
  for (const { id } of exitedLeftovers) stopStepKeepPhase(deps, id);
  const candidates = deps.db
    .select()
    .from(step)
    .where(
      and(
        inArray(step.kind, ['plan', 'build', 'merge', 'review', 'verify']),
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
    const effectiveBeat = stepActivityAt(row);
    if (now - effectiveBeat > BUILD_ABANDONED_STEP_MS) {
      const machineRow = row.machineId
        ? deps.db.select().from(machine).where(eq(machine.id, row.machineId)).get()
        : undefined;
      const progressed =
        row.lastHeartbeatAt !== null && row.lastHeartbeatAt > (row.claimedAt ?? row.createdAt);
      if (machineRow === undefined || !machineRow.online || !progressed) {
        if (todoRow.phase === 'closed' || todoRow.phase === 'done') stopStepKeepPhase(deps, row.id);
        else releaseClaimedStep(deps, row, todoRow);
      }
    }
  }
}

function releaseClaimedStep(
  deps: BuildDeps,
  row: typeof step.$inferSelect,
  todoRow: typeof todo.$inferSelect,
): void {
  deps.db.update(step).set({ status: 'pending', machineId: null }).where(eq(step.id, row.id)).run();
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
  if (stepRow.kind === 'build') {
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
    if (outcome.hasChanges === false) return '构建零改动';
  }
  return null;
}

function latestPlanRow(
  deps: BuildDeps,
  buildId: string,
): { content: string; stepId: string | null } | undefined {
  return deps.db
    .select({ content: planTable.content, stepId: planTable.stepId })
    .from(planTable)
    .where(eq(planTable.buildId, buildId))
    .orderBy(desc(planTable.version))
    .get();
}

function planContractOfStep(
  deps: BuildDeps,
  stepRow: typeof step.$inferSelect,
): PlanContractCheck | null {
  const rewrite = isPlanContractRewritePrompt(stepRow.prompt);
  const latest = latestPlanRow(deps, stepRow.buildId);
  if (latest === undefined) return null;
  if (!rewrite && latest.stepId !== stepRow.id) return null;
  return checkPlanContract(latest.content);
}

const OPEN_DECISION_HEADING = /^(open questions|decisions needed|decision points)$/i;

export const PLAN_AUTO_CONFIRM_GRACE_MS = 10 * 60_000;

export function sweepPlanAutoConfirm(deps: BuildDeps, now: number = nowMs()): void {
  const waiting = deps.db.select().from(todo).where(eq(todo.phase, 'confirm')).all();
  for (const todoRow of waiting) {
    if (todoRow.latestBuildId === null || now - todoRow.phaseAt < PLAN_AUTO_CONFIRM_GRACE_MS) {
      continue;
    }
    const buildId = todoRow.latestBuildId;
    const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
    if (buildRow === undefined || buildRow.errorMessage !== null) continue;
    const liveStep = deps.db
      .select({ id: step.id })
      .from(step)
      .where(
        and(
          eq(step.buildId, buildId),
          inArray(step.status, ['pending', 'claimed', 'waiting_quota']),
        ),
      )
      .get();
    if (liveStep !== undefined) continue;
    const latestPlan = latestPlanRow(deps, buildId);
    if (latestPlan === undefined || !checkPlanContract(latestPlan.content).ok) continue;
    const planLines = latestPlan.content
      .replace(/\r\n?/g, '\n')
      .split('\n')
      .map((l) => l.trim());
    let openDecisions = false;
    for (let i = 0; i < planLines.length && !openDecisions; i++) {
      const name = (planLines[i] ?? '')
        .replace(/^#{1,6}\s+/, '')
        .replace(/\s+#+$/, '')
        .replace(/\*\*|__/g, '')
        .replace(/\s*[:：]$/, '')
        .trim();
      if (!OPEN_DECISION_HEADING.test(name)) continue;
      const own = /^(#{1,6})\s/.exec(planLines[i] ?? '')?.[1]?.length;
      const sectionLevel = own ?? (/^=+$/.test(planLines[i + 1] ?? '') ? 1 : 2);
      for (const next of planLines.slice(i + 1)) {
        if (next === '' || /^(=+|-+)$/.test(next)) continue;
        const nextLevel = /^(#{1,6})\s/.exec(next)?.[1]?.length;
        if (nextLevel !== undefined && nextLevel <= sectionLevel) break;
        if (/^([-*]\s*)?(none|n\/a|nothing)\.?$/i.test(next)) break;
        openDecisions = true;
        break;
      }
    }
    if (openDecisions) continue;
    const mergePolicy = projectMergeConfigSchema.parse({
      mergePolicy: projectOfTodo(deps.db, todoRow)?.autonomy?.mergePolicy,
    }).mergePolicy;
    if (mergePolicy === 'human' || childrenOfTodo(deps.db, todoRow.id).length > 0) continue;
    const latestFeedback = deps.db
      .select({ kind: buildFeedback.kind, side: buildFeedback.side })
      .from(buildFeedback)
      .where(eq(buildFeedback.buildId, buildId))
      .orderBy(desc(buildFeedback.createdAt), desc(buildFeedback.id))
      .get();
    if (latestFeedback?.kind === 'revision' && latestFeedback.side === 'plan') continue;
    const threadIds = [
      ...new Set(
        deps.db
          .select({ watches: chief.watches })
          .from(chief)
          .where(eq(chief.teamId, todoRow.teamId))
          .all()
          .flatMap((row) =>
            row.watches
              .filter((watch) => watch.todoId === todoRow.id)
              .map((watch) => watch.threadId),
          ),
      ),
    ];
    const pendingQuestion =
      threadIds.length > 0 &&
      deps.db
        .select({ content: chiefMessage.content })
        .from(chiefMessage)
        .where(inArray(chiefMessage.threadId, threadIds))
        .all()
        .some((row) => askQuestionContentOf(row.content)?.status === 'pending');
    if (pendingQuestion) continue;
    applyBuildConfirm(deps, buildId, 'server');
  }
}

export function completeStep(
  deps: BuildDeps,
  stepId: string,
  outcome: {
    hasChanges?: boolean;
    workBranchDrift?: { expected: string; actual: string };
    findings?: ReviewVerdict;
    findingsError?: string;
    verifyVerdict?: VerifyVerdict;
    verifyVerdictError?: string;
    report?: string;
    verdictReport?: VerdictReport;
  } = {},
): void {
  const stepRow = deps.db.select().from(step).where(eq(step.id, stepId)).get();
  if (!stepRow) throw new NotFoundError(`step ${stepId}`);
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) {
    deps.db
      .update(step)
      .set({ status: 'done', finishedAt: nowMs() })
      .where(eq(step.id, stepId))
      .run();
    return;
  }
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) {
    deps.db
      .update(step)
      .set({ status: 'done', finishedAt: nowMs() })
      .where(eq(step.id, stepId))
      .run();
    return;
  }
  const reserved = afterStopPhaseByBuild.get(buildRow.id);
  const staleBuild = todoRow.latestBuildId !== null && todoRow.latestBuildId !== buildRow.id;
  if (reserved !== undefined || staleBuild || hasLeftExecution(todoRow.phase)) {
    afterStopPhaseByBuild.delete(buildRow.id);
    deps.db
      .update(step)
      .set({ status: 'done', finishedAt: nowMs() })
      .where(eq(step.id, stepId))
      .run();
    if (reserved !== undefined && reserved !== 'keep') landReservedPhase(deps, todoRow, reserved);
    return;
  }
  const planContract = stepRow.kind === 'plan' ? planContractOfStep(deps, stepRow) : null;
  const gateFailure = stepArtifactGate(
    deps,
    stepRow,
    { ...outcome, output: todoRow.output },
    planContract,
  );
  if (gateFailure !== null) {
    const refuseDriftRecord =
      stepRow.kind === 'build' &&
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
    return;
  }
  if (stepRow.kind === 'build' && todoRow.output === 'info') {
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
  if (stepRow.kind === 'build') {
    const deliveredGithubPr = githubPrOf(deps, todoRow, buildRow.prNumber) !== null;
    if (!deliveredGithubPr) {
      setTodoPhase(deps, todoRow.id, 'review', {
        hasChanges: outcome.hasChanges ?? true,
      });
      maybeEnqueueVerifyStep(deps, todoRow, stepRow.buildId);
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
    const verdict: ReviewVerdict = outcome.findings ?? {
      conclusion: outcome.findingsError !== undefined ? '判定提取失败' : '审核未返回结论',
      findings: [],
    };
    deps.db
      .update(todo)
      .set({ hasChanges: false, v: todoRow.v + 1 })
      .where(eq(todo.id, todoRow.id))
      .run();
    const updatedTodo = getTodo(deps, todoRow.id);
    if (updatedTodo) deps.hub.publishTodoDoc(updatedTodo.teamId, updatedTodo);
    insertMessageRow(deps, buildRow.id, {
      id: newRecordId(),
      role: 'system',
      content: JSON.stringify({
        kind: REVIEW_VERDICT_KIND,
        stepId: stepRow.id,
        verdict,
        ...(outcome.findingsError !== undefined ? { extractionError: outcome.findingsError } : {}),
      }),
      createdAt: nowMs(),
    });
    persistGateVerdict(deps, stepRow, todoRow, {
      stepFailed: false,
      extracted: outcome.findings !== undefined,
      blocked: outcome.findings !== undefined && hasBlockingFinding(outcome.findings),
      report:
        outcome.verdictReport ??
        reportedVerdictHeads(stepRow, { commit: stepRow.checkpointCommit }),
    });
    if (hasBlockingFinding(verdict)) {
      const revisionInFlight = deps.db
        .select({ id: step.id })
        .from(step)
        .where(
          and(
            eq(step.buildId, stepRow.buildId),
            eq(step.kind, 'plan'),
            inArray(step.status, ['pending', 'claimed']),
          ),
        )
        .get();
      if (revisionInFlight === undefined) {
        const blockings = verdict.findings
          .filter((f) => f.severity === 'blocking')
          .map(
            (f) =>
              `- #${f.id} ${f.summary}${
                f.file !== undefined
                  ? ` (${f.file}${f.line !== undefined ? `:${f.line}` : ''})`
                  : ''
              }`,
          )
          .join('\n');
        const revisePrompt = REVIEW_REVISE_PROMPT.replace(
          '<{conclusion}>',
          verdict.conclusion,
        ).replace('{blockings}', blockings);
        enqueueReviewRevision(deps, {
          buildId: stepRow.buildId,
          todoId: todoRow.id,
          teamId: todoRow.teamId,
          note: `AI 审核检测到 ${blockings.split('\n').length} 处 blocking 风险，已自动入队重规划步`,
          revisePrompt,
        });
      }
    }
    return;
  }
  if (stepRow.kind === 'verify') {
    const latestPlan = latestPlanRow(deps, buildRow.id);
    const verdict: VerifyVerdict =
      outcome.verifyVerdict !== undefined
        ? reconcileVerifyVerdict(
            outcome.verifyVerdict,
            planVerificationItems(latestPlan?.content ?? ''),
          )
        : {
            passed: false,
            conclusion:
              outcome.verifyVerdictError !== undefined ? '判定提取失败' : '验证未返回结论',
            evidence: [],
          };
    insertMessageRow(deps, buildRow.id, {
      id: newRecordId(),
      role: 'system',
      content: JSON.stringify({
        kind: VERIFY_VERDICT_KIND,
        verdict,
        ...(outcome.verifyVerdictError !== undefined
          ? { extractionError: outcome.verifyVerdictError }
          : {}),
      }),
      createdAt: nowMs(),
    });
    persistGateVerdict(deps, stepRow, todoRow, {
      stepFailed: false,
      extracted: outcome.verifyVerdict !== undefined,
      blocked: outcome.verifyVerdict !== undefined && !verdict.passed,
      report:
        outcome.verdictReport ??
        reportedVerdictHeads(stepRow, { commit: stepRow.checkpointCommit }),
    });
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
      .where(and(eq(step.buildId, buildId), inArray(step.kind, ['build', 'plan'])))
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
  setTodoPhase(deps, todoId, 'done');
  insertMessageRow(deps, buildId, {
    id: newRecordId(),
    role: 'system',
    content: DONE_ROW,
    createdAt: nowMs(),
  });
  advanceSplitWaves(deps, todoId);
  emitRuntimeBuildSpan(deps.db, buildId, 'done');
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, todoId)).get();
  if (todoRow !== undefined) {
    const buildRow = deps.db.select().from(build).where(eq(build.id, buildId)).get();
    queuePushDigest(deps.db, deps.user.id, todoRow.teamId, {
      title: 'PR 已合并',
      body:
        buildRow?.prNumber != null
          ? `PR #${buildRow.prNumber} 已合并：#${todoRow.seqNum} ${todoRow.title}`
          : `#${todoRow.seqNum} ${todoRow.title}`,
      href: `/app/todo/${todoId}`,
      tag: `${deps.user.id}:${todoId}`,
    });
  }
  markFirstPrPromptDue(deps.db, buildId);
}

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`);
    this.name = 'NotFoundError';
  }
}
