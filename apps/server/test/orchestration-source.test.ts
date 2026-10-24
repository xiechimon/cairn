// #640 / r14 §5.3：编排来源字段（sourceKind='orchestration' + sourceRef =
// 编排会话 id）。失败方式清单（先列后写，代码是让场景通过的手段）：
//
// A 落库面
//  A1 chief create_todo（local 项目）→ sourceKind='orchestration' +
//     sourceRef='chief:<uuid>'（per-request 粒度 = 本次编排会话）；
//     createdBy/sourceBuildId/ownerId 三层旧值不动——各答一问，不混。
//  A2 chief create_todo（GitHub 接入项目）→ 镜像槽位优先：
//     sourceKind='github-issue-self'（#452 出站零回归）；至多一个来源，
//     编排来源让位（r14 §5.7 GitHub 镜像面开放问题， limitation 记录在 PR）。
//  A3 MCP create_todo → 不落编排来源（非 chief 回合，无会话可指）。
//  A4 用户 REST POST todos → 不落编排来源。
// B prompt 面
//  B1 chief system prompt 含编排回合纪律：拆分粒度 = 核销次数；子卡 spec
//     内嵌用户原文片段 + 兄弟任务交叉引用；单任务直派（run_builds）；
//     派发判定（先规划/直接修）归 chief 逐次判断、判据 = 章程 prose
//     （#903，ADR 0014）；拆分时 close_todos 关原卡（父卡不引入，
//     closed 不入看板四列）。
// C 格式面
//  C1 落库的 sourceRef 与 shared orchestrationSourceRef 单源严格互逆
//     （反解 = 编排会话 threadId，详情面板链回会话的消费位）。

import { orchestrationSourceRef, parseOrchestrationSourceRef } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  chief as chiefTable,
  chiefThread,
  step as stepTable,
  tag as tagTable,
  todo as todoTable,
} from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { newUuidv7, nowMs } from '../src/lib/ids.js';
import { composeChiefSystemPrompt } from '../src/services/chief.js';
import { type ChiefToolCtx, executeChiefTool } from '../src/services/chief-tools.js';
import { upsertGithubConnection } from '../src/services/github-connection.js';
import { flushSelfIssueWrites } from '../src/services/todos.js';
import { bootServer, postProject, req, type TestServer } from './helpers.js';

const AGENT_ID = 'agent-orch-1';
const REPO = 'octo/alpha';

let s: TestServer;
let teamId: string;
let userId: string;
let chiefId: string;
let threadId: string;
let projectId: string;
let ghFetch: FetchLike;

function seedAgent(): void {
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId,
      displayName: AGENT_ID,
      description: '负责代码实现与工程修改。',
      status: 'active',
      avatarUrl: null,
      provider: 'stub-gw',
      modelId: 'stub-model',
      thinkingLevel: null,
      tools: [],
      secrets: [],
      defaultSkill: null,
      skillsAllowlist: null,
      mcpServers: [],
    })
    .run();
}

