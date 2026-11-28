import {
  type AgentTurnKind,
  agentTurnKindOf,
  CHIEF_MODEL_FALLBACK_KIND,
  type ChiefModelFallbackContent,
  type MachineDoneBody,
  type OtelObservation,
  type StepKind,
  type TranscriptUserOrigin,
} from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import { runAfterCommit } from '../db/commit-effects.js';
import {
  chiefMessage,
  chiefThread,
  type MessageFileSource,
  message,
  type StepFallbackRow,
  step,
  stopPending,
} from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { fallbackAnnounced } from './chief-model-switch.js';
import { releaseUnconsumedSteer } from './chief-turns.js';
import { wakeCoordinator } from './coordinator-context.js';
import { finishCoordinatorTurn, recordStepUsage } from './coordinator-steps.js';
import { stopStepComputer } from './machine-computer.js';
import {
  isChiefConversation,
  type MachineDeps,
  publishStepStatus,
  stepTeamId,
  upsertChiefRow,
  upsertMessage,
} from './machine-deps.js';
import { modelKey, planModelFallback, ranModel, recordProviderOutcome } from './model-fallback.js';
import { markModelDead } from './model-liveness.js';
import { stepScopeProjectId } from './picked-project.js';
import { coordinatorProfile, type RouteProfile } from './routing-rules.js';
import { flushShield, shieldFor, stepClaimFacts } from './terminal-claims.js';

type StepRow = typeof step.$inferSelect;

export function agentTurnKind(stepRow: { kind: StepKind; buildId: string }): AgentTurnKind {
  return agentTurnKindOf(stepRow.kind, stepRow.buildId);
}

export function emitTurnRow(
  deps: MachineDeps,
  stepRow: Pick<StepRow, 'id' | 'buildId' | 'scopeProjectId' | 'prompt'>,
  row: {
    id: string;
    role: 'system' | 'user' | 'assistant';
    content: unknown;
    createdAt: number;
  },
  opts?: {
    origin?: TranscriptUserOrigin | null;
    flushChiefShield?: boolean;
    /** Server-stamped provenance; omitted or null clears any stamp a rewritten row carried. */
    fileSource?: MessageFileSource | null;
  },
): void {
  if (isChiefConversation(stepRow.buildId)) {
    if (opts?.flushChiefShield) {
      const rest = flushShield(deps.db, stepRow.id);
      if (rest !== '') deps.convHub?.publishTextDelta(stepRow.buildId, rest);
    }
    upsertChiefRow(deps, {
      id: row.id,
      threadId: stepRow.buildId,
      role: row.role,
      content: row.content,
      createdAt: row.createdAt,
      projectId: stepScopeProjectId(stepRow),
      ...(opts?.origin !== undefined ? { origin: opts.origin } : {}),
      ...(opts?.fileSource !== undefined ? { fileSource: opts.fileSource } : {}),
    });
    return;
  }
  upsertMessage(deps, {
    id: row.id,
    conversationId: stepRow.buildId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
    ...(opts?.origin !== undefined ? { origin: opts.origin } : {}),
    ...(opts?.fileSource !== undefined ? { fileSource: opts.fileSource } : {}),
  });
}

export function emitTurnTextDelta(deps: MachineDeps, stepRow: StepRow, text: string): void {
  if (text === '') return;
  if (!isChiefConversation(stepRow.buildId)) {
    deps.convHub?.publishTextDelta(stepRow.buildId, text);
    return;
  }
  const shielded = shieldFor(deps.db, stepRow.id, () => stepClaimFacts(deps.db, stepRow)).push(
    text,
  );
  if (shielded !== '') deps.convHub?.publishTextDelta(stepRow.buildId, shielded);
}

export function readTurnTranscriptContents(
  db: MachineDeps['db'],
  stepRow: Pick<StepRow, 'kind' | 'buildId'>,
): unknown[] {
  if (agentTurnKind(stepRow) === 'coordinator') {
    return db
      .select({ content: chiefMessage.content })
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, stepRow.buildId))
      .all()
      .map((row) => row.content);
  }
  return db
    .select({ content: message.content })
    .from(message)
    .where(eq(message.conversationId, stepRow.buildId))
    .all()
    .map((row) => row.content);
}

export function releaseStallRecoveryHold(
  deps: MachineDeps,
  opts: {
    stepId: string;
    machineId: string | null;
    expectedGeneration: number | undefined;
    requireRecoveredTimestamp?: boolean;
    requireMachineOwner?: boolean;
  },
): void {
  if (opts.requireMachineOwner && opts.machineId === null) return;
  const precheck = deps.db.select().from(step).where(eq(step.id, opts.stepId)).get();
  if (
    precheck === undefined ||
    precheck.status !== 'pending' ||
    precheck.holdReason !== 'stall_recovery' ||
    opts.expectedGeneration === undefined ||
    opts.expectedGeneration !== precheck.claimedAt ||
    (opts.requireRecoveredTimestamp && precheck.stallState?.lastRecoveredAt == null) ||
    precheck.stallState?.lastRecoveredFromMachineId !== opts.machineId
  ) {
    return;
  }
  const released = deps.db
    .update(step)
    .set({ holdReason: null, holdUntil: null })
    .where(
      and(
        eq(step.id, opts.stepId),
        eq(step.status, 'pending'),
        eq(step.holdReason, 'stall_recovery'),
      ),
    )
    .run();
  if (released.changes === 0) return;
  if (precheck.kind === 'chief') wakeCoordinator(precheck.buildId);
  if (opts.machineId !== null) {
    const teamId = stepTeamId(deps, precheck);
    if (teamId !== null) deps.machineHub?.wake(teamId);
  }
}

