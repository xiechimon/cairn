import { ROUTE_USES, type RuleFix, type RuleIssue, type RuleIssueReason } from '@cairn/shared';
import { and, asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { machine, provider, routingRule } from '../db/schema.js';
import { coordinatorRunsOnPi } from './coordinator-context.js';
import { type CoordinatorRouteRefusal, coordinatorRouteVerdict } from './coordinator-route.js';
import {
  codexProviderKeyed,
  machineRuntimeAvailable,
  runtimeGatePasses,
  stepRuntimeFor,
} from './dispatch-eligibility.js';
import {
  defaultCoordinatorChoice,
  defaultSessionChoice,
  keylessEndpoint,
  ROUTED_PROVIDERS,
  resolveRuleProvider,
} from './routing-rules.js';
import { machineSatisfies } from './step-route.js';

type RoutingRuleRow = typeof routingRule.$inferSelect;
type MachineRow = typeof machine.$inferSelect;
type RuleProblem = Omit<RuleIssue, 'use' | 'suggested'>;

const COORDINATOR_REFUSAL_REASON: Record<CoordinatorRouteRefusal, RuleIssueReason> = {
  'no-api-key-provider': 'provider-missing',
  'rule-provider-missing': 'provider-missing',
  'rule-provider-has-no-key': 'provider-no-key',
};

function providerProblem(db: Pick<Db, 'select'>, rule: RoutingRuleRow): RuleProblem | null {
  const row = db
    .select({ keyed: sql<number>`${provider.apiKeyCipher} is not null` })
    .from(provider)
    .where(and(eq(provider.teamId, rule.teamId), eq(provider.providerId, rule.provider)))
    .get();
  if (row === undefined) return { reason: 'provider-missing', provider: rule.provider };
  const runnable = row.keyed === 1 || keylessEndpoint(rule.provider);
  if (!runnable) return { reason: 'provider-no-key', provider: rule.provider };
  return null;
}

function capabilityRouted(rule: RoutingRuleRow): boolean {
  return rule.use === 'session' && ROUTED_PROVIDERS.includes(rule.provider);
}

function runsRule(m: MachineRow, rule: RoutingRuleRow, codexProvider: boolean): boolean {
  if (!capabilityRouted(rule)) return runtimeGatePasses(m, rule.provider);
  return machineRuntimeAvailable(m, 'claude-code') || codexProvider;
}

function ruleProblem(
  db: Db,
  rule: RoutingRuleRow,
  machines: readonly MachineRow[],
): RuleProblem | null {
  const verdict =
    rule.use === 'coordinator' && coordinatorRunsOnPi()
      ? coordinatorRouteVerdict(db, rule.teamId)
      : null;
  if (verdict !== null) {
    if (!('refusal' in verdict)) return null;
    return { reason: COORDINATOR_REFUSAL_REASON[verdict.refusal], provider: rule.provider };
  }
  const runtime = stepRuntimeFor(rule.provider);
  const codexProvider = capabilityRouted(rule) && codexProviderKeyed(db, rule.teamId);
  if (machines.length > 0 && !machines.some((m) => runsRule(m, rule, codexProvider))) {
    return { reason: 'runtime-disabled', runtime };
  }
  if (rule.machineId !== null || rule.requiredCapabilities !== null) {
    const constraints = { machineId: rule.machineId, required: rule.requiredCapabilities };
    const usable = machines.some(
      (m) => machineSatisfies(m, constraints) && runsRule(m, rule, codexProvider),
    );
    if (!usable) {
      return {
        reason: 'machine-unusable',
        ...(rule.machineId === null ? {} : { machineId: rule.machineId }),
      };
    }
  }
  return runtime === 'pi' && !capabilityRouted(rule) ? providerProblem(db, rule) : null;
}

function ruleFix(db: Pick<Db, 'select'>, rule: RoutingRuleRow): RuleFix | null {
  const choice =
    rule.use === 'session'
      ? defaultSessionChoice(db, rule.teamId)
      : rule.use === 'coordinator' && coordinatorRunsOnPi()
        ? defaultCoordinatorChoice(db, rule.teamId)
        : null;
  if (choice === null) return null;
  return {
    provider: choice.provider,
    modelId: choice.modelId,
    ...(rule.machineId === null ? {} : { machineId: null }),
    ...(rule.requiredCapabilities === null ? {} : { requiredCapabilities: null }),
    ...(rule.fallbackModels === null ? {} : { fallbackModels: null }),
    ...(rule.thinkingLevel === null ? {} : { thinkingLevel: null }),
    expectedUpdatedAt: rule.updatedAt,
  };
}

export function routingRuleIssues(db: Db, teamId: string): RuleIssue[] {
  const machines = db.select().from(machine).where(eq(machine.teamId, teamId)).all();
  return db
    .select()
    .from(routingRule)
    .where(eq(routingRule.teamId, teamId))
    .orderBy(asc(routingRule.use))
    .all()
    .filter((row) => ROUTE_USES.includes(row.use))
    .flatMap((row) => {
      const problem = ruleProblem(db, resolveRuleProvider(db, row), machines);
      return problem === null ? [] : [{ use: row.use, ...problem, suggested: ruleFix(db, row) }];
    });
}