function seedChiefThread(): void {
  const now = nowMs();
  s.db
    .insert(chiefTable)
    .values({
      id: chiefId,
      userId,
      teamId,
      agentId: AGENT_ID,
      charter: '',
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

interface TodoWire {
  id: string;
  sourceKind: string | null;
  sourceRef: string | null;
  createdBy: string | null;
  ownerId: string | null;
  sourceBuildId: string | null;
}

beforeEach(async () => {
  // GitHub 出站 mock（github-writeback.test.ts 同律：测试面零真实出站）。
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
  teamId = s.team.id;
  userId = s.user.id;
  chiefId = `chief-${userId}-${teamId}`;
  threadId = `chief-${newUuidv7()}`;
  projectId = await postProject(s.app, 'demo');
  seedAgent();
  seedChiefThread();
});

describe('A 落库面：create_todo 编排来源（#640 / r14 §5.3）', () => {
  test('A1 local 项目 → sourceKind=orchestration + sourceRef=chief:<uuid>，溯源三层旧值不动', async () => {
    const created = (await relay('create_todo', {
      projectId,
      title: '重构登录页表单校验',
      spec: '> 登录页表单校验太松\n\n要求：\n- 邮箱格式校验',
    })) as TodoWire;
    expect(created.sourceKind).toBe('orchestration');
    expect(created.sourceRef).toBe(orchestrationSourceRef(threadId));
    // 三层各答一问：谁建的（createdBy/sourceBuildId）不因来源扩档漂移。
    expect(created.createdBy).toBe(AGENT_ID);
    expect(created.ownerId).toBe(userId);
    expect(created.sourceBuildId).toBe(chiefId);
  });

  test('A2 GitHub 接入项目 → 镜像槽位优先（github-issue-self），出站零回归', async () => {
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
      { projectId: ghProject, title: '写贡献指南', spec: 's' },
      ghFetch,
    )) as TodoWire;
    // 至多一个来源：镜像（写向）占槽，编排来源让位——PR 记录 limitation。
    expect(created.sourceKind).toBe('github-issue-self');
    await flushSelfIssueWrites();
    const row = s.db.select().from(todoTable).where(eq(todoTable.id, created.id)).get();
    // 出站照常发生（#452 语义原样）：建成后补 github ref。
    expect(row?.sourceRef).toBe(`github:${REPO}#5`);
  });

  test('A3 MCP create_todo → 不落编排来源', async () => {
    const keyRes = await s.app.request(`/api/teams/${teamId}/api-keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'mcp-orch',
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

  test('A4 用户 REST POST todos → 不落编排来源', async () => {
    const res = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: '人手建卡',
      spec: 's',
    });
    expect(res.status).toBe(201);
    const record = (await res.json()) as TodoWire;
    expect(record.sourceKind).toBeNull();
    expect(record.sourceRef).toBeNull();
  });

  test('C1 落库 ref 与 shared 单源严格互逆（详情面板链回会话的消费位）', async () => {
    const created = (await relay('create_todo', { projectId, title: 't', spec: 's' })) as TodoWire;
    const parsed = parseOrchestrationSourceRef(created.sourceRef as string);
    expect(parsed).toEqual({ threadId });
  });
});

describe('D 入口面：POST /todos/:id/orchestrate = 开始任务单出口（r14 §5.7）', () => {
  async function makeTodo(spec = '把登录页改成邮箱登录'): Promise<string> {
    const res = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: '', spec });
    expect(res.status).toBe(201);
    return ((await res.json()) as { id: string }).id;
  }

  test('D1 todo 相位 → 201：新 chief 线程 + 编排请求消息（spec 逐字）+ chief 步入队', async () => {
    const todoId = await makeTodo();
    const res = await req(s.app, 'POST', `/api/todos/${todoId}/orchestrate`);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { thread: { id: string }; message: { content: string } };
    expect(body.thread.id.startsWith('chief-')).toBe(true);
    // 总目标正本 = 会话 user 消息，任务原文逐字内嵌（r14 §5.2 稳定锚点）。
    expect(body.message.content).toContain('> 把登录页改成邮箱登录');
    expect(body.message.content).toContain(`(todo:${todoId})`);
    // chief 步入队（kind chief，buildId = conv id = thread id，无 build 行）。
    const steps = s.db.select().from(stepTable).where(eq(stepTable.buildId, body.thread.id)).all();
    expect(steps).toHaveLength(1);
    expect(steps[0]!.kind).toBe('chief');
    expect(steps[0]!.status).toBe('pending');
    // 任务本体零改动：不建 build、相位不动（编排期间卡留待开始，r14 §5.1
    // 不加「编排中」相位）。
    const builds = s.db.select().from(buildTable).all();
    expect(builds).toHaveLength(0);
    const row = s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get();
    expect(row?.phase).toBe('todo');
  });

  test('D2 bug 标签 issue → 编排消息先要求 verify-cairn 复现', async () => {
    const tagId = 'tag-bug-repro';
    s.db
      .insert(tagTable)
      .values({
        id: tagId,
        projectId,
        name: 'bug',
        color: '#b60205',
        createdAt: nowMs(),
        v: 1,
      })
      .run();
    const res = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, {
      title: '保存时报错',
      spec: '打开设置页，点击保存后报错',
      tagIds: [tagId],
    });
    expect(res.status).toBe(201);
    const todoId = ((await res.json()) as { id: string }).id;
    s.db
      .update(todoTable)
      .set({
        sourceKind: 'github-issue',
        sourceRef: 'github:octo/alpha#8',
      })
      .where(eq(todoTable.id, todoId))
      .run();
    const orchestrated = await req(s.app, 'POST', `/api/todos/${todoId}/orchestrate`);
    expect(orchestrated.status).toBe(201);
    const body = (await orchestrated.json()) as { message: { content: string } };
    expect(body.message.content).toContain('先完成复现步骤，再开始实现');
    expect(body.message.content).toContain('verify-cairn');
  });

  test('D3 failed 相位 → 201，消息带重编排上下文', async () => {
    const todoId = await makeTodo();
    s.db.update(todoTable).set({ phase: 'failed' }).where(eq(todoTable.id, todoId)).run();
    const res = await req(s.app, 'POST', `/api/todos/${todoId}/orchestrate`);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { message: { content: string } };
    expect(body.message.content).toContain('上一轮执行失败');
  });

  test('D3 运行中/已完成相位 → 409（相位闸）', async () => {
    const todoId = await makeTodo();
    s.db.update(todoTable).set({ phase: 'building' }).where(eq(todoTable.id, todoId)).run();
    expect((await req(s.app, 'POST', `/api/todos/${todoId}/orchestrate`)).status).toBe(409);
    s.db.update(todoTable).set({ phase: 'done' }).where(eq(todoTable.id, todoId)).run();
    expect((await req(s.app, 'POST', `/api/todos/${todoId}/orchestrate`)).status).toBe(409);
  });

  test('D4 总管未绑定 Agent → 409（门控条 canon，不静默）', async () => {
    const todoId = await makeTodo();
    s.db.update(chiefTable).set({ agentId: null }).where(eq(chiefTable.id, chiefId)).run();
    const res = await req(s.app, 'POST', `/api/todos/${todoId}/orchestrate`);
    expect(res.status).toBe(409);
  });
});

describe('B prompt 面：编排回合拆分纪律（r14 §5.2 护栏进 system prompt）', () => {
  test('B1 system prompt 含粒度=核销次数 / spec 内嵌原文片段 / 单任务直派 / 拆分关原卡', () => {
    const prompt = composeChiefSystemPrompt(
      { db: s.db, hub: s.hub, machineHub: s.machineHub, user: s.user, skillsDir: s.skillsDir },
      teamId,
    );
    expect(prompt).toContain('拆分粒度 = 核销次数');
    expect(prompt).toContain('可独立验收');
    expect(prompt).toContain('原文片段');
    expect(prompt).toContain('兄弟任务');
    expect(prompt).toContain('close_todos');
    // #903（ADR 0014）：派发判定 = chief 逐次判断——静态章程 prose
    // （判断纪律 + 可判信号），不再写死 withPlan:false 直执行指令。
    expect(prompt).toContain('当信息会实质改变结果、执行方式、权限或安全时才问');
    expect(prompt).toContain('判不准 → 先规划');
    expect(prompt).not.toContain('withPlan:false');
  });
});
