import {
  type CapabilityCandidate,
  CODEX_MODEL,
  classifyDifficulty,
  claudeCodeUpdateRequired,
  claudeRateBlock,
  type Difficulty,
  MIN_SUPPORTED_RUNNER_PROTOCOL,
  QUOTA_REJECT_PERCENT,
  type RequiredCapabilities,
  type RouteWorkDecision,
  routeWork,
  runnerOutOfWindow,
  type StepKind,
  tierFallbackOrder,
} from '@cairn/shared';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { machine, routingRule, step, stepQuota, stepRoute, type todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { antigravitySubscriptionAllowsRunner } from './antigravity-subscriptions.js';
import { hasActiveClaudeSubscription } from './claude-subscriptions.js';
import { hasActiveDevinSubscription } from './devin-subscriptions.js';
import {
  antigravityUsesHostLogin,
  githubPushCapable,
  homeMachineRejectReason,
  machineRuntimeAvailable,
  missingCapabilityItems,
  runnerCannotConnect,
} from './dispatch-eligibility.js';
import { doubaoSubscriptionAllowsRunner } from './doubao-subscriptions.js';
import { getModelLiveness, mergedCatalogModels } from './model-liveness.js';
import { providerHealth } from './provider-health.js';
import { antigravityQuotaExhausted, listConnectedTierSources } from './source-tiers.js';

type StepRouteRow = typeof stepRoute.$inferSelect;

export type BuildStepRoute = {
  buildId: string;
  stepId: string;
  kind: StepKind;
  harness: 'claude-code' | 'pi' | 'devin' | 'antigravity' | 'doubao' | null;
  provider: string | null;
  modelId: string | null;
  machineId: string | null;
};

export function listBuildStepRoutes(
  db: Pick<Db, 'select'>,
  buildIds: readonly string[],
): BuildStepRoute[] {
  if (buildIds.length === 0) return [];
  return db
    .select({
      buildId: step.buildId,
      stepId: stepRoute.stepId,
      kind: stepRoute.kind,
      harness: stepRoute.harness,
      provider: stepRoute.provider,
      modelId: stepRoute.modelId,
      machineId: stepRoute.machineId,
    })
    .from(stepRoute)
    .innerJoin(step, eq(step.id, stepRoute.stepId))
    .where(inArray(step.buildId, [...buildIds]))
    .all();
}
type RoutedTodo = Pick<typeof todo.$inferSelect, 'teamId'> &
  Partial<Pick<typeof todo.$inferSelect, 'title' | 'spec' | 'request'>>;

export interface RouteConstraints {
  machineId: string | null;
  required: RequiredCapabilities | null;
}

export function machineSatisfies(
  row: typeof machine.$inferSelect,
  constraints: RouteConstraints,
): boolean {
  if (constraints.machineId !== null && constraints.machineId !== row.id) return false;
  const missing = missingCapabilityItems(row, constraints.required);
  return (
    missing.executor === undefined &&
    missing.os === undefined &&
    missing.mcpServers.length === 0 &&
    missing.models.length === 0
  );
}

function weeklyUsedPercent(row: typeof machine.$inferSelect): number | null {
  const week = (row.claudeRateLimits ?? []).find(
    (window) => window.subscription === 'seven_day' || window.subscription === 'week',
  );
  if (week === undefined || week.utilization === null) return null;
  if (week.resetsAt !== null && week.resetsAt !== undefined && week.resetsAt < nowMs()) {
    return null;
  }
  return week.utilization * 100;
}

function candidateAvailableOnMachine(
  db: Pick<Db, 'select'>,
  row: typeof machine.$inferSelect,
  source: { provider: string; runtime: CapabilityCandidate['harness'] },
  modelId: string,
  catalog: ReturnType<typeof mergedCatalogModels>,
  flags: {
    subscribed: boolean;
    antigravityHostLogin: boolean;
    antigravityBlocked: boolean;
    githubPushRepo?: string | null;
    now: number;
  },
): { available: boolean; unavailableWhy?: 'harness-missing' } {
  const installed = machineRuntimeAvailable(row, source.runtime);
  if (!installed) return { available: false, unavailableWhy: 'harness-missing' };
  if (
    !row.online ||
    runnerOutOfWindow(row.capabilities, MIN_SUPPORTED_RUNNER_PROTOCOL) ||
    runnerCannotConnect(row.capabilities, source.runtime, flags.antigravityHostLogin) ||
    (flags.githubPushRepo != null &&
      !githubPushCapable(row.capabilities, flags.githubPushRepo, flags.now))
  ) {
    return { available: false };
  }
  if (
    getModelLiveness(row.teamId, source.provider, modelId) === 'dead' ||
    !providerHealth.canAcquire(`${row.teamId}/${source.provider}`)
  ) {
    return { available: false };
  }
  if (source.runtime === 'claude-code') {
    const ok =
      flags.subscribed &&
      claudeRateBlock(row.claudeRateLimits ?? [], flags.now) === null &&
      homeMachineRejectReason(row, { provider: 'claude-code', modelId }, catalog) === null &&
      claudeCodeUpdateRequired(modelId, row.claudeCodeReport?.bin?.version) === null;
    return { available: ok };
  }
  if (source.runtime === 'antigravity') {
    const ok =
      !flags.antigravityBlocked &&
      antigravitySubscriptionAllowsRunner(db, row.teamId, row.id, row.capabilities);
    return { available: ok };
  }
  if (source.runtime === 'devin') {
    return { available: hasActiveDevinSubscription({ db }, row.teamId) };
  }
  if (source.runtime === 'doubao') {
    const runnerModels = row.capabilities?.doubao?.models ?? [];
    const hasModel = runnerModels.length === 0 || runnerModels.some((m) => m.id === modelId);
    return {
      available:
        hasModel && doubaoSubscriptionAllowsRunner(db, row.teamId, row.id, row.capabilities),
    };
  }
  return { available: true };
}

export function capabilityCandidates(
  db: Pick<Db, 'select'>,
  teamId: string,
  constraints: RouteConstraints,
  options: {
    primaryProvider?: string | null;
    preferredModelId?: string | null;
    difficulty?: Difficulty;
    excludedKeys?: ReadonlySet<string>;
    githubPushRepo?: string | null;
  } = {},
): CapabilityCandidate[] {
  const now = nowMs();
  const catalog = mergedCatalogModels(teamId);
  const subscribed = hasActiveClaudeSubscription({ db }, teamId);
  const antigravityHostLogin = antigravityUsesHostLogin(db, teamId);
  const antigravityBlocked = antigravityQuotaExhausted(db, teamId, now);
  const sources = listConnectedTierSources(
    db,
    teamId,
    options.primaryProvider ?? null,
    options.preferredModelId ?? null,
  );
  const machines = db
    .select()
    .from(machine)
    .where(and(eq(machine.teamId, teamId), isNull(machine.retiredAt)))
    .all()
    .filter((row) => machineSatisfies(row, constraints));

  const difficulty = options.difficulty ?? 'standard';
  const candidates: CapabilityCandidate[] = [];
  for (const source of sources) {
    for (const modelId of tierFallbackOrder(source.tiers, difficulty)) {
      if (options.excludedKeys?.has(`${source.provider}/${modelId}`) === true) continue;
      for (const row of machines) {
        const status = candidateAvailableOnMachine(db, row, source, modelId, catalog, {
          subscribed,
          antigravityHostLogin,
          antigravityBlocked,
          githubPushRepo: options.githubPushRepo ?? null,
          now,
        });
        candidates.push({
          harness: source.runtime,
          provider: source.provider,
          modelId,
          machineId: row.id,
          available: status.available,
          ...(status.unavailableWhy !== undefined ? { unavailableWhy: status.unavailableWhy } : {}),
          weeklyUsedPercent: source.runtime === 'claude-code' ? weeklyUsedPercent(row) : null,
        });
      }
    }
  }
  return candidates;
}

export function storedStepRoute(db: Pick<Db, 'select'>, stepId: string): StepRouteRow | null {
  return db.select().from(stepRoute).where(eq(stepRoute.stepId, stepId)).get() ?? null;
}

export function routeIsReleasable(db: Pick<Db, 'select'>, stepId: string): boolean {
  const row = db
    .select({
      status: step.status,
      sessionId: step.sessionId,
      checkpointCommit: step.checkpointCommit,
      fallback: stepQuota.fallback,
    })
    .from(step)
    .leftJoin(stepQuota, eq(stepQuota.stepId, step.id))
    .where(eq(step.id, stepId))
    .get();
  return (
    row?.status === 'pending' &&
    row.sessionId === null &&
    row.checkpointCommit === null &&
    row.fallback?.zeroUsageRetried !== true
  );
}

export function primarySourceOnlyOffline(
  db: Pick<Db, 'select'>,
  teamId: string,
  providerId: string,
  constraints: RouteConstraints,
  options: {
    preferredModelId?: string | null;
    difficulty?: Difficulty;
    githubPushRepo?: string | null;
  } = {},
): boolean {
  const now = nowMs();
  const sources = listConnectedTierSources(
    db,
    teamId,
    providerId,
    options.preferredModelId ?? null,
  );
  const source = sources.find((entry) => entry.provider === providerId);
  if (source === undefined) return false;
  const machines = db
    .select()
    .from(machine)
    .where(and(eq(machine.teamId, teamId), isNull(machine.retiredAt)))
    .all()
    .filter((row) => machineSatisfies(row, constraints));
  if (machines.length === 0) return false;
  const catalog = mergedCatalogModels(teamId);
  const flags = {
    subscribed: hasActiveClaudeSubscription({ db }, teamId),
    antigravityHostLogin: antigravityUsesHostLogin(db, teamId),
    antigravityBlocked: antigravityQuotaExhausted(db, teamId, now),
    githubPushRepo: options.githubPushRepo ?? null,
    now,
  };
  const models = tierFallbackOrder(source.tiers, options.difficulty ?? 'standard');
  return models.some((modelId) =>
    machines.some(
      (row) => candidateAvailableOnMachine(db, row, source, modelId, catalog, flags).available,
    ),
  )
    ? false
    : models.some((modelId) =>
        machines.some(
          (row) =>
            candidateAvailableOnMachine(
              db,
              {
                ...row,
                online: true,
                ...(source.runtime === 'claude-code' &&
                row.claudeCodeReport !== null &&
                row.claudeCodeReport.models.length === 0
                  ? {
                      claudeCodeReport: {
                        ...row.claudeCodeReport,
                        models: [{ id: modelId, name: modelId }],
                      },
                    }
                  : {}),
                ...(source.runtime === 'doubao' &&
                row.capabilities?.doubao !== undefined &&
                row.capabilities.doubao.platformSupported !== false
                  ? {
                      capabilities: {
                        ...row.capabilities,
                        doubao: {
                          ...row.capabilities.doubao,
                          installed: true,
                          authenticated: true,
                        },
                      },
                    }
                  : {}),
              },
              source,
              modelId,
              catalog,
              flags,
            ).available,
        ),
      );
}

export function decideStepRoute(
  db: Pick<Db, 'select'>,
  todoRow: RoutedTodo,
  kind: StepKind,
  stepId: string | null,
  constraints: RouteConstraints,
  options: {
    primaryProvider?: string | null;
    preferredModelId?: string | null;
    excludedKeys?: ReadonlySet<string>;
    githubPushRepo?: string | null;
  } = {},
): RouteWorkDecision {
  const difficulty = classifyDifficulty({
    title: todoRow.title ?? '',
    spec: todoRow.spec ?? null,
    request: todoRow.request ?? null,
  });
  const stored = stepId === null ? null : storedStepRoute(db, stepId);
  if (
    stored !== null &&
    stored.provider !== null &&
    stored.modelId !== null &&
    !routeIsReleasable(db, stored.stepId)
  ) {
    return routeWork(
      {
        kind,
        difficulty: stored.difficulty,
        inFlight: {
          provider: stored.provider,
          modelId: stored.modelId,
          machineId: stored.machineId,
        },
      },
      [],
    );
  }
  const storedSessionRule =
    options.primaryProvider === undefined
      ? db
          .select({ provider: routingRule.provider, modelId: routingRule.modelId })
          .from(routingRule)
          .where(and(eq(routingRule.teamId, todoRow.teamId), eq(routingRule.use, 'session')))
          .get()
      : undefined;
  return routeWork(
    { kind, difficulty },
    capabilityCandidates(db, todoRow.teamId, constraints, {
      ...options,
      ...(options.primaryProvider === undefined && storedSessionRule !== undefined
        ? {
            primaryProvider: storedSessionRule.provider,
            preferredModelId: storedSessionRule.modelId,
          }
        : {}),
      difficulty,
    }),
  );
}

function harnessOf(
  provider: string | null,
): 'claude-code' | 'pi' | 'devin' | 'antigravity' | 'doubao' | null {
  if (provider === 'claude-code') return 'claude-code';
  if (provider === 'devin') return 'devin';
  if (provider === 'antigravity') return 'antigravity';
  if (provider === 'doubao') return 'doubao';
  if (provider === null || provider === 'gemini') return null;
  return 'pi';
}

export function recordStepRoute(
  db: Db,
  stepRow: Pick<typeof step.$inferSelect, 'id' | 'kind'>,
  todoRow: RoutedTodo,
  claimingMachineId: string,
  effective: {
    provider: string | null;
    modelId: string | null;
    machineId: string | null;
    requiredCapabilities: RequiredCapabilities | null;
    primaryProvider?: string | null;
    preferredModelId?: string | null;
    githubPushRepo?: string | null;
    routed?: boolean;
    switchReason?: string;
  },
): StepRouteRow {
  const existing = storedStepRoute(db, stepRow.id);
  if (
    existing !== null &&
    existing.provider === effective.provider &&
    existing.modelId === effective.modelId
  ) {
    return existing;
  }
  const decision =
    effective.routed === false
      ? null
      : decideStepRoute(
          db,
          todoRow,
          stepRow.kind,
          null,
          {
            machineId: effective.machineId,
            required: effective.requiredCapabilities,
          },
          {
            primaryProvider: effective.primaryProvider,
            preferredModelId: effective.preferredModelId,
            githubPushRepo: effective.githubPushRepo,
          },
        );
  const difficulty =
    decision?.difficulty ??
    classifyDifficulty({
      title: todoRow.title ?? '',
      spec: todoRow.spec ?? null,
      request: todoRow.request ?? null,
    });
  const agrees =
    decision !== null &&
    decision.chosen !== null &&
    decision.chosen.provider === effective.provider &&
    decision.chosen.modelId === effective.modelId;
  const row: StepRouteRow = {
    stepId: stepRow.id,
    teamId: todoRow.teamId,
    kind: stepRow.kind,
    difficulty,
    harness: harnessOf(effective.provider),
    provider: effective.provider,
    modelId: effective.modelId,
    machineId: claimingMachineId,
    reason:
      decision === null
        ? effective.switchReason !== undefined
          ? `fallback (${effective.switchReason})`
          : 'configured model'
        : agrees
          ? decision.reason
          : decision.chosen === null
            ? `rule default (${decision.reason})`
            : `availability changed during the claim: kept the accepted ${effective.modelId}`,
    rejected: decision?.rejected ?? [],
    decidedAt: nowMs(),
  };
  if (existing === null) {
    db.insert(stepRoute).values(row).onConflictDoNothing().run();
  } else {
    const rejection = decision?.rejected.find(
      (candidate) =>
        candidate.modelId === existing.modelId && candidate.machineId === existing.machineId,
    );
    row.reason = `re-routed: ${existing.modelId}${rejection === undefined ? '' : ` no longer runnable (${rejection.why})`}; ${row.reason}`;
    db.update(stepRoute).set(row).where(eq(stepRoute.stepId, stepRow.id)).run();
  }
  return storedStepRoute(db, stepRow.id) ?? row;
}

export function routedModelRunsOn(
  db: Pick<Db, 'select'>,
  machineRow: Pick<
    typeof machine.$inferSelect,
    'id' | 'teamId' | 'online' | 'claudeCodeReport' | 'claudeRateLimits' | 'capabilities'
  >,
  model: { provider: string | null; modelId: string | null },
): boolean {
  if (model.provider === null || model.modelId === null) return false;
  const sources = listConnectedTierSources(db, machineRow.teamId, model.provider, model.modelId);
  const source = sources.find((s) => s.provider === model.provider);
  if (source === undefined) return false;
  const modelKnown =
    source.models.some((m) => m.id === model.modelId) || model.provider === CODEX_MODEL.provider;
  if (!modelKnown) return false;
  const now = nowMs();
  const status = candidateAvailableOnMachine(
    db,
    machineRow as typeof machine.$inferSelect,
    source,
    model.modelId,
    mergedCatalogModels(machineRow.teamId),
    {
      subscribed: hasActiveClaudeSubscription({ db }, machineRow.teamId),
      antigravityHostLogin: antigravityUsesHostLogin(db, machineRow.teamId),
      antigravityBlocked: antigravityQuotaExhausted(db, machineRow.teamId, now),
      now,
    },
  );
  if (!status.available) return false;
  if (source.runtime === 'claude-code') {
    const used = weeklyUsedPercent(machineRow as typeof machine.$inferSelect);
    if (used !== null && used >= QUOTA_REJECT_PERCENT) return false;
  }
  return true;
}