export function markTurnModelDead(
  deps: MachineDeps,
  stepRow: StepRow,
  model: { provider: string; modelId: string },
): void {
  const teamId = stepTeamId(deps, stepRow);
  if (teamId !== null) {
    runAfterCommit(deps, 'markModelDead', () =>
      markModelDead(teamId, model.provider, model.modelId),
    );
  }
}

export function recordTurnProviderOutcome(
  deps: MachineDeps,
  stepRow: StepRow,
  agent: RouteProfile,
  outcome: MachineDoneBody,
  silent: boolean,
  deferred = true,
): void {
  const teamId = stepTeamId(deps, stepRow);
  const { provider } = ranModel(agent, stepRow);
  if (deferred) {
    runAfterCommit(deps, 'recordProviderOutcome', () =>
      recordProviderOutcome(teamId, provider, outcome, silent),
    );
    return;
  }
  recordProviderOutcome(teamId, provider, outcome, silent);
}

export function requeueTurnStep(
  deps: MachineDeps,
  stepRow: StepRow,
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
      mcpGrant: null,
    })
    .where(eq(step.id, stepRow.id))
    .run();
  emitTurnRow(deps, stepRow, {
    id: note.id,
    role: 'system',
    content: note.content,
    createdAt: nowMs(),
  });
  publishStepStatus(deps, stepRow.id);
}

export function chiefStepAgent(deps: MachineDeps, stepRow: StepRow): RouteProfile | null {
  if (agentTurnKind(stepRow) !== 'coordinator') return null;
  const thread = deps.db
    .select({ teamId: chiefThread.teamId, projectId: chiefThread.projectId })
    .from(chiefThread)
    .where(eq(chiefThread.id, stepRow.buildId))
    .get();
  return thread ? coordinatorProfile(deps.db, thread.teamId, thread.projectId) : null;
}

export function requeueChiefStepOnFallback(
  deps: MachineDeps,
  stepRow: StepRow,
  agentRow: RouteProfile | null,
  outcome: MachineDoneBody,
): boolean {
  if (agentRow === null) return false;
  const plan = planModelFallback(deps, stepRow, agentRow, outcome);
  if (plan === null) return false;
  if (plan.trigger === 'model_unavailable') markTurnModelDead(deps, stepRow, plan.from);
  const content: ChiefModelFallbackContent = {
    kind: CHIEF_MODEL_FALLBACK_KIND,
    from: modelKey(plan.from),
    to: modelKey(plan.to),
    stepId: stepRow.id,
    announced: fallbackAnnounced(deps.db, stepRow.buildId, modelKey(plan.to)),
  };
  requeueTurnStep(deps, stepRow, plan.row, {
    id: `chief-fallback-${stepRow.id}-${plan.row.tried.length}`,
    content: JSON.stringify(content),
  });
  return true;
}

export function settleCoordinatorTurn(
  deps: MachineDeps,
  stepRow: StepRow,
  outcome: MachineDoneBody,
  opts?: {
    observation?: OtelObservation;
    recordUsage?: boolean;
    clearStopPending?: boolean;
    deferProviderOutcome?: boolean;
    alreadyReleasedSteer?: boolean;
    alreadyRecordedOutcome?: boolean;
    skipFallback?: boolean;
    chiefAgent?: RouteProfile | null;
    stopComputer?: boolean;
  },
): { fellBack: boolean } {
  if (opts?.recordUsage) recordStepUsage(deps, stepRow, outcome.usage ?? []);
  if (opts?.clearStopPending) {
    deps.db.delete(stopPending).where(eq(stopPending.stepId, stepRow.id)).run();
  }
  if (!opts?.alreadyReleasedSteer) releaseUnconsumedSteer(deps.db, stepRow);
  const chiefAgent =
    opts?.chiefAgent !== undefined ? opts.chiefAgent : chiefStepAgent(deps, stepRow);
  if (!opts?.alreadyRecordedOutcome && chiefAgent !== null) {
    recordTurnProviderOutcome(
      deps,
      stepRow,
      chiefAgent,
      outcome,
      false,
      opts?.deferProviderOutcome ?? false,
    );
  }
  if (!opts?.skipFallback && requeueChiefStepOnFallback(deps, stepRow, chiefAgent, outcome)) {
    if (opts?.stopComputer) stopStepComputer(deps, stepRow.id);
    return { fellBack: true };
  }
  finishCoordinatorTurn(deps, stepRow, outcome, opts?.observation);
  if (opts?.stopComputer) stopStepComputer(deps, stepRow.id);
  return { fellBack: false };
}
