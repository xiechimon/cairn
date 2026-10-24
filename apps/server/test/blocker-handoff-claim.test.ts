import type { ClaimedStep } from '@cairn/shared';
import {
  BLOCKER_HANDOFF_SUMMARY_MAX_CHARS,
  blockerHandoffSchema,
  claimedStepSchema,
  conversationBranch,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  message as messageTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import type { FetchLike } from '../src/lib/github.js';
import { bindAllAgents, bootServer, issueApiKey, req, type TestServer } from './helpers.js';

const AGENT_ID = 'agent-bh-1';
const HEAD_B = 'b'.repeat(40);

const disposables: (() => void)[] = [];
afterAll(() => {
  for (const dispose of disposables) dispose();
});

interface PullFixture {
  state: 'open' | 'closed';
  merged: boolean;
  title: string;
}

function githubMock(pulls: Record<number, PullFixture | 'missing'>): {
  fetch: FetchLike;
  requests: string[];
} {
  const requests: string[] = [];
  return {
    requests,
    fetch: (input) => {
      const url = String(input);
      requests.push(url);
      const number = Number(/\/pulls\/(\d+)$/.exec(url)?.[1]);
      const pull = pulls[number];
      const found = pull !== undefined && pull !== 'missing';
      return Promise.resolve({
        ok: found,
        status: found ? 200 : 404,
        headers: { get: () => null },
        json: () => Promise.resolve(found ? pull : {}),
        text: () => Promise.resolve(''),
      });
    },
  };
}

interface World {
  s: TestServer;
  token: string;
  projectId: string;
  mock: ReturnType<typeof githubMock>;
}

async function setupWorld(
  opts: { github: boolean; pulls?: Record<number, PullFixture | 'missing'> } = { github: true },
): Promise<World> {
  const mock = githubMock(opts.pulls ?? {});
  const s = bootServer({ claimHoldMs: 200, githubFetch: mock.fetch });
  disposables.push(() => s.dispose());
  const key = await issueApiKey(s);
  const enroll = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: s.team.id, name: 'bh-mbp', cliVersion: '0.1.0' }),
  });
  const token = ((await enroll.json()) as { token: string }).token;
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: AGENT_ID,
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
  bindAllAgents(s);
  const project = await req(
    s.app,
    'POST',
    '/api/projects',
    opts.github ? { name: 'bh', kind: 'github', githubRepo: 'octo/alpha' } : { name: 'bh' },
  );
  expect(project.status).toBe(201);
  const projectId = ((await project.json()) as { id: string }).id;
  return { s, token, projectId, mock };
}

