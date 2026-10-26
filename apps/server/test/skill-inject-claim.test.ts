import { mkdirSync, rmSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';
import type { ClaimedStep } from '@cairn/shared';
import { claimedStepSchema } from '@cairn/shared';
import { eq } from 'drizzle-orm';
import { afterAll, describe, expect, test } from 'vitest';
import { makeTestTempDir } from '../../../scripts/test-tmpdir.mjs';
import { agent as agentTable, chief as chiefTable, step as stepTable } from '../src/db/schema.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  postProject,
  req,
  type TestServer,
} from './helpers.js';

const AGENT_ID = 'agent-si-1';
const CHIEF_AGENT_ID = 'agent-si-chief';

const roots: string[] = [];
function makeRoot(): string {
  const root = makeTestTempDir('cairn-si-skills-');
  roots.push(root);
  return root;
}
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function addSkill(root: string, id: string, description: string): void {
  const dir = join(root, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${id}\ndescription: ${description}\n---\n# ${id}\n步骤…\n`,
  );
}

const SKILLS: readonly (readonly [string, string])[] = [
  ['tdd', 'Test-driven development: red-green-refactor, integration tests'],
  ['better-typography', '产品 UI 排版工程：字号阶梯、字距、换行与截断'],
  ['better-colors', '颜色系统：ramp 生成、语义 token、对比度实测'],
  ['better-layout', '布局工艺：分组、对齐、阅读顺序、渐进披露'],
  ['diagnosing-bugs', 'Diagnosis loop for hard bugs and regressions'],
  ['ask-matt', 'Ask which skill or flow fits your situation'],
  ['great-resume', '中文求职经历提升：岗位定位、简历要点、HR 开场白'],
  ['offer', '中文秋招求职进度管理：投递、筛选、面试进度表'],
  ['kami', '用 Kami 模板排版专业文档：简历、白皮书、信函，产出 PDF'],
  ['interview', '中文简历驱动的面试预测、模拟追问和复练技能'],
  ['wiki', '个人知识沉淀库：存进 wiki、处理 inbox、体检 wiki'],
  ['aihot', '查 AIHOT 中文 AI 资讯、热点、日报'],
  ['archify', '出架构/流程/时序/数据流/状态图，独立 HTML'],
  ['job-apply', '中文求职申请自动填写：读取简历逐项填写招聘网站'],
  ['job-match', '中文岗位匹配分析：JD 对比简历、投递建议'],
  ['evidence-recap', '把 AI 编程对话复盘为九段证据链'],
  ['project-guide', '中文项目导学、源码课程与项目面经'],
  ['writing-dna-skill', '从完整文章蒸馏可复用写作 DNA'],
  ['humanizer-zh', '编辑中文文章的空话与模板化表达'],
  ['make-resume', '中文可编辑简历制作：ASu 模板 HTML/PDF'],
  ['scaffold-exercises', '生成课程练习目录结构并通过 lint'],
];

const GRANTED = SKILLS.map(([id]) => id);
const IRRELEVANT = [
  'great-resume',
  'offer',
  'interview',
  'job-apply',
  'job-match',
  'make-resume',
  'wiki',
  'aihot',
  'project-guide',
  'evidence-recap',
  'writing-dna-skill',
  'humanizer-zh',
] as const;

interface World {
  s: TestServer;
  token: string;
  projectId: string;
}

async function setupWorld(): Promise<World> {
  const root = makeRoot();
  for (const [id, description] of SKILLS) addSkill(root, id, description);
  const s = bootServer({ claimHoldMs: 200, skillsDir: root });
  const key = await issueApiKey(s);
  const res = await s.app.request('/api/machine/enroll', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ teamId: s.team.id, name: 'si-mbp', cliVersion: '0.1.0' }),
  });
  expect(res.status).toBe(200);
  const token = ((await res.json()) as { token: string }).token;
  for (const id of [AGENT_ID, CHIEF_AGENT_ID]) {
    s.db
      .insert(agentTable)
      .values({
        id,
        teamId: s.team.id,
        displayName: id,
        status: 'active',
        avatarUrl: null,
        provider: 'stub-gw',
        modelId: 'stub-model',
        thinkingLevel: null,
        tools: [],
        secrets: [],
        defaultSkill: null,
        skillsAllowlist: id === AGENT_ID ? [...GRANTED] : null,
        mcpServers: [],
      })
      .run();
    bindAllAgents(s);
  }
  const projectId = await postProject(s.app, 'si-proj');
  return { s, token, projectId };
}

