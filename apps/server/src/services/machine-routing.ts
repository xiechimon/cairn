import { claudeLoginBlocksClaim, claudeRateBlock } from '@cairn/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type agent, type build, type machine, step } from '../db/schema.js';
import { claudeUsageGatePasses } from './claude-rate-limit.js';
import { hasActiveClaudeSubscription } from './claude-subscriptions.js';
import {
  type MachineIneligibility,
  machineEligibility,
  stepRuntimeFor,
} from './dispatch-eligibility.js';

export const SESSION_GRACE_MS = 5 * 60_000;
export const OVERFLOW_AFTER_MS = 10 * 60_000;

type MachineRow = typeof machine.$inferSelect;

export interface WorkerStepFacts {
  agentRow: Pick<typeof agent.$inferSelect, 'machineId' | 'requiredCapabilities'>;
  model: Pick<typeof agent.$inferSelect, 'provider' | 'modelId'>;
  localProject: boolean;
  localMerge: boolean;
  routed: boolean;
}

export function workerIneligibility(
  db: Db,
  machineRow: MachineRow,
  facts: WorkerStepFacts,
  catalog: ReadonlyArray<{ id: string; liveness?: 'alive' | 'dead' | 'unknown' }>,
  now: number,
): MachineIneligibility | null {
  const claudeCode = stepRuntimeFor(facts.model.provider) === 'claude-code';
  const pinGatesOnly = { ...facts.agentRow, machineId: machineRow.id };
  return machineEligibility({
    machine: machineRow,
    agent: facts.routed ? facts.agentRow : pinGatesOnly,
    model: facts.model,
    catalog,
    localProject: facts.routed && facts.localProject,
    claudeRateBlocked: claudeRateBlock(machineRow.claudeRateLimits ?? [], now) !== null,
    claudeLoginBlocked:
      claudeCode &&
      !hasActiveClaudeSubscription({ db }, machineRow.teamId) &&
      claudeLoginBlocksClaim(machineRow.claudeCodeReport?.login, now),
    claudeUsageRefused:
      !facts.localMerge && !claudeUsageGatePasses({ db }, machineRow, facts.model),
  });
}

export function targetUnavailable(
  db: Db,
  target: MachineRow | undefined,
  teamId: string,
  facts: WorkerStepFacts,
  catalog: ReadonlyArray<{ id: string; liveness?: 'alive' | 'dead' | 'unknown' }>,
  now: number,
): boolean {
  return (
    target === undefined ||
    target.teamId !== teamId ||
    !target.online ||
    workerIneligibility(db, target, facts, catalog, now) !== null
  );
}

export function priorSessionOf(
  db: Db,
  stepRow: Pick<typeof step.$inferSelect, 'buildId' | 'kind' | 'fallback' | 'freshSession'>,
  buildRow: Pick<typeof build.$inferSelect, 'prevPhase' | 'withPlan' | 'planDocId'>,
): {
  priorSessionId: string | null;
  priorMachineId: string | null;
  freshSession: boolean;
} {
  const prior = db
    .select({ sessionId: step.sessionId, machineId: step.machineId, fallback: step.fallback })
    .from(step)
    .where(
      and(
        eq(step.buildId, stepRow.buildId),
        sql`${step.sessionId} is not null`,
        ...(stepRow.kind === 'build' &&
        (buildRow.prevPhase === 'done' || buildRow.prevPhase === 'review')
          ? [eq(step.kind, 'build')]
          : []),
      ),
    )
    .orderBy(asc(step.createdAt))
    .all();
  const latestPrior = prior[prior.length - 1] ?? null;
  const priorRow =
    latestPrior !== null &&
    (latestPrior.fallback?.model?.provider ?? null) === (stepRow.fallback?.model?.provider ?? null)
      ? latestPrior
      : null;
  const planHandoffMissing =
    stepRow.kind === 'build' && buildRow.withPlan && buildRow.planDocId === null;
  return {
    priorSessionId: priorRow?.sessionId ?? null,
    priorMachineId: priorRow?.machineId ?? null,
    freshSession:
      planHandoffMissing ||
      stepRow.kind === 'review' ||
      stepRow.kind === 'verify' ||
      stepRow.freshSession,
  };
}

export function pinAllows(input: {
  machineId: string;
  pinnedId: string | null;
  pinned: MachineRow | undefined;
  model: Pick<typeof agent.$inferSelect, 'provider'>;
  now: number;
}): boolean {
  if (input.pinnedId === input.machineId) return true;
  return (
    stepRuntimeFor(input.model.provider) === 'claude-code' &&
    input.pinned !== undefined &&
    claudeRateBlock(input.pinned.claudeRateLimits ?? [], input.now) !== null
  );
}

export interface RouteTarget {
  machineId: string;
  session: boolean;
}

export function routeTargets(
  sessionMachineId: string | null,
  preferredMachineId: string | null,
): RouteTarget[] {
  const targets: RouteTarget[] = [];
  if (sessionMachineId !== null) targets.push({ machineId: sessionMachineId, session: true });
  if (preferredMachineId !== null && preferredMachineId !== sessionMachineId) {
    targets.push({ machineId: preferredMachineId, session: false });
  }
  return targets;
}

export type RouteVerdict =
  | { claim: true }
  | { claim: false; waitingFor: string; fallbackAt: number };

export function routeVerdict(input: {
  machineId: string | null;
  targets: readonly RouteTarget[];
  unavailable: (machineId: string) => boolean;
  waitingSince: number;
  now: number;
}): RouteVerdict {
  for (const target of input.targets) {
    if (target.machineId === input.machineId) return { claim: true };
    const wait = input.unavailable(target.machineId)
      ? target.session
        ? SESSION_GRACE_MS
        : 0
      : OVERFLOW_AFTER_MS;
    const fallbackAt = input.waitingSince + wait;
    if (input.now < fallbackAt) {
      return { claim: false, waitingFor: target.machineId, fallbackAt };
    }
  }
  return { claim: true };
}

export function waitingSince(stepRow: { createdAt: number; holdUntil: number | null }): number {
  return Math.max(stepRow.createdAt, stepRow.holdUntil ?? 0);
}
