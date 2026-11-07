import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
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
import { and, eq } from 'drizzle-orm';
import { makeTestTempDir, releaseTestTempDir } from '../../../../../scripts/test-tmpdir.mjs';
import { openDbWithHandle } from '../../../src/db/client.js';
import * as schema from '../../../src/db/schema.js';
import { capabilityGatePasses } from '../../../src/services/dispatch-eligibility.js';
import {
  OVERFLOW_AFTER_MS,
  routeTargets,
  routeVerdict,
} from '../../../src/services/machine-routing.js';
import { listMemoryEntries } from '../../../src/services/memory.js';
import { modelsAreIndependent } from '../../../src/services/merge-gate/model-identity.js';
import { seedDefaultRouting } from '../../../src/services/routing-migration.js';
import {
  coordinatorProfile,
  memoryOpsAreTeamScoped,
  memoryOwnerOf,
  profileForStep,
} from '../../../src/services/routing-rules.js';
import { migrateUpTo } from '../../migrate-helpers.js';
import type { Cell } from './cells.js';
import { type OracleProfile, openLegacyOracle } from './oracle.js';

const ALL_TOOLS = [
  AGENT_TOOL_MERGE,
  AGENT_TOOL_PUSH,
  AGENT_TOOL_TAG,
  AGENT_TOOL_SKILL_CREATE,
  AGENT_TOOL_SKILL_UPDATE,
];
const REVIEWER_DENIED_ALL: readonly string[] = ALL_TOOLS;

const SESSION_MODEL = { provider: 'claude-code', modelId: 'claude-sonnet-5-5' };
const ROLE_MODELS = {
  'same-as-session': SESSION_MODEL,
  'same-vendor': { provider: 'claude-code', modelId: 'claude-opus-5-5' },
  'other-vendor': { provider: 'openai-codex', modelId: 'gpt-6-luna' },
} as const;
const PERSONA_OF: Record<string, string> = {
  plan: 'planner',
  verify: 'verifier',
  review: 'code_reviewer',
  citation: 'test_engineer',
};
const SLOT_OF: Record<string, string> = { plan: 'plan', verify: 'verify', review: 'review' };
const STEP_OF = {
  implement: 'build',
  plan: 'plan',
  verify: 'verify',
  review: 'review',
  citation: 'build',
} as const;

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

function orbMachine(cell: Cell): boolean {
  return cell.machine === 'orb-capability' || cell.machine === 'orb-name';
}

function expectedCaps(cell: Cell): RequiredCapabilities | null {
  const own = capsOf(cell);
  return orbMachine(cell) ? { ...(own ?? {}), executor: 'orb' } : own;
}

function agentValues(
  cell: Cell,
  id: string,
  name: string,
  persona: string | null,
  teamId: string,
  model: { provider: string; modelId: string },
) {
  const caps = capsOf(cell);
  return {
    id,
    teamId,
    name,
    provider: model.provider,
    modelId: model.modelId,
    thinkingLevel: cell.thinking === 'high' ? 'high' : null,
    persona,
    machineId: cell.machine === 'none' ? null : `pin-${teamId}`,
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
    caps: caps === null ? null : JSON.stringify(caps),
  };
}

function plainValues(
  cell: Cell,
  id: string,
  name: string,
  persona: string | null,
  teamId: string,
  model: { provider: string; modelId: string },
) {
  return {
    ...agentValues(cell, id, name, persona, teamId, model),
    thinkingLevel: null,
    tools: JSON.stringify([AGENT_TOOL_PUSH]),
    secrets: '[]',
    mcpServers: '[]',
    skills: null,
    defaultSkill: null,
    fallback: null,
    caps: null,
  };
}

let templateDir: string | null = null;

function templatePath(): string {
  if (templateDir === null) {
    templateDir = makeTestTempDir('migration-0115-template-');
    const sqlite = new Database(join(templateDir, 'template.db'));
    sqlite.pragma('foreign_keys = ON');
    migrateUpTo(sqlite, templateDir, '0109_overconfident_omega_red');
    sqlite.exec("INSERT INTO user (id, displayName) VALUES ('u1', 'Owner')");
    sqlite.close();
  }
  return join(templateDir, 'template.db');
}

