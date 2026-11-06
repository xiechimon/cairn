import { join } from 'node:path';
import { claimedStepSchema } from '@cairn/shared';
import Database from 'better-sqlite3';
import { eq, ne } from 'drizzle-orm';
import { afterEach, describe, expect, test } from 'vitest';
import { makeTestTempDir, releaseTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { openDbWithHandle } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import { hashCredential } from '../src/lib/hash.js';
import { seedDefaultRouting } from '../src/services/routing-migration.js';
import { bootServer, subscriptionClaudeReport } from './helpers.js';
import { migrateAll, migrateUpTo } from './migrate-helpers.js';

const TOKEN = 'a'.repeat(64);
const CHIEF_AGENT = 'agent-chief';
const IMPLEMENTER_AGENT = 'agent-impl';
const REVIEWER_AGENT = 'agent-reviewer';
const HARBOR_AGENT = 'agent-harbor';
const PROBE_AGENT = 'agent-probe';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) releaseTestTempDir(dir);
});

interface LegacyWorld {
  dbPath: string;
  sqlite: Database.Database;
}

function insertAgent(
  sqlite: Database.Database,
  row: {
    id: string;
    name: string;
    provider: string;
    modelId: string;
    persona?: string;
    tools?: string[];
    secrets?: string[];
    mcpServers?: string[];
  },
): void {
  sqlite
    .prepare(
      `INSERT INTO agent (id, teamId, displayName, provider, modelId, thinkingLevel, persona, machineId, tools, secrets, mcpServers)
       VALUES (@id, 't1', @name, @provider, @modelId, 'low', @persona, 'm-box', @tools, @secrets, @mcpServers)`,
    )
    .run({
      id: row.id,
      name: row.name,
      provider: row.provider,
      modelId: row.modelId,
      persona: row.persona ?? null,
      tools: JSON.stringify(row.tools ?? []),
      secrets: JSON.stringify(row.secrets ?? []),
      mcpServers: JSON.stringify(row.mcpServers ?? []),
    });
}

