// stop 写面（M7 #308，08 册附录 A composer 停止钮行 / r9 §3.3）：
// POST /api/builds/{id}/stop = 中断在跑步——claimed 步走机器信号（SSE stop
// 事件 + stop_pending 单槽 + GET /api/machine/stop 拉取-确认，#278 steer 同律）；
// pending 步 server 侧即时取消（无机器可通知）。落账 = done(stopped) 收尾：
// step.status 'stopped' + build.errorMessage '已取消'（运行历史面数据源）+
// gate 回落（最近 done 步的关口；无 done 步 → build.prevPhase）——回落绕过
// 通知/chief-wake 漏斗 [设计]（取消是用户在场动作，不重复发「方案就绪」）。
// 失败方式枚举先于实现固化（AGENTS.md 测试规则 3）：
//   1. 无活动步 stop → 409 不静默；未知 build → 404；body 缺 discard → 400
//   2. pending 步 stop → 即时取消：step stopped + phase 落 prevPhase +
//      build.errorMessage '已取消' + {delegated:false} 200
//   3. claimed 步 stop → stopPending 单槽 + SSE {type:'stop',stepId} +
//      {delegated:true} 202；步保持 claimed（中断在途，done(stopped) 才落账）
//   4. 拉取-确认：首拉 {discard}、二拉 {discard:null}；无凭证 401；
//      他机拉取 → null 且 pending 不清
//   5. 旧步 pending（步收尾换新步）→ 新步拉取 null + 丢弃
//   6. gate 回落三分支：停首轮 plan 步 → prevPhase；停 build 步 → confirm
//      （plan v1 保留）；停 merge 步 → review 不动
//   7. 回落不发通知：confirm 回落不新增 notification 行、不入队 chief 步
//   8. 双 stop → 单槽覆盖（discard 位以后发为准）；stopped 后再 stop → 409
//   9. stop 后 steer 拉取 → null（步非 claimed，pending 不复活）

import {
  type ClaimedStep,
  claimedStepSchema,
  machineUploadUrlsResponseSchema,
  PLAN_FILE_NAME,
} from '@pacman/shared';
import { eq, sql } from 'drizzle-orm';
import type { Hono } from 'hono';
import { beforeEach, describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  notification as notificationTable,
  provider as providerTable,
  step as stepTable,
  stopPending as stopPendingTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { bindAllAgents, bootServer, issueApiKey, postProject } from './helpers.js';

const AGENT_ID = 'agent-stop-1';

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

/** steer.test/plan-handoff 同款引导裁剪面：provider/agent + 双机 enroll +
 *  项目/todo 就位。 */
async function setupWorld() {
  const s = bootServer({ claimHoldMs: 200, pingIntervalMs: 3_600_000 });
  const key = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-stop',
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
      displayName: 'stub-builder',
      provider: 'stub-gw',
      modelId: 'stub-model',
      // XMON-77：本世界含 merge 步（停 merge 步用例），合并闸要求两开关。
      tools: ['合并分支', '推送分支'],
    })
    .run();
  // 双机 = 双 key（enroll 按 key/team 认机器且轮换 token——同 key 二次
  // enroll 会作废首台 token，r3 §1.2）。
  async function enroll(name: string, cred: string): Promise<string> {
    const res = await call(s.app, 'POST', '/api/machine/enroll', {
      cred,
      body: { teamId: s.team.id, name, cliVersion: '0.1.0' },
    });

    bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）
    expect(res.status).toBe(200);
    return ((await res.json()) as { token: string }).token;
  }
  const token = await enroll('stop-mbp', key);
  const otherToken = await enroll('other-mbp', await issueApiKey(s));
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '停止探针', spec: '写一行停止探针到 README.md' },
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
  async function stop(buildId: string, discard: boolean): Promise<Response> {
    return call(s.app, 'POST', `/api/builds/${buildId}/stop`, { body: { discard } });
  }
  const todoRow = () => s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
  const buildRow = (buildId: string) =>
    s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
  const stepsOf = (buildId: string) =>
    s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
  const notificationCount = () =>
    s.db.select({ n: sql<number>`count(*)` }).from(notificationTable).get()?.n ?? 0;
  const chiefStepCount = () =>
    s.db
      .select({ n: sql<number>`count(*)` })
      .from(stepTable)
      .where(eq(stepTable.kind, 'chief'))
      .get()?.n ?? 0;
  async function confirm(buildId: string): Promise<void> {
    const res = await call(s.app, 'POST', `/api/builds/${buildId}/steps`, {
      body: { action: 'confirm' },
    });
    expect(res.status).toBe(202);
  }
  return {
    s,
    token,
    otherToken,
    todoId,
    startBuild,
    claim,
    done,
    uploadPlan,
    stop,
    confirm,
    todoRow,
    buildRow,
    stepsOf,
    notificationCount,
    chiefStepCount,
  };
}

