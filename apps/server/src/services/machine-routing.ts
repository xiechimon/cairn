import {
  claudeRateBlock,
  isBuildStepKind,
  isRegisteredMachine,
  type RunnerOs,
  runnerOsOf,
} from '@cairn/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type build, machine, step, team } from '../db/schema.js';
import { activeAntigravitySubscriptionMode } from './antigravity-subscriptions.js';
import { hasActiveClaudeSubscription } from './claude-subscriptions.js';
import { hasActiveDevinSubscription } from './devin-subscriptions.js';
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
  const runtime = stepRuntimeFor(facts.model.provider);
  const antigravityMode =
    runtime === 'antigravity' ? activeAntigravitySubscriptionMode({ db }, machineRow.teamId) : null;
  const ineligible = machineEligibility({
    machine: machineRow,
    agent: facts.agentRow,
    model: facts.model,
    catalog,
    localProject: facts.localProject,
    claudeRateBlocked: claudeRateBlock(machineRow.claudeRateLimits ?? [], now) !== null,
    claudeSubscriptionMissing:
      runtime === 'claude-code' && !hasActiveClaudeSubscription({ db }, machineRow.teamId),
    devinSubscriptionMissing:
      runtime === 'devin' && !hasActiveDevinSubscription({ db }, machineRow.teamId),
    antigravitySubscriptionMissing:
      runtime === 'antigravity' &&
      (antigravityMode === 'none' ||
        (antigravityMode === 'host' &&
          machineRow.capabilities?.antigravity?.authenticated !== true)),
  });
  return ineligible;
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
  db: Pick<Db, 'select'>,
  stepRow: Pick<
    typeof step.$inferSelect,
    'buildId' | 'kind' | 'fallback' | 'freshSession' | 'byPerson'
  >,
  buildRow: Pick<typeof build.$inferSelect, 'prevPhase' | 'withPlan' | 'planDocId'>,
  enabledSubscriptionIds: {
    claude: string | null;
    devin: string | null;
    antigravity?: string | null;
  },
  intentProvider: string | null = null,
): {
  priorSessionId: string | null;
  priorMachineId: string | null;
  priorMachineLiveId: string | null;
  priorSubscriptionId: string | null;
  freshSession: boolean;
} {
  const prior = db
    .select({
      sessionId: step.sessionId,
      machineId: step.machineId,
      fallback: step.fallback,
      ranModel: step.ranModel,
      subscriptionId: step.claudeSubscriptionId,
      devinSubscriptionId: step.devinSubscriptionId,
      antigravitySubscriptionId: step.antigravitySubscriptionId,
    })
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
  const priorProvider =
    latestPrior?.ranModel?.provider ?? latestPrior?.fallback?.model?.provider ?? null;
  const priorRow =
    latestPrior !== null &&
    (priorProvider === null
      ? stepRow.fallback?.model == null
      : priorProvider === (stepRow.fallback?.model?.provider ?? intentProvider))
      ? latestPrior
      : null;
  const planHandoffMissing =
    stepRow.kind === 'build' && buildRow.withPlan && buildRow.planDocId === null;
  const priorSubscriptionId = priorRow?.subscriptionId ?? null;
  const priorDevinSubscriptionId = priorRow?.devinSubscriptionId ?? null;
  const priorAntigravitySubscriptionId = priorRow?.antigravitySubscriptionId ?? null;
  const startsNewRun =
    (stepRow.byPerson || stepRow.kind === 'merge') &&
    ((priorSubscriptionId !== null && priorSubscriptionId !== enabledSubscriptionIds.claude) ||
      (priorDevinSubscriptionId !== null &&
        priorDevinSubscriptionId !== enabledSubscriptionIds.devin) ||
      (priorAntigravitySubscriptionId !== null &&
        priorAntigravitySubscriptionId !== (enabledSubscriptionIds.antigravity ?? null)));
  return {
    priorSessionId: startsNewRun ? null : (priorRow?.sessionId ?? null),
    priorMachineId: startsNewRun ? null : (priorRow?.machineId ?? null),
    priorMachineLiveId:
      startsNewRun || priorRow?.machineId == null || !machineCanReturn(db, priorRow.machineId)
        ? null
        : priorRow.machineId,
    priorSubscriptionId,
    freshSession:
      startsNewRun ||
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

export function machineCanReturn(db: Pick<Db, 'select'>, machineId: string): boolean {
  const row = db
    .select({ id: machine.id, retiredAt: machine.retiredAt })
    .from(machine)
    .where(eq(machine.id, machineId))
    .get();
  return row !== undefined && row.retiredAt === null;
}

export function liveMachineId(db: Pick<Db, 'select'>, machineId: string | null): string | null {
  return machineId !== null && machineCanReturn(db, machineId) ? machineId : null;
}

export function fallbackMachineId(
  teamMachines: readonly (Pick<MachineRow, 'id' | 'online' | 'kind' | 'lastSeenAt'> & {
    retiredAt?: number | null | undefined;
  })[],
  defaultMachineId: string | null,
): string | null {
  const machines = teamMachines.filter((row) => row.retiredAt == null && isRegisteredMachine(row));
  if (defaultMachineId !== null && machines.some((row) => row.id === defaultMachineId)) {
    return defaultMachineId;
  }
  const online = soleOnlineMachineId(machines.filter((row) => row.online).map((row) => row.id));
  if (online !== null) return online;
  return machines.length === 1 ? (machines[0]?.id ?? null) : null;
}

export function platformFallbackMachineId(
  db: Db,
  machines: readonly (Pick<
    MachineRow,
    'id' | 'online' | 'kind' | 'lastSeenAt' | 'tokenHash' | 'capabilities'
  > & { retiredAt?: number | null | undefined })[],
  defaultMachineId: string | null,
  os: RunnerOs | undefined,
): string | null {
  if (os === undefined) return fallbackMachineId(machines, defaultMachineId);
  const matching = machines.filter(
    (row) => row.retiredAt == null && row.tokenHash !== null && runnerOsOf(row.capabilities) === os,
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
