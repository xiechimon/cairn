import {
  claudeRateBlock,
  isBuildStepKind,
  isRegisteredMachine,
  MIN_SUPPORTED_RUNNER_PROTOCOL,
  machineStrain,
  type RunnerOs,
  runnerOsOf,
  runnerOutOfWindow,
} from '@cairn/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type build, machine, step, team } from '../db/schema.js';
import {
  activeAntigravitySource,
  antigravitySubscriptionAllowsRunner,
} from './antigravity-subscriptions.js';
import { hasActiveClaudeSubscription } from './claude-subscriptions.js';
import { hasActiveDevinSubscription } from './devin-subscriptions.js';
import {
  antigravityUsesHostLogin,
  githubPushCapable,
  homeMachineRejectReason,
  type MachineIneligibility,
  machineEligibility,
  machineRunningCount,
  machineRuntimeClaimable,
  missingCapabilities,
  runnerCannotConnect,
  stepRuntimeFor,
} from './dispatch-eligibility.js';
import { activeDoubaoSource, doubaoRunnerEligibility } from './doubao-subscriptions.js';
import type { RouteProfile } from './routing-rules.js';

type MachineRow = typeof machine.$inferSelect;

export interface WorkerStepFacts {
  agentRow: Pick<RouteProfile, 'machineId' | 'requiredCapabilities'>;
  model: Pick<RouteProfile, 'provider' | 'modelId'>;
  localProject: boolean;
  localMerge: boolean;
  githubPushRepo: string | null;
}

export function workerIneligibility(
  db: Db,
  machineRow: MachineRow,
  facts: WorkerStepFacts,
  catalog: ReadonlyArray<{ id: string; liveness?: 'alive' | 'dead' | 'unknown' }>,
  now: number,
): MachineIneligibility | null {
  const runtime = stepRuntimeFor(facts.model.provider);
  const doubaoGate =
    runtime === 'doubao'
      ? doubaoRunnerEligibility(db, machineRow.teamId, machineRow.id, machineRow.capabilities)
      : 'ok';
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
      !antigravitySubscriptionAllowsRunner(
        db,
        machineRow.teamId,
        machineRow.id,
        machineRow.capabilities,
      ),
    antigravityHostLogin:
      runtime === 'antigravity' && antigravityUsesHostLogin(db, machineRow.teamId),
    doubaoSubscriptionMissing: runtime === 'doubao' && doubaoGate === 'subscription',
    doubaoLoginRequired: runtime === 'doubao' && doubaoGate === 'login-required',
    githubPushMissing:
      facts.githubPushRepo != null &&
      !githubPushCapable(machineRow.capabilities, facts.githubPushRepo, now),
  });
  return ineligible;
}

