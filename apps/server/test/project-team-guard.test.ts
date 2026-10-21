// #1466 规则 2：chief / MCP 两个工具面按项目 id 读写时核调用方团队——跨团队
// 项目 id 与不存在的 id 同 404（requireTeamTodo「纵深防御、防未来多租越权」
// 同口径）。单团队部署下不可触发；本文件直插第二个团队造出触发面。
// 失败方式（先于实现固化）：
//  T1 chief docs 读到另一团队项目的名字 / 形态 / 文件。
//  T2 chief create_todo / MCP create_todo 往另一团队的项目里建任务
//     （任务行 teamId = 调用方、projectId = 他队项目：两边看板都错）。
//  T3 chief update_project 改另一团队项目的名字。
//  T4 chief connect_repo 把另一团队项目接到任意 GitHub 仓。
//  T5 chief / MCP todos 按另一团队的 projectId 列出他队任务（缺失 id 回
//     []，跨团队 id 也回 []）。
//  T6 chief watch_todos 关注另一团队的任务（标题 / 项目名进本队 chief
//     的 watch 列表；缺失 id 静默跳过，跨团队 id 同样跳过）。
//  T7 跨团队与不存在的错误文案同形（不泄露存在性）。
//  T8 同团队路径不变：上述工具对本队项目照常工作。

import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  chief as chiefTable,
  project as projectTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { HttpError } from '../src/lib/errors.js';
import { nowMs } from '../src/lib/ids.js';
import { executeMcpTool, type McpCallerCtx } from '../src/services/mcp-face.js';
import { H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';

registerChiefHarness();

const TEAM_B = 'team-b-1466';
const PROJ_B = 'proj-b-1466';
const TASK_B = 'todo-b-1466';
const MISSING = 'proj-missing-1466';

beforeEach(() => {
  const now = nowMs();
  H.s.db.insert(teamTable).values({ id: TEAM_B, name: 'B', createdAt: now }).run();
  H.s.db
    .insert(projectTable)
    .values({ id: PROJ_B, name: 'beta', teamId: TEAM_B, repoKind: 'github', githubRepo: 'b/beta' })
    .run();
  H.s.db
    .insert(todoTable)
    .values({
      id: TASK_B,
      teamId: TEAM_B,
      projectId: PROJ_B,
      title: '他队任务',
      spec: '',
      phase: 'todo',
      phaseAt: now,
      seqNum: 1,
    })
    .run();
});

async function chiefError(name: string, params: Record<string, unknown>): Promise<HttpError> {
  const err = await relay(name, params).then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, name).toBeInstanceOf(HttpError);
  return err as HttpError;
}

function mcpCtx(): McpCallerCtx {
  return { teamId: H.teamId, user: H.s.user, grants: new Set(['Todos', 'Create Todo']) };
}

async function mcp(name: string, args: Record<string, unknown>): Promise<unknown> {
  return JSON.parse(await executeMcpTool(toolDeps(), mcpCtx(), name, args));
}

function projectB() {
  return H.s.db.select().from(projectTable).where(eq(projectTable.id, PROJ_B)).get();
}

function todosInProject(projectId: string) {
  return H.s.db.select().from(todoTable).where(eq(todoTable.projectId, projectId)).all();
}

function chiefWatchIds(): string[] {
  const row = H.s.db.select().from(chiefTable).where(eq(chiefTable.id, H.chiefId)).get();
  return (row?.watches ?? []).map((w) => w.todoId);
}

