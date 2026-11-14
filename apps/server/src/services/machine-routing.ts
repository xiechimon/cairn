import {
  claudeLoginBlocksClaim,
  claudeRateBlock,
  isBuildStepKind,
  type RunnerOs,
  runnerOsOf,
} from '@cairn/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type build, type machine, step, team } from '../db/schema.js';
import { claudeUsageGatePasses } from './claude-rate-limit.js';
import { hasActiveClaudeSubscription } from './claude-subscriptions.js';
import {
  type MachineIneligibility,
  machineEligibility,
  machineRunningCount,
  stepRuntimeFor,
} from './dispatch-eligibility.js';
import type { RouteProfile } from './routing-rules.js';

type MachineRow = typeof machine.$inferSelect;

export interface WorkerStepFacts {
  agentRow: Pick<RouteProfile, 'machineId' | 'requiredCapabilities'>;
  model: Pick<RouteProfile, 'provider' | 'modelId'>;
  localProject: boolean;
  localMerge: boolean;
}

export function workerIneligibility(
  db: Db,
  machineRow: MachineRow,
  facts: WorkerStepFacts,
  catalog: ReadonlyArray<{ id: string; liveness?: 'alive' | 'dead' | 'unknown' }>,
  now: number,
): MachineIneligibility | null {
  const claudeCode = stepRuntimeFor(facts.model.provider) === 'claude-code';
  return machineEligibility({
    machine: machineRow,
    agent: facts.agentRow,
    model: facts.model,
    catalog,
    localProject: facts.localProject,
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
        ...(isBuildStepKind(stepRow.kind) &&
        (buildRow.prevPhase === 'done' ||
          buildRow.prevPhase === 'review' ||
          buildRow.prevPhase === 'building')
          ? [inArray(step.kind, ['build', 'session'])]
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

export interface RouteTarget {
  machineId: string;
}

export function routeTargets(
  sessionMachineId: string | null,
  preferredMachineId: string | null,
  soleOnlineMachineId: string | null = null,
): RouteTarget[] {
  const machineId = sessionMachineId ?? preferredMachineId ?? soleOnlineMachineId;
  return machineId === null ? [] : [{ machineId }];
}

export function soleOnlineMachineId(onlineIds: readonly string[]): string | null {
  return onlineIds.length === 1 ? (onlineIds[0] ?? null) : null;
}

export function teamDefaultMachineId(db: Pick<Db, 'select'>, teamId: string): string | null {
  return (
    db.select({ id: team.defaultMachineId }).from(team).where(eq(team.id, teamId)).get()?.id ?? null
  );
}

export function fallbackMachineId(
  machines: readonly { id: string; online: boolean }[],
  defaultMachineId: string | null,
): string | null {
  if (defaultMachineId !== null && machines.some((row) => row.id === defaultMachineId)) {
    return defaultMachineId;
  }
  const online = soleOnlineMachineId(machines.filter((row) => row.online).map((row) => row.id));
  if (online !== null) return online;
  return machines.length === 1 ? (machines[0]?.id ?? null) : null;
}

export function platformFallbackMachineId(
  db: Db,
  machines: readonly Pick<MachineRow, 'id' | 'online' | 'tokenHash' | 'capabilities'>[],
  defaultMachineId: string | null,
  os: RunnerOs | undefined,
): string | null {
  if (os === undefined) return fallbackMachineId(machines, defaultMachineId);
  const matching = machines.filter(
    (row) => row.tokenHash !== null && runnerOsOf(row.capabilities) === os,
  );
  if (matching.some((row) => row.id === defaultMachineId)) return defaultMachineId;
  const online = matching
    .filter((row) => row.online)
    .map((row) => ({ id: row.id, running: machineRunningCount(db, row.id) }))
    .sort((a, b) => a.running - b.running || (a.id < b.id ? -1 : 1));
  return online[0]?.id ?? matching[0]?.id ?? null;
}

export type RouteVerdict = { claim: true } | { claim: false; waitingFor: string | null };

export function routeVerdict(input: {
  machineId: string | null;
  targets: readonly RouteTarget[];
}): RouteVerdict {
  const target = input.targets[0];
  if (target === undefined) return { claim: false, waitingFor: null };
  if (target.machineId === input.machineId) return { claim: true };
  return { claim: false, waitingFor: target.machineId };
}

export function waitingSince(stepRow: { createdAt: number; holdUntil: number | null }): number {
  return Math.max(stepRow.createdAt, stepRow.holdUntil ?? 0);
}
