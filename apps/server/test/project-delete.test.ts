import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { MEMORY_INDEX_TITLE, projectRecordSchema, todoRecordSchema } from '@cairn/shared';
import Database from 'better-sqlite3';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { describe, expect, test } from 'vitest';
import { openDbWithHandle } from '../src/db/client.js';
import * as schema from '../src/db/schema.js';
import {
  agentMemory,
  build as buildTable,
  chief,
  chiefThread,
  plan as planTable,
  project as projectTable,
  step as stepTable,
  tag as tagTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { repoDirFor } from '../src/services/git.js';
import { stopStepComputer } from '../src/services/machine-computer.js';
import { deleteProject } from '../src/services/projects.js';
import { bootServer, insertMachine, postProject, req, seedSessionRoute } from './helpers.js';

async function expectErrorShape(res: Response, status: number): Promise<void> {
  expect(res.status).toBe(status);
  const body = (await res.json()) as Record<string, unknown>;
  expect(Object.keys(body)).toEqual(['error']);
}

describe('DELETE /api/projects/{id} (#189)', () => {
  test('unknown id -> 404 {error}; deleting again after deletion -> 404', async () => {
    const s = bootServer();
    await expectErrorShape(await req(s.app, 'DELETE', '/api/projects/nope'), 404);
    const projectId = await postProject(s.app);
    expect((await req(s.app, 'DELETE', `/api/projects/${projectId}`)).status).toBe(204);
    await expectErrorShape(await req(s.app, 'DELETE', `/api/projects/${projectId}`), 404);
    s.dispose();
  });

  test('an empty project (no repo bound) -> 204, gone from the list immediately', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    expect((await req(s.app, 'DELETE', `/api/projects/${projectId}`)).status).toBe(204);
    const list = (await (
      await req(s.app, 'GET', `/api/projects?teamId=${s.team.id}`)
    ).json()) as unknown[];
    expect(list).toHaveLength(0);
    await expectErrorShape(await req(s.app, 'GET', `/api/projects/${projectId}/todos`), 404);
    s.dispose();
  });

  test('cascade: todo/build/step/plan/tag/schedule rows cleared; watch detached; memories kept with project set to null', async () => {
    const s = bootServer();
    insertMachine(s);
    seedSessionRoute(s);
    const projectId = await postProject(s.app);
    const todoDoc = todoRecordSchema.parse(
      await (
        await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'a', spec: '' })
      ).json(),
    );
    const started = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      todoIds: [todoDoc.id],
      withPlan: true,
    });
    const buildId = ((await started.json()) as { builds: { id: string }[] }).builds[0]?.id;
    expect(buildId).toBeDefined();
    s.db
      .insert(planTable)
      .values({
        id: 'plan-del-1',
        buildId: buildId ?? '',
        version: 1,
        content: '# p',
        createdAt: Date.now(),
      })
      .run();
    s.db.insert(tagTable).values({ id: 'tag-del-1', projectId, name: 'x' }).run();
    const sched = await req(s.app, 'POST', '/api/schedules', {
      todoId: todoDoc.id,
      kind: 'daily',
      at: Date.now(),
      tz: 'UTC',
    });
    expect(sched.status).toBe(201);
    s.db
      .insert(chief)
      .values({
        id: `chief-${s.user.id}-${s.team.id}`,
        userId: s.user.id,
        teamId: s.team.id,
        createdAt: Date.now(),
        watches: [
          {
            todoId: todoDoc.id,
            projectId,
            seqNum: todoDoc.seqNum,
            title: todoDoc.title,
            projectName: 'demo',
            phase: 'queued',
            reason: 'Dispatched by the chief: report back when it parks at a gate or settles.',
            createdAt: Date.now(),
            threadId: 'chief-00000000-0000-7000-8000-000000000000',
            threadTitle: 't',
          },
        ],
      })
      .run();
    s.db
      .insert(agentMemory)
      .values({
        id: 'mem-del-1',
        agentId: 'agent-x',
        teamId: s.team.id,
        title: 'm',
        content: 'c',
        projectId,
        sourceTodoId: todoDoc.id,
        sourceBuildId: buildId ?? null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      })
      .run();
    s.db.update(stepTable).set({ status: 'done', finishedAt: Date.now() }).run();

    expect((await req(s.app, 'DELETE', `/api/projects/${projectId}`)).status).toBe(204);

    expect(
      (await (await req(s.app, 'GET', `/api/todos?teamId=${s.team.id}`)).json()) as unknown[],
    ).toHaveLength(0);
    await expectErrorShape(await req(s.app, 'GET', `/api/todos/${todoDoc.id}`), 404);
    await expectErrorShape(await req(s.app, 'GET', `/api/builds/${buildId}`), 404);
    await expectErrorShape(await req(s.app, 'GET', `/api/builds/${buildId}/steps`), 404);
    expect(
      (await (await req(s.app, 'GET', `/api/schedules?team=${s.team.id}`)).json()) as unknown[],
    ).toHaveLength(0);
    expect(s.db.select().from(todoTable).all()).toHaveLength(0);
    expect(s.db.select().from(buildTable).all()).toHaveLength(0);
    expect(s.db.select().from(stepTable).all()).toHaveLength(0);
    expect(s.db.select().from(planTable).all()).toHaveLength(0);
    expect(s.db.select().from(tagTable).all()).toHaveLength(0);
    expect(s.db.select().from(projectTable).all()).toHaveLength(0);
    const chiefRow = s.db.select().from(chief).all()[0];
    expect(chiefRow?.watches).toHaveLength(0);
    const mem = s.db
      .select()
      .from(agentMemory)
      .all()
      .filter((row) => row.invalidAt === null);
    expect(mem).toHaveLength(1);
    expect(mem[0]?.projectId).toBeNull();
    expect(mem[0]?.title).toBe(MEMORY_INDEX_TITLE);
    s.dispose();
  });

  test('hosted shape: the bare repo directory is cleared with it; a new project reusing the same repoName is safe', async () => {
    const s = bootServer();
    const created = projectRecordSchema.parse(
      await (
        await req(s.app, 'POST', '/api/projects', { name: 'Hosted Repo', repoKind: 'hosted' })
      ).json(),
    );
    expect(created.repoName).toBe('hosted-repo');
    const dir = repoDirFor(s.reposDir, s.team.id, 'hosted-repo');
    expect(existsSync(dir)).toBe(true);

    expect((await req(s.app, 'DELETE', `/api/projects/${created.id}`)).status).toBe(204);
    expect(existsSync(dir)).toBe(false);

    const again = projectRecordSchema.parse(
      await (
        await req(s.app, 'POST', '/api/projects', { name: 'Hosted Repo', repoKind: 'hosted' })
      ).json(),
    );
    expect(again.repoName).toBe('hosted-repo');
    expect(existsSync(dir)).toBe(true);
    s.dispose();
  });

  test('isolation: deleting A does not hurt B (the neighboring project todos in the same team survive)', async () => {
    const s = bootServer();
    const a = await postProject(s.app, 'a');
    const b = await postProject(s.app, 'b');
    const todoB = todoRecordSchema.parse(
      await (
        await req(s.app, 'POST', `/api/projects/${b}/todos`, { title: 'b-todo', spec: '' })
      ).json(),
    );
    await req(s.app, 'POST', `/api/projects/${a}/todos`, { title: 'a-todo', spec: '' });

    expect((await req(s.app, 'DELETE', `/api/projects/${a}`)).status).toBe(204);

    const projects = (await (
      await req(s.app, 'GET', `/api/projects?teamId=${s.team.id}`)
    ).json()) as { id: string }[];
    expect(projects.map((p) => p.id)).toEqual([b]);
    const todos = (await (await req(s.app, 'GET', `/api/todos?teamId=${s.team.id}`)).json()) as {
      id: string;
    }[];
    expect(todos.map((t) => t.id)).toEqual([todoB.id]);
    s.dispose();
  });
});

