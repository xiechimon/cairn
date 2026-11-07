import type { MachineDoneBody } from '@cairn/shared';
import {
  CHIEF_TURN_ERROR_KIND,
  formatSkillRouteSection,
  suggestSkillsForMessage,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { type chiefThread, step } from '../db/schema.js';
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
import { recordChiefStop } from './chief-turns.js';
import { type MachineDeps, publishStepStatus, upsertChiefRow } from './machine-deps.js';
import { injectMemories } from './memory.js';
import { stepScopeProjectId } from './picked-project.js';
import { projectTurnContext } from './project-instructions.js';
import { scanLocalSkills } from './skills.js';

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
    .where(and(eq(step.id, stepRow.id), eq(step.status, 'pending')))
    .run();
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
  const memories = injectMemories(deps.db, {
    agentId,
    teamId: threadRow.teamId,
    threadId: threadRow.id,
    projectId: null,
  });
  const projectSection = digest
    ? null
    : projectTurnContext(deps.db, {
        teamId: threadRow.teamId,
        agentId,
        projectId: stepScopeProjectId(stepRow),
        threadId: threadRow.id,
      });
  const instruction =
    stepRow.prompt === null
      ? null
      : [stepRow.prompt, projectSection, routeSection].filter((part) => part).join('\n\n');
  return { digest, trigger, systemPrompt, memories, instruction };
}

export function finishCoordinatorTurn(
  deps: MachineDeps,
  stepRow: StepRow,
  outcome: MachineDoneBody,
): void {
  const { db } = deps;
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
  if (outcome.status === 'success') notifyChiefTurn(deps, stepRow.buildId, stepRow.prompt);
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
  emitRuntimeStepSpan(deps.db, stepRow.id);
}
