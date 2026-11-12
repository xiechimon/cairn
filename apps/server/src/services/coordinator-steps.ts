import type { MachineDoneBody, ModelUsage, OtelObservation } from '@cairn/shared';
import {
  CHIEF_TURN_ERROR_KIND,
  formatSkillRouteSection,
  suggestSkillsForMessage,
} from '@cairn/shared';
import { and, eq, notInArray, sql } from 'drizzle-orm';
import {
  type chiefThread,
  chiefTurnUsage,
  coordinatorInput,
  step,
  tokenUsage,
} from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { emitRuntimeStepSpan } from '../runtime-otel.js';
import {
  chiefClaimContext,
  finishChiefTurn,
  notifyChiefTurn,
  parseChiefTrigger,
  recoverGateWake,
} from './chief.js';
import { CHIEF_DIGEST_SYSTEM_PROMPT, isChiefDigestStep } from './chief-digest.js';
import { cancelPendingQuestions } from './chief-questions.js';
import { recordChiefStop, steeredMessageScopes } from './chief-turns.js';
import { coordinatorRunsOnPi } from './coordinator-context.js';
import { openTurnCapture, sealCoordinatorTurnSnapshot } from './coordinator-turn-capture.js';
import {
  isChiefConversation,
  type MachineDeps,
  publishStepStatus,
  stepTeamId,
  upsertChiefRow,
} from './machine-deps.js';
import { injectMemoryDocuments } from './memory.js';
import { stepScopeProjectId } from './picked-project.js';
import { projectTurnContextTraced } from './project-instructions.js';
import { scanLocalSkills } from './skills.js';
import { costFromRates, ratesForModel } from './token-usage-cost.js';

type StepRow = typeof step.$inferSelect;
type ThreadRow = typeof chiefThread.$inferSelect;

export function claimPendingChiefStep(
  db: MachineDeps['db'],
  stepRow: StepRow,
  machineId: string | null,
): boolean {
  const claimedAt = nowMs();
  const res = db
    .update(step)
    .set({
      status: 'claimed',
      machineId,
      claimedAt,
      lastHeartbeatAt: claimedAt,
      holdReason: null,
      holdUntil: null,
    })
    .where(
      and(
        eq(step.id, stepRow.id),
        eq(step.status, 'pending'),
        notInArray(
          step.id,
          db
            .select({ id: coordinatorInput.id })
            .from(coordinatorInput)
            .where(eq(coordinatorInput.state, 'pending')),
        ),
      ),
    )
    .run();
  if (res.changes > 0) openTurnCapture(stepRow.id);
  return res.changes > 0;
}

export function chiefTurnContext(
  deps: MachineDeps,
  stepRow: StepRow,
  threadRow: ThreadRow,
  agentId: string,
) {
  const digest = isChiefDigestStep(stepRow);
  const ctx = digest ? null : chiefClaimContext(deps, threadRow.id);
  const trigger = parseChiefTrigger(stepRow.prompt);
  const systemPrompt = digest ? CHIEF_DIGEST_SYSTEM_PROMPT : (ctx?.systemPrompt ?? '');
  let routeSection = '';
  if (ctx && trigger === 'user') {
    const hint = suggestSkillsForMessage(
      stepRow.prompt ?? '',
      scanLocalSkills(deps.skillsDir).map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
      })),
    );
    if (hint) routeSection = formatSkillRouteSection(hint);
  }
  const injected = injectMemoryDocuments(deps.db, {
    agentId,
    teamId: threadRow.teamId,
    threadId: threadRow.id,
    projectId: null,
    recordUse: !digest,
  });
  const memories = [
    ...injected.memories.map(({ title, content }) => ({ title, content })),
    { title: '记忆文件', content: `${injected.fileCount} 个；用 memories 按需读取。` },
  ];
  const project = digest
    ? null
    : projectTurnContextTraced(deps.db, {
        teamId: threadRow.teamId,
        agentId,
        projectId: stepScopeProjectId(stepRow),
        threadId: threadRow.id,
      });
  const sections = [project?.text, routeSection].filter((part): part is string => !!part);
  const memoryTrace = {
    teamMemoryIds: ctx?.memoryIds ?? [],
    teamMemoriesOmitted: ctx?.memoriesOmitted ?? 0,
    projectMemoryIds: project?.memoryIds ?? [],
    projectMemoriesOmitted: project?.memoriesOmitted ?? 0,
  };
  const instruction =
    stepRow.prompt === null
      ? null
      : [stepRow.prompt, ...sections].filter((part) => part).join('\n\n');
  return { digest, trigger, systemPrompt, memories, instruction, sections, memoryTrace };
}