function legacyWorld(): LegacyWorld {
  const dir = makeTestTempDir('agent-removal-');
  dirs.push(dir);
  const dbPath = join(dir, 'server.db');
  const sqlite = new Database(dbPath);
  sqlite.pragma('foreign_keys = ON');
  migrateUpTo(sqlite, dir, '0109_overconfident_omega_red');
  sqlite.exec("INSERT INTO user (id, displayName) VALUES ('u1', 'Owner')");
  sqlite.exec("INSERT INTO team (id, name, createdAt) VALUES ('t1', 'Team', 1)");
  sqlite
    .prepare(
      `INSERT INTO machine (id, teamId, name, online, tokenHash, latestCliVersion, enabledRuntimes, claudeCodeReport)
       VALUES ('m-box', 't1', 'box', 1, ?, '0.3.0', '["pi","claude-code"]', ?)`,
    )
    .run(hashCredential(TOKEN), JSON.stringify(subscriptionClaudeReport));
  insertAgent(sqlite, {
    id: CHIEF_AGENT,
    name: 'Chief',
    provider: 'openai-codex',
    modelId: 'gpt-6-luna',
    tools: ['推送分支'],
    mcpServers: ['codegraph', 'playwright'],
  });
  insertAgent(sqlite, {
    id: IMPLEMENTER_AGENT,
    name: 'Implementer',
    provider: 'claude-code',
    modelId: 'claude-sonnet-5-5',
    persona: 'implementer',
    tools: ['推送分支'],
    secrets: ['DEPLOY_KEY'],
  });
  insertAgent(sqlite, {
    id: REVIEWER_AGENT,
    name: 'CodeReviewer',
    provider: 'claude-code',
    modelId: 'claude-sonnet-5-5',
    persona: 'code_reviewer',
    tools: ['推送分支', '合并分支'],
    secrets: ['REVIEW_KEY'],
  });
  insertAgent(sqlite, {
    id: HARBOR_AGENT,
    name: 'eval-harbor',
    provider: 'relay-186',
    modelId: 'glm-5.3',
  });
  insertAgent(sqlite, {
    id: PROBE_AGENT,
    name: 'codex-luna-probe',
    provider: 'openai-codex',
    modelId: 'gpt-6-luna',
  });
  sqlite
    .prepare(
      "INSERT INTO chief (id, userId, teamId, createdAt, agentId) VALUES ('chief-u1-t1', 'u1', 't1', 1, ?)",
    )
    .run(CHIEF_AGENT);
  sqlite.exec("INSERT INTO project (id, name, teamId) VALUES ('p1', 'Proj', 't1')");
  const memory = sqlite.prepare(
    `INSERT INTO agent_memory (id, agentId, teamId, title, content, createdAt, updatedAt)
     VALUES (?, ?, 't1', ?, ?, 1, 1)`,
  );
  memory.run('mem-chief', CHIEF_AGENT, 'chief fact', 'the coordinator knows this');
  memory.run('mem-impl', IMPLEMENTER_AGENT, 'impl fact', 'the implementer knows this');
  memory.run('mem-review', REVIEWER_AGENT, 'review fact', 'the reviewer knows this');
  const todo = sqlite.prepare(
    `INSERT INTO todo (id, teamId, projectId, title, phase, phaseAt, seqNum, assignment, latestBuildId, sourceKind)
     VALUES (?, 't1', 'p1', ?, ?, 1, ?, ?, ?, ?)`,
  );
  todo.run(
    'todo-flight',
    'In flight legacy build',
    'building',
    1,
    JSON.stringify({ plan: null, build: { agentId: IMPLEMENTER_AGENT } }),
    'build-flight',
    null,
  );
  todo.run(
    'todo-pending',
    'Pending legacy build',
    'queued',
    2,
    JSON.stringify({ plan: null, build: { agentId: IMPLEMENTER_AGENT } }),
    'build-pending',
    null,
  );
  todo.run(
    'todo-citation',
    'Check research citations',
    'queued',
    3,
    JSON.stringify({ plan: null, build: { agentId: HARBOR_AGENT } }),
    'build-citation',
    'research-citation-check',
  );
  const build = sqlite.prepare(
    "INSERT INTO build (id, todoId, withPlan, triggerSource, createdAt) VALUES (?, ?, 0, 'user', 1)",
  );
  build.run('build-flight', 'todo-flight');
  build.run('build-pending', 'todo-pending');
  build.run('build-citation', 'todo-citation');
  sqlite
    .prepare(
      `INSERT INTO step (id, buildId, kind, status, machineId, claimedAt, lastHeartbeatAt, createdAt)
       VALUES ('step-flight', 'build-flight', 'build', 'claimed', 'm-box', ?, ?, 1)`,
    )
    .run(Date.now(), Date.now());
  sqlite.exec(
    `INSERT INTO step (id, buildId, kind, status, createdAt) VALUES
       ('step-pending', 'build-pending', 'build', 'pending', 2),
       ('step-citation', 'build-citation', 'build', 'pending', 3)`,
  );
  sqlite.exec(
    `INSERT INTO routing_rule (id, teamId, use, provider, modelId, machineId, seededFromAgentId, createdAt, updatedAt)
     VALUES ('rule-session-old', 't1', 'session', 'claude-code', 'claude-sonnet-5-5', 'm-box', '${IMPLEMENTER_AGENT}', 1, 1)`,
  );
  sqlite.exec(
    `INSERT INTO work_policy (id, teamId, use, tools, mcpServers, secrets, seededFromAgentId, createdAt, updatedAt)
     VALUES ('policy-session-old', 't1', 'session', '["推送分支"]', '[]', '["DEPLOY_KEY"]', '${IMPLEMENTER_AGENT}', 1, 1)`,
  );
  return { dbPath, sqlite };
}

