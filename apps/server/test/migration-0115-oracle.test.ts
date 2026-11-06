import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  AGENT_TOOL_SKILL_CREATE,
  AGENT_TOOL_SKILL_UPDATE,
  AGENT_TOOL_TAG,
  type RequiredCapabilities,
} from '@cairn/shared';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { openDbWithHandle } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { capabilityGatePasses } from '../src/services/dispatch-eligibility.js';
import { OVERFLOW_AFTER_MS, routeTargets, routeVerdict } from '../src/services/machine-routing.js';
import { listMemoryEntries } from '../src/services/memory.js';
import { seedDefaultRouting } from '../src/services/routing-migration.js';
import {
  memoryOpsAreTeamScoped,
  memoryOwnerOf,
  profileForStep,
} from '../src/services/routing-rules.js';
import { openLegacyOracle } from './fixtures/legacy-oracle/oracle.js';
import { migrateAll, migrateUpTo } from './migrate-helpers.js';

const ALL_TOOLS = [
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  AGENT_TOOL_TAG,
  AGENT_TOOL_SKILL_CREATE,
  AGENT_TOOL_SKILL_UPDATE,
];

type Role = 'implement' | 'plan' | 'verify' | 'review';

const PERSONA_OF: Record<Role, string> = {
  implement: 'implementer',
  plan: 'planner',
  verify: 'verifier',
  review: 'code_reviewer',
};
const STEP_OF: Record<Role, 'build' | 'plan' | 'verify' | 'review'> = {
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

const FACTORS: Record<string, readonly string[]> = {
  role: ['implement', 'plan', 'verify', 'review'],
  kind: ['persona', 'custom'],
  assigned: ['yes', 'no'],
  machine: ['none', 'native', 'orb-capability', 'orb-name'],
  caps: ['null', 'mcp', 'models', 'mcp+models', 'orb'],
  tools: ['none', 'push', 'all'],
  secrets: ['none', 'some'],
  mcp: ['none', 'some'],
  skills: ['null', 'empty', 'some'],
  defaultSkill: ['null', 'some'],
  fallback: ['null', 'some'],
  thinking: ['null', 'high'],
  existing: ['none', 'rule-and-policy', 'rule-only'],
  model: ['same-as-session', 'other-vendor'],
};

type Cell = Record<keyof typeof FACTORS, string>;

function pairwiseCells(): Cell[] {
  const names = Object.keys(FACTORS);
  let seed = 20260611;
  const next = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return seed >>> 0;
  };
  const key = (a: number, va: number, b: number, vb: number) => `${a}:${va}|${b}:${vb}`;
  const uncovered = new Set<string>();
  for (let a = 0; a < names.length; a++)
    for (let b = a + 1; b < names.length; b++)
      for (let va = 0; va < FACTORS[names[a] as string]!.length; va++)
        for (let vb = 0; vb < FACTORS[names[b] as string]!.length; vb++)
          uncovered.add(key(a, va, b, vb));
  const rows: number[][] = [];
  while (uncovered.size > 0) {
    let best: number[] = [];
    let bestScore = -1;
    for (let t = 0; t < 400; t++) {
      const row = names.map((n) => next() % FACTORS[n]!.length);
      let score = 0;
      for (let a = 0; a < names.length; a++)
        for (let b = a + 1; b < names.length; b++)
          if (uncovered.has(key(a, row[a]!, b, row[b]!))) score++;
      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    }
    for (let a = 0; a < names.length; a++)
      for (let b = a + 1; b < names.length; b++) uncovered.delete(key(a, best[a]!, b, best[b]!));
    rows.push(best);
  }
  return rows.map((row) =>
    Object.fromEntries(names.map((n, i) => [n, FACTORS[n]![row[i]!] as string])),
  );
}

const CELLS = pairwiseCells();

function capsOf(cell: Cell): RequiredCapabilities | null {
  switch (cell.caps) {
    case 'mcp':
      return { mcpServers: ['codegraph'] };
    case 'models':
      return { models: ['claude-opus-5-5'] };
    case 'mcp+models':
      return { mcpServers: ['codegraph'], models: ['claude-opus-5-5'] };
    case 'orb':
      return { executor: 'orb' };
    default:
      return null;
  }
}

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
});

