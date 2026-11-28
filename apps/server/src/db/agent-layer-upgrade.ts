import {
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  AGENT_TOOL_SKILL_CREATE,
  AGENT_TOOL_SKILL_UPDATE,
  AGENT_TOOL_TAG,
} from '@cairn/shared';
import type Database from 'better-sqlite3';
import { newRecordId, nowMs } from '../lib/ids.js';
import { canonicalModelId, modelVendor } from '../services/merge-gate/model-identity.js';

export const AGENT_LAYER_UPGRADE_ID = 'drop-agents';

const REVIEWER_PERSONAS = new Set(['code_reviewer', 'security_auditor', 'test_engineer']);
const REVIEWER_DENIED_TOOLS: readonly string[] = [
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  AGENT_TOOL_TAG,
  AGENT_TOOL_SKILL_CREATE,
  AGENT_TOOL_SKILL_UPDATE,
];

interface AgentRow {
  id: string;
  teamId: string;
  persona: string | null;
  provider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
  fallbackModels: string | null;
  machineId: string | null;
  requiredCapabilities: string | null;
  tools: string;
  secrets: string;
  mcpServers: string;
  skillsAllowlist: string | null;
  defaultSkill: string | null;
}

function tableExists(sqlite: Database.Database, name: string): boolean {
  return (
    sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !==
    undefined
  );
}

export function agentLayerUpgradePending(sqlite: Database.Database): boolean {
  if (!tableExists(sqlite, 'agent')) return false;
  const hasAgents =
    (sqlite.prepare('SELECT count(*) AS n FROM agent').get() as { n: number }).n > 0;
  if (!hasAgents) return false;
  if (!tableExists(sqlite, 'data_migration')) return true;
  return (
    sqlite.prepare('SELECT 1 FROM data_migration WHERE id = ?').get(AGENT_LAYER_UPGRADE_ID) ===
    undefined
  );
}

function usable(row: AgentRow): boolean {
  return row.provider !== null && row.modelId !== null;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function modelsAreIndependent(authorModel: string, reviewerModel: string): boolean {
  const authorId = canonicalModelId(authorModel);
  const reviewerId = canonicalModelId(reviewerModel);
  if (authorId === reviewerId) return false;
  const authorVendor = modelVendor(authorModel);
  const reviewerVendor = modelVendor(reviewerModel);
  if (authorVendor === null || reviewerVendor === null) return false;
  return authorVendor !== reviewerVendor;
}

function mostAssigned(counts: Map<string, number>, candidates: AgentRow[]): AgentRow | undefined {
  return candidates
    .filter((row) => (counts.get(row.id) ?? 0) > 0)
    .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || a.id.localeCompare(b.id))
    .at(0);
}

function requirementOf(sqlite: Database.Database, source: AgentRow): string | null {
  const own = parseJson<Record<string, unknown> | null>(source.requiredCapabilities, null);
  if (source.machineId === null) return own === null ? null : JSON.stringify(own);
  const machine = sqlite
    .prepare('SELECT name, capabilities FROM machine WHERE id = ?')
    .get(source.machineId) as { name: string; capabilities: string | null } | undefined;
  const capabilities = parseJson<{ executor?: string } | null>(machine?.capabilities ?? null, null);
  const orb =
    machine !== undefined &&
    (capabilities?.executor === 'orb' ||
      (capabilities?.executor === undefined && machine.name.endsWith('-orb')));
  if (!orb) return own === null ? null : JSON.stringify(own);
  return JSON.stringify({ ...(own ?? {}), executor: 'orb' });
}

function ruleExists(sqlite: Database.Database, teamId: string, use: string): boolean {
  return (
    sqlite.prepare('SELECT 1 FROM routing_rule WHERE teamId = ? AND use = ?').get(teamId, use) !==
    undefined
  );
}

function insertRule(sqlite: Database.Database, use: string, source: AgentRow, id: string): void {
  const now = nowMs();
  sqlite
    .prepare(
      'INSERT INTO routing_rule (id, teamId, use, provider, modelId, thinkingLevel, fallbackModels, machineId, requiredCapabilities, mcpServers, seededFromAgentId, createdAt, updatedAt)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
    )
    .run(
      id,
      source.teamId,
      use,
      source.provider,
      source.modelId,
      source.thinkingLevel,
      source.fallbackModels,
      source.machineId,
      use === 'coordinator' ? requirementOf(sqlite, source) : null,
      use === 'coordinator' ? source.mcpServers : null,
      source.id,
      now,
      now,
    );
}

function policyExists(sqlite: Database.Database, teamId: string, use: string): boolean {
  return (
    sqlite.prepare('SELECT 1 FROM work_policy WHERE teamId = ? AND use = ?').get(teamId, use) !==
    undefined
  );
}

function insertPolicy(sqlite: Database.Database, use: string, source: AgentRow): void {
  const reviewer = use === 'review';
  const tools = parseJson<string[]>(source.tools, []).filter(
    (tool) => !reviewer || !REVIEWER_DENIED_TOOLS.includes(tool),
  );
  const now = nowMs();
  sqlite
    .prepare(
      'INSERT INTO work_policy (id, teamId, use, tools, mcpServers, skillsAllowlist, defaultSkill, secrets, seededFromAgentId, createdAt, updatedAt)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING',
    )
    .run(
      newRecordId(),
      source.teamId,
      use,
      JSON.stringify(tools),
      source.mcpServers,
      source.skillsAllowlist,
      source.defaultSkill,
      reviewer ? '[]' : source.secrets,
      source.id,
      now,
      now,
    );
}