async function createTodo(w: World, title: string): Promise<string> {
  const res = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/todos`, {
    title,
    spec: `${title} 的 spec`,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

interface DoneBlocker {
  title: string;
  pr?: { number: number; url: string };
  files?: string[];
  head?: string;
  messages?: { role: 'assistant' | 'user'; content: unknown }[];
}

async function seedDoneBlocker(w: World, spec: DoneBlocker): Promise<string> {
  const todoId = await createTodo(w, spec.title);
  const buildId = `build-${todoId}`;
  const now = Date.now();
  w.s.db
    .insert(buildTable)
    .values({
      id: buildId,
      todoId,
      withPlan: false,
      triggerSource: 'user',
      prNumber: spec.pr?.number ?? null,
      prUrl: spec.pr?.url ?? null,
      changes: (spec.files ?? []).map((path) => ({ path, additions: 1, deletions: 0, hunks: [] })),
      createdAt: now,
    })
    .run();
  w.s.db
    .insert(stepTable)
    .values({
      id: `step-${todoId}`,
      buildId,
      kind: 'build',
      status: 'done',
      checkpointCommit: spec.head ?? null,
      createdAt: now,
    })
    .run();
  (spec.messages ?? []).forEach((m, i) => {
    w.s.db
      .insert(messageTable)
      .values({
        id: `msg-${todoId}-${i}`,
        conversationId: buildId,
        role: m.role,
        content: m.content,
        createdAt: now + i,
      })
      .run();
  });
  w.s.db
    .update(todoTable)
    .set({ phase: 'done', latestBuildId: buildId })
    .where(eq(todoTable.id, todoId))
    .run();
  return todoId;
}

async function startChild(
  w: World,
  title: string,
  blockedBy: string[],
  withPlan = false,
): Promise<string> {
  const id = await createTodo(w, title);
  if (blockedBy.length > 0) {
    w.s.db.update(todoTable).set({ blockedBy }).where(eq(todoTable.id, id)).run();
  }
  const res = await req(w.s.app, 'POST', `/api/projects/${w.projectId}/builds`, {
    todoIds: [id],
    assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
    withPlan,
  });
  expect(res.status).toBe(201);
  return id;
}

async function claim(w: World): Promise<ClaimedStep> {
  const res = await w.s.app.request('/api/machine/tasks/claim', {
    method: 'POST',
    headers: { authorization: `Bearer ${w.token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  const body = (await res.json()) as { step: ClaimedStep | null };
  if (body.step === null) throw new Error('claim returned no step');
  return claimedStepSchema.parse(body.step);
}

const text = (value: string) => [{ type: 'text', text: value }];
const toolOnly = [{ type: 'toolCall', id: 'c1', name: 'bash', arguments: { command: 'ls' } }];

describe('#1624 子卡 claim 带前置卡交付', () => {
  test('S1 两张前置卡：载荷按 blockedBy 顺序带两条，字段取自真值', async () => {
    const w = await setupWorld({
      github: true,
      pulls: { 41: { state: 'closed', merged: true, title: 'feat: login api' } },
    });
    const a = await seedDoneBlocker(w, {
      title: '加登录接口',
      pr: { number: 41, url: 'https://github.com/octo/alpha/pull/41' },
      files: ['src/login.ts', 'test/login.test.ts'],
      messages: [{ role: 'assistant', content: text('已实现 POST /login。') }],
    });
    const b = await seedDoneBlocker(w, {
      title: '加会话存储',
      files: ['src/session.ts'],
      head: HEAD_B,
      messages: [{ role: 'assistant', content: text('会话落盘完成。') }],
    });
    await startChild(w, '接线', [b, a]);
    const got = await claim(w);
    const handoff = got.todo?.blockerHandoff;
    expect(handoff?.blockers.map((e) => e.title)).toEqual(['加会话存储', '加登录接口']);
    expect(handoff?.blockers[1]).toEqual({
      todoId: a,
      title: '加登录接口',
      phase: 'done',
      delivery: {
        kind: 'pr',
        number: 41,
        url: 'https://github.com/octo/alpha/pull/41',
        title: 'feat: login api',
      },
      changedFiles: ['src/login.ts', 'test/login.test.ts'],
      omittedFiles: 0,
      summary: '已实现 POST /login。',
    });
    expect(handoff?.blockers[0]).toMatchObject({
      todoId: b,
      delivery: { kind: 'branch', branch: conversationBranch(`build-${b}`), head: HEAD_B },
      changedFiles: ['src/session.ts'],
      summary: '会话落盘完成。',
    });
  });

  test('S2 无前置的子卡：载荷无该字段，step 行为 null', async () => {
    const w = await setupWorld();
    await startChild(w, '独立卡', []);
    const got = await claim(w);
    expect(got.todo?.blockerHandoff).toBeUndefined();
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, got.step.id)).get();
    expect(row?.blockerHandoff).toBeNull();
    expect(w.mock.requests).toEqual([]);
  });

  test('S3 step 行与载荷同形，steps REST 透出', async () => {
    const w = await setupWorld({
      github: true,
      pulls: { 7: { state: 'closed', merged: true, title: 'PR seven' } },
    });
    const a = await seedDoneBlocker(w, {
      title: '前置',
      pr: { number: 7, url: 'https://github.com/octo/alpha/pull/7' },
      messages: [{ role: 'assistant', content: text('done') }],
    });
    await startChild(w, '后置', [a]);
    const got = await claim(w);
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, got.step.id)).get();
    expect(blockerHandoffSchema.parse(row?.blockerHandoff)).toEqual(got.todo?.blockerHandoff);
    const rest = await req(w.s.app, 'GET', `/api/builds/${got.step.buildId}/steps`);
    const steps = (await rest.json()) as { id: string; blockerHandoff?: unknown }[];
    expect(steps.find((st) => st.id === got.step.id)?.blockerHandoff).toEqual(
      got.todo?.blockerHandoff,
    );
  });

  test('S4 PR 标题读不到：标题为空，claim 照常成功', async () => {
    const w = await setupWorld({ github: true, pulls: { 9: 'missing' } });
    const a = await seedDoneBlocker(w, {
      title: '前置',
      pr: { number: 9, url: 'https://github.com/octo/alpha/pull/9' },
    });
    await startChild(w, '后置', [a]);
    const got = await claim(w);
    expect(got.todo?.blockerHandoff?.blockers[0]?.delivery).toEqual({
      kind: 'pr',
      number: 9,
      url: 'https://github.com/octo/alpha/pull/9',
      title: null,
    });
  });

  test('S5 总结取最后一条带文字的 assistant 行，跳过工具行与用户行', async () => {
    const w = await setupWorld({ github: false });
    const a = await seedDoneBlocker(w, {
      title: '前置',
      head: HEAD_B,
      messages: [
        { role: 'assistant', content: text('第一段') },
        { role: 'assistant', content: text('最终总结') },
        { role: 'assistant', content: toolOnly },
        { role: 'user', content: '用户追问' },
      ],
    });
    await startChild(w, '后置', [a]);
    const got = await claim(w);
    expect(got.todo?.blockerHandoff?.blockers[0]?.summary).toBe('最终总结');
  });

  test('S6 超长总结在 server 侧截断；文件清单超上限计数', async () => {
    const w = await setupWorld({ github: false });
    const a = await seedDoneBlocker(w, {
      title: '前置',
      head: HEAD_B,
      files: Array.from({ length: 45 }, (_, i) => `src/f${i}.ts`),
      messages: [
        {
          role: 'assistant',
          content: text('长'.repeat(BLOCKER_HANDOFF_SUMMARY_MAX_CHARS + 800)),
        },
      ],
    });
    await startChild(w, '后置', [a]);
    const entry = (await claim(w)).todo?.blockerHandoff?.blockers[0];
    expect(entry?.summary?.endsWith('（已截断）')).toBe(true);
    expect(Array.from(entry?.summary ?? '').length).toBeLessThan(
      BLOCKER_HANDOFF_SUMMARY_MAX_CHARS + 20,
    );
    expect(entry?.changedFiles).toHaveLength(30);
    expect(entry?.omittedFiles).toBe(15);
  });

  test('S7 非 github 形态：分支与 head，零 GitHub 出站', async () => {
    const w = await setupWorld({ github: false });
    const a = await seedDoneBlocker(w, {
      title: '前置',
      head: HEAD_B,
      pr: { number: 3, url: 'https://github.com/octo/alpha/pull/3' },
    });
    await startChild(w, '后置', [a]);
    const entry = (await claim(w)).todo?.blockerHandoff?.blockers[0];
    expect(entry?.delivery).toEqual({
      kind: 'branch',
      branch: conversationBranch(`build-${a}`),
      head: HEAD_B,
    });
    expect(w.mock.requests).toEqual([]);
  });

  test('S8 先规划的子卡：plan 步同样带交付节', async () => {
    const w = await setupWorld({ github: false });
    const a = await seedDoneBlocker(w, { title: '前置', head: HEAD_B });
    await startChild(w, '后置', [a], true);
    const got = await claim(w);
    expect(got.step.kind).toBe('plan');
    expect(got.todo?.blockerHandoff?.blockers).toHaveLength(1);
  });

  test('S9 续接会话的步照样带：会话丢失降级为新会话时 daemon 要靠它重组首轮 prompt', async () => {
    const w = await setupWorld({ github: false });
    const a = await seedDoneBlocker(w, { title: '前置', head: HEAD_B });
    const childId = await startChild(w, '后置', [a]);
    const childBuild = w.s.db
      .select()
      .from(todoTable)
      .where(eq(todoTable.id, childId))
      .get()?.latestBuildId;
    w.s.db
      .insert(stepTable)
      .values({
        id: 'step-earlier',
        buildId: childBuild!,
        kind: 'plan',
        status: 'done',
        sessionId: 'pi-sess-earlier',
        createdAt: 1,
      })
      .run();
    const got = await claim(w);
    expect(got.session.action).toBe('continue');
    expect(got.todo?.blockerHandoff?.blockers).toHaveLength(1);
  });

  test('S10 同一 build 的后续步复用首次 claim 的快照：不再出站，记录不漂移', async () => {
    const w = await setupWorld({
      github: true,
      pulls: { 5: { state: 'closed', merged: true, title: 'live title' } },
    });
    const a = await seedDoneBlocker(w, {
      title: '前置',
      pr: { number: 5, url: 'https://github.com/octo/alpha/pull/5' },
    });
    const childId = await startChild(w, '后置', [a]);
    const childBuild = w.s.db
      .select()
      .from(todoTable)
      .where(eq(todoTable.id, childId))
      .get()?.latestBuildId;
    const snapshot = {
      blockers: [
        {
          todoId: a,
          title: '首次快照',
          phase: 'done' as const,
          delivery: null,
          changedFiles: [],
          omittedFiles: 0,
          summary: null,
        },
      ],
    };
    w.s.db
      .insert(stepTable)
      .values({
        id: 'step-first',
        buildId: childBuild!,
        kind: 'plan',
        status: 'done',
        blockerHandoff: snapshot,
        createdAt: 1,
      })
      .run();
    const got = await claim(w);
    expect(got.todo?.blockerHandoff).toEqual(snapshot);
    expect(w.mock.requests).toEqual([]);
  });

  test('S11 review / verify / merge 步不带', async () => {
    const w = await setupWorld({ github: false });
    const a = await seedDoneBlocker(w, { title: '前置', head: HEAD_B });
    const childId = await startChild(w, '后置', [a]);
    w.s.db
      .update(stepTable)
      .set({ kind: 'merge' })
      .where(
        eq(
          stepTable.buildId,
          w.s.db.select().from(todoTable).where(eq(todoTable.id, childId)).get()!.latestBuildId!,
        ),
      )
      .run();
    const got = await claim(w);
    expect(got.step.kind).toBe('merge');
    expect(got.todo?.blockerHandoff).toBeUndefined();
  });
});
