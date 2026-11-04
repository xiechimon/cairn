import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agentTaskSchema,
  conversationStreamEventSchema,
  machineRecordSchema,
  tokenUsageSchema,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  plan as planTable,
  provider as providerTable,
  todo as todoTable,
} from '../src/db/schema.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  openConvStream,
  postProject,
  req,
  withVerification,
} from './helpers.js';

type TestServer = ReturnType<typeof bootServer>;

async function call(
  app: Hono,
  method: string,
  path: string,
  opts: { cred?: string; body?: unknown; text?: string; contentType?: string } = {},
): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.cred) headers.authorization = `Bearer ${opts.cred}`;
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.contentType !== undefined) headers['content-type'] = opts.contentType;
  return Promise.resolve(
    app.request(path, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : opts.text,
    }),
  );
}

const AGENT_ID = 'agent-m5-1';

async function setupWorld(opts: { webDir?: string | null; pingIntervalMs?: number } = {}) {
  const s = bootServer({
    claimHoldMs: 250,
    pingIntervalMs: opts.pingIntervalMs ?? 3_600_000,
    ...(opts.webDir !== undefined ? { webDir: opts.webDir } : {}),
  });
  const apiKey = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-m5',
      teamId: s.team.id,
      kind: 'custom',
      providerId: 'stub-gw',
      label: 'Stub Gateway',
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      authHeader: true,
      compat: { supportsDeveloperRole: false },
      models: [{ id: 'stub-model', name: 'stub-model' }],
      createdBy: s.user.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'm5-builder',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: apiKey,
    body: { teamId: s.team.id, name: 'm5-mbp', cliVersion: '0.1.0' },
  });

  bindAllAgents(s);
  const { token, machineId } = (await enrollRes.json()) as { token: string; machineId: string };
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: 'M5 探针', spec: '探针 spec' },
  });
  const { id: todoId } = (await todoRes.json()) as { id: string };
  return { s, token, machineId, projectId, todoId };
}

async function startBuild(s: TestServer, projectId: string, todoId: string): Promise<string> {
  const res = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    body: {
      todoIds: [todoId],
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
      withPlan: true,
    },
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as { builds: { id: string }[] };
  return body.builds[0]!.id;
}

