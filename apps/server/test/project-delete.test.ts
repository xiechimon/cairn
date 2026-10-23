// DELETE /api/projects/{id} 级联语义 E2E（#189 删除区复活前置；路由 = REST 同名
// DELETE [推断]，项目设置危险操作区 UI 证据 r2 24c，wire 未采——登记
// wire.test.ts INFERRED_ROUTES）。
// 级联取舍（实现注记同文）：级联删（拒绝非空所需逐 todo 手删 UI 不存在）；
// 清图 = step（无 FK 手动清，deleteTodo 同律）→ schedule（无 FK 列）→ tag →
// todo（FK cascade 随行 build/plan/todo_tag）→ chief watch 摘除（JSON 列无 FK，
// 陈旧 watch 不自愈）→ agentMemory.projectId 置 null（记忆属 Agent 资产，清
// 作用域留本体）→ project 行；message/tokenUsage 无 FK 孤儿 = deleteTodo 既有
// 面同口径（document_diff 已随 #1029 死 schema 退役删表）。托管 bare repo 磁盘面随行清（repoName 复用安全：
// uniqueRepoName 只查库行，留目录 = 同名新项目在旧库上 reinit/seed 冲突）。

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

describe('DELETE /api/projects/{id}（#189）', () => {
  test('未知 id → 404 {error}；删除后复删 → 404', async () => {
    const s = bootServer();
    await expectErrorShape(await req(s.app, 'DELETE', '/api/projects/nope'), 404);
    const projectId = await postProject(s.app);
    expect((await req(s.app, 'DELETE', `/api/projects/${projectId}`)).status).toBe(204);
    await expectErrorShape(await req(s.app, 'DELETE', `/api/projects/${projectId}`), 404);
    s.dispose();
  });

  test('空项目（未绑 repo）→ 204，列表面即时消失', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    expect((await req(s.app, 'DELETE', `/api/projects/${projectId}`)).status).toBe(204);
    const list = (await (
      await req(s.app, 'GET', `/api/projects?teamId=${s.team.id}`)
    ).json()) as unknown[];
    expect(list).toHaveLength(0);
    // 子读面随行 404
    await expectErrorShape(await req(s.app, 'GET', `/api/projects/${projectId}/todos`), 404);
    s.dispose();
  });

  test('级联：todo/build/step/plan/tag/schedule 随行清；watch 摘除；记忆置 null 留存', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const todoDoc = todoRecordSchema.parse(
      await (
        await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: 'a', spec: '' })
      ).json(),
    );
    // build + step（POST builds 入队规划步）
    const started = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      todoIds: [todoDoc.id],
      assignment: { plan: null, build: null },
      withPlan: true,
    });
    const buildId = ((await started.json()) as { builds: { id: string }[] }).builds[0]?.id;
    expect(buildId).toBeDefined();
    // plan 行（FK cascade 自 build 的钉点）
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
    // tag（projectId FK 挡路钉点）
    s.db.insert(tagTable).values({ id: 'tag-del-1', projectId, name: 'x' }).run();
    // schedule（无 FK 列，经 API 造）
    const sched = await req(s.app, 'POST', '/api/schedules', {
      todoId: todoDoc.id,
      kind: 'daily',
      at: Date.now(),
      tz: 'UTC',
    });
    expect(sched.status).toBe(201);
    // chief watch（JSON 列，直插一行含该 todo 的 watch）
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
    // 记忆（projectId 作用域 + source 溯源槽）
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

    // 读面
    expect(
      (await (await req(s.app, 'GET', `/api/todos?teamId=${s.team.id}`)).json()) as unknown[],
    ).toHaveLength(0);
    await expectErrorShape(await req(s.app, 'GET', `/api/todos/${todoDoc.id}`), 404);
    await expectErrorShape(await req(s.app, 'GET', `/api/builds/${buildId}`), 404);
    await expectErrorShape(await req(s.app, 'GET', `/api/builds/${buildId}/steps`), 404);
    expect(
      (await (await req(s.app, 'GET', `/api/schedules?team=${s.team.id}`)).json()) as unknown[],
    ).toHaveLength(0);
    // 库面
    expect(s.db.select().from(todoTable).all()).toHaveLength(0);
    expect(s.db.select().from(buildTable).all()).toHaveLength(0);
    expect(s.db.select().from(stepTable).all()).toHaveLength(0);
    expect(s.db.select().from(planTable).all()).toHaveLength(0);
    expect(s.db.select().from(tagTable).all()).toHaveLength(0);
    expect(s.db.select().from(projectTable).all()).toHaveLength(0);
    // watch 摘除（chief 行本体留存）
    const chiefRow = s.db.select().from(chief).all()[0];
    expect(chiefRow?.watches).toHaveLength(0);
    // 记忆留存、作用域置 null（溯源槽悬空 = deleteTodo 既有面，不收窄）
    const mem = s.db.select().from(agentMemory).all();
    expect(mem).toHaveLength(1);
    expect(mem[0]?.projectId).toBeNull();
    s.dispose();
  });

  test('托管形态：bare repo 磁盘随行清；同名新项目复用 repoName 安全', async () => {
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

    // 复用安全钉点：uniqueRepoName 只查库行——目录若残留，同名新项目会在旧库
    // 上 reinit/seed 冲突；清盘后同名再建拿到原名 + 全新空库。
    const again = projectRecordSchema.parse(
      await (
        await req(s.app, 'POST', '/api/projects', { name: 'Hosted Repo', repoKind: 'hosted' })
      ).json(),
    );
    expect(again.repoName).toBe('hosted-repo');
    expect(existsSync(dir)).toBe(true);
    s.dispose();
  });

  test('隔离：删 A 不伤 B（同团队邻项目 todo 留存）', async () => {
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
