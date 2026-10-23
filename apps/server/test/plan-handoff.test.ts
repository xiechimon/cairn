// #113 plan→build 阶段交接缺口：plan 关未产 plan.md 时 build agent 无任务上下文
// （05 §5 实跑发现：withPlan 链路规划轮可跳过写 plan.md 直接交付，build 轮仅收到
// confirm 关口措辞，拿不到 todo 原始 spec 而反问「哪个方案」）。
// 裁定 = 候选1+2 组合（02 §4.2 注记）：
//  ① plan 步完成校验交接物 —— 缺失则不算成：留 planning + 自动补写一轮（有界：
//     仅本 build 首个 plan 步触发——#703 起从「prompt===null」改判，失败重启轮
//     首步同享重试；补写/驳回重规划等续轮仍无产物 → #703 闸 1 失败收尾，不再
//     放行 confirm——B-C10 实测「两轮全空仍进 confirm」由本缝漏过）。
//  ② build 步 claim 时交接物仍缺失 → 强制 new session：daemon 走 buildTaskPrompt
//     = todo 原始 title+spec，agent 必拿任务内容（不依赖模型配合的确定兜底）。
//     #703 起正常链路 confirm 必有方案（闸 1），本兜底值守升级窗口残留态。
// 失败方式清单（先固化，代码是让场景通过的手段）：
//  1. plan 步成功但无 plan.md → 直接 confirm（交接物缺失放行 → build 轮空转）；
//  2. 自动补写无界 → 模型持续不写则循环入队烧 token；
//  3. build 步续轮 confirm 措辞无方案可指（spec 兜底缺失 → agent 反问）；
//  4. 正常路径回归：plan.md 在 → confirm + continue session 不变；
//  5. 驳回重规划轮（续轮指令步）未新产 plan.md → 误触发自动补写（界混淆）；
//  6. withPlan=false 直执行面被波及（planDocId 恒 null 误判交接缺失）。

import type { ClaimedStep } from '@cairn/shared';
import {
  claimedStepSchema,
  conversationStreamEventSchema,
  machineUploadUrlsResponseSchema,
  PLAN_FILE_NAME,
} from '@cairn/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  plan as planTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import {
  bindAllAgents,
  bootServer,
  issueApiKey,
  openConvStream,
  postProject,
  withVerification,
} from './helpers.js';

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

const AGENT_ID = 'agent-ph-1';

/** machine-wire 同款引导裁剪面：provider/agent + enroll + 项目/todo 就位。 */
async function setupWorld() {
  const s = bootServer({ claimHoldMs: 200 });
  const key = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-ph',
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
      displayName: 'ph-builder',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'ph-mbp', cliVersion: '0.1.0' },
  });

  bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）
  const { token } = (await enrollRes.json()) as { token: string };
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '探针任务', spec: '写一行探针到 README.md' },
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
    const body = (await res.json()) as { builds: { id: string }[] };
    return body.builds[0]!.id;
  }
  async function claim(): Promise<ClaimedStep> {
    const res = await call(s.app, 'POST', '/api/machine/tasks/claim', { cred: token, body: {} });
    const body = (await res.json()) as { step: unknown };
    if (!body.step) throw new Error('claim returned no step');
    return claimedStepSchema.parse(body.step);
  }
  async function done(stepId: string, body: Record<string, unknown>): Promise<void> {
    const res = await call(s.app, 'POST', `/api/machine/done/${stepId}`, { cred: token, body });
    expect(res.status).toBe(200);
  }
  /** plan.md 产物回传（upload-urls 预签名 → PUT 原文，02 §1.3/§4.2 分流）。 */
  async function uploadPlan(stepId: string, content: string): Promise<void> {
    const urlsRes = await call(s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
      cred: token,
      body: { files: [{ name: PLAN_FILE_NAME }] },
    });
    const urls = machineUploadUrlsResponseSchema.parse(await urlsRes.json());
    const up = urls.uploads[0]!;
    const put = await call(s.app, 'PUT', up.url.replace(/^https?:\/\/[^/]+/, ''), {
      cred: token,
      text: content,
      contentType: 'text/markdown',
    });
    expect(put.status).toBe(200);
  }
  /** #1026/#1027：PUT 不断言 200——拒绝腿要看响应本身（400/409）。 */
  async function tryUploadPlan(stepId: string, content: string): Promise<Response> {
    const urlsRes = await call(s.app, 'POST', `/api/machine/upload-urls/${stepId}`, {
      cred: token,
      body: { files: [{ name: PLAN_FILE_NAME }] },
    });
    const urls = machineUploadUrlsResponseSchema.parse(await urlsRes.json());
    const up = urls.uploads[0]!;
    return call(s.app, 'PUT', up.url.replace(/^https?:\/\/[^/]+/, ''), {
      cred: token,
      text: content,
      contentType: 'text/markdown',
    });
  }
  const todoRow = () => s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
  const stepsOf = (buildId: string) =>
    s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
  const plansOf = (buildId: string) =>
    s.db.select().from(planTable).where(eq(planTable.buildId, buildId)).all();
  const buildRowOf = (buildId: string) =>
    s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
  return {
    s,
    token,
    projectId,
    todoId,
    startBuild,
    claim,
    done,
    uploadPlan,
    tryUploadPlan,
    todoRow,
    stepsOf,
    plansOf,
    buildRowOf,
  };
}

