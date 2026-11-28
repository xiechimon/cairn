import { rm } from 'node:fs/promises';
import {
  CHIEF_REMOTE_TOOLS,
  orchestrateThreadTitle,
  orchestrationSourceRef,
  parseOrchestrationSourceRef,
} from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  build as buildTable,
  chiefMessage,
  chief as chiefTable,
  chiefThread,
  claudeSubscription,
  machine as machineTable,
  routingRule,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { newUuidv7, nowMs } from '../src/lib/ids.js';
import { composeChiefSystemPrompt, rewatchCreatingThread } from '../src/services/chief.js';
import { type ChiefToolCtx, executeChiefTool } from '../src/services/chief-tools.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { executeThreadMcpTool } from '../src/services/mcp-threads.js';
import { createTodo, getTodo, updateAutonomousTodo } from '../src/services/todos.js';
import {
  bootServer,
  insertMachine,
  postProject,
  req,
  seedRoute,
  type TestServer,
} from './helpers.js';
import { ownerTodoParams } from './owner-message.js';

const AGENT_ID = 'agent-orch-1';
const REPO = 'octo/alpha';

let s: TestServer;
let teamId: string;
let userId: string;
let chiefId: string;
let threadId: string;
let projectId: string;
let ghFetch: FetchLike;
let throttleHome: string;

beforeAll(async () => {
  throttleHome = makeTestTempDir('orchestration-source-');
  vi.stubEnv('CAIRN_HOME', throttleHome);
  vi.stubEnv('CAIRN_GITHUB_CREATE_MIN_INTERVAL_MS', '0');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await rm(throttleHome, { recursive: true, force: true });
});

function seedCoordinator(): void {
  seedRoute(s, 'coordinator', { id: AGENT_ID, provider: 'stub-gw', modelId: 'stub-model' });
}

function seedChiefThread(): void {
  const now = nowMs();
  s.db
    .insert(chiefTable)
    .values({
      id: chiefId,
      userId,
      teamId,
      watches: [],
      wakes: [],
      createdAt: now,
    })
    .run();
  s.db
    .insert(chiefThread)
    .values({
      id: threadId,
      chiefId,
      userId,
      teamId,
      title: '开始任务编排回合',
      createdAt: now,
      updatedAt: now,
      sessionRuntime: 'pi',
      sessionId: '',
      sessionOpenedAt: now,
      toolDefHashes: {},
      toolResultHashes: {},
    })
    .run();
}

function ctx(): ChiefToolCtx {
  return { teamId, userId, chiefId, threadId, chiefAgentId: AGENT_ID, conversationId: threadId };
}

async function relay(
  name: string,
  params: Record<string, unknown>,
  githubFetch?: FetchLike,
): Promise<unknown> {
  const text = await executeChiefTool(
    {
      db: s.db,
      hub: s.hub,
      machineHub: s.machineHub,
      box: s.secretBox,
      user: s.user,
      reposDir: s.reposDir,
      attachmentsDir: s.attachmentsDir,
      skillsDir: s.skillsDir,
      ...(githubFetch !== undefined ? { githubFetch } : {}),
    },
    ctx(),
    name,
    params,
  );
  return JSON.parse(text) as unknown;
}

function ownerTodo(words: string, target: string = projectId) {
  return ownerTodoParams(s.db, threadId, target, words);
}

interface TodoWire {
  id: string;
  sourceKind: string | null;
  sourceRef: string | null;
  createdBy: string | null;
  ownerId: string | null;
  sourceBuildId: string | null;
}

beforeEach(async () => {
  ghFetch = async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const status = method === 'POST' ? 201 : 200;
    const body: unknown =
      method === 'POST' && url.includes('/issues')
        ? { number: 5, title: 'x', state: 'open', labels: [] }
        : {};
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: { get: () => null },
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  s = bootServer({ githubFetch: ghFetch });
  insertMachine(s);
  teamId = s.team.id;
  userId = s.user.id;
  chiefId = `chief-${userId}-${teamId}`;
  threadId = `chief-${newUuidv7()}`;
  projectId = await postProject(s.app, 'demo');
  seedCoordinator();
  seedChiefThread();
});

