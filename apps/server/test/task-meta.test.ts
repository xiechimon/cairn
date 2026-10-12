// spec 15 #394 server 面：占位标题派生（createTodo 落库）+ 固定词表播种 +
// set_task_meta worker 窄工具 relay。失败方式清单 = spec 15 Testing Decisions。

import { type ClaimedStep, FIXED_TAGS, todoRecordSchema } from '@pacman/shared';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import { agent as agentTable } from '../src/db/schema.js';
import { backfillFixedTags, seedFixedTags } from '../src/services/tags.js';
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

describe('占位标题派生（ADR 0002 D2：title 空白 → 正文首个非空行 ≤50 字符）', () => {
  test('title 空串 → 取首个非空行；多行只取首行', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: '', spec: '\n  修支付回调掉单  \n\n现在的情况：每晚批处理偶发' },
    });
    expect(res.status).toBe(201);
    const record = todoRecordSchema.parse(await res.json());
    expect(record.title).toBe('修支付回调掉单');
    s.dispose();
  });

  test('首行 >50 字符 → 截断 50 + 省略号', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: '', spec: '一'.repeat(60) },
    });
    const record = todoRecordSchema.parse(await res.json());
    expect(record.title).toBe(`${'一'.repeat(50)}…`);
    s.dispose();
  });

  test('显式标题原样保留（chief/mcp 面不变）', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: '  显式标题  ', spec: '正文首行不该赢' },
    });
    const record = todoRecordSchema.parse(await res.json());
    expect(record.title).toBe('显式标题');
    s.dispose();
  });
});

describe('固定词表播种（ADR 0002 D4）', () => {
  test('项目创建自带 6 行固定标签（name/color 全对拍）', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    const res = await call(s.app, 'GET', `/api/projects/${projectId}/tags`);
    const tags = (await res.json()) as { name: string; color: string }[];
    expect(tags.map((t) => t.name)).toEqual(FIXED_TAGS.map((t) => t.name));
    expect(tags.map((t) => t.color)).toEqual(FIXED_TAGS.map((t) => t.color));
    s.dispose();
  });

  test('播种/启动补齐幂等：重复调用零插入', async () => {
    const s = bootServer();
    const projectId = await postProject(s.app);
    expect(seedFixedTags(s.db, projectId)).toBe(0);
    backfillFixedTags(s.db);
    const res = await call(s.app, 'GET', `/api/projects/${projectId}/tags`);
    expect(((await res.json()) as unknown[]).length).toBe(FIXED_TAGS.length);
    s.dispose();
  });
});

describe('set_task_meta worker 窄工具（ADR 0002 D3：stepId 钉 todoId）', () => {
  const AGENT_ID = 'agent-task-meta';

  async function world() {
    const s = bootServer({ claimHoldMs: 250 });
    const plain = await issueApiKey(s);
    const enroll = await call(s.app, 'POST', '/api/machine/enroll', {
      cred: plain,
      body: { teamId: s.team.id, name: 'task-meta', cliVersion: '0.1.0' },
    });
    const { token } = (await enroll.json()) as { token: string };
    s.db
      .insert(agentTable)
      .values({ id: AGENT_ID, teamId: s.team.id, displayName: 'meta', provider: 'p', modelId: 'm' })
      .run();
    bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）

    const projectId = await postProject(s.app);
    const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      body: { title: '', spec: '给登录页加图形验证码\n\n现在的情况：暴力破解无成本' },
    });
    const { id: todoId } = (await todoRes.json()) as { id: string };
    await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: {
        todoIds: [todoId],
        assignment: { plan: null, build: { agentId: AGENT_ID } },
        withPlan: false,
      },
    });
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: {},
    });
    const { step } = (await claimRes.json()) as { step: ClaimedStep | null };
    if (!step) throw new Error('no step claimed');
    return { s, token, step, projectId, todoId };
  }

  const relay = (app: Hono, token: string, stepId: string, params: Record<string, unknown>) =>
    call(app, 'POST', `/api/machine/tool/${stepId}`, {
      cred: token,
      body: { name: 'set_task_meta', params },
    });

  test('claim 载荷含 set_task_meta', async () => {
    const { s, step } = await world();
    expect(step.remoteTools?.map((t) => t.name)).toContain('set_task_meta');
    s.dispose();
  });

  test('回填标题 + 标签：todo 更新且 v 递增', async () => {
    const { s, token, step, todoId } = await world();
    const res = await relay(s.app, token, step.step.id, {
      title: '登录页加图形验证码',
      tag: 'feature',
    });
    expect(res.status).toBe(200);
    const one = todoRecordSchema.parse(
      await (await call(s.app, 'GET', `/api/todos/${todoId}`)).json(),
    );
    expect(one.title).toBe('登录页加图形验证码');
    expect(one.tagIds).toHaveLength(1);
    // v 递增（派发链路本身会 v++，钉相对单调不钉绝对值）
    expect(one.v).toBeGreaterThan(1);
    s.dispose();
  });

  test('tag 省略 = 只回填标题；词表外 tag = 400；title 空白 = 400', async () => {
    const { s, token, step, todoId } = await world();
    const ok = await relay(s.app, token, step.step.id, { title: '只回填标题' });
    expect(ok.status).toBe(200);
    const one = todoRecordSchema.parse(
      await (await call(s.app, 'GET', `/api/todos/${todoId}`)).json(),
    );
    expect(one.title).toBe('只回填标题');
    expect(one.tagIds).toEqual([]);
    const bad = await relay(s.app, token, step.step.id, { title: 'x', tag: 'urgent' });
    expect(bad.status).toBe(400);
    const empty = await relay(s.app, token, step.step.id, { title: '   ' });
    expect(empty.status).toBe(400);
    s.dispose();
  });
});
