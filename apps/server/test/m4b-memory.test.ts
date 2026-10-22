// memory 写路径 worker 侧（02 §4.4/r5 §6，M4b）：`save_memory` 经 worker 步
// remoteTools relay 服务端执行——触发 = spec 指令 + Agent 裁量（宿主面 = 只给
// 工具，不加蒸馏钩子），写入时点 = 执行步进行中（非任务结束钩子），三级溯源
// （sourceTodo/sourceBuild 缺省 = 运行中上下文），配额 100，零自动写入语义
// （步收尾不产记忆——r5 §6「任务结束自动蒸馏」证伪的结构性守住）。

import {
  type ClaimedStep,
  MEMORY_QUOTA_PER_AGENT,
  memoryRecordSchema,
  WORKER_REMOTE_TOOLS,
} from '@pacman/shared';
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
  bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）

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

describe('worker 步记忆 relay（r5 §6 写路径 = agent 工具 → 服务端执行）', () => {
  test('claim 载荷 = 记忆三件套 + 附件读 remoteTools（02 §4.4 + #310/r9 §3.1 worker 侧 attachment 工具 = spec `attachment:` token 解析路径）', async () => {
    const { s, step } = await world();
    expect(step.remoteTools?.map((t) => t.name)).toEqual(WORKER_REMOTE_TOOLS.map((t) => t.name));
    s.dispose();
  });

  test('save_memory 执行步进行中写入：三级溯源缺省 = 运行中 todo/build/project', async () => {
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
      projectId, // 缺省 = 运行中项目（r5 §6 样本 projectId 在场）
      sourceTodoId: todoId, // 缺省 = 运行中 todo（r5 §6 实测样本）
      sourceBuildId: step.step.buildId, // buildId ≡ conversationId
    });
    // GET memories REST 面读回（02 §4.4 列表 API 保形）。
    const list = await call(s.app, 'GET', `/api/teams/${s.team.id}/agents/${AGENT_ID}/memories`);
    const rows = (await list.json()) as unknown[];
    expect(rows).toHaveLength(1);
    expect(memoryRecordSchema.parse(rows[0]).id).toBe(saved.id);
    s.dispose();
  });

  test('显式 sourceTodoId/projectId 参数优先（跨任务记录经验 [设计]）', async () => {
    const { s, token, step } = await world();
    // 显式值须是本队真实行（#1470 团队归属）：另建一个本队项目与任务。
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

  test('memories / delete_memory：只及本 Agent 条目（越权防御）', async () => {
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

  test('chief 51 词表不外溢：worker 步 relay 非记忆工具 = 400（组织/执行面 Chief 专属）', async () => {
    const { s, token, step } = await world();
    // set_remote_shell 随 XMON-115 入列：worker 步不得自授 shell（写入点 =
    // chief 会话专属，组织面）。models 随 #627 入列：读侧候选清单同为
    // chief 专属（worker 步的模型面由 assignment 决定，无自选语义）。
    for (const name of ['create_todo', 'run_builds', 'projects', 'set_remote_shell', 'models']) {
      const res = await relay(s.app, token, step.step.id, name, {});
      expect(res.status, name).toBe(400);
      expect(Object.keys((await res.json()) as Record<string, unknown>)).toEqual(['error']);
    }
    s.dispose();
  });

  test(`配额 ${MEMORY_QUOTA_PER_AGENT}/Agent：超限 = 409（UI 「记忆 · n/100」同源）`, async () => {
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

  test('零自动写入语义：步收尾（done）不产记忆——「任务结束自动蒸馏」证伪守住（r5 §6）', async () => {
    const { s, token, step } = await world();
    // 不调任何记忆工具，直接收尾（status success → review park）。
    const done = await call(s.app, 'POST', `/api/machine/done/${step.step.id}`, {
      cred: token,
      body: { status: 'success', sessionId: 'sess-1', hasChanges: true },
    });
    expect(done.status).toBe(200);
    expect(s.db.select().from(agentMemory).all()).toHaveLength(0);
    // build 行无记忆钩子副作用（结构性：写路径唯一入口 = relay 工具）。
    const builds = s.db.select().from(buildTable).all();
    expect(builds).toHaveLength(1);
    s.dispose();
  });

  test('读侧注入形（04 附录 A 验证面）：下一轮 claim 载荷 agent.memories 携带已存条目', async () => {
    const { s, token, step, todoId } = await world();
    await relay(s.app, token, step.step.id, 'save_memory', {
      title: '注入验证',
      content: '第二轮应见我',
    });
    await call(s.app, 'POST', `/api/machine/done/${step.step.id}`, {
      cred: token,
      body: { status: 'success', sessionId: 'sess-1', hasChanges: true },
    });
    // 第二个任务 → claim：注入位 = agent.memories（宿主每步开跑注入 systemPrompt
    // 的载荷半；daemon 半 = composeWorkerSystemPrompt，apps/daemon runner）。
    const projectId2 = await postProject(s.app, 'p2');
    const t2 = await call(s.app, 'POST', `/api/projects/${projectId2}/todos`, {
      body: { title: 't2', spec: 's2' },
    });
    const { id: todo2 } = (await t2.json()) as { id: string };
    expect(todo2).not.toBe(todoId);
    await call(s.app, 'POST', `/api/projects/${projectId2}/builds`, {
      body: {
        todoIds: [todo2],
        assignment: { plan: null, build: { agentId: AGENT_ID } },
        withPlan: false,
      },
    });
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const { step: step2 } = (await claimRes.json()) as { step: ClaimedStep | null };
    expect(step2?.agent?.memories).toEqual([{ title: '注入验证', content: '第二轮应见我' }]);
    s.dispose();
  });
});
