import { join } from 'node:path';
import {
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  AGENT_TOOL_SKILL_CREATE,
  AGENT_TOOL_SKILL_UPDATE,
  AGENT_TOOL_TAG,
  type StepKind,
} from '@cairn/shared';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { openDbWithHandle } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { listMemoryEntries } from '../src/services/memory.js';
import { seedDefaultRouting } from '../src/services/routing-migration.js';
import {
  coordinatorProfile,
  memoryOpsAreTeamScoped,
  memoryOwnerOf,
  profileForStep,
  type RouteProfile,
} from '../src/services/routing-rules.js';
import { migrateAll, migrateUpTo } from './migrate-helpers.js';

const REVIEWER_DENIED: readonly string[] = [
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  AGENT_TOOL_TAG,
  AGENT_TOOL_SKILL_CREATE,
  AGENT_TOOL_SKILL_UPDATE,
];

type Role = 'implement' | 'plan' | 'verify' | 'review';
type AgentKind = 'persona' | 'custom';
type Routing = 'off' | 'rule-and-policy' | 'rule-only';

interface Cell {
  role: Role;
  kind: AgentKind;
  assigned: boolean;
  routing: Routing;
}

interface Config {
  provider: string;
  modelId: string;
  thinkingLevel: string;
  tools: string[];
  mcpServers: string[];
  skillsAllowlist: string[] | null;
  defaultSkill: string | null;
  secrets: string[];
  fallbackModels: { provider: string; modelId: string }[] | null;
}

const ROLE_AGENT: Config = {
  provider: 'relay-9',
  modelId: 'glm-x',
  thinkingLevel: 'high',
  tools: [...REVIEWER_DENIED],
  mcpServers: ['codegraph', 'playwright'],
  skillsAllowlist: ['skill-a'],
  defaultSkill: 'skill-a',
  secrets: ['K1'],
  fallbackModels: [{ provider: 'claude-code', modelId: 'claude-sonnet-5-5' }],
};

const EXISTING_RULE: Config = {
  provider: 'claude-code',
  modelId: 'claude-opus-5-5',
  thinkingLevel: 'low',
  tools: [AGENT_TOOL_PUSH],
  mcpServers: ['rule-mcp'],
  skillsAllowlist: null,
  defaultSkill: null,
  secrets: ['RK'],
  fallbackModels: null,
};

const PERSONA_OF: Record<Role, string> = {
  implement: 'implementer',
  plan: 'planner',
  verify: 'verifier',
  review: 'code_reviewer',
};

const STEP_KIND: Record<Role, StepKind> = {
  implement: 'build',
  plan: 'plan',
  verify: 'verify',
  review: 'review',
};

const SLOT_OF: Record<Role, string> = {
  implement: 'build',
  plan: 'plan',
  verify: 'verify',
  review: 'review',
};

const INTENTIONAL_DIFFERENCES = {
  noExecutorBefore:
    'an unassigned step without a rule had no executor before, so there is no profile to preserve',
  reviewerHardening:
    'a review policy created by the migration drops the reviewer-denied tools and withholds secrets, as seedWorkPolicies did for seeded review policies',
  policySeededFromRuleAgent:
    'a rule with no policy ran with empty permissions on the rule path; the migration seeds the policy from the rule agent',
} as const;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
});

function insertAgent(
  sqlite: Database.Database,
  id: string,
  name: string,
  config: Config,
  persona: string | null,
): void {
  sqlite
    .prepare(
      `INSERT INTO agent (id, teamId, displayName, provider, modelId, thinkingLevel, persona, tools, secrets, mcpServers, skillsAllowlist, defaultSkill, fallbackModels)
       VALUES (@id, 't1', @name, @provider, @modelId, @thinkingLevel, @persona, @tools, @secrets, @mcpServers, @skillsAllowlist, @defaultSkill, @fallbackModels)`,
    )
    .run({
      id,
      name,
      provider: config.provider,
      modelId: config.modelId,
      thinkingLevel: config.thinkingLevel,
      persona,
      tools: JSON.stringify(config.tools),
      secrets: JSON.stringify(config.secrets),
      mcpServers: JSON.stringify(config.mcpServers),
      skillsAllowlist:
        config.skillsAllowlist === null ? null : JSON.stringify(config.skillsAllowlist),
      defaultSkill: config.defaultSkill,
      fallbackModels: config.fallbackModels === null ? null : JSON.stringify(config.fallbackModels),
    });
}

