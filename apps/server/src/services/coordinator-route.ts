import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { type agent, provider, routingRule, team } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { coordinatorRunsOnPi } from './coordinator-context.js';
import { applyRoute } from './routing-rules.js';

type AgentRow = typeof agent.$inferSelect;

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
  return db
    .select()
    .from(routingRule)
    .where(and(eq(routingRule.teamId, teamId), eq(routingRule.use, 'coordinator')))
    .get();
}

export function coordinatorRoute(db: Db, teamId: string) {
  if (!coordinatorRunsOnPi()) return null;
  const rule = coordinatorRule(db, teamId) ?? seedCoordinatorRule(db, teamId);
  if (rule === undefined) return fallback(teamId, 'no-api-key-provider');
  const keyed = db
    .select({ id: provider.id })
    .from(provider)
    .where(
      and(
        eq(provider.teamId, teamId),
        eq(provider.providerId, rule.provider),
        isNotNull(provider.apiKeyCipher),
      ),
    )
    .get();
  if (keyed === undefined) return fallback(teamId, 'rule-provider-has-no-key');
  const usage = db
    .select({ claudeUsage: team.claudeUsage })
    .from(team)
    .where(eq(team.id, teamId))
    .get();
  if (usage?.claudeUsage !== 'allow-paid') {
    return fallback(teamId, 'paid-claude-not-allowed');
  }
  return rule;
}

export function routedChiefAgent(db: Db, teamId: string, agentRow: AgentRow): AgentRow {
  return applyRoute(agentRow, coordinatorRoute(db, teamId));
}
