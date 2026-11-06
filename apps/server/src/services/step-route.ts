import {
  type CapabilityCandidate,
  classifyDifficulty,
  REVIEW_MODEL,
  type RouteWorkDecision,
  routeWork,
  type StepKind,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { machine, type routingRule, type step, stepRoute, team, type todo } from '../db/schema.js';
import { nowMs } from '../lib/ids.js';
import { machineUsesClaudeSubscription } from './model-routing.js';

type RoutingRuleRow = typeof routingRule.$inferSelect;
type StepRouteRow = typeof stepRoute.$inferSelect;
type RoutedTodo = Pick<typeof todo.$inferSelect, 'teamId'> &
  Partial<Pick<typeof todo.$inferSelect, 'title' | 'spec'>>;

const CLAUDE_MODELS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const SECONDS_TO_MS = 1000;

function weeklyUsedPercent(row: typeof machine.$inferSelect): number | null {
  const week = (row.claudeRateLimits ?? []).find(
    (window) => window.subscription === 'seven_day' || window.subscription === 'week',
  );
  if (week === undefined || week.utilization === null) return null;
  if (
    week.resetsAt !== null &&
    week.resetsAt !== undefined &&
    week.resetsAt < nowMs() / SECONDS_TO_MS
  ) {
    return null;
  }
  return week.utilization * 100;
}

export function capabilityCandidates(db: Db, teamId: string): CapabilityCandidate[] {
  const now = nowMs();
  const allowPaid =
    db.select().from(team).where(eq(team.id, teamId)).get()?.claudeUsage === 'allow-paid';
  const candidates: CapabilityCandidate[] = [];
  for (const row of db.select().from(machine).where(eq(machine.teamId, teamId)).all()) {
    const report = row.claudeCodeReport;
    const claudeInstalled =
      report?.installed === true && row.enabledRuntimes.includes('claude-code');
    const paid = !machineUsesClaudeSubscription(report) && !allowPaid;
    const claudeUsable =
      claudeInstalled &&
      row.online &&
      !paid &&
      report?.auth?.state !== 'not-logged-in' &&
      report?.login?.state !== 'expired';
    for (const modelId of CLAUDE_MODELS) {
      candidates.push({
        harness: 'claude-code',
        provider: 'claude-code',
        modelId,
        machineId: row.id,
        available: claudeUsable,
        ...(claudeInstalled ? {} : { unavailableWhy: 'harness-missing' as const }),
        weeklyUsedPercent: weeklyUsedPercent(row),
      });
    }
    const codexLogin = row.capabilities?.codexLogin;
    if (codexLogin === undefined) continue;
    const piEnabled = row.enabledRuntimes.includes('pi');
    candidates.push({
      harness: 'pi',
      provider: REVIEW_MODEL.provider,
      modelId: REVIEW_MODEL.modelId,
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

export function decideStepRoute(
  db: Db,
  todoRow: RoutedTodo,
  kind: StepKind,
  stepId: string | null,
): RouteWorkDecision {
  const difficulty = classifyDifficulty({ title: todoRow.title ?? '', spec: todoRow.spec ?? null });
  const stored = stepId === null ? null : storedStepRoute(db, stepId);
  if (stored !== null && stored.provider !== null && stored.modelId !== null) {
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
  return routeWork({ kind, difficulty }, capabilityCandidates(db, todoRow.teamId));
}

export function routedRule(
  db: Db,
  rule: RoutingRuleRow,
  todoRow: RoutedTodo,
  kind: StepKind,
  stepId: string | null,
): RoutingRuleRow {
  const decision = decideStepRoute(db, todoRow, kind, stepId);
  if (decision.chosen === null) {
    return rule.use === 'review'
      ? { ...rule, provider: REVIEW_MODEL.provider, modelId: REVIEW_MODEL.modelId }
      : rule;
  }
  return {
    ...rule,
    provider: decision.chosen.provider,
    modelId: decision.chosen.modelId,
    machineId: rule.machineId ?? decision.chosen.machineId,
  };
}

export function recordStepRoute(
  db: Db,
  stepRow: Pick<typeof step.$inferSelect, 'id' | 'kind'>,
  todoRow: RoutedTodo,
  claimingMachineId: string,
  effective: { provider: string | null; modelId: string | null },
): StepRouteRow {
  const existing = storedStepRoute(db, stepRow.id);
  if (existing !== null) return existing;
  const decision = decideStepRoute(db, todoRow, stepRow.kind, null);
  const row: StepRouteRow = {
    stepId: stepRow.id,
    teamId: todoRow.teamId,
    kind: stepRow.kind,
    difficulty: decision.difficulty,
    harness:
      decision.chosen?.harness ?? (effective.provider === 'claude-code' ? 'claude-code' : 'pi'),
    provider: decision.chosen?.provider ?? effective.provider,
    modelId: decision.chosen?.modelId ?? effective.modelId,
    machineId: claimingMachineId,
    reason: decision.chosen === null ? `rule default (${decision.reason})` : decision.reason,
    rejected: decision.rejected,
    decidedAt: nowMs(),
  };
  db.insert(stepRoute).values(row).onConflictDoNothing().run();
  return storedStepRoute(db, stepRow.id) ?? row;
}
