import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { codexLoginAvailable, usesHostCodexLogin } from '../coordinator/codex-login.js';
import type { Db } from '../db/client.js';
import { provider, routingRule } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { coordinatorRunsOnPi } from './coordinator-context.js';
import { paidClaudeAllowed } from './model-routing.js';
import { keylessEndpoint, resolveRuleProvider } from './routing-rules.js';

export type CoordinatorRouteFallback =
  | 'no-api-key-provider'
  | 'rule-provider-has-no-key'
  | 'paid-claude-not-allowed';

type FallbackLog = (teamId: string, reason: CoordinatorRouteFallback) => void;

let logFallback: FallbackLog = () => {};
const logged = new Set<string>();

export function setCoordinatorRouteLog(log: FallbackLog): void {
  logFallback = log;
  logged.clear();
}

function fallback(teamId: string, reason: CoordinatorRouteFallback): null {
  const key = `${teamId}:${reason}`;
  if (!logged.has(key)) {
    logged.add(key);
    logFallback(teamId, reason);
  }
  return null;
}

const MODEL_PREFERENCE = [/haiku/i, /sonnet/i];

const ANTHROPIC_API_HOST = 'api.anthropic.com';

function isAnthropicApi(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === ANTHROPIC_API_HOST;
  } catch {
    return false;
  }
}

function keyedAnthropicProvider(db: Db, teamId: string) {
  return db
    .select({ providerId: provider.providerId, models: provider.models, baseUrl: provider.baseUrl })
    .from(provider)
    .where(
      and(
        eq(provider.teamId, teamId),
        eq(provider.api, 'anthropic-messages'),
        isNotNull(provider.apiKeyCipher),
      ),
    )
    .all()
    .find((row) => isAnthropicApi(row.baseUrl) && row.models.length > 0);
}

function seedCoordinatorRule(db: Db, teamId: string) {
  const source = keyedAnthropicProvider(db, teamId);
  if (source === undefined) return undefined;
  const ids = source.models.map((m) => m.id);
  const modelId =
    MODEL_PREFERENCE.map((re) => ids.find((id) => re.test(id))).find((id) => id !== undefined) ??
    ids[0];
  if (modelId === undefined) return undefined;
  const now = nowMs();
  db.insert(routingRule)
    .values({
      id: newRecordId(),
      teamId,
      use: 'coordinator',
      provider: source.providerId,
      modelId,
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

export function coordinatorRoute(db: Db, teamId: string) {
  if (!coordinatorRunsOnPi()) return null;
  const rule = coordinatorRule(db, teamId) ?? seedCoordinatorRule(db, teamId);
  if (rule === undefined) return fallback(teamId, 'no-api-key-provider');
  const row = db
    .select({ baseUrl: provider.baseUrl, keyed: sql<number>`${provider.apiKeyCipher} is not null` })
    .from(provider)
    .where(and(eq(provider.teamId, teamId), eq(provider.providerId, rule.provider)))
    .get();
  const runnable =
    row !== undefined &&
    (row.keyed === 1 ||
      keylessEndpoint(rule.provider) ||
      (usesHostCodexLogin(rule.provider, row.baseUrl) && codexLoginAvailable()));
  if (!runnable) return fallback(teamId, 'rule-provider-has-no-key');
  if (!paidClaudeAllowed(db, teamId, rule.provider, rule.modelId)) {
    return fallback(teamId, 'paid-claude-not-allowed');
  }
  return rule;
}