function migratedWorld(): LegacyWorld {
  const world = legacyWorld();
  migrateAll(world.sqlite);
  return world;
}

function rows(sqlite: Database.Database, sql: string): Record<string, unknown>[] {
  return sqlite.prepare(sql).all() as Record<string, unknown>[];
}

function serverOn(world: LegacyWorld) {
  const opened = openDbWithHandle(world.dbPath);
  const s = bootServer({ db: opened.db, claimHoldMs: 20 });
  return { s, opened };
}

async function call(
  s: ReturnType<typeof bootServer>,
  method: string,
  path: string,
  body?: unknown,
  cred?: string,
) {
  return s.app.request(path, {
    method,
    headers: {
      ...(cred ? { authorization: `Bearer ${cred}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function dropWorkerSteps(s: ReturnType<typeof bootServer>): void {
  s.db.delete(schema.step).where(ne(schema.step.kind, 'chief')).run();
}

async function claim(s: ReturnType<typeof bootServer>) {
  const res = await call(s, 'POST', '/api/machine/tasks/claim', {}, TOKEN);
  const body = (await res.json()) as { step: unknown };
  return body.step === null ? null : claimedStepSchema.parse(body.step);
}

describe('removing the agent table from a seeded legacy install', () => {
  test('failure mode: the Coordinator and the citation checker lose their agent binding', () => {
    const { sqlite } = migratedWorld();
    expect(rows(sqlite, "SELECT name FROM sqlite_master WHERE name = 'agent'")).toEqual([]);
    expect(
      rows(sqlite, "SELECT name FROM pragma_table_info('chief') WHERE name = 'agentId'"),
    ).toEqual([]);
    const coordinator = rows(sqlite, "SELECT * FROM routing_rule WHERE use = 'coordinator'");
    expect(coordinator).toHaveLength(1);
    expect(coordinator[0]).toMatchObject({
      id: CHIEF_AGENT,
      teamId: 't1',
      provider: 'openai-codex',
      modelId: 'gpt-6-luna',
      thinkingLevel: 'low',
      machineId: 'm-box',
      mcpServers: '["codegraph","playwright"]',
      seededFromAgentId: CHIEF_AGENT,
    });
    const checker = rows(sqlite, "SELECT * FROM routing_rule WHERE use = 'citation_check'");
    expect(checker).toHaveLength(1);
    expect(checker[0]).toMatchObject({
      provider: 'relay-186',
      modelId: 'glm-5.3',
      machineId: 'm-box',
      seededFromAgentId: HARBOR_AGENT,
    });
  });

  test('the existing session rule and policy are kept and the review policy stays read-only', () => {
    const { sqlite } = migratedWorld();
    expect(rows(sqlite, "SELECT id FROM routing_rule WHERE use = 'session'")).toEqual([
      { id: 'rule-session-old' },
    ]);
    expect(rows(sqlite, "SELECT tools, secrets FROM work_policy WHERE use = 'session'")).toEqual([
      { tools: '["推送分支"]', secrets: '["DEPLOY_KEY"]' },
    ]);
    expect(rows(sqlite, "SELECT tools, secrets FROM work_policy WHERE use = 'review'")).toEqual([
      { tools: '[]', secrets: '[]' },
    ]);
  });

  test('the removed agents, assignments and bindings stay recoverable from backup tables', () => {
    const { sqlite } = migratedWorld();
    expect(rows(sqlite, 'SELECT count(*) AS n FROM legacy_agent_backup')).toEqual([{ n: 5 }]);
    expect(
      rows(sqlite, "SELECT displayName FROM legacy_agent_backup WHERE id = 'agent-chief'"),
    ).toEqual([{ displayName: 'Chief' }]);
    expect(rows(sqlite, 'SELECT count(*) AS n FROM legacy_todo_assignment_backup')).toEqual([
      { n: 3 },
    ]);
    expect(rows(sqlite, 'SELECT agentId FROM legacy_chief_agent_backup')).toEqual([
      { agentId: CHIEF_AGENT },
    ]);
  });

  test('memories follow the team: the implementer is adopted, the reviewer stays independent', () => {
    const { sqlite } = migratedWorld();
    const adopted = rows(
      sqlite,
      'SELECT agentId, adoptedFrom, independent FROM agent_memory WHERE adoptedFrom IS NOT NULL',
    );
    expect(adopted).toEqual([
      { agentId: 'rule-session-old', adoptedFrom: 'mem-impl', independent: 0 },
    ]);
    expect(rows(sqlite, "SELECT independent FROM agent_memory WHERE id = 'mem-review'")).toEqual([
      { independent: 1 },
    ]);
    expect(rows(sqlite, "SELECT id FROM agent_memory WHERE id = 'mem-chief'")).toHaveLength(1);
  });

  test('a second boot changes nothing', () => {
    const world = migratedWorld();
    const before = {
      rules: rows(world.sqlite, 'SELECT * FROM routing_rule ORDER BY id'),
      policies: rows(world.sqlite, 'SELECT * FROM work_policy ORDER BY id'),
      memories: rows(world.sqlite, 'SELECT * FROM agent_memory ORDER BY id'),
      backup: rows(world.sqlite, 'SELECT * FROM legacy_agent_backup ORDER BY id'),
    };
    world.sqlite.close();
    const opened = openDbWithHandle(world.dbPath);
    expect(seedDefaultRouting(opened.db)).toEqual({ sessionRules: 0, policies: 0 });
    opened.close();
    const again = new Database(world.dbPath);
    expect({
      rules: rows(again, 'SELECT * FROM routing_rule ORDER BY id'),
      policies: rows(again, 'SELECT * FROM work_policy ORDER BY id'),
      memories: rows(again, 'SELECT * FROM agent_memory ORDER BY id'),
      backup: rows(again, 'SELECT * FROM legacy_agent_backup ORDER BY id'),
    }).toEqual(before);
    again.close();
  });

  test('a Coordinator turn after the migration runs on the migrated model and machine', async () => {
    const world = migratedWorld();
    world.sqlite.close();
    const { s, opened } = serverOn(world);
    dropWorkerSteps(s);
    const sent = await call(s, 'POST', `/api/teams/${s.team.id}/chief/threads`, {
      content: 'start the next thing',
    });
    expect(sent.status).toBe(201);
    const claimed = await claim(s);
    expect(claimed?.step.kind).toBe('chief');
    expect(claimed?.agent).toMatchObject({
      id: CHIEF_AGENT,
      provider: 'openai-codex',
      modelId: 'gpt-6-luna',
    });
    expect(claimed?.mcpServers).toEqual(['codegraph', 'playwright']);
    expect(claimed?.remoteTools?.map((tool) => tool.name)).toContain('open_thread');
    expect(claimed?.remoteTools?.map((tool) => tool.name)).not.toContain('run_builds');
    opened.close();
  });

  test('the Coordinator keeps its memory and import ownership because the rule keeps the agent id', async () => {
    const world = migratedWorld();
    world.sqlite.close();
    const { s, opened } = serverOn(world);
    const envelope = (await (await call(s, 'GET', `/api/teams/${s.team.id}/chief`)).json()) as {
      chief: { agent: { agentId: string } | null };
      agentActor: { id: string; modelId: string | null } | null;
    };
    expect(envelope.chief.agent).toEqual({ agentId: CHIEF_AGENT });
    expect(envelope.agentActor).toMatchObject({ id: CHIEF_AGENT, modelId: 'gpt-6-luna' });
    opened.close();
  });

  test('the citation checker step routes to its own rule, not the session rule', async () => {
    const world = migratedWorld();
    world.sqlite.close();
    const { s, opened } = serverOn(world);
    const first = await claim(s);
    expect(first?.step.id).toBe('step-pending');
    const second = await claim(s);
    expect(second?.step.id).toBe('step-citation');
    expect(second?.agent).toMatchObject({ provider: 'relay-186', modelId: 'glm-5.3' });
    opened.close();
  });

  test('a pending legacy step is claimed on the session rule and a claimed one still finishes', async () => {
    const world = migratedWorld();
    world.sqlite.close();
    const { s, opened } = serverOn(world);
    const pending = await claim(s);
    expect(pending?.step.id).toBe('step-pending');
    expect(pending?.agent).toMatchObject({
      id: 'rule-session-old',
      provider: 'claude-code',
      modelId: 'claude-sonnet-5-5',
      tools: ['推送分支'],
    });
    const done = await call(
      s,
      'POST',
      '/api/machine/done/step-flight',
      { status: 'success', hasChanges: true },
      TOKEN,
    );
    expect(done.status).toBe(200);
    const flight = s.db.select().from(schema.step).where(eq(schema.step.id, 'step-flight')).get();
    expect(flight?.status).toBe('done');
    expect(
      s.db.select().from(schema.todo).where(eq(schema.todo.id, 'todo-flight')).get()?.phase,
    ).toBe('review');
    opened.close();
  });

  test('the removed agent surfaces answer with the documented removal error', async () => {
    const world = migratedWorld();
    world.sqlite.close();
    const { s, opened } = serverOn(world);
    const team = s.team.id;
    for (const [method, path, body] of [
      ['GET', `/api/teams/${team}/agents`, undefined],
      ['POST', `/api/teams/${team}/agents`, { displayName: 'x' }],
      ['PATCH', `/api/teams/${team}/agents/${IMPLEMENTER_AGENT}`, { displayName: 'y' }],
      ['DELETE', `/api/teams/${team}/agents/${IMPLEMENTER_AGENT}`, undefined],
      ['GET', `/api/teams/${team}/agents/${IMPLEMENTER_AGENT}/memories`, undefined],
    ] as const) {
      const res = await call(s, method, path, body);
      expect(res.status, `${method} ${path}`).toBe(410);
      expect(((await res.json()) as { error: string }).error).toContain('removed under D60');
    }
    const startWithAssignment = await call(s, 'POST', '/api/projects/p1/builds', {
      todoIds: ['todo-pending'],
      assignment: { plan: null, build: { agentId: IMPLEMENTER_AGENT } },
      withPlan: false,
    });
    expect(startWithAssignment.status).toBe(410);
    const patchAssignment = await call(s, 'PATCH', '/api/todos/todo-pending', {
      assignment: { build: { agentId: IMPLEMENTER_AGENT } },
    });
    expect(patchAssignment.status).toBe(410);
    const bindChief = await call(s, 'PATCH', `/api/teams/${team}/chief`, {
      agent: { agentId: IMPLEMENTER_AGENT },
    });
    expect(bindChief.status).toBe(410);
    opened.close();
  });

  test('the old Coordinator tools answer with the removal error and name their replacement', async () => {
    const world = migratedWorld();
    world.sqlite.close();
    const { s, opened } = serverOn(world);
    dropWorkerSteps(s);
    const sent = await call(s, 'POST', `/api/teams/${s.team.id}/chief/threads`, {
      content: 'hello',
    });
    expect(sent.status).toBe(201);
    const claimed = await claim(s);
    if (claimed === null) throw new Error('the Coordinator step was not claimed');
    for (const [name, replacement] of [
      ['run_builds', 'open_thread'],
      ['agents', 'routing rules'],
      ['split_todo', 'create_todo'],
      ['create_agent', 'routing rules'],
    ] as const) {
      const res = await call(
        s,
        'POST',
        `/api/machine/tool/${claimed.step.id}`,
        { name, params: {} },
        TOKEN,
      );
      expect(res.status, name).toBe(410);
      expect(((await res.json()) as { error: string }).error).toContain(replacement);
    }
    opened.close();
  });
});
