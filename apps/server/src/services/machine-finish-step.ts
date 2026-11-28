import {
  assertSkillInjection,
  buildSecondPrWarningNote,
  CHANGES_DIFF_MAX_BYTES,
  classifyStepFailure,
  conversationBranch,
  type DocumentDiffFile,
  isBuildStepKind,
  type MachineDoneBody,
  parseLocalFolderActionInstruction,
  parseLocalMergeInstruction,
  parseRetryDelayMs,
  QUOTA_BLOCK_REASON_MAX_CHARS,
  RETRY_AFTER_MAX_MS,
  RETRY_AFTER_MIN_MS,
  SKILL_INJECTION_CHECK_KIND,
  type SkillInjectionFacts,
  secondPrWarningNoteRowId,
  skillFactsFromContents,
  WORKFLOW_PUSH_REFUSAL,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { runAfterCommit } from '../db/commit-effects.js';
import { build, machine, step, stopPending, todo } from '../db/schema.js';
import { conflict, HttpError } from '../lib/errors.js';
import { githubBranchPulls } from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import { emitRuntimeStepSpan } from '../runtime-otel.js';
import {
  agentTurnKind,
  chiefStepAgent,
  emitTurnRow,
  markTurnModelDead,
  readTurnTranscriptContents,
  recordTurnProviderOutcome,
  releaseStallRecoveryHold,
  requeueChiefStepOnFallback,
  requeueTurnStep,
  settleCoordinatorTurn,
} from './agent-turn-kernel.js';
import {
  applyStepFailure,
  applyStoppedStep,
  completeStep,
  enqueueStep,
  mergedPrElsewhere,
  noteDeliveredPlanResidual,
  settleParkedStep,
  toBuildRecord,
} from './builds.js';
import { releaseUnconsumedSteer } from './chief-turns.js';
import {
  buildCiFixPrompt,
  CI_FIX_PROMPT_HEAD,
  CI_FIX_ROUNDS_MAX,
  countMarkedRounds,
  deadLoopMessage,
} from './ci-loop.js';
import { recoverClaudeRateLimitFailure } from './claude-rate-limit.js';
import { recordStepUsage } from './coordinator-steps.js';
import { revokeStepGitCredential } from './credentials.js';
import { quotaHoldBackoffMs, quotaHoldNote } from './dispatch-timeouts.js';
import { diffTextNamesAFile, githubRepoOfProject, parseUnifiedDiff, projectOfTodo } from './git.js';
import { githubReadToken } from './github-autonomous-token.js';
import { applyLocalFolderActionReport } from './local-folder-action.js';
import { applyLocalMergeReport } from './local-merge.js';
import { claimGenerationAccepted } from './machine-claim-scope.js';
import { stopStepComputer } from './machine-computer.js';
import { failUnpublishedDeliverables } from './machine-deliverables.js';
import {
  isChiefConversation,
  type MachineDeps,
  ownedStep,
  profileForStep,
  publishStepStatus,
  stepTeamId,
  upsertMessage,
  withFencedTransaction,
} from './machine-deps.js';
import {
  applyMergeLanding,
  applySpaceLanding,
  MERGE_LANDING_SKIPPED,
  MERGE_NOT_LANDED_NOTE,
  mergeCardLeftReview,
} from './machine-merge-landing.js';
import {
  isZeroUsageSilentSuccess,
  planModelFallback,
  ranModel,
  ZERO_USAGE_FAILURE,
  ZERO_USAGE_RETRY_NOTE,
} from './model-fallback.js';
import { notifyModelFallback } from './notifications.js';
import { applyQuotaWaitStep } from './quota-wait.js';
import type { RouteProfile } from './routing-rules.js';
import { finishScheduledStep } from './schedules.js';
import { drainTaskMessageQueue } from './task-message-queue.js';

function emitSettledStepSpan(deps: MachineDeps, stepId: string): void {
  runAfterCommit(deps, 'emitRuntimeStepSpan', () => emitRuntimeStepSpan(deps.db, stepId));
}

function holdStepForQuota(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
  outcome: MachineDoneBody,
): void {
  const { db } = deps;
  const now = nowMs();
  const holdCount = stepRow.holdCount + 1;
  const parsedDelay = parseRetryDelayMs(outcome.errorMessage ?? '', now);
  const clampedDelay =
    parsedDelay !== null
      ? Math.max(RETRY_AFTER_MIN_MS, Math.min(parsedDelay, RETRY_AFTER_MAX_MS))
      : null;
  const backoffDelay = quotaHoldBackoffMs(holdCount);
  const delay =
    clampedDelay === null
      ? backoffDelay
      : holdCount > 1
        ? Math.max(clampedDelay, backoffDelay)
        : clampedDelay;
  const holdUntil = now + delay;
  db.update(step)
    .set({
      status: 'pending',
      machineId: null,
      holdReason: 'quota',
      holdUntil,
      holdCount,
      mcpGrant: null,
    })
    .where(eq(step.id, stepRow.id))
    .run();
  const note = quotaHoldNote(outcome.errorMessage ?? '', holdUntil);
  emitTurnRow(deps, stepRow, {
    id: `quota-hold-${stepRow.id}`,
    role: 'system',
    content: note,
    createdAt: nowMs(),
  });
  publishStepStatus(deps, stepRow.id);
  const teamId = stepTeamId(deps, stepRow);
  if (teamId !== null) deps.machineHub.wake(teamId);
}

function recordSkillInjectionCheck(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
  facts: SkillInjectionFacts,
): void {
  const chiefStep = agentTurnKind(stepRow) === 'coordinator';
  let skillsAllowlist: readonly string[] | null = null;
  let defaultSkill: string | null = null;
  let requested: string[] | undefined;
  if (!chiefStep) {
    const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
    const todoRow = buildRow
      ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
      : undefined;
    const agentRow = todoRow ? profileForStep(deps, todoRow, stepRow.kind, stepRow.id) : null;
    if (agentRow == null) return;
    skillsAllowlist = agentRow.skillsAllowlist ?? null;
    defaultSkill = agentRow.defaultSkill;
    if (stepRow.skillInjection == null) {
      requested = undefined;
    } else {
      const ids = stepRow.skillInjection.hits.map((h) => h.id);
      requested =
        defaultSkill == null || defaultSkill === ''
          ? ids
          : [defaultSkill, ...ids.filter((id) => id !== defaultSkill)];
    }
  }
  const contents = readTurnTranscriptContents(deps.db, stepRow);
  const verdict = assertSkillInjection({
    skillsAllowlist,
    defaultSkill,
    requested,
    names: facts,
    facts: skillFactsFromContents(contents),
  });
  emitTurnRow(deps, stepRow, {
    id: `skill-injection-${stepRow.id}`,
    role: 'system',
    content: JSON.stringify({
      kind: SKILL_INJECTION_CHECK_KIND,
      level: verdict.level,
      reds: verdict.reds,
      yellows: verdict.yellows,
      injected: facts.injected,
      omitted: facts.omitted,
      unrendered: facts.unrendered,
    }),
    createdAt: nowMs(),
  });
}

export async function finishStep(
  deps: MachineDeps,
  machineId: string | null,
  stepId: string,
  body: MachineDoneBody,
): Promise<void> {
  releaseStallRecoveryHold(deps, {
    stepId,
    machineId,
    expectedGeneration: body.generation,
    requireRecoveredTimestamp: true,
    requireMachineOwner: true,
  });
  const prepared = withFencedTransaction(deps, (settleDeps) =>
    prepareStepReport(settleDeps, machineId, stepId, body),
  );
  if ('changeFiles' in prepared) {
    await finishStepReport(deps, prepared.stepRow, body, prepared.changeFiles);
  }
  const buildToDrain = withFencedTransaction(deps, (settled) => {
    const row = settled.db.select().from(step).where(eq(step.id, stepId)).get();
    if (row === undefined || row.claimedAt !== prepared.stepRow.claimedAt) return null;
    stopStepComputer(settled, stepId);
    return row.kind !== 'review' && row.kind !== 'verify' && !isChiefConversation(row.buildId)
      ? row.buildId
      : null;
  });
  if (buildToDrain !== null) await drainTaskMessageQueue(deps, buildToDrain);
}

function prepareStepReport(
  deps: MachineDeps,
  machineId: string | null,
  stepId: string,
  body: MachineDoneBody,
) {
  const { db } = deps;
  const found = db.select().from(step).where(eq(step.id, stepId)).get();
  const recovered = found?.stallState?.lastRecoveredAt != null;
  if (recovered && found !== undefined && found.status !== 'claimed') {
    throw conflict(`step ${stepId} was recovered after stall`);
  }
  if (
    machineId !== null &&
    (!claimGenerationAccepted(
      db,
      machineId,
      found?.claimedAt ?? null,
      body.generation,
      recovered,
    ) ||
      (body.generation === undefined && found?.machineId !== machineId))
  ) {
    throw conflict(
      body.generation === undefined
        ? `step ${stepId} completion requires its claim generation`
        : `step ${stepId} was claimed again after generation ${body.generation}`,
    );
  }
  if (body.generation !== undefined && found?.claimedAt !== body.generation) {
    throw conflict(`step ${stepId} was claimed again after generation ${body.generation}`);
  }
  if (found && found.status !== 'claimed') {
    const released =
      machineId !== null &&
      found.machineId === null &&
      stepTeamId(deps, found) ===
        db.select({ teamId: machine.teamId }).from(machine).where(eq(machine.id, machineId)).get()
          ?.teamId;
    if (found.machineId === machineId || released) {
      if (found.machineId === machineId && found.claimedAt !== null) {
        failUnpublishedDeliverables(db, stepId, found.claimedAt);
      }
      revokeStepGitCredential(deps, stepId);
      if (body.status === 'failed') {
        noteDeliveredPlanResidual(
          deps,
          found,
          body.errorMessage?.trim() ? body.errorMessage : 'no reason reported',
        );
      }
      return { stepRow: found };
    }
  }
  const stepRow = ownedStep(deps, machineId, stepId);
  let changeFiles: DocumentDiffFile[] | undefined;
  if (body.changesDiff !== undefined && body.changesDiff.length <= CHANGES_DIFF_MAX_BYTES) {
    try {
      changeFiles = parseUnifiedDiff(body.changesDiff);
    } catch {
      throw new HttpError(400, 'invalid changesDiff: malformed unified diff');
    }
  }
  revokeStepGitCredential(deps, stepId);
  return { stepRow, changeFiles };
}

function assertCurrentStepClaim(deps: MachineDeps, stepRow: typeof step.$inferSelect): void {
  const current = deps.db.select().from(step).where(eq(step.id, stepRow.id)).get();
  if (
    current?.status !== 'claimed' ||
    current.machineId !== stepRow.machineId ||
    current.claimedAt !== stepRow.claimedAt
  ) {
    throw conflict(`step ${stepRow.id} was released or claimed again while its report was applied`);
  }
}

async function finishStepReport(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
  body: MachineDoneBody,
  changeFiles: DocumentDiffFile[] | undefined,
): Promise<void> {
  const { db } = deps;
  if (isBuildStepKind(stepRow.kind)) {
    const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
    const todoRow = buildRow
      ? db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
      : undefined;
    const project = todoRow ? projectOfTodo(db, todoRow) : null;
    const repo = project ? githubRepoOfProject(project) : null;
    if (repo !== null && todoRow) {
      const token = await githubReadToken(deps, todoRow.teamId, repo);
      const branch = conversationBranch(stepRow.buildId);
      const pulls = await githubBranchPulls(
        deps.githubFetch ?? fetch,
        token,
        repo.owner,
        repo.repo,
        {
          head: `${repo.owner}:${branch}`,
          state: 'open',
          ...(project?.baseBranch != null ? { base: project.baseBranch } : {}),
        },
      );
      const own = pulls
        ?.filter(
          (pull) =>
            pull.state === 'open' &&
            (project?.baseBranch == null || pull.baseRef === project.baseBranch) &&
            pull.headRef === branch &&
            pull.headRepoId !== null &&
            pull.headRepoId === pull.baseRepoId,
        )
        .sort((a, b) => b.number - a.number)[0];
      if (own)
        body = {
          ...body,
          prNumber: own.number,
          prUrl: `https://github.com/${repo.owner}/${repo.repo}/pull/${own.number}`,
        };
    }
  }
  let priorMerged: { prNumber: number; prUrl: string | null } | null = null;
  if (body.prUrl !== undefined && body.prNumber !== undefined) {
    const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
    if (buildRow) priorMerged = await mergedPrElsewhere(deps, buildRow.todoId, stepRow.buildId);
  }
  if (body.localMerge !== undefined) {
    if (body.status !== 'success')
      throw conflict('Local merge results require a successful command report');
    const localMerge = body.localMerge;
    withFencedTransaction(deps, (settleDeps) => {
      assertCurrentStepClaim(settleDeps, stepRow);
      applyLocalMergeReport(settleDeps, stepRow, localMerge);
    });
    return;
  }
  if (body.status === 'success' && parseLocalMergeInstruction(stepRow.prompt) !== null)
    throw conflict('Local merge command reported no landing result');
  if (body.localFolderAction !== undefined) {
    if (body.status !== 'success')
      throw conflict('Local folder action results require a successful command report');
    const localFolderAction = body.localFolderAction;
    withFencedTransaction(deps, (settleDeps) => {
      assertCurrentStepClaim(settleDeps, stepRow);
      applyLocalFolderActionReport(settleDeps, stepRow, localFolderAction);
    });
    return;
  }
  if (body.status === 'success' && parseLocalFolderActionInstruction(stepRow.prompt) !== null)
    throw conflict('Local folder action command reported no result');
  assertCurrentStepClaim(deps, stepRow);
  const mergeSuccess = stepRow.kind === 'merge' && body.status === 'success';
  let landingSkipped = mergeSuccess && mergeCardLeftReview(deps, stepRow);
  let landingError: string | null = null;
  if (mergeSuccess && !landingSkipped) {
    const landing = await applyMergeLanding(deps, stepRow, body.commit ?? null);
    if (landing === MERGE_LANDING_SKIPPED) landingSkipped = true;
    else landingError = landing;
  }
  let spaceNote: string | null = null;
  if (isBuildStepKind(stepRow.kind) && body.status === 'success') {
    const space = await applySpaceLanding(deps, stepRow, body.commit ?? null);
    if (space !== null && 'error' in space) landingError = space.error;
    else if (space !== null) spaceNote = space.note;
  }
  withFencedTransaction(deps, (settleDeps) => {
    assertCurrentStepClaim(settleDeps, stepRow);
    applyStepReport(settleDeps, {
      stepRow,
      body,
      changeFiles,
      priorMerged,
      landingSkipped,
      landingError,
      spaceNote,
    });
    if (stepRow.claimedAt !== null)
      failUnpublishedDeliverables(settleDeps.db, stepRow.id, stepRow.claimedAt);
  });
}

interface StepReport {
  stepRow: typeof step.$inferSelect;
  body: MachineDoneBody;
  changeFiles: DocumentDiffFile[] | undefined;
  priorMerged: { prNumber: number; prUrl: string | null } | null;
  landingSkipped: boolean;
  landingError: string | null;
  spaceNote: string | null;
}

function applyStepReport(deps: MachineDeps, report: StepReport): void {
  const { db } = deps;
  const { stepRow, body, changeFiles, priorMerged, landingSkipped, landingError, spaceNote } =
    report;
  const stepId = stepRow.id;
  {
    const teamId = stepTeamId(deps, stepRow);
    if (teamId !== null) deps.machineHub.wake(teamId);
  }
  if (landingSkipped) {
    upsertMessage(deps, {
      id: `merge-not-landed-${stepId}`,
      conversationId: stepRow.buildId,
      role: 'system',
      content: MERGE_NOT_LANDED_NOTE,
      createdAt: nowMs(),
    });
  }
  if (spaceNote !== null) {
    upsertMessage(deps, {
      id: `space-landed-${stepId}`,
      conversationId: stepRow.buildId,
      role: 'system',
      content: spaceNote,
      createdAt: nowMs(),
    });
  }
  if (body.plainFolder !== undefined) {
    upsertMessage(deps, {
      id: `plain-folder-state-${stepId}`,
      conversationId: stepRow.buildId,
      role: 'system',
      content: JSON.stringify({ kind: 'plain-folder-state', ...body.plainFolder }),
      createdAt: nowMs(),
    });
  }
  if (body.sessionId !== undefined) {
    db.update(step).set({ sessionId: body.sessionId }).where(eq(step.id, stepId)).run();
  }
  if (body.commit !== undefined) {
    db.update(step).set({ checkpointCommit: body.commit }).where(eq(step.id, stepId)).run();
  }
  {
    const sets: Partial<typeof build.$inferSelect> = {};
    if (body.prUrl !== undefined && body.prNumber !== undefined) {
      sets.prUrl = body.prUrl;
      sets.prNumber = body.prNumber;
    }
    if (changeFiles !== undefined) {
      sets.changes =
        changeFiles.length === 0 &&
        body.changesDiff !== undefined &&
        diffTextNamesAFile(body.changesDiff)
          ? { files: changeFiles, changed: true }
          : changeFiles;
    }
    if (Object.keys(sets).length > 0) {
      const updated = db.update(build).set(sets).where(eq(build.id, stepRow.buildId)).run();
      if (updated.changes > 0) {
        const row = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
        const todoRow = row
          ? db.select().from(todo).where(eq(todo.id, row.todoId)).get()
          : undefined;
        if (row && todoRow) deps.hub.publishBuildDoc(todoRow.teamId, toBuildRecord(row));
      }
    }
  }
  if (priorMerged !== null && body.prNumber !== undefined) {
    upsertMessage(deps, {
      id: secondPrWarningNoteRowId(stepRow.buildId),
      conversationId: stepRow.buildId,
      role: 'system',
      content: buildSecondPrWarningNote({
        prNumber: body.prNumber,
        mergedPrNumber: priorMerged.prNumber,
        mergedPrUrl: priorMerged.prUrl,
      }),
      createdAt: nowMs(),
    });
  }
  const isChiefTurn = agentTurnKind(stepRow) === 'coordinator';
  const stopAccepted =
    db
      .delete(stopPending)
      .where(eq(stopPending.stepId, stepId))
      .returning({ stepId: stopPending.stepId })
      .all().length > 0;
  const outcome: MachineDoneBody =
    landingError !== null
      ? { ...body, status: 'failed', errorMessage: landingError }
      : stopAccepted && body.status === 'failed' && isChiefTurn
        ? { ...body, status: 'stopped' }
        : body;
  recordStepUsage(deps, stepRow, outcome.usage ?? []);
  const worker = workerStepContext(deps, stepRow);
  if (
    db.select({ archiveStop: step.archiveStop }).from(step).where(eq(step.id, stepId)).get()
      ?.archiveStop != null
  ) {
    releaseUnconsumedSteer(db, stepRow);
    if (worker?.agentRow) recordTurnProviderOutcome(deps, stepRow, worker.agentRow, outcome, false);
    if (outcome.skillInjectionFacts !== undefined)
      recordSkillInjectionCheck(deps, stepRow, outcome.skillInjectionFacts);
    applyStoppedStep(deps, stepId);
    publishStepStatus(deps, stepId);
    emitSettledStepSpan(deps, stepId);
    return;
  }
  if (worker !== null && settleParkedStep(deps, stepRow, outcome)) {
    if (worker.agentRow)
      recordTurnProviderOutcome(
        deps,
        stepRow,
        worker.agentRow,
        outcome,
        isZeroUsageSilentSuccess(stepRow.kind, outcome),
      );
    if (outcome.skillInjectionFacts !== undefined)
      recordSkillInjectionCheck(deps, stepRow, outcome.skillInjectionFacts);
    emitSettledStepSpan(deps, stepId);
    return;
  }
  if (outcome.status === 'failed' && outcome.errorMessage === WORKFLOW_PUSH_REFUSAL) {
    applyStepFailure(deps, stepRow, WORKFLOW_PUSH_REFUSAL, body.preservedCommits);
    publishStepStatus(deps, stepId);
    emitSettledStepSpan(deps, stepId);
    return;
  }
  const zeroUsage = worker !== null && isZeroUsageSilentSuccess(stepRow.kind, outcome);
  if (worker?.agentRow) {
    recordTurnProviderOutcome(deps, stepRow, worker.agentRow, outcome, zeroUsage);
  }
  const chiefAgent = chiefStepAgent(deps, stepRow);
  if (chiefAgent !== null) {
    releaseUnconsumedSteer(db, stepRow);
    recordTurnProviderOutcome(deps, stepRow, chiefAgent, outcome, false);
  }
  if (requeueChiefStepOnFallback(deps, stepRow, chiefAgent, outcome)) return;
  const modelUnavailable =
    outcome.status === 'failed' &&
    classifyStepFailure(outcome.errorMessage ?? '') === 'model_unavailable';
  if (worker !== null && (!modelUnavailable || worker.agentRow?.routed === true)) {
    const plan = planModelFallback(deps, stepRow, worker.agentRow, outcome);
    if (plan !== null) {
      if (plan.trigger === 'model_unavailable') markTurnModelDead(deps, stepRow, plan.from);
      requeueTurnStep(deps, stepRow, plan.row, {
        id: `model-fallback-${stepRow.id}-${plan.row.tried.length}`,
        content: plan.note,
      });
      notifyModelFallback(deps, worker.todoRow, worker.agentRow, plan.note);
      return;
    }
  }
  if (recoverClaudeRateLimitFailure(deps, stepRow, outcome)) return;
  if (
    worker !== null &&
    outcome.status === 'failed' &&
    classifyStepFailure(outcome.errorMessage ?? '') === 'model_unavailable'
  ) {
    const ran = worker.agentRow ? ranModel(worker.agentRow, stepRow) : null;
    if (ran?.provider && ran.modelId)
      markTurnModelDead(deps, stepRow, { provider: ran.provider, modelId: ran.modelId });
    if (outcome.skillInjectionFacts !== undefined)
      recordSkillInjectionCheck(deps, stepRow, outcome.skillInjectionFacts);
    applyStepFailure(
      deps,
      stepRow,
      `${outcome.errorMessage ?? ''}\nModel ${ran?.modelId ?? 'unknown'} is unavailable.`,
      undefined,
      { code: 'model_unavailable' },
    );
    publishStepStatus(deps, stepId);
    emitSettledStepSpan(deps, stepId);
    return;
  }
  if (outcome.status === 'failed' && outcome.quotaBlock !== undefined) {
    applyQuotaWaitStep(deps, stepRow, outcome.quotaBlock);
    return;
  }
  if (outcome.status === 'failed' && classifyStepFailure(outcome.errorMessage ?? '') === 'quota') {
    holdStepForQuota(deps, stepRow, outcome);
    return;
  }
  if (
    outcome.status === 'failed' &&
    classifyStepFailure(outcome.errorMessage ?? '') === 'capacity'
  ) {
    const ranAgent = worker?.agentRow ?? chiefAgent;
    const ran = ranAgent ? ranModel(ranAgent, stepRow) : null;
    const retryAfterMs = parseRetryDelayMs(outcome.errorMessage ?? '') ?? undefined;
    applyQuotaWaitStep(deps, stepRow, {
      kind: 'capacity',
      providerId: ran?.provider ?? '',
      reason: (outcome.errorMessage ?? '').slice(0, QUOTA_BLOCK_REASON_MAX_CHARS),
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
    });
    return;
  }
  if (
    outcome.status === 'failed' &&
    classifyStepFailure(outcome.errorMessage ?? '') === 'model_unavailable'
  ) {
    const ranAgent = worker?.agentRow ?? chiefAgent;
    const ran = ranAgent ? ranModel(ranAgent, stepRow) : { provider: null, modelId: null };
    if (ran.provider && ran.modelId)
      markTurnModelDead(deps, stepRow, { provider: ran.provider, modelId: ran.modelId });
  }
  if (outcome.skillInjectionFacts !== undefined) {
    recordSkillInjectionCheck(deps, stepRow, outcome.skillInjectionFacts);
  }
  if (isChiefTurn) {
    settleCoordinatorTurn(deps, stepRow, outcome, {
      alreadyReleasedSteer: chiefAgent !== null,
      alreadyRecordedOutcome: chiefAgent !== null,
      skipFallback: true,
      chiefAgent,
    });
    return;
  }
  if (zeroUsage) {
    if (!(stepRow.fallback?.zeroUsageRetried ?? false)) {
      requeueTurnStep(
        deps,
        stepRow,
        {
          model: stepRow.fallback?.model ?? null,
          tried: stepRow.fallback?.tried ?? [],
          zeroUsageRetried: true,
        },
        { id: `zero-usage-retry-${stepRow.id}`, content: ZERO_USAGE_RETRY_NOTE },
      );
      return;
    }
    applyStepFailure(deps, stepRow, ZERO_USAGE_FAILURE, undefined, {
      code: 'silent_no_op',
    });
    publishStepStatus(deps, stepId);
    emitSettledStepSpan(deps, stepId);
    return;
  }
  if (
    isBuildStepKind(stepRow.kind) &&
    outcome.status === 'success' &&
    outcome.pushHookOutput !== undefined &&
    worker !== null &&
    worker.todoRow.phase === 'building' &&
    worker.todoRow.latestBuildId === stepRow.buildId
  ) {
    const rounds = countMarkedRounds(db, stepRow.buildId, CI_FIX_PROMPT_HEAD);
    if (rounds >= CI_FIX_ROUNDS_MAX) {
      applyStepFailure(deps, stepRow, deadLoopMessage(rounds), undefined, {
        code: 'gate_rejection',
      });
    } else {
      db.update(step).set({ status: 'done', finishedAt: nowMs() }).where(eq(step.id, stepId)).run();
      finishScheduledStep(deps, stepRow);
      const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
      const prompt =
        buildRow?.prNumber != null
          ? buildCiFixPrompt({
              prNumber: buildRow.prNumber,
              prUrl: buildRow.prUrl,
              round: rounds + 1,
              failures: [{ name: 'local pre-push hook', conclusion: 'failure', summary: null }],
            })
          : `${CI_FIX_PROMPT_HEAD} Local pre-push hook rejected the closing push (round ${rounds + 1}/${CI_FIX_ROUNDS_MAX}).`;
      enqueueStep(
        deps,
        stepRow.buildId,
        stepRow.kind,
        worker.todoRow.teamId,
        `${prompt}\n\n${outcome.pushHookOutput}\n\nFix the hook failures and push the same branch ${conversationBranch(stepRow.buildId)}. Do not create another branch or PR, bypass hooks, or merge the PR.`,
        undefined,
        undefined,
        { kind: 'ci-fix', trigger: 'pre-push', round: rounds + 1, roundsMax: CI_FIX_ROUNDS_MAX },
      );
    }
    publishStepStatus(deps, stepId);
    emitSettledStepSpan(deps, stepId);
    return;
  }
  if (outcome.status === 'success') {
    const complete = (completeDeps: MachineDeps) =>
      completeStep(completeDeps, stepId, {
        hasChanges: outcome.hasChanges,
        ...(outcome.workBranchDrift !== undefined
          ? { workBranchDrift: outcome.workBranchDrift }
          : {}),
        ...(outcome.unpushedCommits !== undefined
          ? { unpushedCommits: outcome.unpushedCommits }
          : {}),
      });
    complete(deps);
    publishStepStatus(deps, stepId);
    emitSettledStepSpan(deps, stepId);
    return;
  }
  if (outcome.status === 'stopped') {
    applyStoppedStep(deps, stepId);
    publishStepStatus(deps, stepId);
    emitSettledStepSpan(deps, stepId);
    return;
  }
  applyStepFailure(
    deps,
    stepRow,
    outcome.errorMessage ?? `step ${outcome.status}`,
    body.preservedCommits,
    { code: body.failureCode ?? null, detail: body.failureDetail ?? null },
  );
  publishStepStatus(deps, stepId);
  emitSettledStepSpan(deps, stepId);
}

function workerStepContext(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
): { todoRow: typeof todo.$inferSelect; agentRow: RouteProfile | null } | null {
  if (isChiefConversation(stepRow.buildId)) return null;
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return null;
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) return null;
  return { todoRow, agentRow: profileForStep(deps, todoRow, stepRow.kind, stepRow.id) };
}