describe('conversation stream (02 section 1.2 conversation stream, M5 live streaming server half)', () => {
  test('connect pings immediately; step events/tool rows/text increments/rejection rows pass the schema frame by frame', async () => {
    const { s, token, projectId, todoId } = await setupWorld({ pingIntervalMs: 60 });
    const buildId = await startBuild(s, projectId, todoId);
    const stream = await openConvStream(s.app, buildId);
    try {
      const ping = await stream.next((ev) => ev.type === 'ping');
      expect(conversationStreamEventSchema.parse(ping)).toBeTruthy();

      const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
        cred: token,
        body: { running: 0 },
      });
      const claimed = (await claimRes.json()) as { step: { step: { id: string } } | null };
      expect(claimed.step).not.toBeNull();
      const stepId = claimed.step!.step.id;
      const stepEv = await stream.next(
        (ev) => ev.type === 'step' && (ev.step as { status: string }).status === 'claimed',
      );
      expect(conversationStreamEventSchema.parse(stepEv)).toBeTruthy();

      const toolCall = {
        id: 'call-m5-1',
        name: 'bash',
        arguments: { command: 'echo probe' },
        result: 'probe',
        startedAt: Date.now(),
        endedAt: Date.now(),
      };
      const toolRes = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
        cred: token,
        body: toolCall,
      });
      expect(toolRes.status).toBe(200);
      const msgEv = await stream.next((ev) => ev.type === 'message');
      const parsedMsg = conversationStreamEventSchema.parse(msgEv);
      expect(parsedMsg.type === 'message' && parsedMsg.message.id).toBe('call-m5-1');

      const deltaRes = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
        cred: token,
        body: { kind: 'transcript_delta', text: '正在分析仓库结构…' },
      });
      expect(deltaRes.status).toBe(200);
      const deltaEv = await stream.next((ev) => ev.type === 'text_delta');
      expect(conversationStreamEventSchema.parse(deltaEv)).toBeTruthy();
      expect((deltaEv as { text: string }).text).toBe('正在分析仓库结构…');

      const emptyRes = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
        cred: token,
        body: { kind: 'transcript_delta', text: '' },
      });
      expect(emptyRes.status).toBe(200);

      const actRes = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
        cred: token,
        body: { kind: 'activity', activity: { phase: 'thinking' } },
      });
      expect(actRes.status).toBe(200);
      const actEv = await stream.next((ev) => ev.type === 'activity');
      const parsedAct = conversationStreamEventSchema.parse(actEv);
      expect(parsedAct.type === 'activity' && parsedAct.activity.stepId).toBe(stepId);
      expect(parsedAct.type === 'activity' && parsedAct.activity.phase).toBe('thinking');
      expect(parsedAct.type === 'activity' && typeof parsedAct.activity.at).toBe('number');

      const badPhase = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
        cred: token,
        body: { kind: 'activity', activity: { phase: 'moonwalking' } },
      });
      expect(badPhase.status).toBe(400);

      const skillsRes = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
        cred: token,
        body: {
          kind: 'activity',
          activity: {
            phase: 'tool',
            tool: 'skill: to-spec',
            skills: [
              { name: 'extra-skill', denied: true },
              { name: 'demo-skill', denied: false },
            ],
          },
        },
      });
      expect(skillsRes.status).toBe(200);
      const skillsEv = await stream.next((ev) => ev.type === 'activity');
      const parsedSkills = conversationStreamEventSchema.parse(skillsEv);
      expect(parsedSkills.type === 'activity' && parsedSkills.activity.skills).toEqual([
        { name: 'extra-skill', denied: true },
        { name: 'demo-skill', denied: false },
      ]);
      expect(parsedSkills.type === 'activity' && parsedSkills.activity.stepId).toBe(stepId);

      const badSkillFact = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
        cred: token,
        body: { kind: 'activity', activity: { phase: 'tool', skills: [{ name: 'x' }] } },
      });
      expect(badSkillFact.status).toBe(400);

      const todoRes = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
        cred: token,
        body: {
          kind: 'agent_todo',
          todo: {
            items: [
              { text: '通读 poteto 的推文观点', state: 'todo' },
              { text: '开票沉淀注释规则', state: 'doing' },
              { text: '查 pi 模型上下文是不是都 1M', state: 'done' },
            ],
          },
        },
      });
      expect(todoRes.status).toBe(200);
      const todoEv = await stream.next((ev) => ev.type === 'agent_todo');
      const parsedTodo = conversationStreamEventSchema.parse(todoEv);
      expect(parsedTodo.type === 'agent_todo' && parsedTodo.todo.stepId).toBe(stepId);
      expect(parsedTodo.type === 'agent_todo' && typeof parsedTodo.todo.at).toBe('number');
      expect(parsedTodo.type === 'agent_todo' && parsedTodo.todo.items).toEqual([
        { text: '通读 poteto 的推文观点', state: 'todo' },
        { text: '开票沉淀注释规则', state: 'doing' },
        { text: '查 pi 模型上下文是不是都 1M', state: 'done' },
      ]);

      const badTodo = await call(s.app, 'POST', `/api/machine/tool/${stepId}`, {
        cred: token,
        body: { kind: 'agent_todo', todo: { items: [{ text: 'a', state: 'later' }] } },
      });
      expect(badTodo.status).toBe(400);

      const foreignTodo = await call(s.app, 'POST', '/api/machine/tool/no-such-step', {
        cred: token,
        body: { kind: 'agent_todo', todo: { items: [] } },
      });
      expect(foreignTodo.status).toBe(404);

      const foreign = await call(s.app, 'POST', '/api/machine/tool/no-such-step', {
        cred: token,
        body: { kind: 'transcript_delta', text: 'x' },
      });
      expect(foreign.status).toBe(404);
      const foreignAct = await call(s.app, 'POST', '/api/machine/tool/no-such-step', {
        cred: token,
        body: { kind: 'activity', activity: { phase: 'thinking' } },
      });
      expect(foreignAct.status).toBe(404);

      const doneRes = await call(s.app, 'POST', `/api/machine/done/${stepId}`, {
        cred: token,
        body: { status: 'success', hasChanges: false },
      });
      expect(doneRes.status).toBe(200);
      const doneEv = await stream.next(
        (ev) => ev.type === 'step' && (ev.step as { status: string }).status === 'done',
      );
      expect(conversationStreamEventSchema.parse(doneEv)).toBeTruthy();
    } finally {
      stream.close();
      s.dispose();
    }
  });

  test('rejection loop: revision user feedback row enters the conversation stream immediately (r5 section 4 timeline)', async () => {
    const { s, token, projectId, todoId } = await setupWorld();
    const buildId = await startBuild(s, projectId, todoId);
    const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: token,
      body: { running: 0 },
    });
    const stepId = ((await claimRes.json()) as { step: { step: { id: string } } }).step!.step.id;
    const planUrlsRes = await call(s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
      cred: token,
      body: { files: [{ name: 'plan.md' }] },
    });
    const planUpload = ((await planUrlsRes.json()) as { uploads: { url: string }[] }).uploads[0]!;
    await call(s.app, 'PUT', planUpload.url.replace(/^https?:\/\/[^/]+/, ''), {
      cred: token,
      text: withVerification('# 方案\nContext: x'),
      contentType: 'text/markdown',
    });
    await call(s.app, 'POST', `/api/machine/done/${stepId}`, {
      cred: token,
      body: { status: 'success' },
    });
    const stream = await openConvStream(s.app, buildId);
    try {
      const revRes = await call(s.app, 'POST', `/api/builds/${buildId}/steps`, {
        body: {
          action: 'revision',
          side: 'plan',
          feedback: '标题去掉项目名后缀',
          clientMessageId: '3f9a0c2e-0000-4000-8000-000000000001',
        },
      });
      expect(revRes.status).toBe(202);
      const ev = await stream.next(
        (e) => e.type === 'message' && (e.message as { role: string }).role === 'user',
      );
      const parsed = conversationStreamEventSchema.parse(ev);
      expect(parsed.type === 'message' && parsed.message.content).toBe('标题去掉项目名后缀');
      const stepEv = await stream.next(
        (e) => e.type === 'step' && (e.step as { kind: string }).kind === 'plan',
      );
      expect(conversationStreamEventSchema.parse(stepEv)).toBeTruthy();
    } finally {
      stream.close();
      s.dispose();
    }
  });
});