export function releaseMatrixTemplate(): void {
  if (templateDir !== null) releaseTestTempDir(templateDir);
  templateDir = null;
}

export function installCells(cells: readonly Cell[], dir: string): string {
  const base = join(dir, 'matrix-base.db');
  copyFileSync(templatePath(), base);
  const sqlite = new Database(base);
  sqlite.pragma('foreign_keys = ON');
  const team = sqlite.prepare("INSERT INTO team (id, name, createdAt) VALUES (?, 'Team', 1)");
  const project = sqlite.prepare('INSERT INTO project (id, name, teamId) VALUES (?, ?, ?)');
  const machine = sqlite.prepare(
    'INSERT INTO machine (id, teamId, name, online, tokenHash, capabilities) VALUES (?, ?, ?, 1, ?, ?)',
  );
  const agent = sqlite.prepare(
    `INSERT INTO agent (id, teamId, displayName, provider, modelId, thinkingLevel, persona, machineId, tools, secrets, mcpServers, skillsAllowlist, defaultSkill, fallbackModels, requiredCapabilities)
     VALUES (@id, @teamId, @name, @provider, @modelId, @thinkingLevel, @persona, @machineId, @tools, @secrets, @mcpServers, @skills, @defaultSkill, @fallback, @caps)`,
  );
  const chief = sqlite.prepare(
    "INSERT INTO chief (id, userId, teamId, createdAt, agentId) VALUES (?, 'u1', ?, 1, ?)",
  );
  const memory = sqlite.prepare(
    `INSERT INTO agent_memory (id, agentId, teamId, title, content, independent, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
  );
  const todo = sqlite.prepare(
    `INSERT INTO todo (id, teamId, projectId, title, phase, phaseAt, seqNum, assignment, sourceKind)
     VALUES (?, ?, ?, 'Task', 'queued', 1, ?, ?, ?)`,
  );
  const rule = sqlite.prepare(
    `INSERT INTO routing_rule (id, teamId, use, provider, modelId, machineId, seededFromAgentId, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
  );
  const policy = sqlite.prepare(
    `INSERT INTO work_policy (id, teamId, use, tools, mcpServers, secrets, seededFromAgentId, createdAt, updatedAt)
     VALUES (?, ?, ?, '[]', '[]', '[]', ?, 1, 1)`,
  );
  sqlite.transaction(() => {
    cells.forEach((cell, i) => {
      const t = `t${i}`;
      const roleModel = ROLE_MODELS[cell.model];
      team.run(t);
      project.run(`p-${t}`, 'Proj', t);
      const machineName =
        cell.machine === 'orb-name' ? 'box-orb' : cell.machine === 'native' ? 'laptop' : 'box';
      const machineCaps =
        cell.machine === 'orb-capability'
          ? { mcpServers: ['codegraph'], skills: [], executor: 'orb' }
          : cell.machine === 'native'
            ? { mcpServers: ['codegraph'], skills: [], executor: 'host' }
            : { mcpServers: ['codegraph'], skills: [] };
      machine.run(`pin-${t}`, t, machineName, `h-${t}`, JSON.stringify(machineCaps));
      const role = cell.role;
      const chiefAgent = `chief-${t}`;
      if (role === 'coordinator') {
        agent.run(agentValues(cell, chiefAgent, 'Chief', null, t, roleModel));
      } else {
        agent.run(plainValues(cell, chiefAgent, 'Chief', null, t, ROLE_MODELS['other-vendor']));
      }
      chief.run(`c-${t}`, t, chiefAgent);
      const impl = `impl-${t}`;
      const roleAgent = role === 'implement' ? impl : `role-${t}`;
      if (role === 'implement') {
        agent.run(
          agentValues(
            cell,
            impl,
            'Implementer',
            cell.kind === 'persona' ? 'implementer' : null,
            t,
            roleModel,
          ),
        );
      } else {
        agent.run(plainValues(cell, impl, 'Implementer', 'implementer', t, SESSION_MODEL));
        if (role !== 'coordinator') {
          agent.run(
            agentValues(
              cell,
              roleAgent,
              'Role agent',
              cell.kind === 'persona' ? (PERSONA_OF[role] ?? null) : null,
              t,
              roleModel,
            ),
          );
        }
      }
      const mate = `mate-${t}`;
      agent.run(plainValues(cell, mate, 'Mate', null, t, SESSION_MODEL));
      const independent = role === 'review' || role === 'verify' ? 1 : 0;
      memory.run(`mr-${t}`, roleAgent, t, 'mem-role', 'role fact', independent);
      memory.run(`mm-${t}`, mate, t, 'mem-mate', 'mate fact', 0);
      const slot = SLOT_OF[role];
      const assignment: Record<string, unknown> = { plan: null, build: { agentId: impl } };
      if (slot !== undefined && cell.assigned === 'yes') assignment[slot] = { agentId: roleAgent };
      if (role === 'implement' && cell.assigned === 'no') assignment.build = null;
      todo.run(`todo-${t}`, t, `p-${t}`, 1, JSON.stringify(assignment), null);
      if (role === 'citation') {
        todo.run(
          `todoc-${t}`,
          t,
          `p-${t}`,
          2,
          cell.assigned === 'yes'
            ? JSON.stringify({ plan: null, build: { agentId: roleAgent } })
            : null,
          'research-citation-check',
        );
      }
      if (cell.existing !== 'none' && role !== 'coordinator' && role !== 'citation') {
        const use = role === 'review' ? 'review' : 'session';
        const seed = role === 'review' ? roleAgent : impl;
        const model = role === 'review' ? roleModel : SESSION_MODEL;
        rule.run(
          `rule-${t}`,
          t,
          use,
          model.provider,
          model.modelId,
          cell.ruleMachine === 'pinned' ? `pin-${t}` : null,
          seed,
        );
        if (cell.existing === 'rule-and-policy') policy.run(`policy-${t}`, t, use, seed);
      }
    });
  })();
  sqlite.close();
  return base;
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

function pick(p: Comparable): Comparable {
  return {
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
  };
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

export const INTENTIONAL_DIFFERENCES = {
  verifierMemoryIsolation:
    'the verifier reads only its own independent memory; legacy also read the adopted team memory under the session rule (coordinator decision)',
  nonIndependentReviewer:
    'a reviewer on the session vendor gets no review rule; legacy ran an assigned agent directly, but the gate rejects a non-independent verdict',
  reviewerHardening:
    'a review policy drops the reviewer-denied tools and withholds secrets, as the legacy seeded review policy did',
  reviewerExecutorInference:
    'an agent promoted to a review rule gets the Orb executor inferred from its machine, as every legacy seeded rule did',
  citationRoute:
    'citation checks run under a citation_check rule seeded from the assigned or independent checker; legacy ran them under the session route and blocked non-independent checks at runtime',
  unassignedMachineFallback:
    'a rule with no machine takes the seed agent machine for every step; legacy applied that fallback only to a step with an assigned agent',
  unexecutedAgent:
    'an agent that never ran the step has no legacy profile or memory owner to compare against',
} as const;

export interface MatrixFailure {
  index: number;
  cell: Cell;
  message: string;
}

const CHUNK = 80;

export function runMatrix(cells: readonly Cell[], dir: string): MatrixFailure[] {
  const failures: MatrixFailure[] = [];
  for (let start = 0; start < cells.length; start += CHUNK) {
    const chunkDir = join(dir, `chunk-${start}`);
    mkdirSync(chunkDir, { recursive: true });
    for (const failure of runChunk(cells.slice(start, start + CHUNK), chunkDir)) {
      failures.push({ ...failure, index: failure.index + start });
    }
    rmSync(chunkDir, { recursive: true, force: true });
  }
  return failures;
}

function runChunk(cells: readonly Cell[], dir: string): MatrixFailure[] {
  const t0 = Date.now();
  const lap = (label: string) => {
    if (process.env.MIGRATION_ORACLE_TIMING !== undefined)
      process.stderr.write(`${label} ${Date.now() - t0}ms\n`);
  };
  const base = installCells(cells, dir);
  lap('installed');
  const legacyPath = join(dir, 'matrix-legacy.db');
  const migratedPath = join(dir, 'matrix-migrated.db');
  copyFileSync(base, legacyPath);
  copyFileSync(base, migratedPath);
  const oracle = openLegacyOracle(legacyPath);
  const legacyProfiles = cells.map((cell, i) => {
    const t = `t${i}`;
    if (cell.role === 'coordinator' || cell.role === 'citation') return null;
    const kind = STEP_OF[cell.role];
    const reviewer =
      cell.role === 'review' && (cell.assigned === 'yes' || cell.kind === 'persona')
        ? `role-${t}`
        : null;
    return oracle.profile(`todo-${t}`, kind, reviewer);
  });
  oracle.close();
  lap('legacy done');
  const legacyDb = new Database(legacyPath, { readonly: true });
  const legacyMemory = (t: string, kind: string, owner: string | null): string[] => {
    const sql = memoryOpsAreTeamScoped(kind as 'build')
      ? 'SELECT title FROM agent_memory WHERE teamId = ? AND independent = 0 AND adoptedFrom IS NULL'
      : 'SELECT title FROM agent_memory WHERE teamId = ? AND agentId = ?';
    const args = memoryOpsAreTeamScoped(kind as 'build') ? [t] : [t, owner];
    return (legacyDb.prepare(sql).all(...args) as { title: string }[]).map((r) => r.title).sort();
  };
  const sqlite = new Database(migratedPath);
  sqlite.close();
  const opened = openDbWithHandle(migratedPath);
  const failures: MatrixFailure[] = [];
  try {
    lap('migrated boot');
    seedDefaultRouting(opened.db);
    lap('seeded');
    cells.forEach((cell, i) => {
      const t = `t${i}`;
      try {
        compareCell(opened.db, legacyDb, legacyProfiles[i] ?? null, cell, t, legacyMemory);
      } catch (error) {
        failures.push({
          index: i,
          cell,
          message:
            error instanceof Error
              ? error.message.split('\n').slice(0, 12).join('\n')
              : String(error),
        });
      }
    });
    lap('compared');
  } finally {
    opened.close();
    legacyDb.close();
  }
  return failures;
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function same(label: string, actual: unknown, expected: unknown): void {
  if (
    typeof actual === 'object' &&
    actual !== null &&
    typeof expected === 'object' &&
    expected !== null &&
    !Array.isArray(actual)
  ) {
    const a = actual as Record<string, unknown>;
    const e = expected as Record<string, unknown>;
    const keys = Object.keys(e).filter((key) => JSON.stringify(a[key]) !== JSON.stringify(e[key]));
    check(
      keys.length === 0,
      `${label}: ${keys.map((key) => `${key} after ${JSON.stringify(a[key])} legacy ${JSON.stringify(e[key])}`).join('; ')}`,
    );
    return;
  }
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(a === e, `${label}: after ${a} but legacy ${e}`);
}

function compareCell(
  db: ReturnType<typeof openDbWithHandle>['db'],
  _legacyDb: Database.Database,
  before: OracleProfile | null,
  cell: Cell,
  t: string,
  legacyMemory: (t: string, kind: string, owner: string | null) => string[],
): void {
  const roleModel = ROLE_MODELS[cell.model];
  if (cell.role === 'coordinator') {
    const profile = coordinatorProfile(db, t);
    check(profile !== null, 'no coordinator profile');
    if (profile === null) return;
    const agentCaps = capsOf(cell);
    same(
      'coordinator model',
      [profile.provider, profile.modelId, profile.thinkingLevel],
      [roleModel.provider, roleModel.modelId, cell.thinking === 'high' ? 'high' : null],
    );
    same(
      'coordinator mcp',
      profile.mcpServers,
      cell.mcp === 'some' ? ['codegraph', 'playwright'] : [],
    );
    same(
      'coordinator fallback',
      profile.fallbackModels,
      cell.fallback === 'some' ? [{ provider: 'claude-code', modelId: 'claude-sonnet-5-5' }] : null,
    );
    same('coordinator machine', profile.machineId, cell.machine === 'none' ? null : `pin-${t}`);
    const expected = orbMachine(cell) ? { ...(agentCaps ?? {}), executor: 'orb' } : agentCaps;
    same('coordinator caps', profile.requiredCapabilities, expected);
    return;
  }
  const todoRow = db
    .select()
    .from(schema.todo)
    .where(eq(schema.todo.id, `todo-${t}`))
    .get();
  check(todoRow !== undefined, 'todo missing');
  if (todoRow === undefined) return;
  if (cell.role === 'citation') {
    const citation = db
      .select()
      .from(schema.todo)
      .where(eq(schema.todo.id, `todoc-${t}`))
      .get();
    check(citation !== undefined, 'citation todo missing');
    if (citation === undefined) return;
    const after = profileForStep(db, citation, 'build');
    check(after !== null, 'no citation profile');
    if (after === null) return;
    const independent = modelsAreIndependent(
      SESSION_MODEL.modelId,
      ROLE_MODELS[cell.model].modelId,
    );
    const expectCheckerRule = cell.assigned === 'yes' || (cell.kind === 'custom' && independent);
    if (expectCheckerRule) {
      same(
        'citation model',
        [after.provider, after.modelId],
        [roleModel.provider, roleModel.modelId],
      );
    } else {
      same(
        'citation falls back to the session model',
        [after.provider, after.modelId],
        [SESSION_MODEL.provider, SESSION_MODEL.modelId],
      );
    }
    return;
  }
  const kind = STEP_OF[cell.role];
  const after = profileForStep(db, todoRow, kind);
  const executes = cell.assigned === 'yes' || (cell.role === 'review' && cell.kind === 'persona');
  if (before === null) {
    check(INTENTIONAL_DIFFERENCES.unexecutedAgent.length > 0, 'unreachable');
    return;
  }
  if (cell.role === 'review' && after === null) {
    check(
      !modelsAreIndependent(SESSION_MODEL.modelId, roleModel.modelId),
      'review profile missing although the reviewer is vendor independent',
    );
    return;
  }
  check(after !== null, 'profile missing after migration');
  if (after === null) return;
  let expected = pick(before);
  if (cell.role === 'review') {
    expected = {
      ...expected,
      tools: expected.tools.filter((tool) => !REVIEWER_DENIED_ALL.includes(tool)),
      secrets: [],
      requiredCapabilities: expectedCaps(cell),
    };
  }
  const ruleUse = cell.role === 'review' ? 'review' : 'session';
  const seededRule = db
    .select()
    .from(schema.routingRule)
    .where(and(eq(schema.routingRule.teamId, t), eq(schema.routingRule.use, ruleUse)))
    .get();
  if (
    !executes &&
    before.machineId === null &&
    cell.machine !== 'none' &&
    seededRule?.seededFromAgentId != null
  ) {
    check(INTENTIONAL_DIFFERENCES.unassignedMachineFallback.length > 0, 'unreachable');
    expected = { ...expected, machineId: `pin-${t}` };
  }
  const afterComparable = pick(after);
  same('profile', afterComparable, expected);
  same(
    'placement',
    placement(after.requiredCapabilities, after.machineId),
    placement(expected.requiredCapabilities, expected.machineId),
  );
  if (!executes) return;
  const seen = listMemoryEntries(db, {
    agentId: memoryOwnerOf(db, t, kind),
    teamId: t,
    teamScoped: memoryOpsAreTeamScoped(kind),
  })
    .map((entry) => entry.title)
    .sort();
  if (kind === 'verify') {
    same('verifier memory', seen, ['mem-role']);
    return;
  }
  const legacy = legacyMemory(t, kind, `role-${t}`);
  same('memory', seen, legacy);
}
