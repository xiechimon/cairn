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

describe('#1624 child-card claim carries blocker-card deliveries', () => {
  test('S1 two blocking cards: payload carries two entries in blockedBy order, fields from the source of truth', async () => {
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

  test('S2 child card with no blockers: payload has no such field, step rows are null', async () => {
    const w = await setupWorld();
    await startChild(w, '独立卡', []);
    const got = await claim(w);
    expect(got.todo?.blockerHandoff).toBeUndefined();
    const row = w.s.db.select().from(stepTable).where(eq(stepTable.id, got.step.id)).get();
    expect(row?.blockerHandoff).toBeNull();
    expect(w.mock.requests).toEqual([]);
  });

  test('S3 step rows match the payload shape, exposed through steps REST', async () => {
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

  test('S4 PR title unreadable: title empty, claim still succeeds', async () => {
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

  test('S5 summary takes the last assistant line with text, skipping tool lines and user lines', async () => {
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

  test('S6 over-long summary truncated on the server side; file list counted against the cap', async () => {
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

  test('S7 non-github shape: branch and head, zero GitHub outbound', async () => {
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

  test('S8 child card planned first: plan step also carries the delivery section', async () => {
    const w = await setupWorld({ github: false });
    const a = await seedDoneBlocker(w, { title: '前置', head: HEAD_B });
    await startChild(w, '后置', [a], true);
    const got = await claim(w);
    expect(got.step.kind).toBe('plan');
    expect(got.todo?.blockerHandoff?.blockers).toHaveLength(1);
  });

  test('S9 steps on a resumed session still carry it: when the session is lost and downgraded to a fresh session the daemon needs it to reassemble the first-round prompt', async () => {
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

  test('S10 later steps of the same build reuse the first claim snapshot: no more outbound, records do not drift', async () => {
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

  test('S11 review / verify / merge steps do not carry it', async () => {
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
