import type { ClaimedStep } from '@cairn/shared';
import {
  CHIEF_REPLY_TOOLS,
  CHIEF_ROUTER_TOOL_NAMES,
  CHIEF_TOOL_COUNT,
  claimedStepSchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import { readyMachine } from '../../../packages/shared/test/fixtures/machine.js';
import {
  build as buildTable,
  chiefMessage,
  chiefThread,
  notification as notificationTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { setTodoPhase } from '../src/services/todos.js';
import { bootServer, issueApiKey, machineIdByName, seedRoute, type TestServer } from './helpers.js';

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
  coordinatorRouteId: string;
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
  githubAppIdentity?: { name: string; email: string };
}): Promise<ChiefWorld> {
  const s = bootServer({
    claimHoldMs: 200,
    ...(opts?.githubAppIdentity !== undefined ? { githubAppIdentity: opts.githubAppIdentity } : {}),
  });
  disposables.push(() => s.dispose());
  const teamId = s.team.id;
  const key = await issueApiKey(s);
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: readyMachine({
      teamId,
      name: 'm4a-mbp',
      cliVersion: '0.1.0',
      ...(opts?.claudeCode !== undefined ? { claudeCode: opts.claudeCode } : {}),
    }),
  });
  const { token } = (await enrollRes.json()) as { token: string };
  const machineId = machineIdByName(s, 'm4a-mbp');
  const coordinatorRouteId = seedRoute(s, 'coordinator', {
    provider: 'stub-gw',
    modelId: 'stub-model',
    machineId,
  });
  const projRes = await call(s.app, 'POST', '/api/projects', { body: { name: 'm4a-proj' } });
  const project = (await projRes.json()) as { id: string };
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
    coordinatorRouteId,
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
  test('claim → relay(create_todo/open_thread) → transcript → done → thread report', async () => {
    const w = await setupChiefWorld();

    const claimed = await w.claim();
    expect(claimed.step.kind).toBe('chief');
    expect(claimed.conversationId).toBe(w.threadId);
    expect(claimed.chief?.threadId).toBe(w.threadId);
    expect(claimed.chief?.systemPrompt).toContain('Coordinator');
    expect(claimed.remoteTools).toHaveLength(
      CHIEF_TOOL_COUNT + CHIEF_ROUTER_TOOL_NAMES.length + CHIEF_REPLY_TOOLS.length,
    );
    expect(claimed.agent?.id).toBe(w.coordinatorRouteId);
    expect(claimed.agent?.modelId).toBe('stub-model');
    expect(claimed.agent?.skillsAllowlist).toBeUndefined();
    expect(claimed.agent?.defaultSkill).toBeUndefined();
    expect(claimed.todo).toBeUndefined();
    const stepId = claimed.step.id;

    const created = (await w.relay(stepId, 'create_todo', {
      projectId: w.projectId,
    })) as {
      id: string;
      createdBy: string | null;
      sourceBuildId: string | null;
      buildId: string;
    };
    expect(created.createdBy).toBe(w.s.user.id);
    expect(created.sourceBuildId).toBe(`chief-${w.s.user.id}-${w.teamId}`);
    const todoRow = w.s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get()!;
    expect(todoRow.spec).toBe('帮 m4a-proj 写一份 CONTRIBUTING.md 贡献指南。');

    const opened = created;
    expect(
      w.s.db.select().from(buildTable).where(eq(buildTable.id, opened.buildId)).get(),
    ).toMatchObject({
      withPlan: false,
      triggerSource: 'chief',
    });
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
    setTodoPhase(svc, created.id, 'building');
    setTodoPhase(svc, created.id, 'review');
    const reports = w.s.db
      .select()
      .from(chiefMessage)
      .all()
      .filter((m) => {
        const content = String(m.content);
        return content.includes('"kind":"thread-report"') && content.includes(created.id);
      });
    expect(reports.length).toBeGreaterThanOrEqual(1);
  });

  test('models candidates list the Claude Code models the machine reports (#627)', async () => {
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

  test('a chief step token carries the configured App commit identity', async () => {
    const bot = {
      name: 'cairnwright[bot]',
      email: '347615582+cairnwright[bot]@users.noreply.github.com',
    };
    const w = await setupChiefWorld({ githubAppIdentity: bot });
    const claimed = await w.claim();
    const tokenRes = await call(w.s.app, 'GET', `/api/machine/token/${claimed.step.id}`, {
      cred: w.token,
    });
    expect(tokenRes.status).toBe(200);
    expect(((await tokenRes.json()) as { commitIdentity: unknown }).commitIdentity).toEqual(bot);
  });
});

describe('Coordinator router tools over the machine protocol (D60)', () => {
  test('the claim carries the router tools, open_thread starts a session, run_builds says removed under D60', async () => {
    const w = await setupChiefWorld();
    const claimed = await w.claim();
    expect(claimed.remoteTools).toHaveLength(
      CHIEF_TOOL_COUNT + CHIEF_ROUTER_TOOL_NAMES.length + CHIEF_REPLY_TOOLS.length,
    );
    const names = claimed.remoteTools?.map((t) => t.name) ?? [];
    for (const name of CHIEF_ROUTER_TOOL_NAMES) expect(names).toContain(name);
    expect(claimed.chief?.systemPrompt).toContain('open_thread');
    expect(claimed.chief?.systemPrompt).not.toContain('派发判定');
    const stepId = claimed.step.id;
    const created = (await w.relay(stepId, 'create_todo', {
      projectId: w.projectId,
    })) as { id: string; buildId: string };
    await expect(w.relay(stepId, 'run_builds', { todoIds: [created.id] })).rejects.toThrow(
      /run_builds was removed under D60/,
    );
    await expect(w.relay(stepId, 'open_thread', { todoId: created.id })).rejects.toThrow(
      /already open/,
    );
    const opened = created;
    const steps = w.s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, opened.buildId))
      .all();
    expect(steps.map((row) => row.kind)).toEqual(['session']);
    const listed = (await w.relay(stepId, 'threads', {})) as { threads: { id: string }[] };
    expect(listed.threads.map((t) => t.id)).toEqual([created.id]);
  });
});