const runningCases = [
  [
    'step pending',
    "insert into step (id, buildId, kind, status, createdAt) values ('work', 'build', 'build', 'pending', 1)",
  ],
  [
    'step claimed',
    "insert into step (id, buildId, kind, status, createdAt) values ('work', 'build', 'build', 'claimed', 1)",
  ],
  [
    'step waiting_quota',
    "insert into step (id, buildId, kind, status, createdAt) values ('work', 'build', 'build', 'waiting_quota', 1)",
  ],
  [
    'branch-sync pending',
    "insert into branch_sync (id, buildId, machineId, teamId, directory, ref, `commit`, status, createdAt) values ('work', 'build', 'machine', :team, '/repo', 'main', 'abc', 'pending', 1)",
  ],
  [
    'branch-sync running',
    "insert into branch_sync (id, buildId, machineId, teamId, directory, ref, `commit`, status, createdAt) values ('work', 'build', 'machine', :team, '/repo', 'main', 'abc', 'running', 1)",
  ],
  [
    'chief-thread',
    'update chief_thread set activeRun = \'{"phase":"chief"}\' where id = \'thread\'',
  ],
  [
    'computer-call dispatched',
    "insert into computer_call (id, teamId, stepId, toolCallId, machineId, tool, replaySafe, params, state, deadlineAt, createdAt) values ('work', :team, 'settled', 'call', 'machine', 'shell', 0, '{}', 'dispatched', 100, 1)",
  ],
  [
    'computer-call running',
    "insert into computer_call (id, teamId, stepId, toolCallId, machineId, tool, replaySafe, params, state, deadlineAt, createdAt) values ('work', :team, 'settled', 'call', 'machine', 'shell', 0, '{}', 'running', 100, 1)",
  ],
  [
    'computer starting',
    "insert into computer (id, teamId, scopeKey, machineId, providerRef, state, executionStepId, createdAt, updatedAt) values ('work', :team, 'scope', 'machine', 'orb', 'starting', 'settled', 1, 1)",
  ],
  [
    'computer running',
    "insert into computer (id, teamId, scopeKey, machineId, providerRef, state, executionStepId, createdAt, updatedAt) values ('work', :team, 'scope', 'machine', 'orb', 'running', 'settled', 1, 1)",
  ],
  [
    'autonomous-merge',
    "insert into autonomous_merge_admission (buildId, teamId, state, createdAt) values ('build', :team, 'pending', 1)",
  ],
] as const;

