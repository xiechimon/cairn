// M4a Chief 机器协议全环（server 半，真 HTTP + 机器认证）：绑定 → 发消息 →
// claim（chief 块 + 51 remoteTools + 绑定 Agent 模型）→ relay 执行（create_todo
// 溯源 / run_builds 派工 watch + triggerSource:chief）→ transcript 上传落
// chief_message → done（thread sessionId/lastTurnAt + activeRun 清空 +
// chief_message 通知）→ 停 review 触发 gate wake 步。
// 判定：协议环逐字段对拍（02 §4.3/§5.4 + r5 §3.1/§3.2/§3.5）；策略层文本由
// LLM 侧产，此处以 relay params 直投模拟（黑盒逼近，04 §1 A4）。

import type { ClaimedStep } from '@cairn/shared';
import { CHIEF_TOOL_COUNT, claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  chief as chiefTable,
  chiefThread,
  notification as notificationTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { bootServer, issueApiKey, machineIdByName, type TestServer } from './helpers.js';

const AGENT_ID = 'agent-m4a-chief';

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

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const d of disposables) d();
});

interface ChiefWorld {
  s: TestServer;
  token: string;
  teamId: string;
  projectId: string;
  threadId: string;
  claim(): Promise<ClaimedStep>;
  relay(stepId: string, name: string, params: Record<string, unknown>): Promise<unknown>;
  done(stepId: string, body: Record<string, unknown>): Promise<Response>;
  uploadTranscript(
    stepId: string,
    messages: { id: string; role: string; content: unknown; createdAt: number }[],
  ): Promise<void>;
}

async function setupChiefWorld(opts?: {
  claudeCode?: { installed: boolean; hostname: string; models: { id: string; name: string }[] };
}): Promise<ChiefWorld> {
  const s = bootServer({ claimHoldMs: 200 });
  disposables.push(() => s.dispose());
  const teamId = s.team.id;
  const key = await issueApiKey(s);
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: {
      teamId,
      name: 'm4a-mbp',
      cliVersion: '0.1.0',
      ...(opts?.claudeCode !== undefined ? { claudeCode: opts.claudeCode } : {}),
    },
  });
  const { token } = (await enrollRes.json()) as { token: string };
  // 绑定 Agent（带 modelId → 可派发；provider 面本环不断言）。#1260：
  // 归属机 = 认领机（chief 步只投绑定 Agent 的归属机）。
  const machineId = machineIdByName(s, 'm4a-mbp');
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId,
      displayName: 'm4a-chief-agent',
      description: '负责调度',
      modelId: 'stub-model',
      provider: 'stub-gw',
      machineId,
    })
    .run();
  // 项目（无 repo → chief 探索基座为裸目录，chiefWorkspaceProject 返回 null）。
  const projRes = await call(s.app, 'POST', '/api/projects', { body: { name: 'm4a-proj' } });
  const project = (await projRes.json()) as { id: string };
  // 绑定 chief agent（PATCH /chief，r5 §2 抓包原样）。
  const patchRes = await call(s.app, 'PATCH', `/api/teams/${teamId}/chief`, {
    body: { agent: { agentId: AGENT_ID, thinkingLevel: null } },
  });
  expect(patchRes.status).toBe(200);
  // 发消息 → 建线程 + chief 步入队。
  const msgRes = await call(s.app, 'POST', `/api/teams/${teamId}/chief/threads`, {
    body: { content: '帮 m4a-proj 写一份 CONTRIBUTING.md 贡献指南。' },
  });
  expect(msgRes.status).toBe(201);
  const { thread } = (await msgRes.json()) as { thread: { id: string } };

  return {
    s,
    token,
    teamId,
    projectId: project.id,
    threadId: thread.id,
    async claim() {
      const res = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
      const body = (await res.json()) as { step: ClaimedStep | null };
      if (!body.step) throw new Error('no chief step claimed');
      return claimedStepSchema.parse(body.step);
    },
    async relay(stepId, name, params) {
      const res = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
        cred: token,
        body: { name, params },
      });
      const body = (await res.json()) as { text?: string; error?: string };
      if (res.status !== 200) throw new Error(`relay ${name} failed: ${body.error ?? res.status}`);
      return JSON.parse(body.text ?? 'null') as unknown;
    },
    async done(stepId, body) {
      return call(s.app, 'POST', `/api/machine/done/${stepId}`, { cred: token, body });
    },
    async uploadTranscript(stepId, messages) {
      const urlsRes = await call(s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
        cred: token,
        body: { files: [{ name: 'transcript.json' }] },
      });
      const { uploads } = (await urlsRes.json()) as { uploads: { name: string; url: string }[] };
      const upload = uploads.find((u) => u.name === 'transcript.json')!;
      // 预签名 PUT（一次性 uploadId 落地点）。
      const uploadId = upload.url.split('/').pop()!;
      await call(s.app, 'PUT', `/api/machine/upload/${uploadId}`, {
        cred: token,
        body: { stepId, messages },
      });
    },
  };
}