async function claim(app: TestServer['app'], token: string): Promise<ClaimedStep | null> {
  const res = await app.request('/api/machine/tasks/claim', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: '{}',
  });
  const body = (await res.json()) as { step: ClaimedStep | null };
  return body.step === null ? null : claimedStepSchema.parse(body.step);
}

async function createTodo(s: TestServer, projectId: string, spec: string): Promise<string> {
  const res = await req(s.app, 'POST', `/api/projects/${projectId}/todos`, { title: '', spec });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

async function startBuild(s: TestServer, projectId: string, todoId: string): Promise<string> {
  const res = await req(s.app, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [todoId],
    assignment: { plan: null, build: { agentId: AGENT_ID } },
    withPlan: false,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id as string;
}

function stepRow(s: TestServer, stepId: string) {
  return s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
}

type StepsRestRow = {
  id: string;
  skillInjection: { hits: { id: string; rule: string; reason: string }[] } | null;
};

async function stepsRest(s: TestServer, buildId: string): Promise<StepsRestRow[]> {
  const res = await req(s.app, 'GET', `/api/builds/${buildId}/steps`);
  expect(res.status).toBe(200);
  return (await res.json()) as StepsRestRow[];
}

describe('#1106 dispatch skill injection (worker claim selection)', () => {
  test('failure modes 1+4: an explicit-domain task -> the payload carries only the selected ids; the step row = the selection record with reasons, exposed via the steps REST', async () => {
    const w = await setupWorld();
    const todoId = await createTodo(w.s, w.projectId, '修复看板卡片的字号过小与换行溢出');
    const buildId = await startBuild(w.s, w.projectId, todoId);
    const got = await claim(w.s.app, w.token);
    expect(got).not.toBeNull();
    expect(got?.step.kind).toBe('build');
    expect(got?.agent?.skillsAllowlist).toEqual(GRANTED);
    const injected = got?.agent?.injectedSkills ?? [];
    expect(injected.length).toBeGreaterThan(0);
    expect(injected.every((id) => GRANTED.includes(id))).toBe(true);
    for (const id of IRRELEVANT) expect(injected).not.toContain(id);
    const row = stepRow(w.s, got!.step.id);
    expect(row.skillInjection?.hits.map((h) => h.id)).toEqual(injected);
    for (const hit of row.skillInjection?.hits ?? []) {
      expect(['explicit-mention', 'domain']).toContain(hit.rule);
      expect(hit.reason.length).toBeGreaterThan(0);
    }
    const rest = await stepsRest(w.s, buildId);
    const restStep = rest.find((st) => st.id === got!.step.id);
    expect(restStep?.skillInjection?.hits.map((h) => h.id)).toEqual(injected);
    expect(restStep?.skillInjection?.hits.length).toBe(injected.length);
  });

  test('failure mode 2: a zero-hit task -> normal dispatch: claim succeeds + injectedSkills=[] + hits=[] (zero injection is not a failure)', async () => {
    const w = await setupWorld();
    const todoId = await createTodo(w.s, w.projectId, '把首页轮播图换成静态图');
    const buildId = await startBuild(w.s, w.projectId, todoId);
    expect(buildId).toBeTruthy();
    const got = await claim(w.s.app, w.token);
    expect(got?.step.kind).toBe('build');
    expect(got?.agent?.injectedSkills).toEqual([]);
    expect(got?.agent?.skillsAllowlist).toEqual(GRANTED);
    expect(stepRow(w.s, got!.step.id).skillInjection).toEqual({ hits: [] });
  });

  test('failure mode 3: the task text names an ungranted skill -> not selected (grants bound the candidates, nothing invented)', async () => {
    const w = await setupWorld();
    w.s.db
      .update(agentTable)
      .set({ skillsAllowlist: GRANTED.filter((id) => id !== 'tdd') })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const todoId = await createTodo(w.s, w.projectId, '用 tdd 给购物车模块补测试');
    await startBuild(w.s, w.projectId, todoId);
    const got = await claim(w.s.app, w.token);
    expect(got?.agent?.injectedSkills).toEqual([]);
    expect(got?.agent?.skillsAllowlist).not.toContain('tdd');
  });

  test('failure mode 8 (#1169): skillsAllowlist=null (unrestricted) -> the candidate base = the full scan (no longer zero candidates)', async () => {
    const w = await setupWorld();
    w.s.db
      .update(agentTable)
      .set({ skillsAllowlist: null })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const todoId = await createTodo(w.s, w.projectId, '用 tdd 给购物车模块补测试');
    await startBuild(w.s, w.projectId, todoId);
    const got = await claim(w.s.app, w.token);
    expect(got?.agent?.skillsAllowlist).toBeNull();
    expect(got?.agent?.injectedSkills).toContain('tdd');
    const hits = stepRow(w.s, got!.step.id).skillInjection?.hits ?? [];
    expect(hits.map((h) => h.id)).toContain('tdd');
  });

  test('failure mode 7: granted but not scanned by the server (a daemon-local skill) -> still selected by name (candidate base = the granted set)', async () => {
    const w = await setupWorld();
    w.s.db
      .update(agentTable)
      .set({ skillsAllowlist: [...GRANTED, 'local-one'] })
      .where(eq(agentTable.id, AGENT_ID))
      .run();
    const todoId = await createTodo(w.s, w.projectId, '用 local-one 处理本地构建');
    const buildId = await startBuild(w.s, w.projectId, todoId);
    expect(buildId).toBeTruthy();
    const got = await claim(w.s.app, w.token);
    expect(got?.agent?.injectedSkills).toEqual(['local-one']);
    const hits = stepRow(w.s, got!.step.id).skillInjection?.hits ?? [];
    expect(hits.map((h) => h.id)).toEqual(['local-one']);
    expect(hits[0]?.rule).toBe('explicit-mention');
  });
});

describe('#1106 chief steps bypass the selection surface (a live claim)', () => {
  test('failure mode 5: the chief claim payload has no injectedSkills; the chief step row has skillInjection null', async () => {
    const w = await setupWorld();
    const chiefId = `chief-${w.s.user.id}-${w.s.team.id}`;
    w.s.db
      .insert(chiefTable)
      .values({
        id: chiefId,
        userId: w.s.user.id,
        teamId: w.s.team.id,
        agentId: CHIEF_AGENT_ID,
        charter: '',
        createdAt: Date.now(),
      })
      .run();
    const todoId = await createTodo(w.s, w.projectId, '总管编排一轮');
    const orch = await req(w.s.app, 'POST', `/api/todos/${todoId}/orchestrate`, {});
    expect(orch.status).toBe(201);
    const body = (await orch.json()) as { thread: { id: string } };
    const got = await claim(w.s.app, w.token);
    expect(got?.step.kind).toBe('chief');
    expect(got?.agent?.injectedSkills).toBeUndefined();
    expect(got?.agent?.skillsAllowlist).toBeUndefined();
    expect(got?.agent?.defaultSkill).toBeUndefined();
    const row = stepRow(w.s, got!.step.id);
    expect(row.skillInjection).toBeNull();
    expect(row.buildId).toBe(body.thread.id);
  });
});

describe('#1106 the wire gains only an optional field (zero additions to the version wall)', () => {
  test('failure mode 6: the old-shape agent block without injectedSkills still passes claimedStepSchema', () => {
    const legacyAgent = {
      id: 'a',
      displayName: 'a',
      description: null,
      provider: null,
      modelId: 'm',
      thinkingLevel: null,
    };
    expect(() =>
      claimedStepSchema.parse({
        step: { id: 's', buildId: 'b', kind: 'build', machineId: null, createdAt: 1 },
        conversationId: 'b',
        session: { action: 'new', sessionId: null },
        agent: legacyAgent,
      }),
    ).not.toThrow();
    expect(() =>
      claimedStepSchema.parse({
        step: { id: 's', buildId: 'b', kind: 'build', machineId: null, createdAt: 1 },
        conversationId: 'b',
        session: { action: 'new', sessionId: null },
        agent: { ...legacyAgent, injectedSkills: [] },
      }),
    ).not.toThrow();
  });
});