function assignmentCounts(
  sqlite: Database.Database,
  teamId: string,
  key: 'build' | 'review' | 'verify',
): { counts: Map<string, number>; assigned: Set<string> } {
  const counts = new Map<string, number>();
  const assigned = new Set<string>();
  const rows = sqlite.prepare('SELECT assignment FROM todo WHERE teamId = ?').all(teamId) as {
    assignment: string | null;
  }[];
  for (const { assignment } of rows) {
    const agentId = parseJson<Record<string, { agentId?: string } | undefined>>(assignment, {})[key]
      ?.agentId;
    if (agentId == null) continue;
    assigned.add(agentId);
    counts.set(agentId, (counts.get(agentId) ?? 0) + 1);
  }
  return { counts, assigned };
}

function upgradeTeam(sqlite: Database.Database, teamId: string): void {
  const agents = sqlite.prepare('SELECT * FROM agent WHERE teamId = ?').all(teamId) as AgentRow[];
  const chiefAgentId =
    (
      sqlite.prepare('SELECT agentId FROM chief WHERE teamId = ?').get(teamId) as
        | { agentId: string | null }
        | undefined
    )?.agentId ?? null;
  const usableAgents = agents.filter(usable);

  const chiefAgent = usableAgents.find((row) => row.id === chiefAgentId);
  if (chiefAgent !== undefined && !ruleExists(sqlite, teamId, 'coordinator')) {
    insertRule(sqlite, 'coordinator', chiefAgent, chiefAgent.id);
  }

  const build = assignmentCounts(sqlite, teamId, 'build');
  const sessionSource =
    usableAgents.find((row) => row.persona === 'implementer') ??
    mostAssigned(build.counts, usableAgents);
  if (sessionSource !== undefined && !ruleExists(sqlite, teamId, 'session')) {
    insertRule(sqlite, 'session', sessionSource, newRecordId());
    if (!policyExists(sqlite, teamId, 'session')) insertPolicy(sqlite, 'session', sessionSource);
  }
  const sessionRule = sqlite
    .prepare('SELECT id, modelId FROM routing_rule WHERE teamId = ? AND use = ?')
    .get(teamId, 'session') as { id: string; modelId: string } | undefined;

  const review = assignmentCounts(sqlite, teamId, 'review');
  const verify = assignmentCounts(sqlite, teamId, 'verify');
  const sessionModel = sessionRule?.modelId ?? 'claude-sonnet-5-5';
  const reviewer = mostAssigned(
    review.counts,
    usableAgents.filter(
      (row) => row.id !== chiefAgentId && modelsAreIndependent(sessionModel, row.modelId ?? ''),
    ),
  );
  if (reviewer !== undefined && !ruleExists(sqlite, teamId, 'review')) {
    insertRule(sqlite, 'review', reviewer, newRecordId());
    if (!policyExists(sqlite, teamId, 'review')) insertPolicy(sqlite, 'review', reviewer);
  }
  const reviewRule = sqlite
    .prepare('SELECT id, seededFromAgentId FROM routing_rule WHERE teamId = ? AND use = ?')
    .get(teamId, 'review') as { id: string; seededFromAgentId: string | null } | undefined;

  for (const row of agents) {
    if (row.id === chiefAgentId) continue;
    const reviewing =
      REVIEWER_PERSONAS.has(row.persona ?? '') ||
      reviewRule?.seededFromAgentId === row.id ||
      review.assigned.has(row.id);
    const verifying = row.persona === 'verifier' || verify.assigned.has(row.id);
    if (!reviewing && !verifying) continue;
    sqlite.prepare('UPDATE agent_memory SET independent = 1 WHERE agentId = ?').run(row.id);
    const owner =
      reviewing && reviewRule !== undefined
        ? reviewRule.id
        : !reviewing && sessionRule !== undefined
          ? `${sessionRule.id}:verify`
          : null;
    if (owner !== null) {
      sqlite.prepare('UPDATE agent_memory SET agentId = ? WHERE agentId = ?').run(owner, row.id);
    }
  }

  if (sessionRule !== undefined) {
    for (const row of agents) {
      if (row.id === chiefAgentId) continue;
      sqlite
        .prepare('UPDATE memory_candidate SET agentId = ? WHERE agentId = ?')
        .run(sessionRule.id, row.id);
    }
  }
}

export function runAgentLayerUpgrade(sqlite: Database.Database): void {
  const teamIds = (sqlite.prepare('SELECT id FROM team').all() as { id: string }[]).map(
    (row) => row.id,
  );
  sqlite.transaction(() => {
    for (const teamId of teamIds) upgradeTeam(sqlite, teamId);
    sqlite
      .prepare('INSERT INTO data_migration (id, doneAt, detail) VALUES (?, ?, ?)')
      .run(AGENT_LAYER_UPGRADE_ID, nowMs(), JSON.stringify({ teams: teamIds.length }));
  })();
}