function installFor(cell: Cell): { base: string; dir: string } {
  const dir = makeTestTempDir('migration-0115-oracle-');
  dirs.push(dir);
  const base = join(dir, 'legacy.db');
  const sqlite = new Database(base);
  sqlite.pragma('foreign_keys = ON');
  migrateUpTo(sqlite, dir, '0109_overconfident_omega_red');
  sqlite.exec("INSERT INTO user (id, displayName) VALUES ('u1', 'Owner')");
  sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('t1', 'Team', 1)");
  sqlite.exec("INSERT INTO project (id, name, teamId) VALUES ('p1', 'Proj', 't1')");
  const machine = sqlite.prepare(
    'INSERT INTO machine (id, teamId, name, online, tokenHash, capabilities) VALUES (?, ?, ?, 1, ?, ?)',
  );
  const machineName =
    cell.machine === 'orb-name' ? 'box-orb' : cell.machine === 'native' ? 'laptop' : 'box';
  const machineCaps =
    cell.machine === 'orb-capability'
      ? { mcpServers: ['codegraph'], skills: [], executor: 'orb' }
      : cell.machine === 'native'
        ? { mcpServers: ['codegraph'], skills: [], executor: 'host' }
        : { mcpServers: ['codegraph'], skills: [] };
  machine.run('m-pinned', 't1', machineName, 'h1', JSON.stringify(machineCaps));
  const insert = sqlite.prepare(
    `INSERT INTO agent (id, teamId, displayName, provider, modelId, thinkingLevel, persona, machineId, tools, secrets, mcpServers, skillsAllowlist, defaultSkill, fallbackModels, requiredCapabilities)
     VALUES (@id, 't1', @name, @provider, @modelId, @thinkingLevel, @persona, @machineId, @tools, @secrets, @mcpServers, @skills, @defaultSkill, @fallback, @caps)`,
  );
  const sessionModel = { provider: 'claude-code', modelId: 'claude-sonnet-5-5' };
  const roleModel =
    cell.model === 'same-as-session'
      ? sessionModel
      : { provider: 'openai-codex', modelId: 'gpt-6-luna' };
  const agentValues = (id: string, name: string, persona: string | null, model = roleModel) => ({
    id,
    name,
    provider: model.provider,
    modelId: model.modelId,
    thinkingLevel: cell.thinking === 'high' ? 'high' : null,
    persona,
    machineId: cell.machine === 'none' ? null : 'm-pinned',
    tools: JSON.stringify(
      cell.tools === 'all' ? ALL_TOOLS : cell.tools === 'push' ? [AGENT_TOOL_PUSH] : [],
    ),
    secrets: JSON.stringify(cell.secrets === 'some' ? ['K1'] : []),
    mcpServers: JSON.stringify(cell.mcp === 'some' ? ['codegraph', 'playwright'] : []),
    skills:
      cell.skills === 'null' ? null : JSON.stringify(cell.skills === 'some' ? ['skill-a'] : []),
    defaultSkill: cell.defaultSkill === 'some' ? 'skill-a' : null,
    fallback:
      cell.fallback === 'some'
        ? JSON.stringify([{ provider: 'claude-code', modelId: 'claude-sonnet-5-5' }])
        : null,
    caps: JSON.stringify(capsOf(cell)) === 'null' ? null : JSON.stringify(capsOf(cell)),
  });
  insert.run(
    agentValues('agent-chief', 'Chief', null, { provider: 'openai-codex', modelId: 'gpt-6-luna' }),
  );
  sqlite
    .prepare(
      "INSERT INTO chief (id, userId, teamId, createdAt, agentId) VALUES ('c1', 'u1', 't1', 1, 'agent-chief')",
    )
    .run();
  insert.run(agentValues('agent-impl', 'Implementer', 'implementer', sessionModel));
  const rolePersona = cell.kind === 'persona' ? PERSONA_OF[cell.role as Role] : null;
  const roleIsImplementer = cell.role === 'implement' && cell.kind === 'persona';
  if (!roleIsImplementer) {
    insert.run(agentValues('agent-role', 'Role agent', rolePersona));
  }
  const roleAgent = roleIsImplementer ? 'agent-impl' : 'agent-role';
  const independent = cell.role === 'review' || cell.role === 'verify' ? 1 : 0;
  sqlite
    .prepare(
      `INSERT INTO agent_memory (id, agentId, teamId, title, content, independent, createdAt, updatedAt)
       VALUES ('m-role', ?, 't1', 'mem-role', 'role fact', ?, 1, 1), ('m-mate', 'agent-impl', 't1', 'mem-mate', 'mate fact', 0, 1, 1)`,
    )
    .run(roleAgent, independent);
  const assignment =
    cell.assigned === 'yes'
      ? JSON.stringify({
          plan: null,
          build: { agentId: 'agent-impl' },
          [SLOT_OF[cell.role as Role]]: { agentId: roleAgent },
        })
      : JSON.stringify({ plan: null, build: { agentId: 'agent-impl' } });
  sqlite
    .prepare(
      `INSERT INTO todo (id, teamId, projectId, title, phase, phaseAt, seqNum, assignment)
       VALUES ('todo-1', 't1', 'p1', 'Task', 'queued', 1, 1, ?)`,
    )
    .run(assignment);
  if (cell.existing !== 'none') {
    const use = cell.role === 'review' ? 'review' : 'session';
    sqlite
      .prepare(
        `INSERT INTO routing_rule (id, teamId, use, provider, modelId, machineId, seededFromAgentId, createdAt, updatedAt)
         VALUES ('rule-existing', 't1', ?, ?, ?, ?, ?, 1, 1)`,
      )
      .run(
        use,
        roleModel.provider,
        roleModel.modelId,
        cell.machine === 'none' ? null : 'm-pinned',
        roleAgent,
      );
    if (cell.existing === 'rule-and-policy') {
      sqlite
        .prepare(
          `INSERT INTO work_policy (id, teamId, use, tools, mcpServers, secrets, seededFromAgentId, createdAt, updatedAt)
           VALUES ('policy-existing', 't1', ?, '[]', '[]', '[]', ?, 1, 1)`,
        )
        .run(use, roleAgent);
    }
  }
  sqlite.close();
  return { base, dir };
}