type World = Awaited<ReturnType<typeof setupWorld>>;

async function confirm(w: World, buildId: string): Promise<void> {
  const res = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
    body: { action: 'confirm' },
  });
  expect(res.status).toBe(202);
}

describe('plan 关交接物校验（#113 候选1：plan 即文件 plan.md，02 §4.2）', () => {
  test('plan 步未产 plan.md → 不进 confirm：留 planning + 自动补写步入队（带补写指令）', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      expect(planStep.step.kind).toBe('plan');
      expect(planStep.session.action).toBe('new');
      // 复现场景：plan 阶段不写 plan.md 直接交付。
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      // 不进 confirm：留 planning（交接物缺失 → 规划步不算成）。
      expect(w.todoRow().phase).toBe('planning');
      // 自动补写一轮：新 plan 步 pending + 补写指令 prompt 落库。
      const pending = w
        .stepsOf(buildId)
        .filter((st) => st.kind === 'plan' && st.status === 'pending');
      expect(pending).toHaveLength(1);
      expect(pending[0]!.prompt).toContain(PLAN_FILE_NAME);
      // hasPlan 不置位（无交接物不谎称有方案——看板 plan chip 数据源）。
      expect(w.todoRow().hasPlan).toBe(false);
    } finally {
      w.s.dispose();
    }
  });

  test('补写轮仍无 plan.md → #703 闸 1 失败收尾（confirm 不可达，不再放行）', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      // 补写步被领取：续轮同 conv 会话 + claim 载荷 instruction 透出补写指令。
      const rewrite = await w.claim();
      expect(rewrite.step.kind).toBe('plan');
      expect(rewrite.session).toEqual({ action: 'continue', sessionId: 'pi-1' });
      expect(rewrite.instruction).toContain(PLAN_FILE_NAME);
      // 补写轮仍直接交付（无 plan.md）→ 失败收尾（B-C10：闸上无物即无闸）。
      await w.done(rewrite.step.id, { status: 'success', sessionId: 'pi-1' });
      expect(w.todoRow().phase).toBe('failed');
      // 有界：两轮 plan 步封顶，无第三补写步。
      expect(w.stepsOf(buildId).filter((st) => st.kind === 'plan')).toHaveLength(2);
      expect(w.todoRow().hasPlan).toBe(false);
    } finally {
      w.s.dispose();
    }
  });

  test('正常路径不回归：plan.md 产物在 → confirm + hasPlan 置位（无补写步）', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, withVerification('# 方案\nContext: x'));
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      expect(w.todoRow().phase).toBe('confirm');
      expect(w.todoRow().hasPlan).toBe(true);
      expect(w.stepsOf(buildId).filter((st) => st.kind === 'plan')).toHaveLength(1);
    } finally {
      w.s.dispose();
    }
  });

  test('驳回重规划轮未新产 plan.md → 直接 confirm（自动补写不套续轮指令步）', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, withVerification('# v1'));
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      expect(w.todoRow().phase).toBe('confirm');
      // 驳回 → 重规划步（prompt 带 feedback 指令 = 续轮指令步）。
      const rev = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
        body: {
          action: 'revision',
          side: 'plan',
          feedback: '标题去掉项目名后缀',
          clientMessageId: '3f9a0c2e-0000-4000-8000-000000000002',
        },
      });
      expect(rev.status).toBe(202);
      expect(w.todoRow().phase).toBe('planning');
      const replan = await w.claim();
      expect(replan.step.kind).toBe('plan');
      // 重规划轮未新产 plan.md（v1 仍在库）→ 直接 confirm，不触发自动补写。
      await w.done(replan.step.id, { status: 'success', sessionId: 'pi-1' });
      expect(w.todoRow().phase).toBe('confirm');
      expect(w.stepsOf(buildId).filter((st) => st.kind === 'plan')).toHaveLength(2);
    } finally {
      w.s.dispose();
    }
  });
});

