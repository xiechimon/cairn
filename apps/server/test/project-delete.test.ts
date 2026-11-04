import { existsSync } from 'node:fs';
import { projectRecordSchema, todoRecordSchema } from '@cairn/shared';
import { describe, expect, test } from 'vitest';
import {
  agentMemory,
  build as buildTable,
  chief,
  plan as planTable,
  project as projectTable,
  step as stepTable,
  tag as tagTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { repoDirFor } from '../src/services/git.js';
import { bootServer, postProject, req } from './helpers.js';

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
    const projectId = await postProject(s.app);
    const todoDoc = todoRecordSchema.parse(
      await (
        await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'a', spec: '' })
      ).json(),
    );
    const started = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      todoIds: [todoDoc.id],
      assignment: { plan: null, build: null },
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
    const mem = s.db.select().from(agentMemory).all();
    expect(mem).toHaveLength(1);
    expect(mem[0]?.projectId).toBeNull();
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