describe('M5 vocabulary completion surface (02 section 6.1 canonical)', () => {
  test('GET teams/{id}/machines -> machineRecord[] (registered machines listed)', async () => {
    const { s, machineId } = await setupWorld();
    try {
      const res = await req(s.app, 'GET', `/api/teams/${s.team.id}/machines`);
      expect(res.status).toBe(200);
      const rows = (await res.json()) as unknown[];
      expect(rows).toHaveLength(1);
      const record = machineRecordSchema.parse(rows[0]);
      expect(record.id).toBe(machineId);
      expect(record.name).toBe('m5-mbp');
      expect((await req(s.app, 'GET', '/api/teams/nope/machines')).status).toBe(404);
    } finally {
      s.dispose();
    }
  });

  test('models/progress/agents tasks/telemetry surface', async () => {
    const { s, projectId, todoId } = await setupWorld();
    try {
      const models = (await (await req(s.app, 'GET', `/api/teams/${s.team.id}/models`)).json()) as {
        id: string;
        providerId: string;
        providerLabel: string;
      }[];
      expect(models).toEqual([
        {
          id: 'stub-model',
          name: 'stub-model',
          providerId: 'stub-gw',
          providerLabel: 'Stub Gateway',
        },
      ]);

      const progress = (await (
        await req(s.app, 'GET', `/api/teams/${s.team.id}/progress`)
      ).json()) as { todos: { total: number; byPhase: Record<string, number> } };
      expect(progress.todos.total).toBe(1);
      expect(progress.todos.byPhase.todo).toBe(1);

      await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
        body: {
          todoIds: [todoId],
          assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
          withPlan: false,
        },
      });
      const tasks = (await (
        await req(s.app, 'GET', `/api/teams/${s.team.id}/agents/${AGENT_ID}/tasks`)
      ).json()) as { todo: { id: string } }[];
      expect(tasks.map((t) => t.todo.id)).toEqual([todoId]);
      const noTasks = (await (
        await req(s.app, 'GET', `/api/teams/${s.team.id}/agents/other/tasks`)
      ).json()) as unknown[];
      expect(noTasks).toEqual([]);

      expect((await req(s.app, 'POST', '/api/analytics/first-touch', {})).status).toBe(204);
      expect((await req(s.app, 'POST', '/_mp/api/track', {})).status).toBe(204);
    } finally {
      s.dispose();
    }
  });
});