describe('build 步 spec 兜底（#113 候选2：交接物仍缺失 → 强制 new session）', () => {
  test('confirm 时 plan.md 缺席（升级窗口残留态）→ build 步 claim = new session + todo 原始 spec 随载荷', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      // #703 起正常链路 confirm 必有方案（闸 1 失败收尾）；planDocId 缺失的
      // confirm 态只剩老版本 server 已放行的升级窗口残留——直插构造该态：
      // 正常走到 confirm 后清 planDocId（模拟老库残留）。
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, withVerification('# 方案 v1'));
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      expect(w.todoRow().phase).toBe('confirm');
      w.s.db.update(buildTable).set({ planDocId: null }).where(eq(buildTable.id, buildId)).run();
      await confirm(w, buildId);
      // build 步 = new session：daemon 走 buildTaskPrompt = title+spec（agent 必拿
      // 任务内容，不再只有 confirm 关口措辞）。
      const buildStep = await w.claim();
      expect(buildStep.step.kind).toBe('build');
      expect(buildStep.session).toEqual({ action: 'new', sessionId: null });
      expect(buildStep.todo).toMatchObject({
        title: '探针任务',
        spec: '写一行探针到 README.md',
      });
    } finally {
      w.s.dispose();
    }
  });

  test('plan.md 在 → build 步 continue session 不变（正常路径不回归）', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, withVerification('# 方案\nContext: x'));
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      await confirm(w, buildId);
      const buildStep = await w.claim();
      expect(buildStep.step.kind).toBe('build');
      expect(buildStep.session).toEqual({ action: 'continue', sessionId: 'pi-1' });
    } finally {
      w.s.dispose();
    }
  });

  test('withPlan=false 直执行不受影响（planDocId 恒 null 不误判交接缺失）', async () => {
    const w = await setupWorld();
    try {
      await w.startBuild(false);
      const buildStep = await w.claim();
      expect(buildStep.step.kind).toBe('build');
      expect(buildStep.session).toEqual({ action: 'new', sessionId: null });
      expect(w.todoRow().phase).toBe('building');
    } finally {
      w.s.dispose();
    }
  });
});