function buildLegacyInstall(cell: Cell): string {
  const dir = makeTestTempDir('migration-0112-matrix-');
  dirs.push(dir);
  const dbPath = join(dir, 'server.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');
  migrateUpTo(sqlite, dir, '0109_overconfident_omega_red');
  sqlite.exec("INSERT INTO user (id, displayName) VALUES ('u1', 'Owner')");
  sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('t1', 'Team', 1)");
  sqlite.exec("INSERT INTO project (id, name, teamId) VALUES ('p1', 'Proj', 't1')");
  const roleAgentId = 'agent-role';
  insertAgent(
    sqlite,
    'agent-chief',
    'Chief',
    {
      ...ROLE_AGENT,
      provider: 'openai-codex',
      modelId: 'gpt-6-luna',
      thinkingLevel: 'low',
      mcpServers: ['coordinator-mcp'],
      fallbackModels: null,
    },
    null,
  );
  sqlite
    .prepare(
      "INSERT INTO chief (id, userId, teamId, createdAt, agentId) VALUES ('chief-u1-t1', 'u1', 't1', 1, 'agent-chief')",
    )
    .run();
  insertAgent(
    sqlite,
    roleAgentId,
    'Role agent',
    ROLE_AGENT,
    cell.kind === 'persona' ? PERSONA_OF[cell.role] : null,
  );
  insertAgent(
    sqlite,
    'agent-mate',
    'Teammate',
    { ...ROLE_AGENT, provider: 'claude-code', modelId: 'claude-sonnet-5-5' },
    null,
  );
  const independent = cell.role === 'review' || cell.role === 'verify' ? 1 : 0;
  sqlite
    .prepare(
      `INSERT INTO agent_memory (id, agentId, teamId, title, content, independent, createdAt, updatedAt)
       VALUES ('m-role', ?, 't1', 'mem-role', 'role agent fact', ?, 1, 1),
              ('m-mate', 'agent-mate', 't1', 'mem-mate', 'teammate fact', 0, 1, 1)`,
    )
    .run(roleAgentId, independent);
  const assignment = cell.assigned
    ? JSON.stringify({ plan: null, build: null, [SLOT_OF[cell.role]]: { agentId: roleAgentId } })
    : null;
  sqlite
    .prepare(
      `INSERT INTO todo (id, teamId, projectId, title, phase, phaseAt, seqNum, assignment)
       VALUES ('todo-1', 't1', 'p1', 'Task', 'queued', 1, 1, ?)`,
    )
    .run(assignment);
  const use = cell.role === 'review' ? 'review' : 'session';
  if (cell.routing !== 'off') {
    sqlite
      .prepare(
        `INSERT INTO routing_rule (id, teamId, use, provider, modelId, thinkingLevel, seededFromAgentId, createdAt, updatedAt)
         VALUES ('rule-existing', 't1', ?, ?, ?, ?, ?, 1, 1)`,
      )
      .run(
        use,
        EXISTING_RULE.provider,
        EXISTING_RULE.modelId,
        EXISTING_RULE.thinkingLevel,
        roleAgentId,
      );
  }
  if (cell.routing === 'rule-and-policy') {
    sqlite
      .prepare(
        `INSERT INTO work_policy (id, teamId, use, tools, mcpServers, secrets, createdAt, updatedAt)
         VALUES ('policy-existing', 't1', ?, ?, ?, ?, 1, 1)`,
      )
      .run(
        use,
        JSON.stringify(EXISTING_RULE.tools),
        JSON.stringify(EXISTING_RULE.mcpServers),
        JSON.stringify(EXISTING_RULE.secrets),
      );
  }
  migrateAll(sqlite);
  sqlite.close();
  return dbPath;
}

type Comparable = Pick<
  RouteProfile,
  | 'provider'
  | 'modelId'
  | 'thinkingLevel'
  | 'tools'
  | 'secrets'
  | 'mcpServers'
  | 'skillsAllowlist'
  | 'defaultSkill'
  | 'fallbackModels'
>;

function fromConfig(config: Config): Comparable {
  return {
    provider: config.provider,
    modelId: config.modelId,
    thinkingLevel: config.thinkingLevel,
    tools: config.tools,
    secrets: config.secrets,
    mcpServers: config.mcpServers,
    skillsAllowlist: config.skillsAllowlist,
    defaultSkill: config.defaultSkill,
    fallbackModels: config.fallbackModels,
  };
}

function agentExecutes(cell: Cell): boolean {
  return cell.assigned || (cell.role === 'review' && cell.kind === 'persona');
}

function legacyProfile(cell: Cell): { profile: Comparable; usedPolicy: boolean } | null {
  const hasRule = cell.routing !== 'off';
  const hasPolicy = cell.routing === 'rule-and-policy';
  if (!agentExecutes(cell) && !hasRule) return null;
  const base: Comparable = agentExecutes(cell)
    ? fromConfig(ROLE_AGENT)
    : {
        ...fromConfig({
          ...ROLE_AGENT,
          tools: [],
          mcpServers: [],
          secrets: [],
          defaultSkill: null,
        }),
        skillsAllowlist: [],
      };
  const policed: Comparable = hasPolicy
    ? {
        ...base,
        tools: EXISTING_RULE.tools,
        mcpServers: EXISTING_RULE.mcpServers,
        secrets: EXISTING_RULE.secrets,
        skillsAllowlist: EXISTING_RULE.skillsAllowlist,
        defaultSkill: EXISTING_RULE.defaultSkill,
      }
    : base;
  const routed: Comparable = hasRule
    ? {
        ...policed,
        provider: EXISTING_RULE.provider,
        modelId: EXISTING_RULE.modelId,
        thinkingLevel: EXISTING_RULE.thinkingLevel,
        fallbackModels: EXISTING_RULE.fallbackModels,
      }
    : policed;
  return { profile: routed, usedPolicy: hasPolicy };
}

