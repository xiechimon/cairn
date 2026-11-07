import { AGENT_TOOL_DEFAULTS } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { routingRule, team, workPolicy } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import { listClaudeCodeSources } from './providers.js';

export const DEFAULT_SESSION_PROVIDER = 'claude-code';
export const DEFAULT_SESSION_MODEL = 'claude-sonnet-5-5';

export interface DefaultRoutingReport {
  sessionRules: number;
  coordinatorRules: number;
  policies: number;
}

function policyExists(db: Db, teamId: string, use: 'session' | 'review'): boolean {
  return (
    db
      .select({ id: workPolicy.id })
      .from(workPolicy)
      .where(and(eq(workPolicy.teamId, teamId), eq(workPolicy.use, use)))
      .get() !== undefined
  );
}

function insertPolicy(db: Db, teamId: string, use: 'session' | 'review', tools: string[]): number {
  const now = nowMs();
  return db
    .insert(workPolicy)
    .values({
      id: newRecordId(),
      teamId,
      use,
      tools,
      mcpServers: [],
      skillsAllowlist: null,
      defaultSkill: null,
      secrets: [],
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run().changes;
}

function usableCoordinatorModel(db: Db, teamId: string): string | null {
  const usable = listClaudeCodeSources(db, teamId).filter(
    (source) => source.installed && source.auth?.state === 'logged-in',
  );
  if (usable.length === 0) return null;
  const offered = usable.flatMap((source) => source.models.map((model) => model.id));
  if (offered.length === 0 || offered.includes(DEFAULT_SESSION_MODEL)) return DEFAULT_SESSION_MODEL;
  return offered[0] ?? DEFAULT_SESSION_MODEL;
}

function seedCoordinatorRule(db: Db, teamId: string): number {
  const exists =
    db
      .select({ id: routingRule.id })
      .from(routingRule)
      .where(and(eq(routingRule.teamId, teamId), eq(routingRule.use, 'coordinator')))
      .get() !== undefined;
  if (exists) return 0;
  const modelId = usableCoordinatorModel(db, teamId);
  if (modelId === null) return 0;
  const now = nowMs();
  return db
    .insert(routingRule)
    .values({
      id: newRecordId(),
      teamId,
      use: 'coordinator',
      provider: DEFAULT_SESSION_PROVIDER,
      modelId,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run().changes;
}

export function seedDefaultRouting(db: Db): DefaultRoutingReport {
  const report: DefaultRoutingReport = { sessionRules: 0, coordinatorRules: 0, policies: 0 };
  for (const { id: teamId } of db.select({ id: team.id }).from(team).all()) {
    const hasSessionRule =
      db
        .select({ id: routingRule.id })
        .from(routingRule)
        .where(and(eq(routingRule.teamId, teamId), eq(routingRule.use, 'session')))
        .get() !== undefined;
    if (!hasSessionRule) {
      const now = nowMs();
      report.sessionRules += db
        .insert(routingRule)
        .values({
          id: newRecordId(),
          teamId,
          use: 'session',
          provider: DEFAULT_SESSION_PROVIDER,
          modelId: DEFAULT_SESSION_MODEL,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run().changes;
    }
    report.coordinatorRules += seedCoordinatorRule(db, teamId);
    if (!policyExists(db, teamId, 'session')) {
      report.policies += insertPolicy(db, teamId, 'session', [...AGENT_TOOL_DEFAULTS]);
    }
    if (!policyExists(db, teamId, 'review')) {
      report.policies += insertPolicy(db, teamId, 'review', []);
    }
  }
  return report;
}