describe('M4a Chief 机器协议全环（02 §4.3/§5.4 + r5 §3.1/§3.2/§3.5）', () => {
  test('claim → relay(create_todo/run_builds) → transcript → done → gate wake', async () => {
    const w = await setupChiefWorld();

    // —— claim：chief 步载荷（chief 块 + 51 remoteTools + 绑定 Agent）——
    const claimed = await w.claim();
    expect(claimed.step.kind).toBe('chief');
    expect(claimed.conversationId).toBe(w.threadId); // conv ≡ chief-<threadId>
    expect(claimed.chief?.threadId).toBe(w.threadId);
    expect(claimed.chief?.systemPrompt).toContain('总管'); // server 合成 system prompt
    expect(claimed.remoteTools).toHaveLength(CHIEF_TOOL_COUNT); // 51 词表全量
    expect(claimed.agent?.id).toBe(AGENT_ID); // 绑定 Agent 执行
    expect(claimed.agent?.modelId).toBe('stub-model');
    // chief 步不携带技能两字段（#372/#1169：chief 是信任面，不受过滤约束）。
    expect(claimed.agent?.skillsAllowlist).toBeUndefined();
    expect(claimed.agent?.defaultSkill).toBeUndefined();
    expect(claimed.todo).toBeUndefined(); // 无 todo 语境
    const stepId = claimed.step.id;

    // —— relay create_todo：措辞→spec 三段式 + 溯源（r5 §3.2）——
    const spec =
      '> 帮 m4a-proj 写一份 CONTRIBUTING.md 贡献指南。\n\n要求：\n- 说明怎么给 Agent 提任务\n\n补充信息（探测得出，非用户确认）：\n- 仓库当前仅有 README.md';
    const created = (await w.relay(stepId, 'create_todo', {
      projectId: w.projectId,
      title: '编写 CONTRIBUTING.md 贡献指南',
      spec,
    })) as { id: string; createdBy: string | null; sourceBuildId: string | null };
    expect(created.createdBy).toBe(AGENT_ID);
    // sourceBuildId = chief id `chief-<userId>-<teamId>`（r5 §3.2 实测样本），非 conv id
    expect(created.sourceBuildId).toBe(`chief-${w.s.user.id}-${w.teamId}`);
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get()!;
    expect(todoRow.spec).toContain('补充信息（探测得出，非用户确认）：');

    // —— relay run_builds：单 todo 直派 + triggerSource:chief + watch ——
    // #903（ADR 0014）：withPlan = chief 逐次派发判定（缺省先规划）。
    // 本环测机器协议全环，显式传 false 保持直派语义。
    const runOut = (await w.relay(stepId, 'run_builds', {
      todoIds: [created.id],
      assignment: { build: { agentId: AGENT_ID } },
      withPlan: false,
    })) as { builds: { id: string; withPlan: boolean; triggerSource: string }[] };
    expect(runOut.builds[0]!.withPlan).toBe(false);
    expect(runOut.builds[0]!.triggerSource).toBe('chief');
    const chiefRow = w.s.db
      .select()
      .from(chiefTable)
      .where(eq(chiefTable.id, `chief-${w.s.user.id}-${w.teamId}`))
      .get()!;
    expect(chiefRow.watches).toHaveLength(1); // 派工即自动 watch
    expect(chiefRow.watches[0]!.todoId).toBe(created.id);

    // —— transcript 上传 → chief_message 落库 ——
    await w.uploadTranscript(stepId, [
      {
        id: `user-${stepId}`,
        role: 'user',
        content: '帮 m4a-proj 写一份 CONTRIBUTING.md 贡献指南。',
        createdAt: Date.now(),
      },
      {
        id: `asst-${stepId}`,
        role: 'assistant',
        content: '已创建并派工 #1，由文档专职 Agent 承接，完成或需确认时我会跟进汇报。',
        createdAt: Date.now(),
      },
    ]);

    // —— done：thread 收尾（sessionId/lastTurnAt/activeRun）+ chief_message 通知 ——
    const doneRes = await w.done(stepId, {
      status: 'success',
      sessionId: 'pi-chief-sess-1',
      usage: [{ model: 'stub-gw/stub-model', input: 100, output: 50, cacheRead: 0, cacheWrite: 0 }],
    });
    expect(doneRes.status).toBe(200);
    const threadRow = w.s.db
      .select()
      .from(chiefThread)
      .where(eq(chiefThread.id, w.threadId))
      .get()!;
    expect(threadRow.sessionId).toBe('pi-chief-sess-1'); // continue session 复用面
    expect(threadRow.lastTurnAt).not.toBeNull();
    expect(threadRow.activeRun).toBeNull();
    // chief_message 通知（r5 §7.2：type chief_message，snippet = 消息全文）
    const notif = w.s.db
      .select()
      .from(notificationTable)
      .all()
      .find((n) => n.type === 'chief_message');
    expect(notif).toBeDefined();
    expect(notif!.snippet).toContain('已创建并派工');
    // context.tokens 累计（token_usage 按 buildId = chief conv id 记账）
    const stepDone = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
    expect(stepDone.status).toBe('done');

    // —— gate wake：被派工 todo 停 review → chief wake 步入队（同 thread conv）——
    const svc = { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub, user: w.s.user };
    // 驱动 todo → review（queued→building→review）
    const { setTodoPhase } = await import('../src/services/todos.js');
    setTodoPhase(svc, created.id, 'building');
    setTodoPhase(svc, created.id, 'review');
    const wakeSteps = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, w.threadId))
      .all()
      .filter((st) => st.prompt?.includes('[wake:gate]'));
    expect(wakeSteps.length).toBeGreaterThanOrEqual(1); // gate 停驻触发 wake 轮
  });

  // #627 指定模型自主环：chief 先读候选（models）→ create_agent 用候选行
  // 的合法 provider/modelId → agents 读回命中。走真 relay wire
  // （POST /api/machine/tool → executeChiefTool）。#770 起候选只剩
  // claude-code 段：本环用 enroll 上报钉两模型行驱动全链（#707）。
  test('models 取候选 → create_agent 用合法值 → agents 读回（#627）', async () => {
    const w = await setupChiefWorld({
      claudeCode: {
        installed: true,
        hostname: 'm4a-mbp',
        models: [
          { id: 'model-a', name: 'model-a' },
          { id: 'model-b', name: 'model-b' },
        ],
      },
    });

    const claimed = await w.claim();
    // 词表下发含 models（#627 CHIEF_TOOLS_ADDED 登记，读侧 replaySafe）。
    const tools = claimed.remoteTools ?? [];
    const modelsDef = tools.find((t) => t.name === 'models');
    expect(modelsDef).toBeDefined();
    expect(modelsDef?.replaySafe).toBe(true);
    const stepId = claimed.step.id;

    // —— relay models：claude-code 段两上报行 ——
    const rows = (await w.relay(stepId, 'models', {})) as {
      provider: string;
      providerLabel: string;
      modelId: string;
      modelName: string;
    }[];
    expect(rows).toEqual([
      {
        provider: 'claude-code',
        providerLabel: 'Claude Code',
        modelId: 'model-a',
        modelName: 'model-a',
      },
      {
        provider: 'claude-code',
        providerLabel: 'Claude Code',
        modelId: 'model-b',
        modelName: 'model-b',
      },
    ]);

    // —— 从候选取合法值 create_agent → agents 读回全链命中 ——
    const pick = rows[0]!;
    const created = (await w.relay(stepId, 'create_agent', {
      displayName: 'm4a-models-agent',
      description: '按候选清单配模型的 Agent',
      provider: pick.provider,
      modelId: pick.modelId,
    })) as { id: string };
    const agents = (await w.relay(stepId, 'agents', {})) as {
      id: string;
      provider: string | null;
      modelId: string | null;
    }[];
    const row = agents.find((a) => a.id === created.id);
    expect(row?.provider).toBe('claude-code');
    expect(row?.modelId).toBe('model-a');
  });

  // #631 失败闭环：daemon 上报 failed + errorMessage → 落 chief_message
  // system 行（chief_turn_error 形态）供 web 面渲染/toast；无 errorMessage
  // 的失败不落空行；通知面不点火（成功才通知，失败靠行 + toast）。
  test('done(failed) → 失败原因落 chief_message system 行，无通知', async () => {
    const w = await setupChiefWorld();
    const claimed = await w.claim();
    const stepId = claimed.step.id;
    const doneRes = await w.done(stepId, {
      status: 'failed',
      errorMessage: '400: {"message":"Model does not support this protocol."}',
    });
    expect(doneRes.status).toBe(200);
    const stepRow = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
    expect(stepRow.status).toBe('failed');
    const threadRow = w.s.db
      .select()
      .from(chiefThread)
      .where(eq(chiefThread.id, w.threadId))
      .get()!;
    expect(threadRow.activeRun).toBeNull(); // 回合收尾照旧
    // 失败不通知（通知只在成功回合发；失败反馈走行 + web toast）。
    const notifs = w.s.db.select().from(notificationTable).all();
    expect(notifs.filter((n) => n.type === 'chief_message')).toHaveLength(0);
    const messagesRes = await call(w.s.app, 'GET', `/api/conversations/${w.threadId}/messages`);
    expect(messagesRes.status).toBe(200);
    const { messages } = (await messagesRes.json()) as {
      messages: { id: string; role: string; content: unknown }[];
    };
    const failureRow = messages.find((m) => m.id === `chief-err-${stepId}`);
    expect(failureRow).toBeDefined();
    expect(failureRow!.role).toBe('system');
    expect(JSON.parse(failureRow!.content as string)).toEqual({
      kind: 'chief_turn_error',
      message: '400: {"message":"Model does not support this protocol."}',
    });
  });

  test('chief 步 token 下发（绑定 Agent 模型凭证解析，无 build/todo 行）', async () => {
    const w = await setupChiefWorld();
    const claimed = await w.claim();
    const stepId = claimed.step.id;
    const tokenRes = await call(w.s.app, 'GET', `/api/machine/token/${stepId}`, { cred: w.token });
    expect(tokenRes.status).toBe(200);
    const body = (await tokenRes.json()) as {
      provider: unknown;
      secrets: Record<string, string>;
      git: unknown;
    };
    // provider 无 custom 行 → 回退 api_key kind 或 null；secrets 取用面恒空
    // （chief = 总管探索步，records/step.ts stepTakesSecrets）；不因无 build 行报错。
    expect(typeof body.secrets).toBe('object');
    expect(body.secrets).toEqual({});
  });
});
