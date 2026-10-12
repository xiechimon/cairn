// AI 审核发起 + 收尾写面（M7 #312 + #330，r8 §3.1）：
// POST /api/builds/{id}/steps {action:"review", agentId, focus?} = 入队审核步
// （kind:review）+ 时间线插 REVIEW_ANNOUNCEMENT + phase 留 confirm/review。
// 收尾（#330，r8 §3.1 真 findings 上线）：done(success, findings) → emit
// REVIEW_VERDICT_KIND 消息（conclusion + 编号 findings）+ 若 blocking → phase
// 转 planning + enqueue plan 重规划步（自动修订回路，r8 §3.1 实测 62）。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. confirm/review 之外相位 → 409 不静默（沿用 chief 门规则）
//   2. 缺 agentId → 400 (zod body schema)；空 focus 允许（可选）
//   3. happy path：审核步 kind:review + REVIEW_ANNOUNCEMENT message +
//      phase 不变 + prompt 含 JSON meta header（agentId 透出 claim 载荷）
//   4. claim review 步载荷 agent = 模态选定的 reviewer（不是 assignment.build 槽）
//   5. 终态闭环（无 blocking）：done(success, 空 verdict) → REVIEW_VERDICT_KIND
//      message 落地 + phase 不动
//   6. 终态闭环（blocking）：done(success, 含 blocking verdict) → REVIEW_VERDICT_KIND
//      消息 + phase 转 planning + 重规划步入队 + 新 plan prompt 注入 blocking 事实
//   7. 终态闭环（daemon 未传 findings）→ verdict 兜底 message 落地 + 不触发修订
//   8. 终态闭环（#700 daemon 报提取失败 findingsError）→ verdict 兜底 message
//      conclusion「判定提取失败」+ extractionError 原因上浮 + 不触发修订——
//      与 7 的「审核未返回结论」（旧 daemon 无信号）分开报，提取失败不再
//      冒充审核没结论。

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  claimedStepSchema,
  conversationBranch,
  MERGE_ANNOUNCEMENT,
  parseReviewPromptMeta,
  REVIEW_ANNOUNCEMENT,
  REVIEW_VERDICT_KIND,
  reviewVerdictSchema,
} from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  message as messageTable,
  plan as planTable,
  project as projectTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { runGit } from '../src/lib/git.js';
import type { TestServer } from './helpers.js';
import { bindAllAgents, bootServer, issueApiKey, postProject, req } from './helpers.js';

const AGENT_ID = 'agent-review-1';
const REVIEW_AGENT_ID = 'agent-reviewer-1';
/** #509 探针：与产出槽 AGENT_ID（provider 'stub-gw'）不同厂商的审核候选。 */
const CROSS_VENDOR_AGENT_ID = 'agent-rival-1';
const PLAN_FILE_NAME = 'plan.md';

/** 播种用 git 提交身份（与 build-diff-fulltext 同款；宿主 git 无全局身份时
 * commit 会因 user.email 缺位失败）。 */
const GIT_ENV = {
  GIT_AUTHOR_NAME: 'review-probe',
  GIT_AUTHOR_EMAIL: 'probe@localhost',
  GIT_COMMITTER_NAME: 'review-probe',
  GIT_COMMITTER_EMAIL: 'probe@localhost',
};

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

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

interface World {
  s: TestServer;
  todoId: string;
  projectId: string;
  /** #511：往托管 bare repo 的会话分支推一次真实改动（变更面数据源）。 */
  seedConvChanges(buildId: string, files: Record<string, string>): Promise<void>;
  machineToken: string;
  startBuild(withPlan?: boolean): Promise<string>;
  claim(): Promise<{ stepId: string; kind: string }>;
  done(stepId: string, body: Record<string, unknown>): Promise<void>;
  uploadPlan(stepId: string, content: string): Promise<void>;
  confirm(buildId: string): Promise<void>;
  startReview(buildId: string, body?: { agentId: string; focus?: string }): Promise<Response>;
  todoRow(): ReturnType<typeof loadTodoRow>;
  buildRow(buildId: string): ReturnType<typeof loadBuildRow>;
  stepsOf(buildId: string): ReturnType<typeof loadStepsOf>;
  messagesOf(buildId: string): ReturnType<typeof loadMessagesOf>;
  planContent(buildId: string): ReturnType<typeof loadPlanContent>;
}