async function runningWorld() {
  const s = bootServer();
  const projectId = await postProject(s.app, 'running');
  insertMachine(s, { name: 'guard' });
  s.db.run(sql`update machine set id = 'machine'`);
  s.db
    .insert(todoTable)
    .values({ id: 'todo', teamId: s.team.id, projectId, title: 'task', phaseAt: 1, seqNum: 1 })
    .run();
  s.db
    .insert(buildTable)
    .values({ id: 'build', todoId: 'todo', withPlan: false, triggerSource: 'user', createdAt: 1 })
    .run();
  s.db
    .insert(stepTable)
    .values({ id: 'settled', buildId: 'build', kind: 'build', status: 'done', createdAt: 1 })
    .run();
  s.db
    .insert(chiefThread)
    .values({
      id: 'thread',
      chiefId: 'chief',
      userId: s.user.id,
      teamId: s.team.id,
      projectId,
      title: 'thread',
      createdAt: 1,
      updatedAt: 1,
      sessionId: 'session',
      sessionOpenedAt: 1,
    })
    .run();
  return { s, projectId };
}

describe('project deletion running guard', () => {
  test.each(runningCases)(
    '%s independently blocks deletion without stopping work',
    async (kind, statement) => {
      const { s, projectId } = await runningWorld();
      s.db.run(sql.raw(statement.replaceAll(':team', `'${s.team.id}'`)));
      const before = s.db.all(sql`select * from step`);
      const res = await req(s.app, 'DELETE', `/api/projects/${projectId}`);
      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string; reason: string };
      expect(body.reason).toBe('project-running');
      s.db.run(sql`update project set archivedAt = 1 where id = ${projectId}`);
      expect((await req(s.app, 'DELETE', `/api/projects/${projectId}`)).status).toBe(409);
      expect(body.error).toContain(kind.split(' ')[0]);
      expect(body.error).toContain(kind.split(' ')[1] ?? '');
      expect(s.db.all(sql`select * from step`)).toEqual(before);
      expect(s.db.select().from(projectTable).all()).toHaveLength(1);
      const other = await postProject(s.app, 'unrelated');
      expect((await req(s.app, 'DELETE', `/api/projects/${other}`)).status).toBe(204);
      const terminal = kind.startsWith('step ')
        ? "update step set status = 'done'"
        : kind.startsWith('branch-sync ')
          ? "update branch_sync set status = 'synced'"
          : kind === 'chief-thread'
            ? 'update chief_thread set activeRun = null'
            : kind.startsWith('computer-call ')
              ? "update computer_call set state = 'done'"
              : kind.startsWith('computer ')
                ? "update computer set state = 'stopped'"
                : "update autonomous_merge_admission set state = 'merged'";
      s.db.run(sql.raw(terminal));
      expect((await req(s.app, 'DELETE', `/api/projects/${projectId}`)).status).toBe(204);
      s.dispose();
    },
  );

  test.each(['unfinished', 'finished', 'expired'] as const)(
    'cancelled computer call after stop: %s',
    async (lifecycle) => {
      const { s, projectId } = await runningWorld();
      try {
        const now = Date.now();
        s.db.run(sql`insert into computer_call
          (id, teamId, stepId, toolCallId, machineId, tool, replaySafe, params, state, deadlineAt, createdAt)
          values ('stopping', ${s.team.id}, 'settled', 'call', 'machine', 'shell', 0, '{}',
            'running', ${now + 60_000}, ${now})`);
        stopStepComputer(s, 'settled');
        expect(
          s.db.get(sql`select state, finishedAt from computer_call where id = 'stopping'`),
        ).toEqual({ state: 'cancelled', finishedAt: null });
        if (lifecycle === 'finished') {
          s.db.run(sql`update computer_call set finishedAt = ${now} where id = 'stopping'`);
        } else if (lifecycle === 'expired') {
          s.db.run(sql`update computer_call set deadlineAt = ${now - 1} where id = 'stopping'`);
        }
        const response = await req(s.app, 'DELETE', `/api/projects/${projectId}`);
        expect(response.status).toBe(lifecycle === 'unfinished' ? 409 : 204);
        if (lifecycle === 'unfinished') {
          expect(await response.json()).toEqual({
            error:
              'cannot delete project while work is running: computer-call stopping cancelled on step settled',
            reason: 'project-running',
          });
          expect(s.db.all(sql`select id from project where id = ${projectId}`)).toHaveLength(1);
          expect(
            s.db.get(sql`select state, finishedAt from computer_call where id = 'stopping'`),
          ).toEqual({ state: 'cancelled', finishedAt: null });
        }
      } finally {
        s.dispose();
      }
    },
  );

  test.each(['scope', 'thread'] as const)(
    'direct service blocks a chief step linked through %s',
    async (link) => {
      const { s, projectId } = await runningWorld();
      s.db
        .insert(stepTable)
        .values({
          id: 'chief-work',
          buildId: link === 'thread' ? 'thread' : 'unbound',
          kind: 'chief',
          status: 'pending',
          scopeProjectId: link === 'scope' ? projectId : null,
          createdAt: 1,
        })
        .run();
      expect(() => deleteProject(s, projectId)).toThrow(/chief-work pending/);
      s.dispose();
    },
  );

  test('settled work allows deletion; response lists multiple blockers', async () => {
    const { s, projectId } = await runningWorld();
    for (const [kind, statement] of runningCases) {
      if (kind === 'step pending' || kind === 'chief-thread') s.db.run(sql.raw(statement));
    }
    const res = await req(s.app, 'DELETE', `/api/projects/${projectId}`);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('step work pending on build build');
    expect(body.error).toContain('chief-thread thread');
    s.db.update(stepTable).set({ status: 'done' }).run();
    s.db.update(chiefThread).set({ activeRun: null }).run();
    expect(deleteProject(s, projectId)).toBe(true);
    s.dispose();
  });

  test('holds a write lock from the first project read through deletion', async () => {
    const scratch = bootServer();
    const file = join(scratch.reposDir, 'guard.db');
    const opened = openDbWithHandle(file);
    const writer = new Database(file, { timeout: 0 });
    const reader = new Database(file);
    let attempts = 0;
    const db = drizzle(reader, {
      schema,
      logger: {
        logQuery(query) {
          if (!/^(select|delete)/.test(query) || !query.includes('from "project"')) return;
          attempts++;
          expect(() => writer.exec('BEGIN IMMEDIATE')).toThrow(/locked/);
        },
      },
    });
    const s = bootServer({ db });
    const projectId = 'lock-project';
    db.insert(projectTable).values({ id: projectId, teamId: s.team.id, name: 'lock' }).run();
    attempts = 0;
    try {
      expect(deleteProject(s, projectId)).toBe(true);
      expect(attempts).toBe(2);
      writer.exec('BEGIN IMMEDIATE; ROLLBACK');
    } finally {
      if (writer.inTransaction) writer.exec('ROLLBACK');
      reader.close();
      writer.close();
      opened.close();
      s.dispose();
      scratch.dispose();
    }
  });
});
