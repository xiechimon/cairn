import { and, eq, sql } from 'drizzle-orm';
import { codexLoginAvailable, usesHostCodexLogin } from '../coordinator/codex-login.js';
import type { Db } from '../db/client.js';
import { provider, routingRule } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { coordinatorRunsOnPi } from './coordinator-context.js';
import { paidClaudeAllowed } from './model-routing.js';
import {
  anthropicCoordinatorChoice,
  defaultCoordinatorRule,
  keylessEndpoint,
  resolveRuleProvider,
} from './routing-rules.js';

const CLAUDE_CODE_PROVIDER = 'claude-code';

export type CoordinatorRouteRefusal =
  | 'no-api-key-provider'
  | 'rule-provider-missing'
  | 'rule-provider-has-no-key'
  | 'paid-claude-not-allowed';

function seedCoordinatorRule(db: Db, teamId: string) {
  const choice = anthropicCoordinatorChoice(db, teamId);
  if (choice === null) return undefined;
  const now = nowMs();
  db.insert(routingRule)
    .values({
      id: newRecordId(),
      teamId,
      use: 'coordinator',
      provider: choice.provider,
      modelId: choice.modelId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();
  return coordinatorRule(db, teamId);
}

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
  const rule =
    coordinatorRule(db, teamId) ??
    seedCoordinatorRule(db, teamId) ??
    defaultCoordinatorRule(db, teamId) ??
    undefined;
  if (rule === undefined) return { refusal: 'no-api-key-provider' };
  if (rule.provider === CLAUDE_CODE_PROVIDER) return null;
  const row = db
    .select({ baseUrl: provider.baseUrl, keyed: sql<number>`${provider.apiKeyCipher} is not null` })
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, rule.provider)))
    .get();
  if (row === undefined) return { refusal: 'rule-provider-missing', rule };
  const runnable =
    row.keyed === 1 ||
    keylessEndpoint(rule.provider) ||
    (usesHostCodexLogin(rule.provider, row.baseUrl) && codexLoginAvailable());
  if (!runnable) return { refusal: 'rule-provider-has-no-key', rule };
  if (!paidClaudeAllowed(db, teamId, rule.provider, rule.modelId)) {
    return { refusal: 'paid-claude-not-allowed', rule };
  }
  return { rule };
}

export function coordinatorRoute(db: Db, teamId: string): CoordinatorRule | null {
  const verdict = coordinatorRouteVerdict(db, teamId);
  return verdict === null || 'refusal' in verdict ? null : verdict.rule;
}
