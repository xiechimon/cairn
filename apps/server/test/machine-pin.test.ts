import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ClaimedStep } from '@cairn/shared';
import {
  claimedStepSchema,
  machineOkResponseSchema,
  machineUploadUrlsResponseSchema,
  PLAN_FILE_NAME,
} from '@cairn/shared';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterAll, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { MIGRATIONS_FOLDER } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import {
  chief as chiefTable,
  machine as machineTable,
  step as stepTable,
} from '../src/db/schema.js';
import {
  bootServer,
  insertLegacyUserAndTeam,
  issueApiKey,
  postProject,
  req,
  seedRoute,
  seedSessionRoute,
  startLegacyBuild,
  subscriptionClaudeReport,
  type TestServer,
  withVerification,
} from './helpers.js';

const temps: string[] = [];
function temp(prefix: string): string {
  const dir = makeTestTempDir(prefix);
  temps.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

function call(
  app: TestServer['app'],
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    }),
  );
}

async function enroll(s: TestServer, name: string): Promise<string> {
  const key = await issueApiKey(s);
  const res = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: readyMachine({ teamId: s.team.id, name, cliVersion: '0.1.0' }),
  });
  expect(res.status).toBe(200);
  return ((await res.json()) as { token: string }).token;
}

async function claim(app: TestServer['app'], token: string): Promise<ClaimedStep | null> {
  const res = await call(app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
  const body = (await res.json()) as { step: ClaimedStep | null };
  return body.step === null ? null : claimedStepSchema.parse(body.step);
}

async function rebind(
  w: World,
  use: 'session' | 'coordinator',
  machineId: string,
): Promise<Response> {
  return req(w.s.app, 'PATCH', `/api/teams/${w.s.team.id}/routing-rules/${use}`, { machineId });
}

interface World {
  s: TestServer;
  tokenA: string;
  tokenB: string;
  machineAId: string;
  machineBId: string;
  projectId: string;
}

async function setupWorld(): Promise<World> {
  const s = bootServer({ claimHoldMs: 200 });
  temps.push('');
  const tokenA = await enroll(s, 'home-mbp');
  const tokenB = await enroll(s, 'home-other');
  const machineAId = s.db
    .select()
    .from(machineTable)
    .where(eq(machineTable.name, 'home-mbp'))
    .get()!.id;
  const machineBId = s.db
    .select()
    .from(machineTable)
    .where(eq(machineTable.name, 'home-other'))
    .get()!.id;
  s.db.update(machineTable).set({ online: true }).where(eq(machineTable.teamId, s.team.id)).run();
  seedSessionRoute(s, { provider: 'stub-gw', modelId: 'stub-model', machineId: machineAId });
  const projectId = await postProject(s.app, 'home-proj');
  return { s, tokenA, tokenB, machineAId, machineBId, projectId };
}

async function createTodo(s: TestServer, projectId: string): Promise<string> {
  const res = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: '',
    spec: '探针任务',
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function startBuild(s: TestServer, projectId: string, todoId: string): Promise<string> {
  const res = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [todoId],
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id as string;
}

describe('#1259 worker home-machine gate', () => {
  test('pinned to A -> A claims, B comes up empty; re-pinned to B -> B claims (reassignment immediate)', async () => {
    const w = await setupWorld();
    const todoId = await createTodo(w.s, w.projectId);
    await startBuild(w.s, w.projectId, todoId);

    expect(await claim(w.s.app, w.tokenB)).toBeNull();
    const got = await claim(w.s.app, w.tokenA);
    expect(got).not.toBeNull();
    expect(got!.step.machineId).toBe(w.machineAId);

    const repin = await rebind(w, 'session', w.machineBId);
    expect(repin.status).toBe(200);
    const todoId2 = await createTodo(w.s, w.projectId);
    await startBuild(w.s, w.projectId, todoId2);
    expect(await claim(w.s.app, w.tokenA)).toBeNull();
    const got2 = await claim(w.s.app, w.tokenB);
    expect(got2).not.toBeNull();
    expect(got2!.step.machineId).toBe(w.machineBId);
  });
});

describe('#1312 other-machine mark on a resumed session', () => {
  async function finishPlan(w: World, stepId: string, sessionId: string): Promise<void> {
    const urlsRes = await call(w.s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
      cred: w.tokenA,
      body: { files: [{ name: PLAN_FILE_NAME }] },
    });
    expect(urlsRes.status).toBe(200);
    const planUpload = machineUploadUrlsResponseSchema.parse(await urlsRes.json()).uploads[0]!;
    const planPath = planUpload.url.replace(/^https?:\/\/[^/]+/, '');
    const planPut = await w.s.app.request(planPath, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${w.tokenA}`,
        'content-type': 'text/markdown',
      },
      body: withVerification('# 方案\nContext: 1312\n'),
    });
    expect(machineOkResponseSchema.parse(await planPut.json())).toEqual({ ok: true });
    const doneRes = await call(w.s.app, 'POST', `/api/machine/done/${stepId}`, {
      cred: w.tokenA,
      body: { status: 'success', sessionId, hasChanges: false },
    });
    expect(doneRes.status).toBe(200);
  }

  test('same-machine resume carries no priorMachineId; rebinding the rule does not move the session', async () => {
    const w = await setupWorld();
    const todoId = await createTodo(w.s, w.projectId);
    startLegacyBuild(w.s, todoId, { withPlan: true });
    const plan = await claim(w.s.app, w.tokenA);
    expect(plan?.step.kind).toBe('plan');
    await finishPlan(w, plan!.step.id, 'sess-home');

    const confirmRes = await req(w.s.app, 'POST', `/api/builds/${plan!.step.buildId}/steps`, {
      action: 'confirm',
    });
    expect(confirmRes.status).toBe(202);
    const sameMachine = await claim(w.s.app, w.tokenA);
    expect(sameMachine?.step.kind).toBe('build');
    expect(sameMachine?.session).toEqual({ action: 'continue', sessionId: 'sess-home' });

    const todoId2 = await createTodo(w.s, w.projectId);
    startLegacyBuild(w.s, todoId2, { withPlan: true });
    const plan2 = await claim(w.s.app, w.tokenA);
    expect(plan2?.step.kind).toBe('plan');
    await finishPlan(w, plan2!.step.id, 'sess-moved');
    const repin = await rebind(w, 'session', w.machineBId);
    expect(repin.status).toBe(200);
    const confirm2 = await req(w.s.app, 'POST', `/api/builds/${plan2!.step.buildId}/steps`, {
      action: 'confirm',
    });
    expect(confirm2.status).toBe(202);
    w.s.db
      .update(machineTable)
      .set({ enabledRuntimes: [] })
      .where(eq(machineTable.id, w.machineAId))
      .run();
    w.s.db
      .update(stepTable)
      .set({ createdAt: Date.now() - 6 * 60_000 })
      .where(eq(stepTable.status, 'pending'))
      .run();
    expect(await claim(w.s.app, w.tokenA)).toBeNull();
    expect(await claim(w.s.app, w.tokenB)).toBeNull();
  });
});

describe('#682 runtime real gate (semantics unchanged, home-machine version)', () => {
  test('home machine without the step-needed runtime -> cannot claim; enabled back -> claims (PATCH hot write)', async () => {
    const w = await setupWorld();
    const off = await req(w.s.app, 'PATCH', `/api/machines/${w.machineAId}`, {
      enabledRuntimes: [],
    });
    expect(off.status).toBe(200);
    const todoId = await createTodo(w.s, w.projectId);
    await startBuild(w.s, w.projectId, todoId);
    expect(await claim(w.s.app, w.tokenA)).toBeNull();

    const on = await req(w.s.app, 'PATCH', `/api/machines/${w.machineAId}`, {
      enabledRuntimes: ['pi'],
    });
    expect(on.status).toBe(200);
    const got = await claim(w.s.app, w.tokenA);
    expect(got).not.toBeNull();
  });

  test('a claude-code step cannot be claimed on a pi-only home machine; re-pin to a dual-enabled machine claims', async () => {
    const w = await setupWorld();
    const dual = await req(w.s.app, 'PATCH', `/api/machines/${w.machineBId}`, {
      enabledRuntimes: ['pi', 'claude-code'],
    });
    expect(dual.status).toBe(200);
    w.s.db
      .update(machineTable)
      .set({ claudeCodeReport: { ...subscriptionClaudeReport, installed: false } })
      .where(eq(machineTable.id, w.machineAId))
      .run();
    const todoId = await createTodo(w.s, w.projectId);
    seedSessionRoute(w.s, {
      provider: 'claude-code',
      modelId: 'stub-model',
      machineId: w.machineAId,
    });
    const res = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
      todoIds: [todoId],
    });
    expect(res.status).toBe(201);
    expect(await claim(w.s.app, w.tokenA)).toBeNull();
    w.s.db
      .update(machineTable)
      .set({
        claudeCodeReport: {
          ...subscriptionClaudeReport,
          hostname: 'home-other',
          models: [{ id: 'stub-model', name: 'stub-model', slot: 'default' }],
        },
      })
      .where(eq(machineTable.id, w.machineBId))
      .run();
    const repin = await rebind(w, 'session', w.machineBId);
    expect(repin.status).toBe(200);
    const got = await claim(w.s.app, w.tokenB);
    expect(got).not.toBeNull();
  });
});

describe('#1260 chief step delivery = coordinator rule home machine', () => {
  function bindChief(w: World): void {
    const chiefId = `chief-${w.s.user.id}-${w.s.team.id}`;
    w.s.db
      .insert(chiefTable)
      .values({
        id: chiefId,
        userId: w.s.user.id,
        teamId: w.s.team.id,
        charter: '',
        createdAt: Date.now(),
      })
      .run();
    seedRoute(w.s, 'coordinator', {
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId: w.machineAId,
    });
  }

  test('Coordinator pinned to B -> only B can claim the chief step; re-pinned to A -> A claims (reassignment immediate)', async () => {
    const w = await setupWorld();
    bindChief(w);
    const repin = await rebind(w, 'coordinator', w.machineBId);
    expect(repin.status).toBe(200);
    const todoId = await createTodo(w.s, w.projectId);
    const res = await req(w.s.app, 'POST', `/api/todos/${todoId}/orchestrate`, {});
    expect(res.status).toBe(201);
    expect(await claim(w.s.app, w.tokenA)).toBeNull();
    const got = await claim(w.s.app, w.tokenB);
    expect(got).not.toBeNull();
    expect(got!.step.kind).toBe('chief');
    w.s.db.update(stepTable).set({ status: 'done' }).where(eq(stepTable.id, got!.step.id)).run();

    const back = await rebind(w, 'coordinator', w.machineAId);
    expect(back.status).toBe(200);
    const todoId2 = await createTodo(w.s, w.projectId);
    const res2 = await req(w.s.app, 'POST', `/api/todos/${todoId2}/orchestrate`, {});
    expect(res2.status).toBe(201);
    expect(await claim(w.s.app, w.tokenB)).toBeNull();
    const got2 = await claim(w.s.app, w.tokenA);
    expect(got2).not.toBeNull();
    expect(got2!.step.kind).toBe('chief');
  });
});

describe('#895 GET /chief orchestration envelope (#1260 re-source)', () => {
  interface OrchestrationBlock {
    orchestration: {
      homeMachineId: string | null;
      activity: { machineId: string; running: number; waiting: number }[];
    };
  }

  async function getEnvelope(w: World): Promise<OrchestrationBlock> {
    const res = await req(w.s.app, 'GET', `/api/teams/${w.s.team.id}/chief`);
    expect(res.status).toBe(200);
    return (await res.json()) as OrchestrationBlock;
  }

  function setChiefStep(
    s: TestServer,
    threadId: string,
    opts: { status: 'claimed' | 'pending'; machineId?: string | null },
  ): void {
    const row = s.db.select().from(stepTable).where(eq(stepTable.buildId, threadId)).get()!;
    s.db
      .update(stepTable)
      .set({ status: opts.status, machineId: opts.machineId ?? null })
      .where(eq(stepTable.id, row.id))
      .run();
  }

  test('failure mode G: projection -- homeMachineId + running (claimed) / waiting (pending not executable by its home machine) counts', async () => {
    const w = await setupWorld();
    seedRoute(w.s, 'coordinator', {
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId: w.machineAId,
    });
    const t1 = await req(w.s.app, 'POST', `/api/teams/${w.s.team.id}/chief/threads`, {
      content: '回合一',
    });
    const thread1 = ((await t1.json()) as { thread: { id: string } }).thread.id;
    setChiefStep(w.s, thread1, { status: 'claimed', machineId: w.machineAId });
    w.s.db
      .update(machineTable)
      .set({ online: false })
      .where(eq(machineTable.id, w.machineAId))
      .run();
    await req(w.s.app, 'POST', `/api/teams/${w.s.team.id}/chief/threads`, {
      content: '回合二',
    });

    const body = await getEnvelope(w);
    expect(body.orchestration.homeMachineId).toBe(w.machineAId);
    const activityA = body.orchestration.activity.find((a) => a.machineId === w.machineAId);
    expect(activityA?.running).toBe(1);
    expect(activityA?.waiting).toBe(1);
  });

  test('failure mode H: waiting criterion -- home machine online but runtime gate off also counts (T3 gap visibility)', async () => {
    const w = await setupWorld();
    seedRoute(w.s, 'coordinator', {
      provider: 'stub-gw',
      modelId: 'stub-model',
      machineId: w.machineAId,
    });
    const repin = await rebind(w, 'coordinator', w.machineBId);
    expect(repin.status).toBe(200);
    await req(w.s.app, 'PATCH', `/api/machines/${w.machineBId}`, {
      enabledRuntimes: ['claude-code'],
    });
    w.s.db
      .update(machineTable)
      .set({ online: true })
      .where(eq(machineTable.id, w.machineBId))
      .run();
    await req(w.s.app, 'POST', `/api/teams/${w.s.team.id}/chief/threads`, {
      content: '回合',
    });

    const body = await getEnvelope(w);
    expect(body.orchestration.homeMachineId).toBe(w.machineBId);
    const activityB = body.orchestration.activity.find((a) => a.machineId === w.machineBId);
    expect(activityB?.waiting).toBe(1);
  });

  test('regression red line: chief with no coordinator rule + no chief step -> homeMachineId null + activity empty', async () => {
    const w = await setupWorld();
    const body = await getEnvelope(w);
    expect(body.orchestration.homeMachineId).toBeNull();
    expect(body.orchestration.activity).toEqual([]);
  });
});

describe('#682 0022 backfill (legacy [] machine rows -> [pi])', () => {
  function readJournal(folder: string): { entries: { idx: number; tag: string }[] } {
    return JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8'));
  }

  function pinMigrationIdx(): number {
    const journal = readJournal(MIGRATIONS_FOLDER);
    const idx = journal.entries.findIndex((entry) =>
      /UPDATE `machine` SET `enabledRuntimes`/i.test(
        readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), 'utf8'),
      ),
    );
    expect(idx, 'enabledRuntimes backfill migration missing from journal').toBeGreaterThan(0);
    return idx;
  }

  function prePinMigrations(): string {
    const journal = readJournal(MIGRATIONS_FOLDER);
    const cut = pinMigrationIdx();
    const dir = temp('cairn-migrations-pre-pin-');
    mkdirSync(join(dir, 'meta'));
    for (const entry of journal.entries.slice(0, cut)) {
      cpSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
      const snapshot = join(MIGRATIONS_FOLDER, 'meta', `${entry.tag}_snapshot.json`);
      try {
        cpSync(snapshot, join(dir, 'meta', `${entry.tag}_snapshot.json`));
      } catch {}
    }
    const full = readJournal(MIGRATIONS_FOLDER);
    writeFileSync(
      join(dir, 'meta', '_journal.json'),
      JSON.stringify({ ...full, entries: full.entries.slice(0, cut) }, null, 2),
    );
    return dir;
  }

  function buildPrePinDb(): string {
    const dir = temp('cairn-pin-db-');
    const dbPath = join(dir, 'server.db');
    const sqlite = new Database(dbPath);
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: prePinMigrations() });
    const { teamId } = insertLegacyUserAndTeam(sqlite, {
      userId: 'user-legacy',
      teamId: 'team-legacy',
    });
    const insert = sqlite.prepare(
      'INSERT INTO machine (id, teamId, name, enabledRuntimes) VALUES (?, ?, ?, ?)',
    );
    insert.run('m-legacy-off', teamId, 'legacy-off', '[]');
    insert.run('m-legacy-cc', teamId, 'legacy-cc', '["claude-code"]');
    sqlite.close();
    return dbPath;
  }

  function readRuntimes(dbPath: string, id: string): string[] {
    const sqlite = new Database(dbPath, { readonly: true });
    const row = sqlite.prepare('SELECT enabledRuntimes FROM machine WHERE id = ?').get(id) as {
      enabledRuntimes: string;
    };
    sqlite.close();
    return JSON.parse(row.enabledRuntimes);
  }

  test('pre-upgrade legacy db -> full backfill migration rerun: [] rows backfilled [pi], already claude-code-enabled rows untouched', () => {
    const dbPath = buildPrePinDb();
    const sqlite = new Database(dbPath);
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    sqlite.close();
    expect(readRuntimes(dbPath, 'm-legacy-off')).toEqual(['pi']);
    expect(readRuntimes(dbPath, 'm-legacy-cc')).toEqual(['claude-code']);
  });

  test('backfill UPDATE idempotent (defensive replay produces no duplicates; ALTER section not in the replay surface)', () => {
    const dbPath = buildPrePinDb();
    const entry = readJournal(MIGRATIONS_FOLDER).entries[pinMigrationIdx()]!;
    const sql = readFileSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`), 'utf8');
    const updateStmt = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .find((s) => /^UPDATE `machine`/i.test(s))!;
    const sqlite = new Database(dbPath);
    sqlite.exec(updateStmt);
    sqlite.exec(updateStmt);
    sqlite.close();
    expect(readRuntimes(dbPath, 'm-legacy-off')).toEqual(['pi']);
  });
});
