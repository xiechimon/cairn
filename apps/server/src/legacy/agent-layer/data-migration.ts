import type Database from 'better-sqlite3';
import { and, eq, isNull } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { newRecordId, nowMs } from '../../lib/ids.js';
import { modelsAreIndependent } from '../../services/merge-gate/model-identity.js';
import type { Db } from './db.js';
import { runRoutingMigration } from './routing-migration.js';
import { seedRoutingRules } from './routing-rules.js';
import * as schema from './schema.js';

export const AGENT_LAYER_MIGRATION_ID = 'drop-agents';

const DEFAULT_SESSION_MODEL = 'claude-sonnet-5-5';
const REVIEWER_PERSONAS = ['code_reviewer', 'security_auditor', 'test_engineer'];
const CITATION_SOURCE_KIND = 'research-citation-check';

type AgentRow = typeof schema.agent.$inferSelect;
type RuleUse = typeof schema.routingRule.$inferInsert.use;

export interface AgentLayerTeamReport {
  teamId: string;
  rulesCreated: number;
  policiesCreated: number;
  machineFallbacks: number;
  memoriesMoved: number;
  candidatesRekeyed: number;
}

export interface AgentLayerMigrationOutcome {
  alreadyDone: boolean;
  hadAgents: boolean;
  teams: AgentLayerTeamReport[];
}

export class AgentLayerMigrationError extends Error {
  constructor(teamId: string | null, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `Agent-layer data migration failed${teamId === null ? '' : ` for team ${teamId}`}: ${reason}. ` +
        'Nothing was written and no table was dropped. Fix the cause (or restore the legacy_agent_backup rows) and restart; the migration is safe to retry.',
      { cause },
    );
    this.name = 'AgentLayerMigrationError';
  }
}

function tableExists(sqlite: Database.Database, name: string): boolean {
  return (
    sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  );
}

function ruleOf(db: Db, teamId: string, use: RuleUse) {
  return db
    .select()
    .from(schema.routingRule)
    .where(and(eq(schema.routingRule.teamId, teamId), eq(schema.routingRule.use, use)))
    .get();
}

function mostAssigned(counts: Map<string, number>, candidates: AgentRow[]): AgentRow | undefined {
  return [...candidates]
    .filter((row) => (counts.get(row.id) ?? 0) > 0)
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.id.localeCompare(b.id))
    .at(0);
}

function executorRequirement(db: Db, source: AgentRow) {
  const own = source.requiredCapabilities ?? null;
  const home =
    source.machineId === null
      ? undefined
      : db.select().from(schema.machine).where(eq(schema.machine.id, source.machineId)).get();
  const orb =
    home !== undefined &&
    (home.capabilities?.executor === 'orb' ||
      (home.capabilities?.executor === undefined && home.name.endsWith('-orb')));
  return orb ? { ...(own ?? {}), executor: 'orb' as const } : own;
}