function loadTodoRow(s: TestServer, todoId: string) {
  return s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
}
function loadBuildRow(s: TestServer, buildId: string) {
  return s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
}
function loadStepsOf(s: TestServer, buildId: string) {
  return s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
}
function loadMessagesOf(s: TestServer, buildId: string) {
  return s.db.select().from(messageTable).where(eq(messageTable.conversationId, buildId)).all();
}
function loadPlanContent(s: TestServer, buildId: string) {
  return s.db.select().from(planTable).where(eq(planTable.buildId, buildId)).all();
}

async function setupWorld(opts: { hosted?: boolean } = {}): Promise<World> {
  const s = bootServer({ claimHoldMs: 200, pingIntervalMs: 3_600_000 });
  const key = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-review',
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
  // 双 agent：plan/build 用 stub-builder；review agent 是被评审方。
  s.db
    .insert(agentTable)
    .values({
      id: AGENT_ID,
      teamId: s.team.id,
      displayName: 'stub-builder',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();

  s.db
    .insert(agentTable)
    .values({
      id: REVIEW_AGENT_ID,
      teamId: s.team.id,
      displayName: 'stub-reviewer',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'review-mbp', cliVersion: '0.1.0' },
  });

  bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）
  expect(enrollRes.status).toBe(200);
  const { token: machineToken } = (await enrollRes.json()) as { token: string; machineId: string };
  // #511：托管形态项目 —— 变更面数据源（readBuildChanges 仅托管形态有本地
  // bare 读面）与「只读检出」判据都要真实 repo 绑定。
  let projectId: string;
  if (opts.hosted) {
    const hostedRes = await call(s.app, 'POST', '/api/projects', {
      body: { name: 'review-hosted', repoKind: 'hosted' },
    });
    expect(hostedRes.status).toBe(201);
    projectId = ((await hostedRes.json()) as { id: string }).id;
  } else {
    projectId = await postProject(s.app);
  }
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '审核探针', spec: '实现一段示例代码供审核' },
  });
  const { id: todoId } = (await todoRes.json()) as { id: string };

  async function startBuild(withPlan = true): Promise<string> {
    const res = await call(s.app, 'POST', `/api/projects/${projectId}/builds`, {
      body: {
        todoIds: [todoId],
        assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
        withPlan,
      },
    });
    expect(res.status).toBe(201);
    return ((await res.json()) as { builds: { id: string }[] }).builds[0]!.id;
  }
  async function claim() {
    const res = await call(s.app, 'POST', '/api/machine/tasks/claim', {
      cred: machineToken,
      body: {},
    });
    const body = (await res.json()) as { step: unknown };
    if (!body.step) throw new Error('claim returned no step');
    const parsed = claimedStepSchema.parse(body.step);
    return { stepId: parsed.step.id, kind: parsed.step.kind };
  }
  async function done(stepId: string, body: Record<string, unknown>): Promise<void> {
    const res = await call(s.app, 'POST', `/api/machine/done/${stepId}`, {
      cred: machineToken,
      body,
    });
    expect(res.status).toBe(200);
  }
  async function uploadPlan(stepId: string, content: string): Promise<void> {
    const urlsRes = await call(s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
      cred: machineToken,
      body: { files: [{ name: PLAN_FILE_NAME }] },
    });
    const urls = (await urlsRes.json()) as { uploads: { url: string }[] };
    const up = urls.uploads[0]!;
    const put = await call(s.app, 'PUT', up.url.replace(/^https?:\/\/[^/]+/, ''), {
      cred: machineToken,
      text: content,
      contentType: 'text/markdown',
    });
    expect(put.status).toBe(200);
  }
  async function confirm(buildId: string): Promise<void> {
    const res = await call(s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'confirm' },
    });
    expect(res.status).toBe(202);
  }
  async function startReview(
    buildId: string,
    body: { agentId: string; focus?: string } = { agentId: REVIEW_AGENT_ID },
  ): Promise<Response> {
    return call(s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'review', ...body },
    });
  }

  // 会话分支改动播种（#511）：人看的变更面与审核者拿的变更必须同源，所以
  // 现场按「人的那一侧」造——推 conv 分支进托管 bare repo。
  async function seedConvChanges(buildId: string, files: Record<string, string>): Promise<void> {
    const projRow = s.db.select().from(projectTable).where(eq(projectTable.id, projectId)).get();
    expect(projRow?.repoName).toBeTruthy();
    const bareDir = join(s.reposDir, s.team.id, `${projRow?.repoName}.git`);
    const dir = mkdtempSync(join(tmpdir(), 'pacman-review-511-'));
    dirs.push(dir);
    const repoDir = join(dir, 'repo');
    const git = async (args: string[]) => {
      const r = await runGit(args, { cwd: repoDir, env: GIT_ENV, timeoutMs: 60_000 });
      expect(r.code, r.stderr).toBe(0);
    };
    const clone = await runGit(['clone', bareDir, repoDir], { cwd: dir, env: GIT_ENV });
    expect(clone.code, clone.stderr).toBe(0);
    await git(['checkout', '-B', conversationBranch(buildId)]);
    for (const [path, content] of Object.entries(files)) {
      const abs = join(repoDir, path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content);
    }
    await git(['add', '-A']);
    await git(['commit', '-m', 'conv round']);
    await git(['push', 'origin', conversationBranch(buildId)]);
  }

  return {
    s,
    todoId,
    projectId,
    seedConvChanges,
    machineToken,
    startBuild,
    claim,
    done,
    uploadPlan,
    confirm,
    startReview,
    todoRow: () => loadTodoRow(s, todoId),
    buildRow: (buildId: string) => loadBuildRow(s, buildId),
    stepsOf: (buildId: string) => loadStepsOf(s, buildId),
    messagesOf: (buildId: string) => loadMessagesOf(s, buildId),
    planContent: (buildId: string) => loadPlanContent(s, buildId),
  };
}