interface Comparable {
  provider: string | null;
  modelId: string | null;
  thinkingLevel: string | null;
  machineId: string | null;
  tools: string[];
  secrets: string[];
  mcpServers: string[];
  skillsAllowlist: string[] | null;
  defaultSkill: string | null;
  requiredCapabilities: unknown;
  fallbackModels: unknown;
}

function placement(caps: unknown, machineId: string | null) {
  const other = {
    capabilities: { mcpServers: ['codegraph'], skills: [], executor: 'host' as const },
    claudeCodeReport: null,
  };
  return (['online', 'offline', 'busy'] as const).map((state) => {
    const verdict = routeVerdict({
      machineId: 'm-other',
      targets: routeTargets(null, machineId),
      unavailable: () => state === 'offline',
      waitingSince: 0,
      now: state === 'busy' ? OVERFLOW_AFTER_MS + 1 : 1,
    });
    return (
      verdict.claim &&
      capabilityGatePasses(other, { requiredCapabilities: caps as RequiredCapabilities | null })
    );
  });
}

const INTENTIONAL_DIFFERENCES = {
  verifierMemoryIsolation:
    'the verifier reads only its own independent memory; legacy read the adopted team memory under the session rule as well (coordinator decision)',
  sameModelReviewer:
    'a reviewer on the session model gets no review rule; legacy ran the assigned agent directly, but the gate rejects a non-independent verdict',
  unexecutedAgentMemory:
    'memory of an agent that never ran the step has no legacy owner to compare against',
} as const;

