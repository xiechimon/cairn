import {
  type CapabilityCandidate,
  CODEX_MODEL,
  classifyDifficulty,
  claudeLoginBlocksClaim,
  claudeRateBlock,
  QUOTA_REJECT_PERCENT,
  type RequiredCapabilities,
  type RouteWorkDecision,
  routeWork,
  type StepKind,
} from '@cairn/shared';
import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { machine, step, stepRoute, type todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { claudeUsageGatePasses } from './claude-rate-limit.js';
import { hasActiveClaudeSubscription } from './claude-subscriptions.js';
import { homeMachineRejectReason, missingCapabilityItems } from './dispatch-eligibility.js';
import { mergedCatalogModels } from './model-liveness.js';

type StepRouteRow = typeof stepRoute.$inferSelect;

export type BuildStepRoute = {
  buildId: string;
  stepId: string;
  kind: StepKind;
  harness: 'claude-code' | 'pi' | null;
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

function machineSatisfies(
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

const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];

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

export function capabilityCandidates(
  db: Pick<Db, 'select'>,
  teamId: string,
  constraints: RouteConstraints,
): CapabilityCandidate[] {
  const now = nowMs();
  const catalog = mergedCatalogModels();
  const candidates: CapabilityCandidate[] = [];
  for (const row of db.select().from(machine).where(eq(machine.teamId, teamId)).all()) {
    if (!machineSatisfies(row, constraints)) continue;
    const report = row.claudeCodeReport;
    const claudeInstalled =
      report?.installed === true && row.enabledRuntimes.includes('claude-code');
    const claudeUsable =
      claudeInstalled &&
      row.online &&
      claudeUsageGatePasses({ db }, row, {
        provider: 'claude-code',
        modelId: 'claude-sonnet-5-5',
      }) &&
      claudeRateBlock(row.claudeRateLimits ?? [], now) === null &&
      report?.auth?.state !== 'not-logged-in' &&
      (hasActiveClaudeSubscription({ db }, teamId) || !claudeLoginBlocksClaim(report?.login, now));
    for (const modelId of CLAUDE_MODELS) {
      candidates.push({
        harness: 'claude-code',
        provider: 'claude-code',
        modelId,
        machineId: row.id,
        available:
          claudeUsable &&
          homeMachineRejectReason(row, { provider: 'claude-code', modelId }, catalog) === null,
        ...(claudeInstalled ? {} : { unavailableWhy: 'harness-missing' as const }),
        weeklyUsedPercent: weeklyUsedPercent(row),
      });
    }
    const codexLogin = row.capabilities?.codexLogin;
    if (codexLogin === undefined) continue;
    const piEnabled = row.enabledRuntimes.includes('pi');
    candidates.push({
      harness: 'pi',
      provider: CODEX_MODEL.provider,
      modelId: CODEX_MODEL.modelId,
      machineId: row.id,
      available:
        piEnabled &&
        row.online &&
        codexLogin.state === 'ok' &&
        codexLogin.expiresAt !== undefined &&
        codexLogin.expiresAt > now,
      ...(piEnabled ? {} : { unavailableWhy: 'harness-missing' as const }),
      weeklyUsedPercent: null,
    });
  }
  return candidates;
}

export function storedStepRoute(db: Pick<Db, 'select'>, stepId: string): StepRouteRow | null {
  return db.select().from(stepRoute).where(eq(stepRoute.stepId, stepId)).get() ?? null;
}

function routeIsReleasable(db: Pick<Db, 'select'>, stepId: string): boolean {
  const row = db
    .select({
      status: step.status,
      sessionId: step.sessionId,
      checkpointCommit: step.checkpointCommit,
    })
    .from(step)
    .where(eq(step.id, stepId))
    .get();
  return row?.status === 'pending' && row.sessionId === null && row.checkpointCommit === null;
}

export function decideStepRoute(
  db: Pick<Db, 'select'>,
  todoRow: RoutedTodo,
  kind: StepKind,
  stepId: string | null,
  constraints: RouteConstraints,
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
  return routeWork({ kind, difficulty }, capabilityCandidates(db, todoRow.teamId, constraints));
}

function harnessOf(provider: string | null): 'claude-code' | 'pi' | null {
  if (provider === 'claude-code') return 'claude-code';
  return provider === CODEX_MODEL.provider ? 'pi' : null;
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
  const decision = decideStepRoute(db, todoRow, stepRow.kind, null, {
    machineId: effective.machineId,
    required: effective.requiredCapabilities,
  });
  const agrees =
    decision.chosen !== null &&
    decision.chosen.provider === effective.provider &&
    decision.chosen.modelId === effective.modelId;
  const row: StepRouteRow = {
    stepId: stepRow.id,
    teamId: todoRow.teamId,
    kind: stepRow.kind,
    difficulty: decision.difficulty,
    harness: harnessOf(effective.provider),
    provider: effective.provider,
    modelId: effective.modelId,
    machineId: claimingMachineId,
    reason: agrees
      ? decision.reason
      : decision.chosen === null
        ? `rule default (${decision.reason})`
        : `availability changed during the claim: kept the accepted ${effective.modelId}`,
    rejected: decision.rejected,
    decidedAt: nowMs(),
  };
  if (existing === null) {
    db.insert(stepRoute).values(row).onConflictDoNothing().run();
  } else {
    const rejection = decision.rejected.find(
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
  machineRow: Pick<typeof machine.$inferSelect, 'id' | 'teamId'>,
  model: { provider: string | null; modelId: string | null },
): boolean {
  return capabilityCandidates(db, machineRow.teamId, {
    machineId: machineRow.id,
    required: null,
  }).some(
    (candidate) =>
      candidate.available &&
      (candidate.weeklyUsedPercent === null ||
        candidate.weeklyUsedPercent < QUOTA_REJECT_PERCENT) &&
      candidate.provider === model.provider &&
      candidate.modelId === model.modelId,
  );
}
