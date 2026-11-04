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
  const projRes = await call(s.app, 'POST', '/api/projects', { body: { name: 'm4a-proj' } });
  const project = (await projRes.json()) as { id: string };
  const patchRes = await call(s.app, 'PATCH', `/api/teams/${teamId}/chief`, {
    body: { agent: { agentId: AGENT_ID, thinkingLevel: null } },
  });
  expect(patchRes.status).toBe(200);
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
      const uploadId = upload.url.split('/').pop()!;
      await call(s.app, 'PUT', `/api/machine/upload/${uploadId}`, {
        cred: token,
        body: { stepId, messages },
      });
    },
  };
}

describe('M4a Chief machine protocol full loop (02 section 4.3/5.4 + r5 sections 3.1/3.2/3.5)', () => {
  test('claim → relay(create_todo/run_builds) → transcript → done → gate wake', async () => {
    const w = await setupChiefWorld();

    const claimed = await w.claim();
    expect(claimed.step.kind).toBe('chief');
    expect(claimed.conversationId).toBe(w.threadId);
    expect(claimed.chief?.threadId).toBe(w.threadId);
    expect(claimed.chief?.systemPrompt).toContain('总管');
    expect(claimed.remoteTools).toHaveLength(CHIEF_TOOL_COUNT);
    expect(claimed.agent?.id).toBe(AGENT_ID);
    expect(claimed.agent?.modelId).toBe('stub-model');
    expect(claimed.agent?.skillsAllowlist).toBeUndefined();
    expect(claimed.agent?.defaultSkill).toBeUndefined();
    expect(claimed.todo).toBeUndefined();
    const stepId = claimed.step.id;

    const spec =
      '> 帮 m4a-proj 写一份 CONTRIBUTING.md 贡献指南。\n\n要求：\n- 说明怎么给 Agent 提任务\n\n补充信息（探测得出，非用户确认）：\n- 仓库当前仅有 README.md';
    const created = (await w.relay(stepId, 'create_todo', {
      projectId: w.projectId,
      title: '编写 CONTRIBUTING.md 贡献指南',
      spec,
    })) as { id: string; createdBy: string | null; sourceBuildId: string | null };
    expect(created.createdBy).toBe(AGENT_ID);
    expect(created.sourceBuildId).toBe(`chief-${w.s.user.id}-${w.teamId}`);
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get()!;
    expect(todoRow.spec).toContain('补充信息（探测得出，非用户确认）：');

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
    expect(chiefRow.watches).toHaveLength(1);
    expect(chiefRow.watches[0]!.todoId).toBe(created.id);

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
    expect(threadRow.sessionId).toBe('pi-chief-sess-1');
    expect(threadRow.lastTurnAt).not.toBeNull();
    expect(threadRow.activeRun).toBeNull();
    const notif = w.s.db
      .select()
      .from(notificationTable)
      .all()
      .find((n) => n.type === 'chief_message');
    expect(notif).toBeDefined();
    expect(notif!.snippet).toContain('已创建并派工');
    const stepDone = w.s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
    expect(stepDone.status).toBe('done');

    const svc = { db: w.s.db, hub: w.s.hub, machineHub: w.s.machineHub, user: w.s.user };
    const { setTodoPhase } = await import('../src/services/todos.js');
    setTodoPhase(svc, created.id, 'building');
    setTodoPhase(svc, created.id, 'review');
    const wakeSteps = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, w.threadId))
      .all()
      .filter((st) => st.prompt?.includes('[wake:gate]'));
    expect(wakeSteps.length).toBeGreaterThanOrEqual(1);
  });

  test('models candidates -> create_agent uses valid values -> agents read back (#627)', async () => {
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
    const tools = claimed.remoteTools ?? [];
    const modelsDef = tools.find((t) => t.name === 'models');
    expect(modelsDef).toBeDefined();
    expect(modelsDef?.replaySafe).toBe(true);
    const stepId = claimed.step.id;

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

  test('done(failed) -> failure reason lands in a chief_message system row, no notification', async () => {
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
    expect(threadRow.activeRun).toBeNull();
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

  test('chief step token dispatch (bound Agent model credential resolution, no build/todo row)', async () => {
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
    expect(typeof body.secrets).toBe('object');
    expect(body.secrets).toEqual({});
  });
});