describe('AI 审核发起写面（M7 #312）', () => {
  let w: World;
  beforeEach(async () => {
    w = await setupWorld();
  });

  test('失败方式 1：planning 态 → 409 不静默', async () => {
    const buildId = await w.startBuild(true);
    const claimed = await w.claim();
    expect(claimed.kind).toBe('plan');
    const res = await w.startReview(buildId);
    expect(res.status).toBe(409);
    expect(w.stepsOf(buildId).find((s) => s.kind === 'review')).toBeUndefined();
  });

  test('失败方式 2：缺 agentId → 400 (zod body schema)', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, '# plan v1');
    await w.done(planClaimed.stepId, { status: 'success' });
    // 推到 confirm phase（plan done(success) 后自然进 confirm，confirm(buildId)
    // 会再推到 building——所以这里不调 confirm）。
    expect(w.todoRow().phase).toBe('confirm');
    const res = await req(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'review', focus: '看看安全' },
    });
    expect(res.status).toBe(400);
  });

  // #509：审核人的「优先跨厂商」是**界面默认值偏好**，不是服务端策略。服务端
  // 对 agentId 只做形状校验（zod）与相位门，厂商一律不看——用户显式指定同厂
  // 商是最高优先，不得被硬拦成 409。下面两条同时钉两侧：同厂商 202、跨厂商 202。
  test('选人策略不进服务端：显式指定同厂商 agentId 照常受理（不回归成 409）', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, '# plan v1');
    await w.done(planClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');
    // 产出步 Agent = 执行侧槽 AGENT_ID（provider 'stub-gw'）。
    expect(w.todoRow().assignment?.build?.agentId).toBe(AGENT_ID);

    // 同厂商：REVIEW_AGENT_ID 与 AGENT_ID 同为 'stub-gw'。
    const sameVendor = await w.startReview(buildId, { agentId: REVIEW_AGENT_ID, focus: '' });
    expect(sameVendor.status).toBe(202);
    const sameMeta = parseReviewPromptMeta(
      w.stepsOf(buildId).find((s) => s.kind === 'review')?.prompt ?? null,
    );
    expect(sameMeta?.agentId).toBe(REVIEW_AGENT_ID);
  });

  test('选人策略不进服务端：跨厂商 agentId 同样照常受理（无厂商判据）', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, '# plan v1');
    await w.done(planClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');

    w.s.db
      .insert(agentTable)
      .values({
        id: CROSS_VENDOR_AGENT_ID,
        teamId: w.s.team.id,
        displayName: 'stub-rival',
        provider: 'rival-gw',
        modelId: 'rival-model',
      })
      .run();
    bindAllAgents(w.s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）

    const res = await w.startReview(buildId, { agentId: CROSS_VENDOR_AGENT_ID, focus: '' });
    expect(res.status).toBe(202);
    const meta = parseReviewPromptMeta(
      w.stepsOf(buildId).find((s) => s.kind === 'review')?.prompt ?? null,
    );
    expect(meta?.agentId).toBe(CROSS_VENDOR_AGENT_ID);
  });

  test('happy path：confirm 态发起审核 → review 步入队 + REVIEW_ANNOUNCEMENT + phase 留 confirm', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, '# plan v1');
    await w.done(planClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');

    const res = await w.startReview(buildId, {
      agentId: REVIEW_AGENT_ID,
      focus: '关注边界情况',
    });
    expect(res.status).toBe(202);

    const steps = w.stepsOf(buildId);
    const reviewStep = steps.find((s) => s.kind === 'review');
    expect(reviewStep).toBeDefined();
    expect(reviewStep?.status).toBe('pending');
    // step 表无 agentId 列（review 步的 agentId 经 prompt 透出 + claim 载荷传
    // 机器；DB 不冗余）。本测试钉 prompt meta header（kind=review + agentId
    // 经 shared parseReviewPromptMeta 解析可得）+ 用户关注点注入。
    const meta = parseReviewPromptMeta(reviewStep?.prompt ?? null);
    expect(meta).not.toBeNull();
    expect(meta?.kind).toBe('review');
    expect(meta?.agentId).toBe(REVIEW_AGENT_ID);
    expect(reviewStep?.prompt ?? '').toContain('关注边界情况');

    // 时间线插 REVIEW_ANNOUNCEMENT（r8 §3.1 双端单源）
    const messages = w.messagesOf(buildId);
    const announcement = messages.find(
      (m) => m.role === 'user' && m.content === REVIEW_ANNOUNCEMENT,
    );
    expect(announcement).toBeDefined();

    // phase 留 confirm（review 步是额外 agent 步，不推进主时序）
    expect(w.todoRow().phase).toBe('confirm');
    // build 表无 hasChanges 列（hasChanges 是 todo 表字段，02 §4.2）；用 todo
    // 表 hasChanges 钉「审核不计入用户变更」语义。
    expect(w.todoRow().hasChanges).toBe(false);
  });

  test('happy path：claim review 步 → claim 载荷 agent = 模态选定的 reviewer（不经 assignment 槽）', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, '# plan v1');
    await w.done(planClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');

    // 启动审核：模态选 reviewer（≠ assignment.build 的 AGENT_ID）
    const startRes = await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });
    expect(startRes.status).toBe(202);

    // 机器 claim 该审核步 → claim 响应载荷 agent.id = 模态选定的 reviewer
    // （不是 assignment.build 的 builder；这是 #330 review 步的特殊路径：
    // agentId 经 prompt meta header 透出，不走 assignment 槽）。
    const claimRes = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
      cred: w.machineToken,
      body: {},
    });
    const claimBody = (await claimRes.json()) as { step: unknown };
    const parsed = claimedStepSchema.parse(claimBody.step);
    expect(parsed.step.kind).toBe('review');
    expect(parsed.agent?.id).toBe(REVIEW_AGENT_ID);
    expect(parsed.agent?.id).not.toBe(AGENT_ID);
  });

  test('happy path：空 focus 允许（可选 textarea 可空）', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, '# plan v1');
    await w.done(planClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');
    const res = await w.startReview(buildId, { agentId: REVIEW_AGENT_ID, focus: '' });
    expect(res.status).toBe(202);
    expect(w.stepsOf(buildId).find((s) => s.kind === 'review')).toBeDefined();
  });

  test('happy path：review phase 态也能再发起一次审核', async () => {
    // 推进到 review phase：先建带 plan 的 build → plan done(success) → confirm
    // action = confirm → phase 推到 building + 入队 build 步 → claim +
    // done(success) → phase = 'review'。
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, '# plan v1');
    await w.done(planClaimed.stepId, { status: 'success' });
    await w.confirm(buildId);
    expect(w.todoRow().phase).toBe('building');
    const buildClaimed = await w.claim();
    expect(buildClaimed.kind).toBe('build');
    await w.done(buildClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('review');
    const res = await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });
    expect(res.status).toBe(202);
    expect(w.stepsOf(buildId).filter((s) => s.kind === 'review')).toHaveLength(1);
  });

  test('终态闭环（无 blocking）：review 步 done(success, 空 verdict) → REVIEW_VERDICT_KIND 消息落地 + phase 不动', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, '# plan v1');
    await w.done(planClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');
    await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });
    expect(w.todoRow().phase).toBe('confirm');

    // claim review 步 → done(success, 通过 verdict)
    const reviewClaimed = await w.claim();
    expect(reviewClaimed.kind).toBe('review');
    expect(reviewClaimed.stepId).not.toBe('');
    await w.done(reviewClaimed.stepId, {
      status: 'success',
      findings: { conclusion: '方案通过，无 blocking 风险', findings: [] },
    });

    // emit REVIEW_VERDICT_KIND 消息行（system role + JSON content）
    const messages = w.messagesOf(buildId);
    const verdictRow = messages.find(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (() => {
          try {
            const parsed = JSON.parse(m.content) as { kind?: string };
            return parsed.kind === REVIEW_VERDICT_KIND;
          } catch {
            return false;
          }
        })(),
    );
    expect(verdictRow).toBeDefined();
    const parsedVerdict = reviewVerdictSchema.parse(
      JSON.parse((verdictRow as { content: string }).content).verdict,
    );
    expect(parsedVerdict.conclusion).toBe('方案通过，无 blocking 风险');
    expect(parsedVerdict.findings).toHaveLength(0);

    // phase 仍 confirm（无 blocking = 不触发自动修订；主时序在用户手动 confirm 后才推进）
    expect(w.todoRow().phase).toBe('confirm');
    // 审核步状态落 done（step status enum = pending|claimed|done|failed|stopped）
    const reviewStep = w.stepsOf(buildId).find((s) => s.kind === 'review');
    expect(reviewStep?.status).toBe('done');
    // 跟 merge_announcement 路径无交叉（不是合并）
    expect(messages.some((m) => m.content === MERGE_ANNOUNCEMENT)).toBe(false);
    // 无新增 plan 步（无修订）
    expect(w.stepsOf(buildId).filter((s) => s.kind === 'plan')).toHaveLength(1);
  });

  test('终态闭环（blocking）：review 步 done(success, 含 blocking verdict) → REVIEW_VERDICT_KIND 消息 + phase 转 planning + 重规划步入队', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, '# plan v1');
    await w.done(planClaimed.stepId, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');
    await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });
    expect(w.todoRow().phase).toBe('confirm');

    // claim review 步 → done(success, blocking verdict)
    const reviewClaimed = await w.claim();
    expect(reviewClaimed.kind).toBe('review');
    await w.done(reviewClaimed.stepId, {
      status: 'success',
      findings: {
        conclusion: '方案在边界情况上存在硬风险',
        findings: [
          {
            id: '1',
            severity: 'blocking',
            summary: '未处理空输入',
            description: 'parseInput 对空字符串未做防御',
            file: 'src/parse.ts',
            line: 42,
            suggestion: '加入空字符串 early return',
          },
          {
            id: '2',
            severity: 'suggestion',
            summary: '可选：日志格式',
          },
        ],
      },
    });

    // emit REVIEW_VERDICT_KIND 消息行（含 blocking findings）
    const messages = w.messagesOf(buildId);
    const verdictRow = messages.find(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (() => {
          try {
            const parsed = JSON.parse(m.content) as { kind?: string };
            return parsed.kind === REVIEW_VERDICT_KIND;
          } catch {
            return false;
          }
        })(),
    );
    expect(verdictRow).toBeDefined();
    const parsedVerdict = reviewVerdictSchema.parse(
      JSON.parse((verdictRow as { content: string }).content).verdict,
    );
    expect(parsedVerdict.findings.some((f) => f.severity === 'blocking')).toBe(true);

    // phase 转 planning（review → planning = 自动修订回路扩展，r8 §3.1 实测 62）
    expect(w.todoRow().phase).toBe('planning');
    // 新 plan 步入队（原 plan v1 + 新 auto-revise plan v2）
    const planSteps = w.stepsOf(buildId).filter((s) => s.kind === 'plan');
    expect(planSteps).toHaveLength(2);
    const revisePrompt = planSteps[1]?.prompt ?? '';
    expect(revisePrompt).toContain('审核结论');
    expect(revisePrompt).toContain('Blocking findings');
    expect(revisePrompt).toContain('未处理空输入');
    expect(revisePrompt).toContain('src/parse.ts:42');
    // 审核步状态落 done
    const reviewStep = w.stepsOf(buildId).find((s) => s.kind === 'review');
    expect(reviewStep?.status).toBe('done');

    // 调整摘要行落地：时间线 dim note「AI 审核检测到 N 处 blocking 风险…」
    // 给用户解释「为什么又来一个 plan 步」。1 条 blocking = 「1 处」。
    const reviseNote = messages.find(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        !m.content.startsWith('{') &&
        m.content.includes('AI 审核检测到'),
    );
    expect(reviseNote?.content).toContain('1 处 blocking 风险');
    expect(reviseNote?.content).toContain('已自动入队重规划步');
  });

  test('终态闭环（daemon 未传 findings）：verdict 兜底消息落地 + 不触发修订', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, '# plan v1');
    await w.done(planClaimed.stepId, { status: 'success' });
    await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });

    // daemon 未解析/未传 findings（agent 未按契约输出 JSON）
    const reviewClaimed = await w.claim();
    await w.done(reviewClaimed.stepId, { status: 'success' });

    const messages = w.messagesOf(buildId);
    const verdictRow = messages.find(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (() => {
          try {
            const parsed = JSON.parse(m.content) as { kind?: string };
            return parsed.kind === REVIEW_VERDICT_KIND;
          } catch {
            return false;
          }
        })(),
    );
    expect(verdictRow).toBeDefined();
    const parsedVerdict = reviewVerdictSchema.parse(
      JSON.parse((verdictRow as { content: string }).content).verdict,
    );
    expect(parsedVerdict.conclusion).toBe('审核未返回结论');
    expect(parsedVerdict.findings).toHaveLength(0);
    // phase 留 confirm（兜底空 verdict 不触发修订）
    expect(w.todoRow().phase).toBe('confirm');
    // 不入队新 plan 步
    expect(w.stepsOf(buildId).filter((s) => s.kind === 'plan')).toHaveLength(1);
  });

  test('终态闭环（#700 daemon 报提取失败）：「判定提取失败」+ 原因上浮 + 不触发修订', async () => {
    const buildId = await w.startBuild(true);
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, '# plan v1');
    await w.done(planClaimed.stepId, { status: 'success' });
    await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });

    // #519 形状下旧 daemon 提取被尾部工具调用击穿 → 空判定；新 daemon 报
    // findingsError（原因 = 提取器视角的失败事实）
    const reviewClaimed = await w.claim();
    await w.done(reviewClaimed.stepId, {
      status: 'success',
      findingsError: '审核步输出中未找到 verdict JSON（agent 未按契约输出）',
    });

    const messages = w.messagesOf(buildId);
    const verdictRow = messages.find(
      (m) =>
        m.role === 'system' &&
        typeof m.content === 'string' &&
        (() => {
          try {
            const parsed = JSON.parse(m.content) as { kind?: string };
            return parsed.kind === REVIEW_VERDICT_KIND;
          } catch {
            return false;
          }
        })(),
    );
    expect(verdictRow).toBeDefined();
    const row = JSON.parse((verdictRow as { content: string }).content) as {
      verdict: { conclusion: string; findings: unknown[] };
      extractionError?: string;
    };
    // 兜底 conclusion 与旧 daemon 的「审核未返回结论」分开报——提取失败
    // 不冒充审核没结论
    expect(row.verdict.conclusion).toBe('判定提取失败');
    expect(row.verdict.findings).toHaveLength(0);
    // 原因原文随消息上浮（web 审核面「判定提取失败」行的正文）
    expect(row.extractionError).toBe('审核步输出中未找到 verdict JSON（agent 未按契约输出）');
    // 无 blocking 可判：phase 留 confirm、不入队新 plan 步
    expect(w.todoRow().phase).toBe('confirm');
    expect(w.stepsOf(buildId).filter((s) => s.kind === 'plan')).toHaveLength(1);
  });
});

