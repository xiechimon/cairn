import { rm } from 'node:fs/promises';
import {
  CHIEF_REMOTE_TOOLS,
  orchestrationSourceRef,
  parseOrchestrationSourceRef,
} from '@cairn/shared';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import {
  build as buildTable,
  chief as chiefTable,
  chiefThread,
  routingRule,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { newUuidv7, nowMs } from '../src/lib/ids.js';
import { composeChiefSystemPrompt } from '../src/services/chief.js';
import { type ChiefToolCtx, executeChiefTool } from '../src/services/chief-tools.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { flushSelfIssueWrites, updateAutonomousTodo } from '../src/services/todos.js';
import {
  bootServer,
  deliverCodeStep,
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

  test('A2 GitHub-connected project -> the mirror slot wins (github-issue-self), zero outbound regression', async () => {
    const res = await req(s.app, 'POST', '/api/projects', {
      name: 'gh-demo',
      kind: 'github',
      githubRepo: REPO,
    });
    expect(res.status).toBe(201);
    const ghProject = ((await res.json()) as { id: string }).id;
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId, login: 'octo', accessToken: 'ghp_orch_token', scope: 'repo' },
    );
    const created = (await relay(
      'create_todo',
      ownerTodo('写贡献指南', ghProject),
      ghFetch,
    )) as TodoWire;
    expect(created.sourceKind).toBe('github-issue-self');
    expect(created.sourceRef).toBeNull();
    deliverCodeStep(
      {
        ...s.svc,
        box: s.secretBox,
        reposDir: s.reposDir,
        attachmentsDir: s.attachmentsDir,
        githubFetch: ghFetch,
      },
      created.id,
    );
    await flushSelfIssueWrites();
    const row = s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get();
    expect(row?.sourceRef).toBe(`github:${REPO}#5`);
  });

  test('A2b a mail turn on a GitHub-connected project creates no GitHub issue', async () => {
    const res = await req(s.app, 'POST', '/api/projects', {
      name: 'gh-mail',
      kind: 'github',
      githubRepo: REPO,
    });
    const ghProject = ((await res.json()) as { id: string }).id;
    upsertGithubConnection(
      { db: s.db, box: s.secretBox },
      { teamId, login: 'octo', accessToken: 'ghp_orch_token', scope: 'repo' },
    );
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
    await flushSelfIssueWrites();
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

  test('D1 todo phase -> 201: a new chief thread + the orchestration request message (spec verbatim) + the chief step queued', async () => {
    const todoId = await makeTodo();
    const res = await req(s.app, 'POST', `/api/todos/${todoId}/orchestrate`);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { thread: { id: string }; message: { content: string } };
    expect(body.thread.id.startsWith('chief-')).toBe(true);
    expect(body.message.content).toContain('> 把登录页改成邮箱登录');
    expect(body.message.content).toContain(`(todo:${todoId})`);
    const steps = s.db.select().from(stepTable).where(eq(stepTable.buildId, body.thread.id)).all();
    expect(steps).toHaveLength(1);
    expect(steps[0]!.kind).toBe('chief');
    expect(steps[0]!.status).toBe('pending');
    const builds = s.db.select().from(buildTable).all();
    expect(builds).toHaveLength(0);
    const row = s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get();
    expect(row?.phase).toBe('todo');
  });

  test('D2 bug routing follows dedicated GitHub labels', async () => {
    s.db.run(sql`INSERT INTO github_label
      (id, projectId, name, color) VALUES ('bug-label', ${projectId}, 'BuG', '#b60205')`);
    const res = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: 'Save failure',
      spec: 'Open settings and save.',
    });
    expect(res.status).toBe(201);
    const todoId = ((await res.json()) as { id: string }).id;
    s.db.run(sql`INSERT INTO todo_github_label
      (todoId, labelId) VALUES (${todoId}, 'bug-label')`);
    s.db
      .update(todoTable)
      .set({ sourceKind: 'github-issue', sourceRef: 'github:octo/alpha#8' })
      .where(eq(todoTable.id, todoId))
      .run();
    const orchestrated = await req(s.app, 'POST', `/api/todos/${todoId}/orchestrate`);
    expect(orchestrated.status).toBe(201);
    const body = (await orchestrated.json()) as { message: { content: string } };
    expect(body.message.content.includes('先完成复现步骤，再开始实现')).toBe(true);
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
