import { eq } from 'drizzle-orm';
import { describe, expect, test } from 'vitest';
import {
  chiefMessage,
  project as projectTable,
  step as stepTable,
  team as teamTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { composeChiefSystemPrompt } from '../src/services/chief.js';
import { H, registerChiefHarness, relay, toolDeps } from './chief-harness.js';
import { postProject, req } from './helpers.js';

registerChiefHarness();

function chiefPrompts(threadId: string): string[] {
  return H.s.db
    .select()
    .from(stepTable)
    .where(eq(stepTable.buildId, threadId))
    .all()
    .filter((s) => s.kind === 'chief')
    .map((s) => s.prompt ?? '');
}

async function postTodo(projectId: string, body: Record<string, unknown> = {}) {
  const res = await req(H.s.app, 'POST', `/api/projects/${projectId}/todos`, {
    title: '修 README 链接',
    spec: '> 修一下',
    ...body,
  });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string; projectId: string; orderIndex: number };
}

function seedForeignProject(): string {
  H.s.db.insert(teamTable).values({ id: 'team-other', name: '别的团队', createdAt: 0 }).run();
  H.s.db
    .insert(projectTable)
    .values({ id: 'proj-other', name: 'secret', teamId: 'team-other', repoKind: 'hosted' })
    .run();
  return 'proj-other';
}

describe('composer project chip reaches the chief (#2009)', () => {
  test('a new thread with projectId prefixes the chief prompt and keeps the stored message as typed', async () => {
    const site = await postProject(H.s.app, 'cairn-site');
    const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads`, {
      content: '把按钮颜色统一一下',
      projectId: site,
    });
    expect(res.status).toBe(201);
    const { thread, message } = (await res.json()) as {
      thread: { id: string };
      message: { content: string };
    };
    expect(message.content).toBe('把按钮颜色统一一下');
    const stored = H.s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.threadId, thread.id))
      .all();
    expect(stored.map((m) => m.content)).toEqual(['把按钮颜色统一一下']);
    const [prompt] = chiefPrompts(thread.id);
    expect(prompt).toContain(`cairn-site（id: ${site}）`);
    expect(prompt?.endsWith('把按钮颜色统一一下')).toBe(true);
  });

  test('a follow-up in an existing thread carries the chip too', async () => {
    const site = await postProject(H.s.app, 'cairn-site');
    const res = await req(H.s.app, 'POST', `/api/conversations/${H.threadId}/messages`, {
      content: '再把字号也统一',
      projectId: site,
    });
    expect(res.status).toBe(201);
    expect(chiefPrompts(H.threadId).at(-1)).toContain(`cairn-site（id: ${site}）`);
  });

  test('without projectId the prompt is the message itself', async () => {
    const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads`, {
      content: '看板计数不对',
    });
    const { thread } = (await res.json()) as { thread: { id: string } };
    expect(chiefPrompts(thread.id)).toEqual(['看板计数不对']);
  });

  test('an unknown or foreign projectId is rejected and nothing is enqueued', async () => {
    const foreign = seedForeignProject();
    for (const projectId of ['proj-missing', foreign]) {
      const res = await req(H.s.app, 'POST', `/api/teams/${H.teamId}/chief/threads`, {
        content: '看板计数不对',
        projectId,
      });
      expect(res.status).toBe(400);
    }
    expect(
      H.s.db
        .select()
        .from(stepTable)
        .all()
        .filter((s) => s.kind === 'chief'),
    ).toHaveLength(0);
  });

  test('the system prompt makes the chip win and offers 都不是 on a project question', () => {
    const prompt = composeChiefSystemPrompt(toolDeps(), H.teamId);
    expect(prompt).toContain('输入框选定项目');
    expect(prompt).toContain('「都不是」');
    expect(prompt).toContain('update_todo 传 projectId');
  });
});

describe('moving an unstarted todo to another project (#2009)', () => {
  test('PATCH projectId moves the todo to the end of the target column and drops the old tags', async () => {
    const site = await postProject(H.s.app, 'cairn-site');
    await postTodo(site, { title: '已有任务' });
    const tagRes = await req(H.s.app, 'POST', `/api/projects/${H.projectId}/tags`, {
      name: 'docs',
      color: '#6366f1',
    });
    const tag = (await tagRes.json()) as { id: string };
    const created = await postTodo(H.projectId, { tagIds: [tag.id] });
    const res = await req(H.s.app, 'PATCH', `/api/todos/${created.id}`, { projectId: site });
    expect(res.status).toBe(200);
    const moved = (await res.json()) as { projectId: string; tagIds: string[]; orderIndex: number };
    expect(moved.projectId).toBe(site);
    expect(moved.tagIds).toEqual([]);
    expect(moved.orderIndex).toBe(1);
  });

  test('a started todo cannot move', async () => {
    const site = await postProject(H.s.app, 'cairn-site');
    const created = await postTodo(H.projectId);
    H.s.db
      .update(todoTable)
      .set({ phase: 'building', latestBuildId: 'build-x' })
      .where(eq(todoTable.id, created.id))
      .run();
    const res = await req(H.s.app, 'PATCH', `/api/todos/${created.id}`, { projectId: site });
    expect(res.status).toBe(409);
    const row = H.s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get();
    expect(row?.projectId).toBe(H.projectId);
  });

  test('a todo imported from a GitHub issue cannot move', async () => {
    const site = await postProject(H.s.app, 'cairn-site');
    const created = await postTodo(H.projectId);
    H.s.db
      .update(todoTable)
      .set({ sourceKind: 'github-issue', sourceRef: 'github:octo/alpha#7' })
      .where(eq(todoTable.id, created.id))
      .run();
    const res = await req(H.s.app, 'PATCH', `/api/todos/${created.id}`, { projectId: site });
    expect(res.status).toBe(409);
  });

  test('the target project must be in the same team', async () => {
    const foreign = seedForeignProject();
    const created = await postTodo(H.projectId);
    const res = await req(H.s.app, 'PATCH', `/api/todos/${created.id}`, { projectId: foreign });
    expect(res.status).toBe(404);
  });

  test('the chief update_todo tool moves an unstarted todo and refuses a started one', async () => {
    const site = await postProject(H.s.app, 'cairn-site');
    const created = await postTodo(H.projectId);
    const moved = (await relay('update_todo', { todoId: created.id, projectId: site })) as {
      projectId: string;
    };
    expect(moved.projectId).toBe(site);
    H.s.db
      .update(todoTable)
      .set({ phase: 'building', latestBuildId: 'build-x' })
      .where(eq(todoTable.id, created.id))
      .run();
    await expect(
      relay('update_todo', { todoId: created.id, projectId: H.projectId }),
    ).rejects.toThrow(/已经开始/);
  });
});
