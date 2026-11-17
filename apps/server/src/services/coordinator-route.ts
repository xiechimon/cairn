import { and, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { provider, routingRule } from '../db/schema.js';
import { coordinatorRunsOnPi } from './coordinator-context.js';
import {
  defaultCoordinatorRule,
  keylessEndpoint,
  projectModelChoice,
  resolveRuleProvider,
} from './routing-rules.js';

const CLAUDE_CODE_PROVIDER = 'claude-code';

export type CoordinatorRouteRefusal =
  | 'no-api-key-provider'
  | 'rule-provider-missing'
  | 'rule-provider-has-no-key';

function coordinatorRule(db: Db, teamId: string) {
  const row = db
    .select()
    .from(routingRule)
    .where(and(eq(routingRule.teamId, teamId), eq(routingRule.use, 'coordinator')))
    .get();
  return row === undefined ? undefined : resolveRuleProvider(db, row, true);
}

type CoordinatorRule = NonNullable<ReturnType<typeof coordinatorRule>>;

export function coordinatorRouteVerdict(
  db: Db,
  teamId: string,
): { rule: CoordinatorRule } | { refusal: CoordinatorRouteRefusal; rule?: CoordinatorRule } | null {
  if (!coordinatorRunsOnPi()) return null;
  const rule = coordinatorRule(db, teamId) ?? defaultCoordinatorRule(db, teamId) ?? undefined;
  if (rule === undefined) return { refusal: 'no-api-key-provider' };
  if (rule.provider === CLAUDE_CODE_PROVIDER) return null;
  const refusal = providerRefusal(db, teamId, rule.provider);
  return refusal === null ? { rule } : { refusal, rule };
}

export function providerRefusal(
  db: Db,
  teamId: string,
  providerId: string,
): Exclude<CoordinatorRouteRefusal, 'no-api-key-provider'> | null {
  const row = db
    .select({ keyed: sql<number>`${provider.apiKeyCipher} is not null` })
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, providerId)))
    .get();
  if (row === undefined) return 'rule-provider-missing';
  return row.keyed === 1 || keylessEndpoint(providerId) ? null : 'rule-provider-has-no-key';
}

export function coordinatorRoute(
  db: Db,
  teamId: string,
  projectId: string | null = null,
): CoordinatorRule | null {
  const verdict = coordinatorRouteVerdict(db, teamId);
  if (verdict === null || 'refusal' in verdict) return null;
  const choice = projectModelChoice(db, projectId, 'coordinator');
  if (
    choice === null ||
    choice.provider === CLAUDE_CODE_PROVIDER ||
    providerRefusal(db, teamId, choice.provider) !== null
  ) {
    return verdict.rule;
  }
  return { ...verdict.rule, ...choice };
}