// #511 审核步材料随关口分叉：外部行为 = 材料里有什么（不是怎么拼字符串）。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. 确认关口（phase=confirm）：即使会话分支已推了改动，材料也不含变更
//      ——那里「只审方案」是正确的（票面 Solution 的硬规则）。
//   2. 审核关口（phase=review）：材料同时含方案全文与变更（文件路径 + 逐行
//      diff）——审核者拿到人能拿到的那份。
//   3. 审核关口但变更面为空：审核步仍能发起，材料如实写「无改动」。
//   4. 变更来源与人的变更面同源：同一 readBuildChanges 计算路径（同一文件集）。
//   5. meta 头带 gate（相位值判据），daemon 据此决定开只读检出。
//   6. review 步 session = new：prompt 真的会被投递（不是接续别人的会话）。
const CONV_CHANGE_FILE = 'src/parse.ts';
const CONV_CHANGE_BODY = 'export function parseInput() {}\n';
const PLAN_V1 = '# plan v1\n\n## Changes\n- 加 parseInput\n';

/** 走到审核关口（plan done → confirm → build done → phase=review）。 */
async function advanceToReviewGate(w: World): Promise<string> {
  const buildId = await w.startBuild(true);
  const planClaimed = await w.claim();
  await w.uploadPlan(planClaimed.stepId, PLAN_V1);
  // sessionId 照真 daemon 的 done 回传位给（缺省会让「续轮」判定永不触发，
  // 于是审核步的 session 分叉面测不到——本票的投递面正踩这条路径）。
  await w.done(planClaimed.stepId, { status: 'success', sessionId: 'sess-plan' });
  await w.confirm(buildId);
  const buildClaimed = await w.claim();
  expect(buildClaimed.kind).toBe('build');
  await w.done(buildClaimed.stepId, { status: 'success', sessionId: 'sess-build' });
  expect(w.todoRow().phase).toBe('review');
  return buildId;
}