export function chiefIneligibility(
  db: Pick<Db, 'select' | 'update'>,
  machineRow: MachineRow,
  agentRow: Pick<RouteProfile, 'requiredCapabilities'> & { modelId?: string | null },
  provider: string | null | undefined,
  now: number,
): MachineIneligibility | null {
  const runtime = stepRuntimeFor(provider);
  if (
    runnerOutOfWindow(machineRow.capabilities, MIN_SUPPORTED_RUNNER_PROTOCOL) ||
    runnerCannotConnect(
      machineRow.capabilities,
      runtime,
      runtime === 'antigravity' && antigravityUsesHostLogin(db, machineRow.teamId),
    )
  ) {
    return { kind: 'runner-outdated' };
  }
  if (!machineRuntimeClaimable(machineRow, runtime)) return { kind: 'runtime' };
  if (runtime === 'claude-code' && claudeRateBlock(machineRow.claudeRateLimits ?? [], now) !== null)
    return { kind: 'claude-blocked' };
  if (runtime === 'claude-code' && !hasActiveClaudeSubscription({ db }, machineRow.teamId))
    return { kind: 'claude-login' };
  if (runtime === 'devin' && !hasActiveDevinSubscription({ db }, machineRow.teamId))
    return { kind: 'devin-subscription' };
  if (
    runtime === 'antigravity' &&
    !antigravitySubscriptionAllowsRunner(
      db,
      machineRow.teamId,
      machineRow.id,
      machineRow.capabilities,
    )
  )
    return { kind: 'antigravity-subscription' };
  if (runtime === 'doubao') {
    const modelReject = homeMachineRejectReason(machineRow, {
      provider,
      modelId: agentRow.modelId,
    });
    if (modelReject !== null) return { kind: 'model', reason: modelReject };
    const gate = doubaoRunnerEligibility(
      db,
      machineRow.teamId,
      machineRow.id,
      machineRow.capabilities,
    );
    if (gate === 'subscription') return { kind: 'doubao-subscription' };
    if (gate === 'unsupported') return { kind: 'runtime' };
    if (gate === 'login-required') return { kind: 'doubao-login-required' };
  }
  const missing = missingCapabilities(machineRow, agentRow);
  if (missing.length > 0) return { kind: 'capability', missing };
  return null;
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
    doubao?: string | null;
  },
  intentProvider: string | null = null,
): {
  priorSessionId: string | null;
  priorMachineId: string | null;
  priorMachineLiveId: string | null;
  priorSubscriptionId: string | null;
  priorStepAt: number | null;
  freshSession: boolean;
} {
  const prior = db
    .select({
      sessionId: step.sessionId,
      machineId: step.machineId,
      fallback: step.fallback,
      ranModel: step.ranModel,
      createdAt: step.createdAt,
      claimedAt: step.claimedAt,
      subscriptionId: step.claudeSubscriptionId,
      devinSubscriptionId: step.devinSubscriptionId,
      antigravitySubscriptionId: step.antigravitySubscriptionId,
      doubaoSubscriptionId: step.doubaoSubscriptionId,
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
  const priorDoubaoSubscriptionId = priorRow?.doubaoSubscriptionId ?? null;
  const startsNewRun =
    (stepRow.byPerson || stepRow.kind === 'merge') &&
    ((priorSubscriptionId !== null && priorSubscriptionId !== enabledSubscriptionIds.claude) ||
      (priorDevinSubscriptionId !== null &&
        priorDevinSubscriptionId !== enabledSubscriptionIds.devin) ||
      (priorAntigravitySubscriptionId !== null &&
        priorAntigravitySubscriptionId !== (enabledSubscriptionIds.antigravity ?? null)) ||
      (priorDoubaoSubscriptionId !== null &&
        priorDoubaoSubscriptionId !== (enabledSubscriptionIds.doubao ?? null)));
  return {
    priorSessionId: startsNewRun ? null : (priorRow?.sessionId ?? null),
    priorMachineId: startsNewRun ? null : (priorRow?.machineId ?? null),
    priorMachineLiveId:
      startsNewRun || priorRow?.machineId == null || !machineCanReturn(db, priorRow.machineId)
        ? null
        : priorRow.machineId,
    priorSubscriptionId,
    priorStepAt: priorRow === null ? null : (priorRow.claimedAt ?? priorRow.createdAt),
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

export const OFFLINE_FAILOVER_GRACE_MS = 15_000;

export type RouteLockReason =
  | 'active-session'
  | 'local-project'
  | 'explicit-pin'
  | 'host-subscription';

export interface CandidateResolution {
  claimableIds: string[];
  waitingForId: string | null;
  alternateMachines: Array<{ machineId: string; name: string }>;
  failover?: { fromMachineId: string; reason: 'offline' | 'busy' };
  lockReason?: RouteLockReason;
}

function inOfflineGrace(
  preferred: MachineRow | undefined,
  stepCreatedAt: number,
  now: number,
): boolean {
  if (preferred === undefined || preferred.online) return false;
  if (now - stepCreatedAt >= OFFLINE_FAILOVER_GRACE_MS) return false;
  if (preferred.lastSeenAt == null) return true;
  return now - preferred.lastSeenAt < OFFLINE_FAILOVER_GRACE_MS;
}

function underLoad(row: Pick<MachineRow, 'capabilities'>): boolean {
  return machineStrain(row.capabilities?.hardware).length > 0;
}

function pinnedTo(
  pinnedId: string | null,
  eligibleOnline: readonly MachineRow[],
  alternateMachines: CandidateResolution['alternateMachines'],
  lockReason: RouteLockReason,
): CandidateResolution {
  const claimable = pinnedId !== null && eligibleOnline.some((m) => m.id === pinnedId);
  return {
    claimableIds: claimable ? [pinnedId] : [],
    waitingForId: claimable ? null : pinnedId,
    alternateMachines,
    lockReason,
  };
}

function poolResolution(input: {
  db: Db;
  preferredId: string | null;
  activeMachines: readonly MachineRow[];
  eligibleOnline: readonly MachineRow[];
  toAlternates: (excludeId: string | null) => CandidateResolution['alternateMachines'];
  stepCreatedAt: number;
  now: number;
}): CandidateResolution {
  const { db, preferredId, eligibleOnline, toAlternates } = input;
  if (preferredId === null) {
    const ranked = eligibleOnline
      .map((m) => ({ id: m.id, calm: !underLoad(m), running: machineRunningCount(db, m.id) }))
      .sort(
        (a, b) =>
          Number(b.calm) - Number(a.calm) ||
          a.running - b.running ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    return {
      claimableIds: ranked.map((m) => m.id),
      waitingForId: null,
      alternateMachines: toAlternates(null),
    };
  }
  const preferred = input.activeMachines.find((m) => m.id === preferredId);
  const backups = eligibleOnline
    .filter((m) => m.id !== preferredId)
    .map((m) => ({ id: m.id, calm: !underLoad(m), running: machineRunningCount(db, m.id) }))
    .sort(
      (a, b) => Number(b.calm) - Number(a.calm) || a.running - b.running || (a.id < b.id ? -1 : 1),
    );

  if (preferred !== undefined && eligibleOnline.some((m) => m.id === preferred.id)) {
    const calmBackups = backups.filter((b) => b.calm);
    if (underLoad(preferred) && calmBackups.length > 0) {
      return {
        claimableIds: calmBackups.map((b) => b.id),
        waitingForId: null,
        alternateMachines: toAlternates(preferred.id),
        failover: { fromMachineId: preferred.id, reason: 'busy' },
      };
    }
    return {
      claimableIds: [preferred.id],
      waitingForId: null,
      alternateMachines: toAlternates(preferred.id),
    };
  }

  if (
    (preferred !== undefined && inOfflineGrace(preferred, input.stepCreatedAt, input.now)) ||
    backups.length === 0
  ) {
    return {
      claimableIds: [],
      waitingForId: preferredId,
      alternateMachines: toAlternates(preferredId),
    };
  }

  return {
    claimableIds: backups.map((b) => b.id),
    waitingForId: null,
    alternateMachines: toAlternates(preferredId),
    failover: { fromMachineId: preferredId, reason: 'offline' },
  };
}

function doubaoDefaultTarget(
  pool: readonly MachineRow[],
  defaultMachineId: string | null,
): string | null {
  const sorted = [...pool].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1,
  );
  const authed = sorted.filter((m) => m.capabilities?.doubao?.authenticated === true);
  const candidates = authed.length > 0 ? authed : sorted;
  if (defaultMachineId !== null && candidates.some((m) => m.id === defaultMachineId)) {
    return defaultMachineId;
  }
  return candidates[0]?.id ?? null;
}

function doubaoCapablePool(activeMachines: readonly MachineRow[]): readonly MachineRow[] {
  const capable = activeMachines.filter(
    (m) =>
      m.capabilities?.doubao !== undefined && m.capabilities.doubao.platformSupported !== false,
  );
  return capable.length > 0 ? capable : activeMachines;
}

export function resolveChiefCandidates(input: {
  db: Db;
  teamId: string;
  teamMachines: readonly MachineRow[];
  pinnedMachineId: string | null;
  targetMachineId: string | null;
  agentRow: Pick<RouteProfile, 'requiredCapabilities'>;
  provider: string | null | undefined;
  stepCreatedAt: number;
  now: number;
  claimingMachineId?: string;
}): CandidateResolution {
  const { db, teamId, teamMachines, agentRow, provider, stepCreatedAt, now } = input;
  const isOnline = (m: MachineRow) => m.online || m.id === input.claimingMachineId;
  const activeMachines = teamMachines.filter((m) => m.retiredAt === null && isRegisteredMachine(m));
  const eligibleOnline = activeMachines.filter(
    (m) => isOnline(m) && chiefIneligibility(db, m, agentRow, provider, now) === null,
  );
  const toAlternates = (excludeId: string | null) =>
    eligibleOnline
      .filter((m) => m.id !== excludeId)
      .map((m) => ({ machineId: m.id, name: m.name }));

  if (input.targetMachineId !== null && machineCanReturn(db, input.targetMachineId)) {
    return pinnedTo(
      input.targetMachineId,
      eligibleOnline,
      toAlternates(input.targetMachineId),
      'explicit-pin',
    );
  }

  if (stepRuntimeFor(provider) === 'antigravity') {
    const source = activeAntigravitySource(db, teamId);
    if (source.kind === 'host') {
      const hostId = source.login.runnerId;
      return pinnedTo(hostId, eligibleOnline, toAlternates(hostId), 'host-subscription');
    }
  }

  if (stepRuntimeFor(provider) === 'doubao') {
    const source = activeDoubaoSource(db, teamId);
    if (source.kind === 'none') return pinnedTo(null, [], [], 'host-subscription');
    const pool = doubaoCapablePool(activeMachines);
    const pinned = liveMachineId(db, input.pinnedMachineId);
    const targetId =
      source.runnerId !== null
        ? source.runnerId
        : ((pinned !== null && pool.some((m) => m.id === pinned) ? pinned : undefined) ??
          doubaoDefaultTarget(pool, teamDefaultMachineId(db, teamId)));
    return pinnedTo(targetId, eligibleOnline, toAlternates(targetId), 'host-subscription');
  }

  return poolResolution({
    db,
    preferredId:
      liveMachineId(db, input.pinnedMachineId) ??
      fallbackMachineId(activeMachines, teamDefaultMachineId(db, teamId)),
    activeMachines,
    eligibleOnline,
    toAlternates,
    stepCreatedAt,
    now,
  });
}

export function resolveWorkerCandidates(input: {
  db: Db;
  teamId: string;
  teamMachines: readonly MachineRow[];
  facts: WorkerStepFacts;
  catalog: ReadonlyArray<{ id: string; liveness?: 'alive' | 'dead' | 'unknown' }>;
  sessionMachineId: string | null;
  explicitOverrideMachineId: string | null;
  ruleMachineId: string | null;
  defaultMachineId: string | null;
  stepCreatedAt: number;
  now: number;
  claimingMachineId?: string;
}): CandidateResolution {
  const { db, teamId, teamMachines, facts, catalog, stepCreatedAt, now } = input;
  const isOnline = (m: MachineRow) => m.online || m.id === input.claimingMachineId;
  const activeMachines = teamMachines.filter((m) => m.retiredAt === null && isRegisteredMachine(m));
  const eligibleOnline = activeMachines.filter(
    (m) => isOnline(m) && workerIneligibility(db, m, facts, catalog, now) === null,
  );
  const toAlternates = (excludeId: string | null) =>
    eligibleOnline
      .filter((m) => m.id !== excludeId)
      .map((m) => ({ machineId: m.id, name: m.name }));

  if (facts.localProject || facts.localMerge) {
    const pinnedId =
      input.sessionMachineId ??
      input.explicitOverrideMachineId ??
      input.ruleMachineId ??
      input.defaultMachineId;
    return pinnedTo(pinnedId, eligibleOnline, [], 'local-project');
  }

  if (input.sessionMachineId !== null) {
    return pinnedTo(
      input.sessionMachineId,
      eligibleOnline,
      toAlternates(input.sessionMachineId),
      'active-session',
    );
  }

  if (input.explicitOverrideMachineId !== null) {
    return pinnedTo(
      input.explicitOverrideMachineId,
      eligibleOnline,
      toAlternates(input.explicitOverrideMachineId),
      'explicit-pin',
    );
  }

  if (stepRuntimeFor(facts.model.provider) === 'antigravity') {
    const source = activeAntigravitySource(db, teamId);
    if (source.kind === 'host') {
      const hostId = source.login.runnerId;
      return pinnedTo(hostId, eligibleOnline, toAlternates(hostId), 'host-subscription');
    }
  }

  if (stepRuntimeFor(facts.model.provider) === 'doubao') {
    const source = activeDoubaoSource(db, teamId);
    if (source.kind === 'none') return pinnedTo(null, [], [], 'host-subscription');
    const pool = doubaoCapablePool(activeMachines);
    const osFilter = facts.agentRow.requiredCapabilities?.os;
    const filteredPool =
      osFilter !== undefined ? pool.filter((m) => runnerOsOf(m.capabilities) === osFilter) : pool;
    const rule = liveMachineId(db, input.ruleMachineId);
    const targetId =
      source.runnerId !== null
        ? source.runnerId
        : ((rule !== null && pool.some((m) => m.id === rule) ? rule : undefined) ??
          doubaoDefaultTarget(filteredPool, input.defaultMachineId) ??
          rule);
    return pinnedTo(targetId, eligibleOnline, toAlternates(targetId), 'host-subscription');
  }

  return poolResolution({
    db,
    preferredId:
      liveMachineId(db, input.ruleMachineId) ??
      platformFallbackMachineId(
        db,
        activeMachines,
        input.defaultMachineId,
        facts.agentRow.requiredCapabilities?.os,
      ),
    activeMachines,
    eligibleOnline,
    toAlternates,
    stepCreatedAt,
    now,
  });
}

export type RouteVerdict = { claim: true } | { claim: false; waitingFor: string | null };

export function routeVerdict(input: {
  machineId: string | null;
  targets: readonly RouteTarget[];
}): RouteVerdict {
  if (input.targets.length === 0) return { claim: false, waitingFor: null };
  if (input.machineId !== null && input.targets.some((t) => t.machineId === input.machineId)) {
    return { claim: true };
  }
  return { claim: false, waitingFor: input.targets[0]?.machineId ?? null };
}

export function waitingSince(stepRow: { createdAt: number; holdUntil: number | null }): number {
  return Math.max(stepRow.createdAt, stepRow.holdUntil ?? 0);
}