export function finishCoordinatorTurn(
  deps: MachineDeps,
  stepRow: StepRow,
  outcome: MachineDoneBody,
  observation?: OtelObservation,
): void {
  const { db } = deps;
  try {
    const teamId = stepTeamId(deps, stepRow);
    if (teamId !== null) sealCoordinatorTurnSnapshot(db, stepRow, teamId, outcome.status, nowMs());
  } catch {}
  db.update(step)
    .set({
      status:
        outcome.status === 'success' ? 'done' : outcome.status === 'stopped' ? 'stopped' : 'failed',
      ...(outcome.status === 'stopped' ? { finishedAt: nowMs() } : {}),
    })
    .where(eq(step.id, stepRow.id))
    .run();
  if (outcome.status === 'stopped') recordChiefStop(deps, stepRow);
  publishStepStatus(deps, stepRow.id);
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
  if (outcome.status === 'success')
    notifyChiefTurn(
      deps,
      stepRow.buildId,
      stepRow.prompt,
      steeredMessageScopes(deps.db, stepRow).length > 0,
    );
  if (outcome.status === 'failed') recoverGateWake(deps, stepRow);
  if (outcome.status === 'failed' && outcome.errorMessage) {
    upsertChiefRow(deps, {
      id: `chief-err-${stepRow.id}`,
      threadId: stepRow.buildId,
      role: 'system',
      content: JSON.stringify({ kind: CHIEF_TURN_ERROR_KIND, message: outcome.errorMessage }),
      createdAt: nowMs(),
    });
  }
  emitRuntimeStepSpan(deps.db, stepRow.id, process.env, observation);
}

export function recordStepUsage(
  deps: MachineDeps,
  stepRow: StepRow,
  usage: readonly ModelUsage[],
): void {
  const { db } = deps;
  const usageTeamId = stepTeamId(deps, stepRow);
  for (const u of usage) {
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
    if (
      coordinatorRunsOnPi() &&
      stepRow.kind === 'chief' &&
      isChiefConversation(stepRow.buildId) &&
      !isChiefDigestStep(stepRow)
    ) {
      db.insert(chiefTurnUsage)
        .values({
          stepId: stepRow.id,
          threadId: stepRow.buildId,
          model: u.model,
          input: u.input,
          output: u.output,
          cacheRead: u.cacheRead,
          cacheWrite: u.cacheWrite,
          ttftMs: u.ttftMs ?? null,
          contextTokens: u.contextTokens ?? null,
          createdAt: nowMs(),
        })
        .onConflictDoUpdate({
          target: [chiefTurnUsage.stepId, chiefTurnUsage.model],
          set: {
            input: sql`${chiefTurnUsage.input} + ${u.input}`,
            output: sql`${chiefTurnUsage.output} + ${u.output}`,
            cacheRead: sql`${chiefTurnUsage.cacheRead} + ${u.cacheRead}`,
            cacheWrite: sql`${chiefTurnUsage.cacheWrite} + ${u.cacheWrite}`,
            ttftMs: sql`coalesce(${chiefTurnUsage.ttftMs}, ${u.ttftMs ?? null})`,
            contextTokens: sql`coalesce(${u.contextTokens ?? null}, ${chiefTurnUsage.contextTokens})`,
          },
        })
        .run();
    }
  }
}