function reviewPromptOf(w: World, buildId: string): string {
  const step = w.stepsOf(buildId).find((s) => s.kind === 'review');
  expect(step).toBeDefined();
  return step?.prompt ?? '';
}

describe('审核步材料随关口分叉（#511）', () => {
  beforeEach(async () => {
    w = await setupWorld({ hosted: true });
  });
  let w: World;

  test('失败方式 1：确认关口材料不含变更——即使会话分支已有改动', async () => {
    const buildId = await w.startBuild(true);
    await w.seedConvChanges(buildId, { [CONV_CHANGE_FILE]: CONV_CHANGE_BODY });
    const planClaimed = await w.claim();
    await w.uploadPlan(planClaimed.stepId, PLAN_V1);
    await w.done(planClaimed.stepId, { status: 'success', sessionId: 'sess-plan' });
    expect(w.todoRow().phase).toBe('confirm');

    const res = await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });
    expect(res.status).toBe(202);
    const prompt = reviewPromptOf(w, buildId);
    expect(prompt).toContain(PLAN_V1);
    expect(prompt).not.toContain(CONV_CHANGE_FILE);
    expect(parseReviewPromptMeta(prompt)?.gate).toBe('confirm');
  });

  test('失败方式 2：审核关口材料含方案 + 变更（文件路径与逐行 diff 都在）', async () => {
    const buildId = await advanceToReviewGate(w);
    await w.seedConvChanges(buildId, { [CONV_CHANGE_FILE]: CONV_CHANGE_BODY });

    const res = await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });
    expect(res.status).toBe(202);
    const prompt = reviewPromptOf(w, buildId);
    expect(prompt).toContain(PLAN_V1);
    expect(prompt).toContain(CONV_CHANGE_FILE);
    expect(prompt).toContain('+export function parseInput() {}');
    expect(parseReviewPromptMeta(prompt)?.gate).toBe('review');
  });

  test('失败方式 3：审核关口变更面为空 → 仍能发起，材料如实写无改动', async () => {
    const buildId = await advanceToReviewGate(w); // 未推 conv 分支 = 无改动
    const res = await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });
    expect(res.status).toBe(202);
    const prompt = reviewPromptOf(w, buildId);
    expect(prompt).toContain(PLAN_V1);
    // 托管项目 = 有只读检出 → 空态不说「本轮无改动」（变更面算不出 ≠ 没改），
    // 改指检出自行核对
    expect(prompt).toContain('变更面为空');
    expect(prompt).toContain('检出');
    expect(prompt).not.toContain(CONV_CHANGE_FILE);
    expect(parseReviewPromptMeta(prompt)?.gate).toBe('review');
  });

  test('失败方式 4：材料里的变更 = 人的变更面同一计算路径（GET /changes 文件集一致）', async () => {
    const buildId = await advanceToReviewGate(w);
    await w.seedConvChanges(buildId, {
      [CONV_CHANGE_FILE]: CONV_CHANGE_BODY,
      'plan.md': '# plan v1\n\n## Changes\n- 加 parseInput\n- 再改一行\n',
    });
    const changesRes = await call(w.s.app, 'GET', `/api/builds/${buildId}/changes`);
    expect(changesRes.status).toBe(200);
    const { files } = (await changesRes.json()) as { files: { path: string }[] };
    expect(files.length).toBeGreaterThan(0);

    await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });
    const prompt = reviewPromptOf(w, buildId);
    for (const file of files) expect(prompt).toContain(file.path);
    expect(prompt).toContain(`本轮共 ${files.length} 个文件改动`);
  });

  test('失败方式 6：review 步 claim 载荷 session = new（prompt 投递给新会话，不接续主 conv）', async () => {
    const buildId = await advanceToReviewGate(w);
    await w.startReview(buildId, { agentId: REVIEW_AGENT_ID });
    const claimRes = await call(w.s.app, 'POST', '/api/machine/tasks/claim', {
      cred: w.machineToken,
      body: {},
    });
    const parsed = claimedStepSchema.parse(((await claimRes.json()) as { step: unknown }).step);
    expect(parsed.step.kind).toBe('review');
    expect(parsed.session.action).toBe('new');
    expect(parsed.session.sessionId).toBeNull();
    // 材料经 instruction 位下发（daemon 侧 prompt 单一来源就是它）
    expect(parsed.instruction ?? '').toContain(PLAN_V1);
  });
});