function allowedAdjustment(cell: Cell, before: Comparable, usedPolicy: boolean): Comparable {
  if (usedPolicy) return before;
  const reviewing = cell.role === 'review';
  const hardened = (tools: string[], secrets: string[]) =>
    reviewing
      ? { tools: tools.filter((tool) => !REVIEWER_DENIED.includes(tool)), secrets: [] as string[] }
      : { tools, secrets };
  if (!agentExecutes(cell)) {
    const { tools, secrets } = hardened(ROLE_AGENT.tools, ROLE_AGENT.secrets);
    return {
      ...before,
      tools,
      secrets,
      mcpServers: ROLE_AGENT.mcpServers,
      skillsAllowlist: ROLE_AGENT.skillsAllowlist,
      defaultSkill: ROLE_AGENT.defaultSkill,
    };
  }
  const { tools, secrets } = hardened(before.tools, before.secrets);
  return { ...before, tools, secrets };
}

function comparable(profile: RouteProfile): Comparable {
  return {
    provider: profile.provider,
    modelId: profile.modelId,
    thinkingLevel: profile.thinkingLevel,
    tools: profile.tools,
    secrets: profile.secrets,
    mcpServers: profile.mcpServers,
    skillsAllowlist: profile.skillsAllowlist,
    defaultSkill: profile.defaultSkill,
    fallbackModels: profile.fallbackModels,
  };
}

function legacyVisibleMemories(cell: Cell): string[] {
  return cell.role === 'review' || cell.role === 'verify' ? ['mem-role'] : ['mem-mate', 'mem-role'];
}

const ROLES: Role[] = ['implement', 'plan', 'verify', 'review'];
const KINDS: AgentKind[] = ['persona', 'custom'];
const ROUTINGS: Routing[] = ['off', 'rule-and-policy', 'rule-only'];
const CELLS: Cell[] = ROLES.flatMap((role) =>
  KINDS.flatMap((kind) =>
    [true, false].flatMap((assigned) =>
      ROUTINGS.map((routing) => ({ role, kind, assigned, routing })),
    ),
  ),
);

describe('migration 0112 keeps every legacy step profile', () => {
  test.each(CELLS)('$role $kind assigned=$assigned routing=$routing', (cell) => {
    const dbPath = buildLegacyInstall(cell);
    const opened = openDbWithHandle(dbPath);
    try {
      seedDefaultRouting(opened.db);
      const before = legacyProfile(cell);
      if (before === null) {
        expect(INTENTIONAL_DIFFERENCES.noExecutorBefore).toBeTruthy();
        return;
      }
      const todoRow = opened.db
        .select()
        .from(schema.todo)
        .where(eq(schema.todo.id, 'todo-1'))
        .get();
      if (todoRow === undefined) throw new Error('fixture todo missing');
      const kind = STEP_KIND[cell.role];
      const after = profileForStep(opened.db, todoRow, kind);
      expect(after, 'a profile exists after the migration').not.toBeNull();
      if (after === null) return;
      expect(comparable(after)).toEqual(allowedAdjustment(cell, before.profile, before.usedPolicy));
      if (!agentExecutes(cell)) return;
      const owner = memoryOwnerOf(opened.db, 't1', kind);
      const visible = listMemoryEntries(opened.db, {
        agentId: owner,
        teamId: 't1',
        teamScoped: memoryOpsAreTeamScoped(kind),
      })
        .map((entry) => entry.title)
        .sort();
      expect(visible).toEqual(legacyVisibleMemories(cell));
    } finally {
      opened.close();
    }
  });

  test('the Coordinator keeps its model, thinking level and MCP servers', () => {
    const dbPath = buildLegacyInstall({
      role: 'implement',
      kind: 'custom',
      assigned: true,
      routing: 'off',
    });
    const opened = openDbWithHandle(dbPath);
    try {
      seedDefaultRouting(opened.db);
      expect(coordinatorProfile(opened.db, 't1')).toMatchObject({
        provider: 'openai-codex',
        modelId: 'gpt-6-luna',
        thinkingLevel: 'low',
        mcpServers: ['coordinator-mcp'],
      });
    } finally {
      opened.close();
    }
  });

  test('every intentional difference is justified', () => {
    for (const reason of Object.values(INTENTIONAL_DIFFERENCES)) {
      expect(reason.length).toBeGreaterThan(20);
    }
  });
});