// XMON-59 第二断口 + 主断口的机器面：plan.md 落库静默无事件（web
// ['plans', buildId] 失效生命线断——挂载取数读早于提交时方案卡永久停
// v1/空）；done 同相位重放抛错（journal 卡死）。失败方式清单（先固化）：
//  1. upload 缝落库（plan 行 + planDocId）不发任何事件 → 无 done 介入时
//     plans 查询永久陈旧；
//  2. done 重放（HTTP 响应丢失后 daemon recover 重发）撞同相位 assert
//     → 500 → journal 卡死，只能重启 recover 且重放仍 500；
//  3. 重放成功后落库状态被破坏（v/phaseAt 漂移）＝幂等假象。
describe('XMON-59：upload 缝发事件 + done 重放幂等（相位漏斗静默丢事件）', () => {
  test('plan.md 落库即发会话流 step 事件（无 done 介入，订阅先于上传）', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const claimed = await w.claim();
      const stream = await openConvStream(w.s.app, buildId); // 订阅先于上传（SSE 无重放）
      try {
        await w.uploadPlan(claimed.step.id, withVerification('# 方案 v1'));
        const raw = await stream.next((ev) => ev.type === 'step', 3000);
        const ev = conversationStreamEventSchema.parse(raw); // shared 单源全形状复验
        if (ev.type !== 'step') throw new Error(`expected step event, got ${ev.type}`);
        expect(ev.step).toMatchObject({ id: claimed.step.id, buildId, status: 'claimed' });
      } finally {
        stream.close();
      }
    } finally {
      w.s.dispose();
    }
  });

  test('done 重放（recover 面）同相位幂等：不 500，重放零副作用（v/phaseAt 不动）', async () => {
    const w = await setupWorld();
    try {
      await w.startBuild(true);
      const claimed = await w.claim();
      await w.uploadPlan(claimed.step.id, withVerification('# 方案 v1'));
      await w.done(claimed.step.id, { status: 'success', sessionId: 'pi-1' });
      expect(w.todoRow().phase).toBe('confirm');
      expect(w.todoRow().hasPlan).toBe(true);
      const before = w.todoRow();
      // 重放：现实现 completeStep → setTodoPhase(confirm) 撞同相位 assert 抛
      // → done 500；修复后幂等放行且不改任何可观测状态。
      await w.done(claimed.step.id, { status: 'success', sessionId: 'pi-1' });
      const after = w.todoRow();
      expect(after.v).toBe(before.v);
      expect(after.phaseAt).toBe(before.phaseAt);
      expect(after.phase).toBe('confirm');
    } finally {
      w.s.dispose();
    }
  });
});

