import { type ClaimedStep, memoryRecordSchema } from '@cairn/shared';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import { agentMemory, build as buildTable } from '../src/db/schema.js';
import { workerRemoteTools } from '../src/services/machine-claim.js';
import { listMemoryEntries } from '../src/services/memory.js';
import { bootServer, issueApiKey, postProject, seedSessionRoute } from './helpers.js';

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

const OWNER_ID = 'route-m4b-mem';

async function world() {
  const s = bootServer({ claimHoldMs: 250 });
  const plain = await issueApiKey(s);
  const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: plain,
    body: readyMachine({ teamId: s.team.id, name: 'm4b-mem', cliVersion: '0.1.0' }),
  });
  const { token } = (await enroll.json()) as { token: string };
  seedSessionRoute(s, { id: OWNER_ID, provider: 'p', modelId: 'm' });

  const projectId = await postProject(s.app);
  const spec = '完成后请用你的记忆工具保存一条与本项目相关的一句话经验';
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '记忆指令任务', spec },
  });
  const { id: todoId } = (await todoRes.json()) as { id: string };
  await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    body: { todoIds: [todoId] },
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
    expect(step.remoteTools?.map((t) => t.name)).toEqual(
      workerRemoteTools('session', false, true).map((t) => t.name),
    );
    s.dispose();
  });

  test('save_memory during an execution step: three-level provenance defaults to the running todo/build/project', async () => {
    const { s, token, step, projectId, todoId } = await world();
    const res = await relay(s.app, token, step.step.id, 'save_memory', {
      scope: projectId,
      file: 'README 只在末尾追加小节',
      content: 'README.md 约定：新增说明一律在文件末尾追加二级标题小节。',
    });
    expect(res.status).toBe(200);
    const { text } = (await res.json()) as { text: string };
    const saved = memoryRecordSchema.parse(
      s.db
        .select()
        .from(agentMemory)
        .all()
        .find((row) => row.id === JSON.parse(text).id),
    );
    expect(saved).toMatchObject({
      agentId: OWNER_ID,
      teamId: s.team.id,
      projectId,
      sourceTodoId: todoId,
      sourceBuildId: step.step.buildId,
    });
    const list = await call(s.app, 'GET', `/api/teams/${s.team.id}/memories`);
    const rows = (await list.json()) as unknown[];
    expect(rows).toHaveLength(1);
    expect(memoryRecordSchema.parse(rows[0]).id).toBe(saved.id);
    s.dispose();
  });

  test('chief 51-vocabulary does not leak out: worker step relay with a non-memory tool = 400 (org/execution surfaces chief-only)', async () => {
    const { s, token, step } = await world();
    for (const name of ['create_todo', 'run_builds', 'projects', 'schedule_todo', 'models']) {
      const res = await relay(s.app, token, step.step.id, name, {});
      expect(res.status, name).toBe(400);
      expect(Object.keys((await res.json()) as Record<string, unknown>)).toEqual(['error']);
    }
    s.dispose();
  });

  test('HTTP worker relay rejects missing, stale and reserved writes', async () => {
    const { s, token, step, projectId } = await world();
    const send = (name: string, params: Record<string, unknown>) =>
      relay(s.app, token, step.step.id, name, params);
    const saved = await send('save_memory', {
      scope: projectId,
      file: 'lesson.md',
      content: 'first',
    });
    expect(saved.status).toBe(200);
    const first = JSON.parse(((await saved.json()) as { text: string }).text) as {
      id: string;
      baseVersion: string;
    };
    expect(
      (await send('save_memory', { scope: projectId, file: 'lesson.md', content: 'overwrite' }))
        .status,
    ).toBe(409);
    expect(
      (await send('save_memory', { scope: projectId, file: 'MEMORY.md', content: 'reserved' }))
        .status,
    ).toBe(400);
    expect(
      (await send('update_memory', { scope: projectId, file: 'lesson.md', content: 'missing' }))
        .status,
    ).toBe(400);
    const updated = await send('update_memory', {
      scope: projectId,
      file: 'lesson.md',
      baseVersion: first.baseVersion,
      content: 'second',
    });
    expect(updated.status).toBe(200);
    expect(
      (
        await send('delete_memory', {
          scope: projectId,
          file: 'lesson.md',
          baseVersion: first.baseVersion,
        })
      ).status,
    ).toBe(409);
    const listed = await send('memories', { scope: projectId });
    expect(listed.status).toBe(200);
    expect(JSON.parse(((await listed.json()) as { text: string }).text).documents).toHaveLength(2);
    expect((await send('create_project', { name: 'forbidden' })).status).toBe(400);
    s.dispose();
  });

  test('zero auto-write semantics: step wrap-up (done) produces no memory -- "auto-distill when task ends" disproven and held (r5 section 6)', async () => {
    const { s, token, step } = await world();
    const done = await call(s.app, 'POST', `/api/machine/done/${step.step.id}`, {
      cred: token,
      body: { status: 'success', sessionId: 'sess-1', hasChanges: true },
    });
    expect(done.status).toBe(200);
    expect(listMemoryEntries(s.db, { agentId: OWNER_ID, teamId: s.team.id })).toHaveLength(0);
    const builds = s.db.select().from(buildTable).all();
    expect(builds).toHaveLength(1);
    s.dispose();
  });

  test('read-side injection shape (04 appendix A verification surface): next-round claim payload agent.memories carries stored entries', async () => {
    const { s, token, step, todoId, projectId } = await world();
    await editIndex(s.app, token, step.step.id, projectId, {
      title: '注入验证',
      content: '第二轮应见我',
    });
    await call(s.app, 'POST', `/api/machine/done/${step.step.id}`, {
      cred: token,
      body: { status: 'success', sessionId: 'sess-1', hasChanges: true },
    });
    const step2 = await claimNextTask(s, token, projectId);
    expect(step2.todo?.id).not.toBe(todoId);
    expect(step2.agent?.memories).toEqual([
      { title: 'MEMORY.md', content: '' },
      { title: 'MEMORY.md', content: '- 注入验证：第二轮应见我' },
    ]);
    s.dispose();
  });

  test('read-side narrows by project (#1494): entries from other projects not injected, global entries (empty projectId) still injected', async () => {
    const { s, token, step, projectId } = await world();
    await editIndex(s.app, token, step.step.id, projectId, { title: '项目一', content: 'p1' });
    await call(s.app, 'POST', `/api/machine/done/${step.step.id}`, {
      cred: token,
      body: { status: 'success', sessionId: 'sess-1', hasChanges: true },
    });
    const now = Date.now();
    s.db
      .insert(agentMemory)
      .values({
        id: 'mem-global',
        agentId: OWNER_ID,
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
    expect(step2.agent?.memories).toEqual([
      { title: 'MEMORY.md', content: '- 全局：g' },
      { title: 'MEMORY.md', content: '' },
    ]);
    s.dispose();
  });

  test('invalidated entries do not enter the claim payload; only actually-injected entries record lastInjectedAt', async () => {
    const { s, token, step, projectId } = await world();
    await editIndex(s.app, token, step.step.id, projectId, { title: '项目一', content: 'p1' });
    await call(s.app, 'POST', `/api/machine/done/${step.step.id}`, {
      cred: token,
      body: { status: 'success', sessionId: 'sess-1', hasChanges: true },
    });
    const now = Date.now();
    const base = { agentId: OWNER_ID, teamId: s.team.id, createdAt: now, updatedAt: now };
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
      { title: 'MEMORY.md', content: '- 全局：g' },
      { title: 'MEMORY.md', content: '- 项目一：p1' },
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
    expect(stamped['mem-global']).toBe(false);
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
    body: { todoIds: [todoId] },
  });
  const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
  const { step } = (await claimRes.json()) as { step: ClaimedStep | null };
  if (!step) throw new Error('no step claimed');
  return step;
}

async function editIndex(
  app: Hono,
  token: string,
  stepId: string,
  scope: string,
  params: { title: string; content: string },
) {
  const res = await relay(app, token, stepId, 'memories', { scope, file: 'MEMORY.md' });
  const row = JSON.parse(((await res.json()) as { text: string }).text) as { baseVersion: string };
  return relay(app, token, stepId, 'update_memory', {
    scope,
    file: 'MEMORY.md',
    content: `- ${params.title}：${params.content}`,
    baseVersion: row.baseVersion,
  });
}
