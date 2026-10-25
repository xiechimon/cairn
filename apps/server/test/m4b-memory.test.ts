import {
  type ClaimedStep,
  MEMORY_QUOTA_PER_AGENT,
  memoryRecordSchema,
  WORKER_REMOTE_TOOLS,
} from '@cairn/shared';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { agentMemory, agent as agentTable, build as buildTable } from '../src/db/schema.js';
import { bindAllAgents, bootServer, issueApiKey, postProject } from './helpers.js';

async function call(
  app: Hono,
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

const AGENT_ID = 'agent-m4b-mem';

async function world() {
  const s = bootServer({ claimHoldMs: 250 });
  const plain = await issueApiKey(s);
  const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: plain,
    body: { teamId: s.team.id, name: 'm4b-mem', cliVersion: '0.1.0' },
  });
  const { token } = (await enroll.json()) as { token: string };
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'scribe',
      provider: 'p',
      modelId: 'm',
    })
    .run();
  bindAllAgents(s);

  const projectId = await postProject(s.app);
  const spec = '完成后请用你的记忆工具保存一条与本项目相关的一句话经验';
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '记忆指令任务', spec },
  });
  const { id: todoId } = (await todoRes.json()) as { id: string };
  await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    body: {
      todoIds: [todoId],
      assignment: { plan: null, build: { agentId: AGENT_ID } },
      withPlan: false,
    },
  });
  const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
  const { step } = (await claimRes.json()) as { step: ClaimedStep | null };
  if (!step) throw new Error('no step claimed');
  return { s, token, step, projectId, todoId };
}

async function relay(
  app: Hono,
  token: string,
  stepId: string,
  name: string,
  params: Record<string, unknown>,
): Promise<Response> {
  return call(app, 'POST', `/api/machine/tool/${stepId}`, { cred: token, body: { name, params } });
}