describe('Agent detail "in progress" section (shape = shared agentTaskSchema)', () => {
  const pathFor = (teamId: string, agentId: string) =>
    `/api/teams/${teamId}/agents/${agentId}/tasks`;

  test('only running builds enter the list; shape/status slots line up with the original one by one', async () => {
    const { s, projectId, todoId } = await setupWorld();
    try {
      const path = pathFor(s.team.id, AGENT_ID);
      const seqNum = (
        (await (await req(s.app, 'GET', `/api/todos/${todoId}`)).json()) as { seqNum: number }
      ).seqNum;

      expect(await (await req(s.app, 'GET', path)).json()).toEqual([]);

      const buildId = await startBuild(s, projectId, todoId);
      const queued = (await (await req(s.app, 'GET', path)).json()) as unknown[];
      expect(queued).toHaveLength(1);
      const row = agentTaskSchema.parse(queued[0]);
      expect(row).toEqual({
        kind: 'build',
        state: 'waiting',
        buildId,
        todo: { id: todoId, seqNum, title: 'M5 探针', phase: 'queued' },
      });

      for (const phase of ['planning', 'building'] as const) {
        s.db.update(todoTable).set({ phase }).where(eq(todoTable.id, todoId)).run();
        const live = agentTaskSchema.parse(
          ((await (await req(s.app, 'GET', path)).json()) as unknown[])[0],
        );
        expect(live.state).toBeNull();
        expect(live.todo.phase).toBe(phase);
        expect(live.buildId).toBe(buildId);
      }

      for (const phase of ['review', 'confirm', 'done', 'failed', 'closed'] as const) {
        s.db.update(todoTable).set({ phase }).where(eq(todoTable.id, todoId)).run();
        expect(await (await req(s.app, 'GET', path)).json()).toEqual([]);
      }

      s.db.update(todoTable).set({ phase: 'building' }).where(eq(todoTable.id, todoId)).run();
      expect(await (await req(s.app, 'GET', pathFor(s.team.id, 'agent-other'))).json()).toEqual([]);
    } finally {
      s.dispose();
    }
  });
});