function insertRule(db: Db, use: RuleUse, source: AgentRow, id?: string): void {
  const now = nowMs();
  db.insert(schema.routingRule)
    .values({
      id: id ?? newRecordId(),
      teamId: source.teamId,
      use,
      provider: source.provider ?? '',
      modelId: source.modelId ?? '',
      thinkingLevel: source.thinkingLevel,
      fallbackModels: source.fallbackModels,
      machineId: source.machineId,
      requiredCapabilities:
        use === 'coordinator' || use === 'citation_check' ? executorRequirement(db, source) : null,
      mcpServers: use === 'coordinator' ? source.mcpServers : null,
      seededFromAgentId: source.id,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .run();
}

function usable(row: AgentRow): boolean {
  return row.provider !== null && row.modelId !== null;
}

function countRows(db: Db, teamId: string): { rules: number; policies: number } {
  return {
    rules: db
      .select({ id: schema.routingRule.id })
      .from(schema.routingRule)
      .where(eq(schema.routingRule.teamId, teamId))
      .all().length,
    policies: db
      .select({ id: schema.workPolicy.id })
      .from(schema.workPolicy)
      .where(eq(schema.workPolicy.teamId, teamId))
      .all().length,
  };
}

function preseedRules(db: Db, teamId: string): void {
  const agents = db.select().from(schema.agent).where(eq(schema.agent.teamId, teamId)).all();
  const todos = db.select().from(schema.todo).where(eq(schema.todo.teamId, teamId)).all();
  const chiefRow = db.select().from(schema.chief).where(eq(schema.chief.teamId, teamId)).get();
  const chiefAgentId = chiefRow?.agentId ?? null;
  const sessionModel = ruleOf(db, teamId, 'session')?.modelId ?? DEFAULT_SESSION_MODEL;
  const nonChief = agents.filter((row) => row.id !== chiefAgentId && usable(row));

  const chiefAgent = agents.find((row) => row.id === chiefAgentId);
  if (chiefAgent !== undefined && usable(chiefAgent)) {
    const existing = ruleOf(db, teamId, 'coordinator');
    if (existing === undefined) insertRule(db, 'coordinator', chiefAgent, chiefAgent.id);
    else if (existing.mcpServers === null) {
      db.update(schema.routingRule)
        .set({ mcpServers: chiefAgent.mcpServers })
        .where(eq(schema.routingRule.id, existing.id))
        .run();
    }
  }

  const citationTodos = todos.filter((row) => row.sourceKind === CITATION_SOURCE_KIND);
  if (citationTodos.length > 0 && ruleOf(db, teamId, 'citation_check') === undefined) {
    const counts = new Map<string, number>();
    for (const row of citationTodos) {
      const id = row.assignment?.build?.agentId;
      if (id != null) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const assigned = mostAssigned(counts, nonChief);
    const independent = nonChief
      .filter(
        (row) =>
          row.status === 'active' &&
          row.persona === null &&
          modelsAreIndependent(sessionModel, row.modelId ?? ''),
      )
      .sort(
        (a, b) =>
          Number(b.displayName === 'eval-harbor') - Number(a.displayName === 'eval-harbor') ||
          a.id.localeCompare(b.id),
      )
      .at(0);
    const checker = assigned ?? independent;
    if (checker !== undefined) insertRule(db, 'citation_check', checker);
  }
}

function createAssignedReviewRule(db: Db, teamId: string): void {
  const agents = db.select().from(schema.agent).where(eq(schema.agent.teamId, teamId)).all();
  if (
    ruleOf(db, teamId, 'review') !== undefined ||
    agents.some((row) => row.persona === 'code_reviewer')
  ) {
    return;
  }
  const todos = db.select().from(schema.todo).where(eq(schema.todo.teamId, teamId)).all();
  const chiefAgentId =
    db.select().from(schema.chief).where(eq(schema.chief.teamId, teamId)).get()?.agentId ?? null;
  const counts = new Map<string, number>();
  for (const row of todos) {
    const id = row.assignment?.review?.agentId;
    if (id != null) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const reviewer = mostAssigned(
    counts,
    agents.filter((row) => row.id !== chiefAgentId && usable(row)),
  );
  const sessionModel = ruleOf(db, teamId, 'session')?.modelId ?? DEFAULT_SESSION_MODEL;
  if (reviewer !== undefined && modelsAreIndependent(sessionModel, reviewer.modelId ?? '')) {
    insertRule(db, 'review', reviewer);
  }
}

function fillMachineFallbacks(db: Db, teamId: string): number {
  let filled = 0;
  for (const rule of db
    .select()
    .from(schema.routingRule)
    .where(and(eq(schema.routingRule.teamId, teamId), isNull(schema.routingRule.machineId)))
    .all()) {
    if (rule.seededFromAgentId === null) continue;
    const source = db
      .select()
      .from(schema.agent)
      .where(eq(schema.agent.id, rule.seededFromAgentId))
      .get();
    if (source?.machineId == null) continue;
    db.update(schema.routingRule)
      .set({ machineId: source.machineId })
      .where(eq(schema.routingRule.id, rule.id))
      .run();
    filled += 1;
  }
  return filled;
}

function moveIndependentMemories(db: Db, teamId: string): number {
  const agents = db.select().from(schema.agent).where(eq(schema.agent.teamId, teamId)).all();
  const todos = db.select().from(schema.todo).where(eq(schema.todo.teamId, teamId)).all();
  const chiefAgentId =
    db.select().from(schema.chief).where(eq(schema.chief.teamId, teamId)).get()?.agentId ?? null;
  const reviewRule = ruleOf(db, teamId, 'review');
  const sessionRule = ruleOf(db, teamId, 'session');
  const reviewAssigned = new Set(todos.map((row) => row.assignment?.review?.agentId));
  const verifyAssigned = new Set(todos.map((row) => row.assignment?.verify?.agentId));
  let moved = 0;
  for (const row of agents) {
    if (row.id === chiefAgentId) continue;
    const reviewing =
      REVIEWER_PERSONAS.includes(row.persona ?? '') ||
      reviewRule?.seededFromAgentId === row.id ||
      reviewAssigned.has(row.id);
    const verifying = row.persona === 'verifier' || verifyAssigned.has(row.id);
    if (!reviewing && !verifying) continue;
    db.update(schema.agentMemory)
      .set({ independent: true })
      .where(eq(schema.agentMemory.agentId, row.id))
      .run();
    const owner =
      reviewing && reviewRule !== undefined
        ? reviewRule.id
        : !reviewing && sessionRule !== undefined
          ? `${sessionRule.id}:verify`
          : null;
    if (owner === null) continue;
    moved += db
      .update(schema.agentMemory)
      .set({ agentId: owner })
      .where(eq(schema.agentMemory.agentId, row.id))
      .run().changes;
  }
  return moved;
}

function rekeyCandidates(db: Db, teamId: string): number {
  const sessionRule = ruleOf(db, teamId, 'session');
  if (sessionRule === undefined) return 0;
  const chiefAgentId =
    db.select().from(schema.chief).where(eq(schema.chief.teamId, teamId)).get()?.agentId ?? null;
  let rekeyed = 0;
  for (const row of db.select().from(schema.agent).where(eq(schema.agent.teamId, teamId)).all()) {
    if (row.id === chiefAgentId) continue;
    rekeyed += db
      .update(schema.memoryCandidate)
      .set({ agentId: sessionRule.id })
      .where(eq(schema.memoryCandidate.agentId, row.id))
      .run().changes;
  }
  return rekeyed;
}

export function runAgentLayerDataMigration(sqlite: Database.Database): AgentLayerMigrationOutcome {
  if (!tableExists(sqlite, 'data_migration') || !tableExists(sqlite, 'agent')) {
    return { alreadyDone: true, hadAgents: false, teams: [] };
  }
  const done = sqlite
    .prepare('SELECT 1 FROM data_migration WHERE id = ?')
    .get(AGENT_LAYER_MIGRATION_ID);
  if (done !== undefined) return { alreadyDone: true, hadAgents: false, teams: [] };
  const hadAgents =
    (sqlite.prepare('SELECT count(*) AS n FROM agent').get() as { n: number }).n > 0;
  const root = drizzle(sqlite, { schema });
  let currentTeam: string | null = null;
  const teams: AgentLayerTeamReport[] = [];
  try {
    root.transaction((tx) => {
      const db = tx as unknown as Db;
      const teamIds = db
        .select({ id: schema.team.id })
        .from(schema.team)
        .all()
        .map((row) => row.id);
      const before = new Map(teamIds.map((id) => [id, countRows(db, id)]));
      seedRoutingRules(db);
      for (const teamId of teamIds) {
        currentTeam = teamId;
        preseedRules(db, teamId);
      }
      currentTeam = null;
      runRoutingMigration(db);
      for (const teamId of teamIds) {
        currentTeam = teamId;
        createAssignedReviewRule(db, teamId);
      }
      currentTeam = null;
      seedRoutingRules(db);
      for (const teamId of teamIds) {
        currentTeam = teamId;
        const machineFallbacks = fillMachineFallbacks(db, teamId);
        const memoriesMoved = moveIndependentMemories(db, teamId);
        const candidatesRekeyed = rekeyCandidates(db, teamId);
        const after = countRows(db, teamId);
        const prior = before.get(teamId) ?? { rules: 0, policies: 0 };
        teams.push({
          teamId,
          rulesCreated: after.rules - prior.rules,
          policiesCreated: after.policies - prior.policies,
          machineFallbacks,
          memoriesMoved,
          candidatesRekeyed,
        });
      }
      currentTeam = null;
      sqlite
        .prepare('INSERT INTO data_migration (id, doneAt, detail) VALUES (?, ?, ?)')
        .run(AGENT_LAYER_MIGRATION_ID, nowMs(), JSON.stringify({ hadAgents, teams: teams.length }));
    });
  } catch (error) {
    throw new AgentLayerMigrationError(currentTeam, error);
  }
  return { alreadyDone: false, hadAgents, teams };
}