describe('worker step memory relay (r5 section 6 write path = agent tool -> server executes)', () => {
  test('claim payload = memory trio + attachment read remoteTools (02 section 4.4 + #310/r9 section 3.1 worker-side attachment tools = spec `attachment:` token parse path)', async () => {
    const { s, step } = await world();
    expect(step.remoteTools?.map((t) => t.name)).toEqual(WORKER_REMOTE_TOOLS.map((t) => t.name));
    s.dispose();
  });

  test('save_memory during an execution step: three-level provenance defaults to the running todo/build/project', async () => {
    const { s, token, step, projectId, todoId } = await world();
    const res = await relay(s.app, token, step.step.id, 'save_memory', {
      title: 'README 只在末尾追加小节',
      content: 'README.md 约定：新增说明一律在文件末尾追加二级标题小节。',
    });
    expect(res.status).toBe(200);
    const { text } = (await res.json()) as { text: string };
    const saved = memoryRecordSchema.parse(JSON.parse(text));
    expect(saved).toMatchObject({
      agentId: AGENT_ID,
      teamId: s.team.id,
      projectId,
      sourceTodoId: todoId,
      sourceBuildId: step.step.buildId,
    });
    const list = await call(s.app, 'GET', `/api/teams/${s.team.id}/agents/${AGENT_ID}/memories`);
    const rows = (await list.json()) as unknown[];
    expect(rows).toHaveLength(1);
    expect(memoryRecordSchema.parse(rows[0]).id).toBe(saved.id);
    s.dispose();
  });

  test('candidate retry returns HTTP 409, updated history readable over REST', async () => {
    const { s, token, step } = await world();
    try {
      const first = await relay(s.app, token, step.step.id, 'save_memory', {
        title: '包管理器',
        content: '本仓使用 npm',
      });
      expect(first.status).toBe(200);
      const { id } = JSON.parse(((await first.json()) as { text: string }).text) as { id: string };
      const params = { title: '包管理器', content: '本仓使用 pnpm' };
      const conflict = await relay(s.app, token, step.step.id, 'save_memory', params);
      expect(conflict.status).toBe(200);
      expect(JSON.parse(((await conflict.json()) as { text: string }).text)).toMatchObject({
        status: 'candidates',
        candidates: [{ id }],
      });
      const retry = await relay(s.app, token, step.step.id, 'save_memory', params);
      expect(retry.status).toBe(409);
      const update = await relay(s.app, token, step.step.id, 'update_memory', {
        memoryId: id,
        content: params.content,
      });
      expect(update.status).toBe(200);
      const list = await call(s.app, 'GET', `/api/teams/${s.team.id}/agents/${AGENT_ID}/memories`);
      expect(await list.json()).toMatchObject([
        { content: '本仓使用 pnpm', history: [{ content: '本仓使用 npm' }] },
      ]);
      const all = await call(
        s.app,
        'GET',
        `/api/teams/${s.team.id}/agents/${AGENT_ID}/memories?includeInvalid=true`,
      );
      expect(await all.json()).toMatchObject([
        { id, content: '本仓使用 npm', supersededBy: expect.any(String) },
        { content: '本仓使用 pnpm' },
      ]);
    } finally {
      s.dispose();
    }
  });

  test('after REST deletes the candidate, retrying the same body is treated as a new entry', async () => {
    const { s, token, step } = await world();
    try {
      const first = await relay(s.app, token, step.step.id, 'save_memory', {
        title: '包管理器',
        content: '本仓使用 npm',
      });
      const { id } = JSON.parse(((await first.json()) as { text: string }).text) as { id: string };
      const params = { title: '包管理器', content: '本仓使用 pnpm' };
      await relay(s.app, token, step.step.id, 'save_memory', params);
      const removed = await call(
        s.app,
        'DELETE',
        `/api/teams/${s.team.id}/agents/${AGENT_ID}/memories/${id}`,
      );
      expect(removed.status).toBe(204);
      const retry = await relay(s.app, token, step.step.id, 'save_memory', params);
      expect(retry.status).toBe(200);
      expect(JSON.parse(((await retry.json()) as { text: string }).text)).toMatchObject({
        content: params.content,
      });
    } finally {
      s.dispose();
    }
  });

  test('explicit sourceTodoId/projectId params win (recording cross-task experience [design])', async () => {
    const { s, token, step } = await world();
    const otherProject = await postProject(s.app, 'other');
    const otherTodoRes = await call(s.app, 'POST', `/api/projects/${otherProject}/todos`, {
      body: { title: '另一任务', spec: '' },
    });
    const { id: otherTodo } = (await otherTodoRes.json()) as { id: string };
    const res = await relay(s.app, token, step.step.id, 'save_memory', {
      title: 't',
      content: 'c',
      projectId: otherProject,
      sourceTodoId: otherTodo,
    });
    const saved = memoryRecordSchema.parse(
      JSON.parse(((await res.json()) as { text: string }).text),
    );
    expect(saved.projectId).toBe(otherProject);
    expect(saved.sourceTodoId).toBe(otherTodo);
    s.dispose();
  });

  test('memories / delete_memory: only this Agent entries (out-of-scope defense)', async () => {
    const { s, token, step } = await world();
    await relay(s.app, token, step.step.id, 'save_memory', { title: 't', content: 'c' });
    const listRes = await relay(s.app, token, step.step.id, 'memories', {});
    const rows = JSON.parse(((await listRes.json()) as { text: string }).text) as { id: string }[];
    expect(rows).toHaveLength(1);
    const del = await relay(s.app, token, step.step.id, 'delete_memory', { memoryId: rows[0]!.id });
    expect(JSON.parse(((await del.json()) as { text: string }).text)).toEqual({
      deleted: rows[0]!.id,
    });
    expect(s.db.select().from(agentMemory).all()).toHaveLength(0);
    s.dispose();
  });

  test('chief 51-vocabulary does not leak out: worker step relay with a non-memory tool = 400 (org/execution surfaces chief-only)', async () => {
    const { s, token, step } = await world();
    for (const name of ['create_todo', 'run_builds', 'projects', 'set_remote_shell', 'models']) {
      const res = await relay(s.app, token, step.step.id, name, {});
      expect(res.status, name).toBe(400);
      expect(Object.keys((await res.json()) as Record<string, unknown>)).toEqual(['error']);
    }
    s.dispose();
  });

  test(`quota ${MEMORY_QUOTA_PER_AGENT}/Agent: over = 409 (UI "memory n/100" same source)`, async () => {
    const { s, token, step } = await world();
    const now = Date.now();
    for (let i = 0; i < MEMORY_QUOTA_PER_AGENT; i++) {
      s.db
        .insert(agentMemory)
        .values({
          id: `mem-${i}`,
          agentId: AGENT_ID,
          teamId: s.team.id,
          title: `t${i}`,
          content: 'c',
          projectId: null,
          sourceTodoId: null,
          sourceBuildId: null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    }
    const res = await relay(s.app, token, step.step.id, 'save_memory', {
      title: 't',
      content: 'c',
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toContain('memory quota exceeded');
    s.dispose();
  });

  test('zero auto-write semantics: step wrap-up (done) produces no memory -- "auto-distill when task ends" disproven and held (r5 section 6)', async () => {
    const { s, token, step } = await world();
    const done = await call(s.app, 'POST', `/api/machine/done/${step.step.id}`, {
      cred: token,
      body: { status: 'success', sessionId: 'sess-1', hasChanges: true },
    });
    expect(done.status).toBe(200);
    expect(s.db.select().from(agentMemory).all()).toHaveLength(0);
    const builds = s.db.select().from(buildTable).all();
    expect(builds).toHaveLength(1);
    s.dispose();
  });

  test('read-side injection shape (04 appendix A verification surface): next-round claim payload agent.memories carries stored entries', async () => {
    const { s, token, step, todoId, projectId } = await world();
    await relay(s.app, token, step.step.id, 'save_memory', {
      title: '注入验证',
      content: '第二轮应见我',
    });
    await call(s.app, 'POST', `/api/machine/done/${step.step.id}`, {
      cred: token,
      body: { status: 'success', sessionId: 'sess-1', hasChanges: true },
    });
    const step2 = await claimNextTask(s, token, projectId);
    expect(step2.todo?.id).not.toBe(todoId);
    expect(step2.agent?.memories).toEqual([{ title: '注入验证', content: '第二轮应见我' }]);
    s.dispose();
  });

  test('read-side narrows by project (#1494): entries from other projects not injected, global entries (empty projectId) still injected', async () => {
    const { s, token, step, projectId } = await world();
    await relay(s.app, token, step.step.id, 'save_memory', { title: '项目一', content: 'p1' });
    await call(s.app, 'POST', `/api/machine/done/${step.step.id}`, {
      cred: token,
      body: { status: 'success', sessionId: 'sess-1', hasChanges: true },
    });
    const now = Date.now();
    s.db
      .insert(agentMemory)
      .values({
        id: 'mem-global',
        agentId: AGENT_ID,
        teamId: s.team.id,
        title: '全局',
        content: 'g',
        projectId: null,
        createdAt: now,
        updatedAt: now,
      })
      .run();
    const projectId2 = await postProject(s.app, 'p2');
    expect(projectId2).not.toBe(projectId);
    const step2 = await claimNextTask(s, token, projectId2);
    expect(step2.agent?.memories).toEqual([{ title: '全局', content: 'g' }]);
    s.dispose();
  });

  test('invalidated entries do not enter the claim payload; only actually-injected entries record lastInjectedAt', async () => {
    const { s, token, step, projectId } = await world();
    await relay(s.app, token, step.step.id, 'save_memory', { title: '项目一', content: 'p1' });
    await call(s.app, 'POST', `/api/machine/done/${step.step.id}`, {
      cred: token,
      body: { status: 'success', sessionId: 'sess-1', hasChanges: true },
    });
    const now = Date.now();
    const base = { agentId: AGENT_ID, teamId: s.team.id, createdAt: now, updatedAt: now };
    s.db
      .insert(agentMemory)
      .values([
        { ...base, id: 'mem-retired', title: '旧', content: 'old', projectId, invalidAt: now },
        { ...base, id: 'mem-global', title: '全局', content: 'g', projectId: null },
      ])
      .run();
    const otherProject = await postProject(s.app, 'p3');
    s.db
      .insert(agentMemory)
      .values({ ...base, id: 'mem-other', title: '别项目', content: 'o', projectId: otherProject })
      .run();

    const step2 = await claimNextTask(s, token, projectId);

    expect(step2.agent?.memories).toEqual([
      { title: '项目一', content: 'p1' },
      { title: '全局', content: 'g' },
    ]);
    const stamped = Object.fromEntries(
      s.db
        .select()
        .from(agentMemory)
        .all()
        .map((row) => [row.id, row.lastInjectedAt !== null]),
    );
    expect(stamped['mem-retired']).toBe(false);
    expect(stamped['mem-other']).toBe(false);
    expect(stamped['mem-global']).toBe(true);
    expect(Object.values(stamped).filter(Boolean)).toHaveLength(2);
    s.dispose();
  });
});

async function claimNextTask(
  s: Awaited<ReturnType<typeof world>>['s'],
  token: string,
  projectId: string,
): Promise<ClaimedStep> {
  const t = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: 't2', spec: 's2' },
  });
  const { id: todoId } = (await t.json()) as { id: string };
  await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    body: {
      todoIds: [todoId],
      assignment: { plan: null, build: { agentId: AGENT_ID } },
      withPlan: false,
    },
  });
  const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
  const { step } = (await claimRes.json()) as { step: ClaimedStep | null };
  if (!step) throw new Error('no step claimed');
  return step;
}