// #1026 + #1027（#904 调研副产物 2/3）：plan 上传接收端收口。receivePlanUpload
// 此前只验机器归属（ownedStep）——非规划语义步（build / review / 已收尾）照样
// 落版本、改 planDocId；且 version = max+1 无去重，「PUT 成功 / done 失败」的
// 恢复重传把同一份内容存成重复版本。失败方式清单（先固化，代码是让场景通过
// 的手段）：
//  1. build 步 PUT plan.md → 放行（机器可对执行步伪造方案版本，#1027）；
//  2. review 步 PUT plan.md → 同上（审核步不产方案，#1027）；
//  3. 步已收尾（done）后迟到 PUT → 放行（改写已确认历史的版本面，#1027）；
//  4. 同步同内容重复 PUT（done 失败 → recover 重传形）→ 落重复版本（#1026）；
//  5. 幂等收窄过度：内容确实变了 / 换步重规划同文 → 新版本不落（幂等 ≠ 永不
//     新增；「驳回重规划轮自然 v2」的既有语义不得回归）。
describe('#1026/#1027 plan 上传接收端：入参校验 + 步+内容幂等', () => {
  test('build 步 PUT plan.md → 400 拒：不落版本、不改 planDocId（#1027 拒绝腿）', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(false); // withPlan=false → 首步即 build
      const buildStep = await w.claim();
      expect(buildStep.step.kind).toBe('build');
      const res = await w.tryUploadPlan(buildStep.step.id, '# 伪方案');
      expect(res.status).toBe(400);
      expect(Object.keys((await res.json()) as object)).toEqual(['error']);
      expect(w.plansOf(buildId)).toHaveLength(0);
      expect(w.buildRowOf(buildId).planDocId).toBeNull();
    } finally {
      w.s.dispose();
    }
  });

  test('review 步 PUT plan.md → 400 拒：不落版本、不改 planDocId（#1027 拒绝腿）', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, withVerification('# 方案 v1'));
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      await confirm(w, buildId);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, { status: 'success', sessionId: 'pi-1', hasChanges: true });
      const revRes = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
        body: { action: 'review', agentId: AGENT_ID },
      });
      expect(revRes.status).toBe(202);
      const reviewStep = await w.claim();
      expect(reviewStep.step.kind).toBe('review');
      const res = await w.tryUploadPlan(reviewStep.step.id, '# 伪方案');
      expect(res.status).toBe(400);
      expect(Object.keys((await res.json()) as object)).toEqual(['error']);
      // v1 原样：无新增行、planDocId 仍指 v1。
      expect(w.plansOf(buildId)).toHaveLength(1);
      expect(w.buildRowOf(buildId).planDocId).toBe(w.plansOf(buildId)[0]!.id);
    } finally {
      w.s.dispose();
    }
  });

  test('步已 done 后迟到 PUT → 409 拒：plan 表不动（#1027 状态腿）', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, withVerification('# 方案 v1'));
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      // done 已收尾：恢复重传若撞上已收尾步（done 实际成功、响应丢失后旧
      // journal 残留重放）不得改写版本面。恢复真路径只会对仍 claimed 的步
      // 重传（recover 只返回 claimed），本腿钉的是收尾后的迟到上传被拒。
      const res = await w.tryUploadPlan(planStep.step.id, withVerification('# 方案 v1'));
      expect(res.status).toBe(409);
      expect(w.plansOf(buildId)).toHaveLength(1);
      expect(w.buildRowOf(buildId).planDocId).toBe(w.plansOf(buildId)[0]!.id);
    } finally {
      w.s.dispose();
    }
  });

  test('同步同内容重复 PUT → 幂等：不落重复版本，planDocId 不漂（#1026）', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, withVerification('# 方案 v1'));
      // 「PUT 成功 / done 失败 → 恢复重传」形：fresh 预签名 URL、同内容。
      await w.uploadPlan(planStep.step.id, withVerification('# 方案 v1'));
      const plans = w.plansOf(buildId);
      expect(plans).toHaveLength(1);
      expect(plans[0]!.version).toBe(1);
      expect(plans[0]!.content).toBe(withVerification('# 方案 v1'));
      expect(w.buildRowOf(buildId).planDocId).toBe(plans[0]!.id);
      // 收尾照常：幂等不挡正常流。
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      expect(w.todoRow().phase).toBe('confirm');
      expect(w.todoRow().hasPlan).toBe(true);
    } finally {
      w.s.dispose();
    }
  });

  test('内容确实变了 → 新版本照常落（幂等 ≠ 永不新增，#1026 正向腿）', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, withVerification('# 方案 v1'));
      await w.uploadPlan(planStep.step.id, withVerification('# 方案 v2（改稿）'));
      const plans = w.plansOf(buildId);
      expect(plans.map((p) => p.version)).toEqual([1, 2]);
      expect(w.buildRowOf(buildId).planDocId).toBe(plans[1]!.id);
    } finally {
      w.s.dispose();
    }
  });

  test('换步重规划同文 → 新版本照落（幂等键 = 步+内容；驳回轮 v2 语义不回归）', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const planStep = await w.claim();
      await w.uploadPlan(planStep.step.id, withVerification('# 方案 v1'));
      await w.done(planStep.step.id, { status: 'success', sessionId: 'pi-1' });
      // 驳回 → 重规划步（不同 stepId）；轮次产物与 v1 逐字节相同。
      const rev = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
        body: {
          action: 'revision',
          side: 'plan',
          feedback: '再看看',
          clientMessageId: '3f9a0c2e-0000-4000-8000-0000000000aa',
        },
      });
      expect(rev.status).toBe(202);
      const replan = await w.claim();
      expect(replan.step.id).not.toBe(planStep.step.id);
      await w.uploadPlan(replan.step.id, withVerification('# 方案 v1'));
      // 不同步的相同内容 = 新版本（v2，空 diff）：版本面如实记录「新一轮
      // 规划发生过」，这正是幂等键带「步」的原因。
      const plans = w.plansOf(buildId);
      expect(plans.map((p) => p.version)).toEqual([1, 2]);
      expect(plans[1]!.content).toBe(withVerification('# 方案 v1'));
      expect(w.buildRowOf(buildId).planDocId).toBe(plans[1]!.id);
    } finally {
      w.s.dispose();
    }
  });
});