describe('[inferred] build detail read surface (M5 overlay data source, registered in wire.test)', () => {
  test('plans/changes/usage: unknown build 404; empty artifacts = empty-set shape', async () => {
    const { s, projectId, todoId } = await setupWorld();
    try {
      for (const path of [
        '/api/builds/nope/plans',
        '/api/builds/nope/changes',
        '/api/builds/nope/usage',
      ]) {
        expect((await req(s.app, 'GET', path)).status).toBe(404);
      }
      const buildId = await startBuild(s, projectId, todoId);
      expect(await (await req(s.app, 'GET', `/api/builds/${buildId}/plans`)).json()).toEqual([]);
      expect(await (await req(s.app, 'GET', `/api/builds/${buildId}/usage`)).json()).toEqual([]);
      expect(await (await req(s.app, 'GET', `/api/builds/${buildId}/changes`)).json()).toEqual({
        files: [],
        reported: false,
      });
    } finally {
      s.dispose();
    }
  });

  test('after plans are persisted = version set + content; usage = tokenUsageSchema rows', async () => {
    const { s, token, projectId, todoId } = await setupWorld();
    try {
      const buildId = await startBuild(s, projectId, todoId);
      const claimRes = await call(s.app, 'POST', '/api/machine/tasks/claim', {
        cred: token,
        body: { running: 0 },
      });
      const stepId = ((await claimRes.json()) as { step: { step: { id: string } } }).step!.step.id;
      await call(s.app, 'POST', `/api/machine/done/${stepId}`, {
        cred: token,
        body: {
          status: 'success',
          usage: [
            { model: 'stub-gw/stub-model', input: 12, output: 980, cacheRead: 100, cacheWrite: 0 },
          ],
        },
      });
      const usage = (await (
        await req(s.app, 'GET', `/api/builds/${buildId}/usage`)
      ).json()) as unknown[];
      expect(usage).toHaveLength(1);
      expect(tokenUsageSchema.safeParse(usage[0]).success).toBe(true);
      s.db
        .insert(planTable)
        .values({
          id: 'plan-m5-1',
          buildId,
          version: 1,
          content: withVerification('# 方案\nContext: x'),
          createdAt: Date.now(),
        })
        .run();
      const plans = (await (await req(s.app, 'GET', `/api/builds/${buildId}/plans`)).json()) as {
        id: string;
        version: number;
        content: string;
      }[];
      expect(plans).toHaveLength(1);
      expect(plans[0]!.content).toContain('Context:');
    } finally {
      s.dispose();
    }
  });
});

describe('SPA static same-origin hosting (02/A1)', () => {
  const webDir = mkdtempSync(join(tmpdir(), 'cairn-web-dir-'));
  afterAll(() => rmSync(webDir, { recursive: true, force: true }));
  mkdirSync(join(webDir, 'assets'), { recursive: true });
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>spa</title>');
  writeFileSync(join(webDir, 'assets', 'app.js'), 'console.log(1)');
  writeFileSync(join(webDir, 'manifest.webmanifest'), '{"name":"x"}');

  test('root/deep routes = index.html; assets carry content-type; API misses still 404 JSON', async () => {
    const { s } = await setupWorld({ webDir });
    try {
      const root = await req(s.app, 'GET', '/');
      expect(root.status).toBe(200);
      expect(root.headers.get('content-type')).toContain('text/html');
      expect(await root.text()).toContain('<title>spa</title>');

      const deep = await req(s.app, 'GET', '/app/todo/whatever');
      expect(deep.status).toBe(200);
      expect(await deep.text()).toContain('<title>spa</title>');

      const asset = await req(s.app, 'GET', '/assets/app.js');
      expect(asset.status).toBe(200);
      expect(asset.headers.get('content-type')).toContain('text/javascript');

      const manifest = await req(s.app, 'GET', '/manifest.webmanifest');
      expect(manifest.headers.get('content-type')).toContain('application/manifest+json');

      const apiMiss = await req(s.app, 'GET', '/api/no-such-route');
      expect(apiMiss.status).toBe(404);
      expect(await apiMiss.json()).toEqual({ error: 'Not found' });

      const traversal = await req(s.app, 'GET', '/%2e%2e%2f%2e%2e%2fpackage.json');
      expect(traversal.status).toBe(404);
    } finally {
      s.dispose();
    }
  });

  test('webDir unset = pure API form (GET / 404 JSON)', async () => {
    const { s } = await setupWorld();
    try {
      const root = await req(s.app, 'GET', '/');
      expect(root.status).toBe(404);
      expect(await root.json()).toEqual({ error: 'Not found' });
    } finally {
      s.dispose();
    }
  });
});
