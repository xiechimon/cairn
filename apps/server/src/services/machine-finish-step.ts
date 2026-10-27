import type { MachineDoneBody } from '@cairn/shared';
import {
  assertSkillInjection,
  buildSecondPrWarningNote,
  CHANGES_DIFF_MAX_BYTES,
  CHIEF_MODEL_FALLBACK_KIND,
  CHIEF_TURN_ERROR_KIND,
  type ChiefModelFallbackContent,
  classifyStepFailure,
  conversationBranch,
  QUOTA_BLOCK_REASON_MAX_CHARS,
  SKILL_INJECTION_CHECK_KIND,
  type SkillInjectionFacts,
  secondPrWarningNoteRowId,
  skillFactsFromContents,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import {
  type agent,
  agent as agentTable,
  build,
  chief,
  chiefMessage,
  chiefThread,
  machine,
  message,
  type StepFallbackRow,
  step,
  stopPending,
  todo,
  tokenUsage,
} from '../db/schema.js';
import { conflict } from '../lib/errors.js';
import { githubBranchPulls } from '../lib/github.js';
import { nowMs } from '../lib/ids.js';
import { emitRuntimeStepSpan } from '../runtime-otel.js';
import {
  applyStepFailure,
  applyStoppedStep,
  completeStep,
  enqueueStep,
  mergedPrElsewhere,
  noteDeliveredPlanResidual,
  reportedVerdictHeads,
  toBuildRecord,
} from './builds.js';
import { finishChiefTurn, notifyChiefTurn, recoverGateWake } from './chief.js';
import { cancelPendingQuestions } from './chief-questions.js';
import { recordChiefStop, releaseUnconsumedSteer } from './chief-turns.js';
import {
  buildCiFixPrompt,
  CI_FIX_PROMPT_HEAD,
  CI_FIX_ROUNDS_MAX,
  countMarkedRounds,
  deadLoopMessage,
} from './ci-loop.js';
import { revokeStepGitCredential } from './credentials.js';
import { quotaHoldBackoffMs, quotaHoldNote } from './dispatch-timeouts.js';
import { diffTextNamesAFile, githubRepoOfProject, parseUnifiedDiff, projectOfTodo } from './git.js';
import { githubTokenOrNull } from './github-connection.js';
import {
  agentForStep,
  isChiefConversation,
  type MachineDeps,
  ownedStep,
  publishStepStatus,
  stepTeamId,
  upsertChiefRow,
  upsertMessage,
} from './machine-deps.js';
import {
  applyMergeLanding,
  MERGE_LANDING_SKIPPED,
  MERGE_NOT_LANDED_NOTE,
  mergeCardLeftReview,
} from './machine-merge-landing.js';
import {
  effectiveModel,
  isZeroUsageSilentSuccess,
  modelKey,
  planModelFallback,
  recordProviderOutcome,
  ZERO_USAGE_FAILURE,
  ZERO_USAGE_RETRY_NOTE,
} from './model-fallback.js';
import { markModelDead } from './model-liveness.js';
import { notifyModelFallback } from './notifications.js';
import { applyQuotaWaitStep } from './quota-wait.js';
import { costFromRates, ratesForModel } from './token-usage-cost.js';

function holdStepForQuota(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
  outcome: MachineDoneBody,
): void {
  const { db } = deps;
  const holdCount = stepRow.holdCount + 1;
  const holdUntil = nowMs() + quotaHoldBackoffMs(holdCount);
  db.update(step)
    .set({ status: 'pending', machineId: null, holdReason: 'quota', holdUntil, holdCount })
    .where(eq(step.id, stepRow.id))
    .run();
  const note = quotaHoldNote(outcome.errorMessage ?? '', holdUntil);
  if (isChiefConversation(stepRow.buildId)) {
    upsertChiefRow(deps, {
      id: `quota-hold-${stepRow.id}`,
      threadId: stepRow.buildId,
      role: 'system',
      content: note,
      createdAt: nowMs(),
    });
  } else {
    upsertMessage(deps, {
      id: `quota-hold-${stepRow.id}`,
      conversationId: stepRow.buildId,
      role: 'system',
      content: note,
      createdAt: nowMs(),
    });
  }
  publishStepStatus(deps, stepRow.id);
  const teamId = stepTeamId(deps, stepRow);
  if (teamId !== null) deps.machineHub.wake(teamId);
}

function recordSkillInjectionCheck(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
  facts: SkillInjectionFacts,
): void {
  const chiefStep = stepRow.kind === 'chief' && isChiefConversation(stepRow.buildId);
  let skillsAllowlist: readonly string[] | null = null;
  let defaultSkill: string | null = null;
  let requested: string[] | undefined;
  if (!chiefStep) {
    const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
    const todoRow = buildRow
      ? deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
      : undefined;
    const agentRow = todoRow ? agentForStep(deps, todoRow, stepRow.kind, stepRow.prompt) : null;
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
  const contents = (
    chiefStep
      ? deps.db
          .select({ content: chiefMessage.content })
          .from(chiefMessage)
          .where(eq(chiefMessage.threadId, stepRow.buildId))
          .all()
      : deps.db
          .select({ content: message.content })
          .from(message)
          .where(eq(message.conversationId, stepRow.buildId))
          .all()
  ).map((row) => row.content);
  const verdict = assertSkillInjection({
    skillsAllowlist,
    defaultSkill,
    requested,
    names: facts,
    facts: skillFactsFromContents(contents),
  });
  const row = {
    id: `skill-injection-${stepRow.id}`,
    role: 'system' as const,
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
  };
  if (chiefStep) upsertChiefRow(deps, { ...row, threadId: stepRow.buildId });
  else upsertMessage(deps, { ...row, conversationId: stepRow.buildId });
}

export async function finishStep(
  deps: MachineDeps,
  machineId: string,
  stepId: string,
  body: MachineDoneBody,
): Promise<void> {
  const { db } = deps;
  const found = db.select().from(step).where(eq(step.id, stepId)).get();
  if (found && found.status !== 'claimed') {
    const released =
      found.machineId === null &&
      stepTeamId(deps, found) ===
        db.select({ teamId: machine.teamId }).from(machine).where(eq(machine.id, machineId)).get()
          ?.teamId;
    if (found.machineId === machineId || released) {
      revokeStepGitCredential(deps, stepId);
      if (body.status === 'failed') {
        noteDeliveredPlanResidual(
          deps,
          found,
          body.errorMessage?.trim() ? body.errorMessage : 'no reason reported',
        );
      }
      return;
    }
  }
  const stepRow = ownedStep(deps, machineId, stepId);
  revokeStepGitCredential(deps, stepId);
  if (stepRow.kind === 'build') {
    const buildRow = db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
    const todoRow = buildRow
      ? db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get()
      : undefined;
    const project = todoRow ? projectOfTodo(db, todoRow) : null;
    const repo = project ? githubRepoOfProject(project) : null;
    if (repo !== null && todoRow) {
      const token = await githubTokenOrNull(deps, todoRow.teamId);
      const branch = conversationBranch(stepRow.buildId);
      const pulls = await githubBranchPulls(
        deps.githubFetch ?? fetch,
        token,
        repo.owner,
        repo.repo,
        { head: `${repo.owner}:${branch}`, state: 'open' },
      );
      const own = pulls
        ?.filter(
          (pull) =>
            pull.state === 'open' &&
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
  const mergeSuccess = stepRow.kind === 'merge' && body.status === 'success';
  let landingSkipped = mergeSuccess && mergeCardLeftReview(deps, stepRow);
  let landingError: string | null = null;
  if (mergeSuccess && !landingSkipped) {
    const landing = await applyMergeLanding(deps, stepRow, body.commit ?? null);
    if (landing === MERGE_LANDING_SKIPPED) landingSkipped = true;
    else landingError = landing;
  }
  {
    const current = db.select().from(step).where(eq(step.id, stepId)).get();
    if (
      current?.status !== 'claimed' ||
      current.machineId !== machineId ||
      current.claimedAt !== stepRow.claimedAt
    ) {
      throw conflict(`step ${stepId} was released or claimed again while its report was applied`);
    }
  }
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
    if (body.changesDiff !== undefined && body.changesDiff.length <= CHANGES_DIFF_MAX_BYTES) {
      const files = parseUnifiedDiff(body.changesDiff);
      sets.changes =
        files.length === 0 && diffTextNamesAFile(body.changesDiff)
          ? { files, changed: true }
          : files;
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
  const outcome: MachineDoneBody =
    landingError !== null ? { ...body, status: 'failed', errorMessage: landingError } : body;
  const usageTeamId = stepTeamId(deps, stepRow);
  for (const u of outcome.usage ?? []) {
    const prior = db
      .select()
      .from(tokenUsage)
      .where(and(eq(tokenUsage.buildId, stepRow.buildId), eq(tokenUsage.model, u.model)))
      .get();
    const tokens = {
      input: (prior?.input ?? 0) + u.input,
      output: (prior?.output ?? 0) + u.output,
      cacheRead: (prior?.cacheRead ?? 0) + u.cacheRead,
      cacheWrite: (prior?.cacheWrite ?? 0) + u.cacheWrite,
    };
    const rates = ratesForModel(db, usageTeamId, u.model);
    const reported = u.cost;
    const cost = rates
      ? costFromRates(tokens, rates)
      : reported !== undefined &&
          (reported.input !== 0 ||
            reported.output !== 0 ||
            reported.cacheRead !== 0 ||
            reported.cacheWrite !== 0 ||
            reported.total !== 0)
        ? {
            costInput: (prior?.costInput ?? 0) + reported.input,
            costOutput: (prior?.costOutput ?? 0) + reported.output,
            costCacheRead: (prior?.costCacheRead ?? 0) + reported.cacheRead,
            costCacheWrite: (prior?.costCacheWrite ?? 0) + reported.cacheWrite,
            costTotal: (prior?.costTotal ?? 0) + reported.total,
          }
        : null;
    db.insert(tokenUsage)
      .values({
        buildId: stepRow.buildId,
        model: u.model,
        ...tokens,
        costInput: cost?.costInput ?? null,
        costOutput: cost?.costOutput ?? null,
        costCacheRead: cost?.costCacheRead ?? null,
        costCacheWrite: cost?.costCacheWrite ?? null,
        costTotal: cost?.costTotal ?? null,
      })
      .onConflictDoUpdate({
        target: [tokenUsage.buildId, tokenUsage.model],
        set: cost === null ? tokens : { ...tokens, ...cost },
      })
      .run();
  }
  db.delete(stopPending).where(eq(stopPending.conversationId, stepRow.buildId)).run();
  const worker = workerStepContext(deps, stepRow);
  const zeroUsage = worker !== null && isZeroUsageSilentSuccess(stepRow.kind, outcome);
  if (worker?.agentRow) {
    recordProviderOutcome(effectiveModel(worker.agentRow, stepRow).provider, outcome, zeroUsage);
  }
  const chiefAgent = chiefStepAgent(deps, stepRow);
  if (chiefAgent !== null) {
    releaseUnconsumedSteer(db, stepRow);
    recordProviderOutcome(effectiveModel(chiefAgent, stepRow).provider, outcome, false);
    const plan = planModelFallback(db, stepRow, chiefAgent, outcome);
    if (plan !== null) {
      if (plan.trigger === 'model_unavailable') {
        markModelDead(plan.from.provider, plan.from.modelId);
      }
      const content: ChiefModelFallbackContent = {
        kind: CHIEF_MODEL_FALLBACK_KIND,
        from: modelKey(plan.from),
        to: modelKey(plan.to),
        stepId: stepRow.id,
      };
      requeueStep(deps, stepRow, plan.row, {
        id: `chief-fallback-${stepRow.id}-${plan.row.tried.length}`,
        content: JSON.stringify(content),
      });
      return;
    }
  }
  if (worker !== null) {
    const plan = planModelFallback(db, stepRow, worker.agentRow, outcome);
    if (plan !== null) {
      if (plan.trigger === 'model_unavailable') {
        markModelDead(plan.from.provider, plan.from.modelId);
      }
      requeueStep(deps, stepRow, plan.row, {
        id: `model-fallback-${stepRow.id}-${plan.row.tried.length}`,
        content: plan.note,
      });
      notifyModelFallback(deps, worker.todoRow, worker.agentRow, plan.note);
      return;
    }
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
    const ran = ranAgent ? effectiveModel(ranAgent, stepRow) : null;
    applyQuotaWaitStep(deps, stepRow, {
      kind: 'capacity',
      providerId: ran?.provider ?? '',
      reason: (outcome.errorMessage ?? '').slice(0, QUOTA_BLOCK_REASON_MAX_CHARS),
    });
    return;
  }
  if (
    outcome.status === 'failed' &&
    classifyStepFailure(outcome.errorMessage ?? '') === 'model_unavailable'
  ) {
    const ranAgent = worker?.agentRow ?? chiefAgent;
    const ran = ranAgent ? effectiveModel(ranAgent, stepRow) : { provider: null, modelId: null };
    if (ran.provider && ran.modelId) markModelDead(ran.provider, ran.modelId);
  }
  if (outcome.skillInjectionFacts !== undefined) {
    recordSkillInjectionCheck(deps, stepRow, outcome.skillInjectionFacts);
  }
  if (stepRow.kind === 'chief' && isChiefConversation(stepRow.buildId)) {
    db.update(step)
      .set({
        status:
          outcome.status === 'success'
            ? 'done'
            : outcome.status === 'stopped'
              ? 'stopped'
              : 'failed',
        ...(outcome.status === 'stopped' ? { finishedAt: nowMs() } : {}),
      })
      .where(eq(step.id, stepId))
      .run();
    if (outcome.status === 'stopped') recordChiefStop(deps, stepRow);
    publishStepStatus(deps, stepId);
    cancelPendingQuestions(
      {
        db: deps.db,
        hub: deps.hub,
        user: deps.user,
        ...(deps.convHub !== undefined ? { convHub: deps.convHub } : {}),
      },
      stepRow.buildId,
      '回合已结束',
    );
    finishChiefTurn(deps, stepRow.buildId, outcome);
    if (outcome.status === 'success') notifyChiefTurn(deps, stepRow.buildId, stepRow.prompt);
    if (outcome.status === 'failed') recoverGateWake(deps, stepRow);
    if (outcome.status === 'failed' && outcome.errorMessage) {
      upsertChiefRow(deps, {
        id: `chief-err-${stepId}`,
        threadId: stepRow.buildId,
        role: 'system',
        content: JSON.stringify({ kind: CHIEF_TURN_ERROR_KIND, message: outcome.errorMessage }),
        createdAt: nowMs(),
      });
    }
    emitRuntimeStepSpan(deps.db, stepId);
    return;
  }
  const verdictReport = reportedVerdictHeads(stepRow, {
    gateHeadSha: body.gateHeadSha,
    commit: body.commit,
  });
  if (zeroUsage) {
    if (!(stepRow.fallback?.zeroUsageRetried ?? false)) {
      requeueStep(
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
    applyStepFailure(deps, stepRow, ZERO_USAGE_FAILURE, verdictReport);
    publishStepStatus(deps, stepId);
    emitRuntimeStepSpan(deps.db, stepId);
    return;
  }
  if (
    stepRow.kind === 'build' &&
    outcome.status === 'success' &&
    outcome.pushHookOutput !== undefined &&
    worker !== null &&
    worker.todoRow.phase === 'building' &&
    worker.todoRow.latestBuildId === stepRow.buildId
  ) {
    const rounds = countMarkedRounds(db, stepRow.buildId, CI_FIX_PROMPT_HEAD);
    if (rounds >= CI_FIX_ROUNDS_MAX) {
      applyStepFailure(deps, stepRow, deadLoopMessage(rounds), verdictReport);
    } else {
      db.update(step).set({ status: 'done', finishedAt: nowMs() }).where(eq(step.id, stepId)).run();
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
        'build',
        worker.todoRow.teamId,
        `${prompt}\n\n${outcome.pushHookOutput}\n\nFix the hook failures and push the same branch ${conversationBranch(stepRow.buildId)}. Do not create another branch or PR, bypass hooks, or merge the PR.`,
      );
    }
    publishStepStatus(deps, stepId);
    emitRuntimeStepSpan(deps.db, stepId);
    return;
  }
  if (outcome.status === 'success') {
    completeStep(deps, stepId, {
      hasChanges: outcome.hasChanges,
      ...(outcome.workBranchDrift !== undefined
        ? { workBranchDrift: outcome.workBranchDrift }
        : {}),
      ...(outcome.findings !== undefined ? { findings: outcome.findings } : {}),
      ...(outcome.findingsError !== undefined ? { findingsError: outcome.findingsError } : {}),
      ...(outcome.verifyVerdict !== undefined ? { verifyVerdict: outcome.verifyVerdict } : {}),
      ...(outcome.verifyVerdictError !== undefined
        ? { verifyVerdictError: outcome.verifyVerdictError }
        : {}),
      ...(outcome.report !== undefined ? { report: outcome.report } : {}),
      verdictReport,
    });
    publishStepStatus(deps, stepId);
    emitRuntimeStepSpan(deps.db, stepId);
    return;
  }
  if (outcome.status === 'stopped') {
    applyStoppedStep(deps, stepId);
    publishStepStatus(deps, stepId);
    emitRuntimeStepSpan(deps.db, stepId);
    return;
  }
  applyStepFailure(
    deps,
    stepRow,
    outcome.errorMessage ?? `step ${outcome.status}`,
    verdictReport,
    body.preservedCommits,
  );
  publishStepStatus(deps, stepId);
  emitRuntimeStepSpan(deps.db, stepId);
}

function workerStepContext(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
): { todoRow: typeof todo.$inferSelect; agentRow: typeof agent.$inferSelect | null } | null {
  if (isChiefConversation(stepRow.buildId)) return null;
  const buildRow = deps.db.select().from(build).where(eq(build.id, stepRow.buildId)).get();
  if (!buildRow) return null;
  const todoRow = deps.db.select().from(todo).where(eq(todo.id, buildRow.todoId)).get();
  if (!todoRow) return null;
  return { todoRow, agentRow: agentForStep(deps, todoRow, stepRow.kind, stepRow.prompt) };
}

function requeueStep(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
  fallback: StepFallbackRow,
  note: { id: string; content: string },
): void {
  deps.db
    .update(step)
    .set({
      status: 'pending',
      machineId: null,
      sessionId: null,
      fallback,
      holdReason: null,
      holdUntil: null,
    })
    .where(eq(step.id, stepRow.id))
    .run();
  const noteRow = {
    id: note.id,
    role: 'system' as const,
    content: note.content,
    createdAt: nowMs(),
  };
  if (isChiefConversation(stepRow.buildId)) {
    upsertChiefRow(deps, { ...noteRow, threadId: stepRow.buildId });
  } else {
    upsertMessage(deps, { ...noteRow, conversationId: stepRow.buildId });
  }
  publishStepStatus(deps, stepRow.id);
}

function chiefStepAgent(
  deps: MachineDeps,
  stepRow: typeof step.$inferSelect,
): typeof agent.$inferSelect | null {
  if (stepRow.kind !== 'chief' || !isChiefConversation(stepRow.buildId)) return null;
  const row = deps.db
    .select({ agentRow: agentTable })
    .from(chiefThread)
    .innerJoin(chief, eq(chiefThread.chiefId, chief.id))
    .innerJoin(agentTable, eq(chief.agentId, agentTable.id))
    .where(eq(chiefThread.id, stepRow.buildId))
    .get();
  return row?.agentRow ?? null;
}