type World = Awaited<ReturnType<typeof setupWorld>>;

describe('stop 服务端写面（M7 #308）', () => {
  let w: World;
  beforeEach(async () => {
    w = await setupWorld();
  });

  test('失败方式 1：无活动步 409；未知 build 404；缺 discard 400', async () => {
    const buildId = await w.startBuild(true);
    const unknown = await call(w.s.app, 'POST', '/api/builds/does-not-exist/stop', {
      body: { discard: true },
    });
    expect(unknown.status).toBe(404);
    const badBody = await call(w.s.app, 'POST', `/api/builds/${buildId}/stop`, { body: {} });
    expect(badBody.status).toBe(400);
    // 步收尾后（plan done + 关口 confirm，无活动步）再 stop → 409 不静默。
    // 注：plan 步 done(success) 必须先上传 plan.md，否则 #113 自动补写步入队
    // （仍有活动步）。
    const claimed = await w.claim();
    await w.uploadPlan(claimed.step.id, '# plan v1');
    await w.done(claimed.step.id, { status: 'success' });
    const late = await w.stop(buildId, true);
    expect(late.status).toBe(409);
    expect(Object.keys((await late.json()) as object)).toEqual(['error']);
  });

  test('失败方式 2：pending 步 → server 即时取消（step stopped + prevPhase 回落 + 已取消）', async () => {
    const buildId = await w.startBuild(true);
    const res = await w.stop(buildId, true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ delegated: false });
    const steps = w.stepsOf(buildId);
    expect(steps).toHaveLength(1);
    expect(steps[0]!.status).toBe('stopped');
    expect(w.todoRow().phase).toBe('todo'); // prevPhase 回落（fresh 任务）
    expect(w.buildRow(buildId).errorMessage).toBe('已取消');
    // 取消后 stopPending 无残留（无机器可通知，不落 pending）。
    expect(w.s.db.select().from(stopPendingTable).all()).toHaveLength(0);
  });

  test('失败方式 3：claimed 步 → 单槽 pending + SSE stop 信号 + 202 delegated', async () => {
    const buildId = await w.startBuild(true);
    const claimed = await w.claim();
    const events: unknown[] = [];
    const unsubscribe = w.s.machineHub.subscribe(w.s.team.id, (ev) => events.push(ev));
    const res = await w.stop(buildId, true);
    unsubscribe();
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ delegated: true });
    expect(events).toEqual([{ type: 'stop', stepId: claimed.step.id }]);
    // 中断在途：步保持 claimed，phase 不动（planning），done(stopped) 才落账。
    expect(w.stepsOf(buildId)[0]!.status).toBe('claimed');
    expect(w.todoRow().phase).toBe('planning');
    const pending = w.s.db.select().from(stopPendingTable).all();
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      conversationId: buildId,
      stepId: claimed.step.id,
      discard: true,
    });
  });

  test('失败方式 4：拉取-确认（首拉/二拉/401/他机不消费）', async () => {
    const buildId = await w.startBuild(true);
    const claimed = await w.claim();
    await w.stop(buildId, false);
    const stepId = claimed.step.id;
    const noCred = await call(w.s.app, 'GET', `/api/machine/stop?stepId=${stepId}`);
    expect(noCred.status).toBe(401);
    // 他机拉取 → null 且 pending 不清（steer 同律）。
    const other = await call(w.s.app, 'GET', `/api/machine/stop?stepId=${stepId}`, {
      cred: w.otherToken,
    });
    expect(await other.json()).toEqual({ discard: null });
    expect(w.s.db.select().from(stopPendingTable).all()).toHaveLength(1);
    const first = await call(w.s.app, 'GET', `/api/machine/stop?stepId=${stepId}`, {
      cred: w.token,
    });
    expect(await first.json()).toEqual({ discard: false }); // false ≠ null（勾选位如实）
    const second = await call(w.s.app, 'GET', `/api/machine/stop?stepId=${stepId}`, {
      cred: w.token,
    });
    expect(await second.json()).toEqual({ discard: null });
  });

  test('失败方式 5：旧步 pending → 新步拉取 null + 丢弃', async () => {
    const buildId = await w.startBuild(true);
    const first = await w.claim();
    await w.uploadPlan(first.step.id, '# plan v1');
    await w.stop(buildId, true);
    // 竞态：机器在拉取前自然完成 → pending 定向旧步。
    await w.done(first.step.id, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');
    await w.confirm(buildId);
    const next = await w.claim();
    expect(next.step.id).not.toBe(first.step.id);
    const fetch = await call(w.s.app, 'GET', `/api/machine/stop?stepId=${next.step.id}`, {
      cred: w.token,
    });
    expect(await fetch.json()).toEqual({ discard: null });
    expect(w.s.db.select().from(stopPendingTable).all()).toHaveLength(0);
  });

  test('失败方式 6a：停首轮 plan 步（claimed → done(stopped)）→ prevPhase 回落', async () => {
    const buildId = await w.startBuild(true);
    const claimed = await w.claim();
    await w.stop(buildId, true);
    await w.done(claimed.step.id, { status: 'stopped', sessionId: 'pi-s-1' });
    expect(w.stepsOf(buildId)[0]!.status).toBe('stopped');
    expect(w.todoRow().phase).toBe('todo');
    expect(w.buildRow(buildId).errorMessage).toBe('已取消');
    // steps 读面透出 stopped（stepJournalRow 词表）。
    const face = await call(w.s.app, 'GET', `/api/builds/${buildId}/steps`);
    expect(face.status).toBe(200);
    const rows = (await face.json()) as { status: string }[];
    expect(rows[0]!.status).toBe('stopped');
  });

  test('失败方式 6b/7：停 build 步 → confirm 回落（plan v1 保留）且不发通知', async () => {
    const buildId = await w.startBuild(true);
    const planStep = await w.claim();
    await w.uploadPlan(planStep.step.id, '# plan v1');
    await w.done(planStep.step.id, { status: 'success' });
    expect(w.todoRow().phase).toBe('confirm');
    await w.confirm(buildId);
    const buildStep = await w.claim();
    expect(w.todoRow().phase).toBe('building');
    const before = w.notificationCount();
    const chiefBefore = w.chiefStepCount();
    await w.stop(buildId, true);
    await w.done(buildStep.step.id, { status: 'stopped' });
    // gate 回落 = 上一完成 turn（plan）的关口 confirm；plan v1 保留。
    expect(w.todoRow().phase).toBe('confirm');
    const plans = w.s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get();
    expect(plans?.planDocId).not.toBeNull();
    // 回落绕过通知漏斗：无新增通知、无 chief wake 入队。
    expect(w.notificationCount()).toBe(before);
    expect(w.chiefStepCount()).toBe(chiefBefore);
    // stopPending 已清（done(stopped) 收尾卫生）。
    expect(w.s.db.select().from(stopPendingTable).all()).toHaveLength(0);
  });

  test('失败方式 6c：停 merge 步 → review 不动', async () => {
    const buildId = await w.startBuild(true);
    const planStep = await w.claim();
    await w.uploadPlan(planStep.step.id, '# plan v1');
    await w.done(planStep.step.id, { status: 'success' });
    await w.confirm(buildId);
    const buildStep = await w.claim();
    await w.done(buildStep.step.id, { status: 'success', hasChanges: true });
    expect(w.todoRow().phase).toBe('review');
    const merge = await call(w.s.app, 'POST', `/api/builds/${buildId}/merge`, { body: {} });
    expect(merge.status).toBe(202);
    const mergeStep = await w.claim();
    expect(mergeStep.step.kind).toBe('merge');
    await w.stop(buildId, false);
    await w.done(mergeStep.step.id, { status: 'stopped' });
    expect(w.todoRow().phase).toBe('review'); // 上一完成 turn（build）的关口
    expect(w.buildRow(buildId).errorMessage).toBe('已取消');
  });

  test('失败方式 8：双 stop 单槽覆盖（discard 后发为准）；stopped 后 409', async () => {
    const buildId = await w.startBuild(true);
    const claimed = await w.claim();
    await w.stop(buildId, true);
    await w.stop(buildId, false);
    const pending = w.s.db.select().from(stopPendingTable).all();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.discard).toBe(false);
    await w.done(claimed.step.id, { status: 'stopped' });
    const again = await w.stop(buildId, true);
    expect(again.status).toBe(409);
  });

  test('失败方式 9：stop 落账后 steer 拉取 → null（步非 claimed）', async () => {
    const buildId = await w.startBuild(true);
    const claimed = await w.claim();
    await call(w.s.app, 'POST', `/api/conversations/${buildId}/messages`, {
      body: { content: '顺便补一句' },
    });
    await w.stop(buildId, true);
    await w.done(claimed.step.id, { status: 'stopped' });
    const steerFetch = await call(w.s.app, 'GET', `/api/machine/steer?stepId=${claimed.step.id}`, {
      cred: w.token,
    });
    expect(await steerFetch.json()).toEqual({ content: null });
  });

  test('chief 会话不受 stop 面波及：chief- 前缀 id → 404（stop 以 build 表为门）', async () => {
    // stop 端点以 build 行存在为门（chief 会话无 build 行）——chief 停止面
    // 不在 #308 范围（composer 停止钮 = build 会话专属）。
    const res = await call(w.s.app, 'POST', '/api/builds/chief-stop-probe/stop', {
      body: { discard: true },
    });
    expect(res.status).toBe(404);
  });
});