describe('A storage surface: create_todo orchestration source (#640 / r14 §5.3)', () => {
  test('A1 local project -> sourceKind=orchestration + sourceRef=chief:<uuid>, the three provenance layers keep their old values', async () => {
    const created = (await relay(
      'create_todo',
      ownerTodo('重构登录页表单校验', projectId),
    )) as TodoWire;
    expect(created.sourceKind).toBe('orchestration');
    expect(created.sourceRef).toBe(orchestrationSourceRef(threadId));
    expect(created.createdBy).toBe(AGENT_ID);
    expect(created.ownerId).toBe(userId);
    expect(created.sourceBuildId).toBe(chiefId);
  });

  test('A2 GitHub-connected project -> the orchestration source slot wins, zero outbound', async () => {
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId, login: 'octo', accessToken: 'ghp_orch_token', scope: 'repo' },
    );
    const res = await req(s.app, 'POST', '/api/projects', {
      name: 'gh-demo',
      kind: 'github',
      githubRepo: REPO,
    });
    expect(res.status).toBe(201);
    const ghProject = ((await res.json()) as { id: string }).id;
    const outbound: string[] = [];
    const watching: FetchLike = async (input, init) => {
      outbound.push(`${init?.method ?? 'GET'} ${String(input)}`);
      return ghFetch(input, init);
    };
    const created = (await relay(
      'create_todo',
      ownerTodo('写贡献指南', ghProject),
      watching,
    )) as TodoWire;
    expect(created.sourceKind).toBe('orchestration');
    expect(created.sourceRef).toBe(orchestrationSourceRef(threadId));
    expect(outbound).toEqual([]);
  });

  test('A2c github-issue-self todos created by a Coordinator thread remain traceable for rewatchCreatingThread and thread_pull_requests', async () => {
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId, login: 'octo', accessToken: 'ghp_orch_token', scope: 'repo' },
    );
    const res = await req(s.app, 'POST', '/api/projects', {
      name: 'gh-trace',
      kind: 'github',
      githubRepo: REPO,
    });
    expect(res.status).toBe(201);
    const ghProject = ((await res.json()) as { id: string }).id;
    const created = createTodo(s.svc, {
      teamId,
      projectId: ghProject,
      title: '修复自开发着陆',
      spec: '修复自开发着陆',
      createdBy: AGENT_ID,
      ownerId: userId,
      sourceKind: 'github-issue-self',
      sourceRef: `github:${REPO}#5`,
      request: {
        segments: [
          {
            source: { kind: 'chat', threadId, messageId: 'msg-legacy-self', span: 'whole' },
            author: 'owner',
            sourceRef: null,
            text: '修复自开发着陆',
          },
        ],
        siblings: [],
        difficulty: null,
        titleSource: 'owner',
        titleSourceRef: null,
      },
    });
    s.db.update(chiefTable).set({ watches: [] }).where(eq(chiefTable.id, chiefId)).run();
    const record = getTodo(s.svc, created.id);
    expect(record?.sourceRef).toBe(`github:${REPO}#5`);
    rewatchCreatingThread(
      { db: s.db, hub: s.hub, machineHub: s.machineHub, user: s.user },
      record!,
    );
    const watches = s.db.select().from(chiefTable).where(eq(chiefTable.id, chiefId)).get()?.watches;
    expect(watches?.map((w) => [w.todoId, w.threadId])).toEqual([[created.id, threadId]]);

    s.db.update(chiefTable).set({ watches: [] }).where(eq(chiefTable.id, chiefId)).run();
    s.db
      .insert(buildTable)
      .values({
        id: 'build-self-issue',
        todoId: created.id,
        withPlan: false,
        triggerSource: 'user',
        createdAt: nowMs(),
        prNumber: 77,
        prUrl: `https://github.com/${REPO}/pull/77`,
      })
      .run();
    const prs = await executeThreadMcpTool(
      {
        db: s.db,
        hub: s.hub,
        convHub: s.convHub,
        machineHub: s.machineHub,
        box: s.secretBox,
        user: s.user,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        skillsDir: s.skillsDir,
      },
      teamId,
      'thread_pull_requests',
      { threadId },
    );
    expect(prs).toEqual([
      {
        threadId: created.id,
        buildId: 'build-self-issue',
        prUrl: `https://github.com/${REPO}/pull/77`,
        prNumber: 77,
      },
    ]);
  });

  test('A2b a mail turn on a GitHub-connected project creates no GitHub issue', async () => {
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId, login: 'octo', accessToken: 'ghp_orch_token', scope: 'repo' },
    );
    const res = await req(s.app, 'POST', '/api/projects', {
      name: 'gh-mail',
      kind: 'github',
      githubRepo: REPO,
    });
    const ghProject = ((await res.json()) as { id: string }).id;
    const posts: string[] = [];
    const watching: FetchLike = async (input, init) => {
      if ((init?.method ?? 'GET') === 'POST') posts.push(String(input));
      return ghFetch(input, init);
    };
    const text = await executeChiefTool(
      {
        db: s.db,
        hub: s.hub,
        machineHub: s.machineHub,
        box: s.secretBox,
        user: s.user,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        skillsDir: s.skillsDir,
        githubFetch: watching,
      },
      { ...ctx(), turnPrompt: '[wake:wake] provenance=mail:evt-1\nreply to the sender' },
      'create_todo',
      ownerTodo('写贡献指南', ghProject),
    );
    const created = JSON.parse(text) as TodoWire;
    expect(created.sourceKind).toBe('orchestration');
    expect(posts).toEqual([]);
  });

  test('A3 MCP create_todo -> no orchestration source stored', async () => {
    const keyRes = await s.app.request(`/api/teams/${teamId}/api-keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'MCP_ORCH',
        gitAccess: false,
        mcpAccess: true,
        toolGrants: { read: ['Todos'], write: ['Create Todo'] },
      }),
    });
    expect(keyRes.status).toBe(201);
    const key = ((await keyRes.json()) as { plaintext: string }).plaintext;
    const rpcRes = await s.app.request('/api/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_todo', arguments: { projectId, title: 'mcp 建卡', spec: 's' } },
      }),
    });
    expect(rpcRes.status).toBe(200);
    const row = s.db.select().from(todoTable).where(eq(todoTable.title, 'mcp 建卡')).get();
    expect(row?.sourceKind).toBeNull();
    expect(row?.sourceRef).toBeNull();
  });

  test('A4 user REST POST todos -> no orchestration source stored', async () => {
    const res = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: '人手建卡',
      spec: 's',
    });
    expect(res.status).toBe(201);
    const record = (await res.json()) as TodoWire;
    expect(record.sourceKind).toBeNull();
    expect(record.sourceRef).toBeNull();
  });

  test('C1 the stored ref and the shared single source are exact inverses (the detail panel links back to the session consumer)', async () => {
    const created = (await relay('create_todo', ownerTodo('t', projectId))) as TodoWire;
    const parsed = parseOrchestrationSourceRef(created.sourceRef as string);
    expect(parsed).toEqual({ threadId });
  });
});

describe('D entry surface: POST /todos/:id/orchestrate is the single start-task exit (r14 §5.7)', () => {
  async function makeTodo(spec = '把登录页改成邮箱登录'): Promise<string> {
    const res = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: '', spec });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  test('D1 todo phase -> 201: a new chief thread + synthetic orchestration request + the chief step queued', async () => {
    const todoId = await makeTodo();
    const res = await req(s.app, 'POST', `/api/todos/${todoId}/orchestrate`);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      thread: { id: string };
      message: { id: string; content: string; origin?: string };
    };
    expect(body.thread.id.startsWith('chief-')).toBe(true);
    expect(body.message.origin).toBe('synthetic');
    expect(body.message.content).toContain('> 把登录页改成邮箱登录');
    expect(body.message.content).toContain(`(todo:${todoId})`);
    const storedMsg = s.db
      .select()
      .from(chiefMessage)
      .where(eq(chiefMessage.id, body.message.id))
      .get();
    expect(storedMsg?.origin).toBe('synthetic');
    const steps = s.db.select().from(stepTable).where(eq(stepTable.buildId, body.thread.id)).all();
    expect(steps).toHaveLength(1);
    expect(steps[0]!.kind).toBe('chief');
    expect(steps[0]!.status).toBe('pending');
    const builds = s.db.select().from(buildTable).all();
    expect(builds).toHaveLength(0);
    const row = s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get();
    expect(row?.phase).toBe('todo');
  });

  test('Coordinator generic updates cannot replace dedicated correction labels', async () => {
    const todoId = await makeTodo();
    s.db.run(sql`INSERT INTO github_label (id, projectId, name, color)
      VALUES ('correction-label', ${projectId}, 'correction', '#000000')`);
    updateAutonomousTodo(s.svc, todoId, { githubLabelIds: ['correction-label'] });
    await expect(relay('update_todo', { todoId, githubLabelIds: [] })).rejects.toMatchObject({
      status: 400,
    });
    await expect(relay('update_todo', { todoId, tagIds: [] })).rejects.toMatchObject({
      status: 400,
    });
    const edited = await relay('update_todo', { todoId, blockedBy: [] });
    expect(edited).toMatchObject({ githubLabelIds: ['correction-label'] });
    expect(s.db.get(sql`SELECT correctionRequired FROM todo WHERE id = ${todoId}`)).toEqual({
      correctionRequired: 1,
    });
  });

  test('D3 failed phase -> 201, the message carries re-orchestration context', async () => {
    const todoId = await makeTodo();
    s.db.update(todoTable).set({ phase: 'failed' }).where(eq(todoTable.id, todoId)).run();
    const res = await req(s.app, 'POST', `/api/todos/${todoId}/orchestrate`);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { message: { content: string } };
    expect(body.message.content).toContain('上一轮执行失败');
  });

  test('D3 running / finished phases -> 409 (phase gate)', async () => {
    const todoId = await makeTodo();
    s.db.update(todoTable).set({ phase: 'building' }).where(eq(todoTable.id, todoId)).run();
    expect((await req(s.app, 'POST', `/api/todos/${todoId}/orchestrate`)).status).toBe(409);
    s.db.update(todoTable).set({ phase: 'done' }).where(eq(todoTable.id, todoId)).run();
    expect((await req(s.app, 'POST', `/api/todos/${todoId}/orchestrate`)).status).toBe(409);
  });

  test('D4 the team has no coordinator routing rule -> 409 (the gating entry is canon, not silent)', async () => {
    const todoId = await makeTodo();
    s.db.delete(routingRule).where(eq(routingRule.id, AGENT_ID)).run();
    const res = await req(s.app, 'POST', `/api/todos/${todoId}/orchestrate`);
    expect(res.status).toBe(409);
  });

  test('D5 orchestrateThreadTitle uses the task title without seqNum and getChiefEnvelope reports subscription and runner-offline outages while keeping step queued', async () => {
    expect(orchestrateThreadTitle('修复登录页')).toBe('修复登录页');
    expect(orchestrateThreadTitle('修复登录页')).not.toContain('开始任务 #');

    s.db.delete(routingRule).where(eq(routingRule.id, AGENT_ID)).run();
    seedRoute(s, 'coordinator', {
      id: AGENT_ID,
      provider: 'claude-code',
      modelId: 'claude-sonnet-4-5',
    });
    s.db
      .insert(claudeSubscription)
      .values({
        id: 'sub-expired',
        teamId,
        label: 'Expired Claude',
        tokenCipher: 'cipher',
        expiresAt: nowMs() - 60_000,
        enabledAt: nowMs() - 120_000,
        models: [],
        createdAt: nowMs() - 120_000,
      })
      .run();

    const todoId = await makeTodo();
    const res = await req(s.app, 'POST', `/api/todos/${todoId}/orchestrate`);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { thread: { id: string } };
    const queuedSteps = s.db
      .select()
      .from(stepTable)
      .where(eq(stepTable.buildId, body.thread.id))
      .all();
    expect(queuedSteps).toHaveLength(1);
    expect(queuedSteps[0]?.status).toBe('pending');

    const subEnv = (await (await req(s.app, 'GET', `/api/teams/${teamId}/chief`)).json()) as {
      outage: { reason: string; model: string | null } | null;
    };
    expect(subEnv.outage?.reason).toBe('subscription');

    s.db
      .update(claudeSubscription)
      .set({ expiresAt: nowMs() + 3_600_000 })
      .where(eq(claudeSubscription.id, 'sub-expired'))
      .run();
    s.db.update(machineTable).set({ online: false }).where(eq(machineTable.teamId, teamId)).run();
    const offlineEnv = (await (await req(s.app, 'GET', `/api/teams/${teamId}/chief`)).json()) as {
      outage: { reason: string } | null;
    };
    expect(offlineEnv.outage?.reason).toBe('runner-offline');
  });
});

describe('B prompt surface: orchestration round splitting discipline (the r14 §5.2 guardrails in the system prompt)', () => {
  test('B1 create_todo carries the splitting discipline: one todo per accepted outcome, exact owner quotes, order through dependsOn', () => {
    const createTodo = CHIEF_REMOTE_TOOLS.find((tool) => tool.name === 'create_todo')!;
    expect(createTodo.description).toContain('once per independently accepted outcome');
    expect(createTodo.description).toContain("the owner's exact sentences that todo covers");
    expect(createTodo.description).toContain('dependsOn');
    const prompt = composeChiefSystemPrompt(
      { db: s.db, hub: s.hub, machineHub: s.machineHub, user: s.user, skillsDir: s.skillsDir },
      teamId,
    );
    expect(prompt).not.toContain('withPlan:false');
  });
});