describe('migration 0115 against the legacy routing code as the oracle', () => {
  test('the cell generator covers every pair of factor values', () => {
    expect(CELLS.length).toBeGreaterThan(20);
  });

  test.each(
    CELLS.map((cell, index) => [`cell ${index} ${Object.values(cell).join(' ')}`, cell] as const),
  )('%s', (_name, cell) => {
    const { base, dir } = installFor(cell);
    const legacyPath = join(dir, 'legacy-run.db');
    const migratedPath = join(dir, 'migrated-run.db');
    copyFileSync(base, legacyPath);
    copyFileSync(base, migratedPath);
    const role = cell.role as Role;
    const kind = STEP_OF[role];
    const reviewer =
      role === 'review'
        ? cell.assigned === 'yes' || cell.kind === 'persona'
          ? 'agent-role'
          : null
        : null;
    const oracle = openLegacyOracle(legacyPath);
    const before = oracle.profile('todo-1', kind, reviewer);
    const legacyOwner = oracle.memoryOwner(
      't1',
      role === 'implement' && cell.kind === 'persona' ? 'agent-impl' : 'agent-role',
      kind,
    );
    oracle.close();
    const sqlite = new Database(migratedPath);
    migrateAll(sqlite);
    sqlite.close();
    const opened = openDbWithHandle(migratedPath);
    try {
      seedDefaultRouting(opened.db);
      const todoRow = opened.db
        .select()
        .from(schema.todo)
        .where(eq(schema.todo.id, 'todo-1'))
        .get();
      if (todoRow === undefined) throw new Error('fixture todo missing');
      const after = profileForStep(opened.db, todoRow, kind);
      if (before === null) {
        expect(INTENTIONAL_DIFFERENCES.unexecutedAgentMemory).toBeTruthy();
        return;
      }
      if (role === 'review' && cell.model === 'same-as-session' && after === null) {
        expect(INTENTIONAL_DIFFERENCES.sameModelReviewer).toBeTruthy();
        return;
      }
      expect(after, 'profile exists after migration').not.toBeNull();
      if (after === null) return;
      const pick = (p: Comparable): Comparable => ({
        provider: p.provider,
        modelId: p.modelId,
        thinkingLevel: p.thinkingLevel,
        machineId: p.machineId,
        tools: p.tools,
        secrets: p.secrets,
        mcpServers: p.mcpServers,
        skillsAllowlist: p.skillsAllowlist,
        defaultSkill: p.defaultSkill,
        requiredCapabilities: p.requiredCapabilities,
        fallbackModels: p.fallbackModels,
      });
      expect(pick(after as Comparable)).toEqual(pick(before));
      expect(placement(after.requiredCapabilities, after.machineId)).toEqual(
        placement(before.requiredCapabilities, before.machineId),
      );
      const visible = (agentId: string, teamScoped: boolean) =>
        listMemoryEntries(opened.db, { agentId, teamId: 't1', teamScoped })
          .map((entry) => entry.title)
          .sort();
      const executes = cell.assigned === 'yes' || (role === 'review' && cell.kind === 'persona');
      if (!executes) {
        expect(INTENTIONAL_DIFFERENCES.unexecutedAgentMemory).toBeTruthy();
        return;
      }
      const seen = visible(memoryOwnerOf(opened.db, 't1', kind), memoryOpsAreTeamScoped(kind));
      if (kind === 'verify') {
        expect(INTENTIONAL_DIFFERENCES.verifierMemoryIsolation).toBeTruthy();
        expect(seen).toEqual(['mem-role']);
        return;
      }
      const legacy = new Database(legacyPath, { readonly: true });
      const titles = (
        legacy
          .prepare(
            memoryOpsAreTeamScoped(kind)
              ? "SELECT title FROM agent_memory WHERE teamId = 't1' AND independent = 0 AND adoptedFrom IS NULL"
              : "SELECT title FROM agent_memory WHERE teamId = 't1' AND agentId = ?",
          )
          .all(...(memoryOpsAreTeamScoped(kind) ? [] : [legacyOwner])) as { title: string }[]
      )
        .map((row) => row.title)
        .sort();
      legacy.close();
      expect(seen).toEqual(titles);
    } finally {
      opened.close();
    }
  });
});