describe('#1466 chief 工具面：跨团队项目 id = 404（与不存在同形）', () => {
  const projectFaces: [string, (projectId: string) => Record<string, unknown>][] = [
    ['docs', (projectId) => ({ projectId, paths: [] })],
    ['create_todo', (projectId) => ({ projectId, title: '越权任务', spec: 's' })],
    ['update_project', (projectId) => ({ projectId, name: 'hijacked' })],
    ['connect_repo', (projectId) => ({ projectId, githubRepo: 'evil/repo' })],
  ];

  test.each(projectFaces)(
    'T1-T4/T7 %s：他队项目 404，文案与不存在 id 同形',
    async (name, params) => {
      const cross = await chiefError(name, params(PROJ_B));
      const missing = await chiefError(name, params(MISSING));
      expect(cross.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(cross.message).toBe(missing.message.replace(MISSING, PROJ_B));
    },
  );

  test('T2-T4 越权调用无副作用：他队项目名 / 仓 / 任务集不变', async () => {
    for (const [name, params] of projectFaces) await chiefError(name, params(PROJ_B));
    expect(projectB()?.name).toBe('beta');
    expect(projectB()?.githubRepo).toBe('b/beta');
    expect(todosInProject(PROJ_B).map((t) => t.id)).toEqual([TASK_B]);
  });

  test('T5 todos：他队 projectId 与不存在 id 同回 []', async () => {
    expect(await relay('todos', { projectId: PROJ_B })).toEqual([]);
    expect(await relay('todos', { projectId: MISSING })).toEqual([]);
  });

  test('T6 watch_todos：他队任务与不存在任务同样跳过，不进本队 watch', async () => {
    await relay('watch_todos', { todoIds: [TASK_B, 'todo-missing-1466'] });
    expect(chiefWatchIds()).toEqual([]);
  });

  test('T8 同团队路径不变：docs / create_todo / update_project / connect_repo / todos / watch_todos', async () => {
    const docs = (await relay('docs', { projectId: H.projectId, paths: [] })) as { name: string };
    expect(docs.name).toBe('demo');
    const created = (await relay('create_todo', {
      projectId: H.projectId,
      title: '本队任务',
      spec: 's',
    })) as { id: string; projectId: string };
    expect(created.projectId).toBe(H.projectId);
    const listed = (await relay('todos', { projectId: H.projectId })) as { id: string }[];
    expect(listed.map((t) => t.id)).toContain(created.id);
    await relay('watch_todos', { todoIds: [created.id] });
    expect(chiefWatchIds()).toEqual([created.id]);
    expect(await relay('update_project', { projectId: H.projectId, name: 'renamed' })).toEqual({
      id: H.projectId,
      name: 'renamed',
    });
    expect(
      await relay('connect_repo', { projectId: H.projectId, githubRepo: 'octo/alpha' }),
    ).toEqual({ id: H.projectId, repoKind: 'github', githubRepo: 'octo/alpha' });
  });
});

describe('#1466 MCP 工具面：跨团队项目 id = 404（与不存在同形）', () => {
  test('T2/T7 create_todo：他队项目 404，不建任务', async () => {
    const cross = await mcp('create_todo', { projectId: PROJ_B, title: 't', spec: 's' }).then(
      () => null,
      (e: unknown) => e,
    );
    const missing = await mcp('create_todo', { projectId: MISSING, title: 't', spec: 's' }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(cross).toBeInstanceOf(HttpError);
    expect(missing).toBeInstanceOf(HttpError);
    expect((cross as HttpError).status).toBe(404);
    expect((cross as HttpError).message).toBe(
      (missing as HttpError).message.replace(MISSING, PROJ_B),
    );
    expect(todosInProject(PROJ_B).map((t) => t.id)).toEqual([TASK_B]);
  });

  test('T5 todos：他队 projectId 与不存在 id 同回 []', async () => {
    expect(await mcp('todos', { projectId: PROJ_B })).toEqual([]);
    expect(await mcp('todos', { projectId: MISSING })).toEqual([]);
  });

  test('T8 同团队路径不变：create_todo + todos', async () => {
    const created = (await mcp('create_todo', {
      projectId: H.projectId,
      title: 'MCP 本队任务',
      spec: 's',
    })) as { id: string; projectId: string };
    expect(created.projectId).toBe(H.projectId);
    const listed = (await mcp('todos', { projectId: H.projectId })) as { id: string }[];
    expect(listed.map((t) => t.id)).toContain(created.id);
  });
});
