import { AGENT_TOOL_DEFAULTS } from '@cairn/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agent, routingRule, team, workPolicy } from '../db/schema.js';
import { newRecordId, nowMs } from '../lib/ids.js';
import {
  adoptAgentMemories,
  seedReviewPolicies,
  seedReviewRules,
  seedRoutingRules,
  seedWorkPolicies,
} from './routing-rules.js';

export const DEFAULT_SESSION_PROVIDER = 'claude-code';
export const DEFAULT_SESSION_MODEL = 'claude-sonnet-5-5';

export interface WithheldSecrets {
  teamId: string;
  agentId: string;
  agentName: string;
  secretCount: number;
}

export interface RoutingMigrationReport {
  sessionRules: number;
  defaultRules: number;
  reviewRules: number;
  policies: number;
  memoriesAdopted: number;
  withheldSecrets: WithheldSecrets[];
}

function teamsWithoutSessionPolicy(db: Db): string[] {
  return db
    .select({ id: team.id })
    .from(team)
    .all()
    .map((row) => row.id)
    .filter(
      (teamId) =>
        db
          .select({ id: workPolicy.id })
          .from(workPolicy)
          .where(and(eq(workPolicy.teamId, teamId), eq(workPolicy.use, 'session')))
          .get() === undefined,
    );
}

function seedDefaultSessionRules(db: Db): number {
  let inserted = 0;
  for (const { id: teamId } of db.select({ id: team.id }).from(team).all()) {
    const existing = db
      .select({ id: routingRule.id })
      .from(routingRule)
      .where(and(eq(routingRule.teamId, teamId), eq(routingRule.use, 'session')))
      .get();
    if (existing !== undefined) continue;
    const now = nowMs();
    db.transaction((tx) => {
      tx.insert(routingRule)
        .values({
          id: newRecordId(),
          teamId,
          use: 'session',
          provider: DEFAULT_SESSION_PROVIDER,
          modelId: DEFAULT_SESSION_MODEL,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      tx.insert(workPolicy)
        .values({
          id: newRecordId(),
          teamId,
          use: 'session',
          tools: [...AGENT_TOOL_DEFAULTS],
          mcpServers: [],
          skillsAllowlist: null,
          defaultSkill: null,
          secrets: [],
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .run();
    });
    inserted += 1;
  }
  return inserted;
}

function withheldSecretsOf(db: Db, teamIds: readonly string[]): WithheldSecrets[] {
  const withheld: WithheldSecrets[] = [];
  for (const teamId of teamIds) {
    const policy = db
      .select({ seededFromAgentId: workPolicy.seededFromAgentId })
      .from(workPolicy)
      .where(and(eq(workPolicy.teamId, teamId), eq(workPolicy.use, 'session')))
      .get();
    if (policy?.seededFromAgentId == null) continue;
    for (const row of db.select().from(agent).where(eq(agent.teamId, teamId)).all()) {
      if (row.id === policy.seededFromAgentId || row.secrets.length === 0) continue;
      withheld.push({
        teamId,
        agentId: row.id,
        agentName: row.displayName,
        secretCount: row.secrets.length,
      });
    }
  }
  return withheld;
}

export function runRoutingMigration(db: Db): RoutingMigrationReport {
  const pendingTeams = teamsWithoutSessionPolicy(db);
  const sessionRules = seedRoutingRules(db);
  const defaultRules = seedDefaultSessionRules(db);
  const reviewRules = seedReviewRules(db);
  const policies = seedWorkPolicies(db) + seedReviewPolicies(db);
  const memoriesAdopted = adoptAgentMemories(db);
  return {
    sessionRules,
    defaultRules,
    reviewRules,
    policies: policies + defaultRules,
    memoriesAdopted,
    withheldSecrets: withheldSecretsOf(db, pendingTeams),
  };
}
