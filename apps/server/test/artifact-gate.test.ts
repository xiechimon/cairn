// #703 产物闸（B-C10/B-C11/B-C14）：两道闸各自有物可看——方案步没写出方案
// 文档，进不了 confirm 闸；构建步零改动 / 假完成，进不了 review 闸。无物即
// 无闸（spec 18 §3.1）。完成判据 = 契约产物存在，不是会话结束（#519「每步
// 产物可核」的代码化）。
// 失败方式清单（票面五条，先固化再实现）：
//  1. 空方案进 confirm（B-C10）：plan 步 done 无方案文档 → 首轮 #113 补写轮
//     重试一次；补写轮仍无 → 按失败收尾（step failed + todo failed +
//     build.errorMessage「规划未产出方案」），confirm 不可达。
//  2. 零改动进 review（B-C11）：build 步 done success + hasChanges=false
//     （daemon worktree git 真值）→ 失败收尾「构建零改动」，review 不可达。
//  3. 假完成（B-C14 形状）：流中断 + auto_retry + 零产出 → done success 无
//     errorMessage —— plan 形落闸 1、build 形（零产出 ⇒ hasChanges false）落
//     闸 2，不当 done。
//  4. 误伤合法空产物：判定钉「本步该产什么」——review 步 hasChanges 恒 false
//     （只读收尾，#511）不受闸 2 影响；hasChanges 缺省（老 daemon 版本墙）
//     fail-open 照常过闸；有方案 / 有改动的步照常过闸。
//  5. 判定读错真值源：闸只读 daemon 侧真值（plan 行 = 产物上传通道；done
//     载荷 hasChanges = runner worktree git 判定），不读服务端 changes 投影
//     （readBuildChanges 对非 hosted 项目恒空——读它会把手动项目全拦死，
//     #704 地界）。本 harness 项目即无 repo 绑定：hasChanges=true 照常进
//     review = 投影恒空没有参与判定。
// 另钉：#113 补写触发条件从「prompt===null」改判「本 build 首个 plan 步」
//     ——失败重启轮（新 build 首步、prompt 带 restart 指令）同样享一次补写
//     重试，否则重启即硬失败。

import type { ClaimedStep } from '@pacman/shared';
import { claimedStepSchema, machineUploadUrlsResponseSchema, PLAN_FILE_NAME } from '@pacman/shared';
import { eq } from 'drizzle-orm';
import type { Hono } from 'hono';
import { describe, expect, test } from 'vitest';
import {
  agent as agentTable,
  build as buildTable,
  provider as providerTable,
  step as stepTable,
  todo as todoTable,
} from '../src/db/schema.js';
import { bindAllAgents, bootServer, issueApiKey, postProject } from './helpers.js';

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

const AGENT_ID = 'agent-ag-1';

/** plan-handoff 同款引导裁剪面：provider/agent + enroll + 项目/todo 就位。项目
 * 不绑 repo（#704 投影恒空形态 = 失败方式 5 的判定素材）。 */
async function setupWorld() {
  const s = bootServer({ claimHoldMs: 200 });
  const key = await issueApiKey(s);
  s.db
    .insert(providerTable)
    .values({
      id: 'prov-ag',
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
      displayName: 'ag-builder',
      provider: 'stub-gw',
      modelId: 'stub-model',
    })
    .run();
  const enrollRes = await call(s.app, 'POST', '/api/machine/enroll', {
    cred: key,
    body: { teamId: s.team.id, name: 'ag-mbp', cliVersion: '0.1.0' },
  });

  bindAllAgents(s); // #1259：测试世界单机——agent 全部绑它（可领缺省形态）
  const { token } = (await enrollRes.json()) as { token: string };
  const projectId = await postProject(s.app);
  const todoRes = await call(s.app, 'POST', `/api/projects/${projectId}/todos`, {
    body: { title: '闸探针任务', spec: '写一行探针到 README.md' },
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
  const todoRow = () => s.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()!;
  const buildRow = (buildId: string) =>
    s.db.select().from(buildTable).where(eq(buildTable.id, buildId)).get()!;
  const stepRow = (stepId: string) =>
    s.db.select().from(stepTable).where(eq(stepTable.id, stepId)).get()!;
  const stepsOf = (buildId: string) =>
    s.db.select().from(stepTable).where(eq(stepTable.buildId, buildId)).all();
  return {
    s,
    token,
    projectId,
    todoId,
    startBuild,
    claim,
    done,
    uploadPlan,
    todoRow,
    buildRow,
    stepRow,
    stepsOf,
  };
}

type World = Awaited<ReturnType<typeof setupWorld>>;

/** withPlan 链路走两轮空方案 plan 步（B-C10 形状：首轮 + 补写轮都不写 plan.md）。 */
async function runTwoEmptyPlanRounds(w: World): Promise<{ buildId: string; secondStepId: string }> {
  const buildId = await w.startBuild(true);
  const first = await w.claim();
  expect(first.step.kind).toBe('plan');
  await w.done(first.step.id, { status: 'success', sessionId: 'pi-1' });
  const second = await w.claim();
  expect(second.step.kind).toBe('plan');
  await w.done(second.step.id, { status: 'success', sessionId: 'pi-1' });
  return { buildId, secondStepId: second.step.id };
}

describe('闸 1（B-C10）：plan 步无方案文档 → confirm 不可达', () => {
  test('补写轮仍无 plan.md → 失败收尾：step failed + todo failed + errorMessage「规划未产出方案」', async () => {
    const w = await setupWorld();
    try {
      const { buildId, secondStepId } = await runTwoEmptyPlanRounds(w);
      // 不进 confirm（闸上无物）——按失败收尾，UI 失败行数据源 = build.errorMessage。
      expect(w.todoRow().phase).toBe('failed');
      expect(w.buildRow(buildId).errorMessage).toBe('规划未产出方案');
      expect(w.stepRow(secondStepId).status).toBe('failed');
      // 有界：两轮 plan 步封顶，失败收尾不追加第三补写步。
      expect(w.stepsOf(buildId).filter((st) => st.kind === 'plan')).toHaveLength(2);
    } finally {
      w.s.dispose();
    }
  });

  test('首轮无 plan.md 仍走 #113 补写轮（重试一次，不是直接失败）', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(true);
      const first = await w.claim();
      await w.done(first.step.id, { status: 'success', sessionId: 'pi-1' });
      expect(w.todoRow().phase).toBe('planning');
      expect(w.todoRow().hasPlan).toBe(false);
      const pending = w
        .stepsOf(buildId)
        .filter((st) => st.kind === 'plan' && st.status === 'pending');
      expect(pending).toHaveLength(1);
      expect(pending[0]!.prompt).toContain(PLAN_FILE_NAME);
    } finally {
      w.s.dispose();
    }
  });

  test('负例：补写轮写出 plan.md → 照常过闸进 confirm（hasPlan 置位）', async () => {
    const w = await setupWorld();
    try {
      await w.startBuild(true);
      const first = await w.claim();
      await w.done(first.step.id, { status: 'success', sessionId: 'pi-1' });
      const second = await w.claim();
      await w.uploadPlan(second.step.id, '# 方案\nContext: x');
      await w.done(second.step.id, { status: 'success', sessionId: 'pi-1' });
      expect(w.todoRow().phase).toBe('confirm');
      expect(w.todoRow().hasPlan).toBe(true);
    } finally {
      w.s.dispose();
    }
  });

  test('失败重启轮（新 build 首个 plan 步、prompt 带 restart 指令）→ 同样享一次补写重试', async () => {
    const w = await setupWorld();
    try {
      const { buildId } = await runTwoEmptyPlanRounds(w);
      expect(w.todoRow().phase).toBe('failed');
      // failed 面带反馈重启（#320）：新 build（withPlan 承接）+ 首步 prompt 带
      // restart 指令——prompt 非 null，但仍是本 build 首个 plan 步 → 补写重试
      // 而非直接硬失败（重启语义 = 再给一轮，不是即死）。
      const res = await call(w.s.app, 'POST', `/api/builds/${buildId}/steps`, {
        body: {
          action: 'restart',
          feedback: '请务必先写方案文档',
          clientMessageId: '3f9a0c2e-0000-4000-8000-000000000003',
        },
      });
      expect(res.status).toBe(202);
      expect(w.todoRow().phase).toBe('queued');
      const first = await w.claim();
      expect(first.step.kind).toBe('plan');
      await w.done(first.step.id, { status: 'success', sessionId: 'pi-restart' });
      // 首轮（本 build 无其它 plan 步）→ 补写步入队，todo 留 planning 不 failed。
      expect(w.todoRow().phase).toBe('planning');
      expect(
        w.stepsOf(first.step.buildId).filter((st) => st.kind === 'plan' && st.status === 'pending'),
      ).toHaveLength(1);
      // 补写轮仍无产物 → 失败收尾（同 build 的第二次 plan 完成 = 闸拦）。
      const rewrite = await w.claim();
      await w.done(rewrite.step.id, { status: 'success', sessionId: 'pi-restart' });
      expect(w.todoRow().phase).toBe('failed');
      expect(w.buildRow(rewrite.step.buildId).errorMessage).toBe('规划未产出方案');
    } finally {
      w.s.dispose();
    }
  });
});

describe('闸 2（B-C11/B-C14）：build 步零改动 / 假完成 → review 不可达', () => {
  test('done success + hasChanges=false → 失败收尾「构建零改动」', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(false);
      const buildStep = await w.claim();
      expect(buildStep.step.kind).toBe('build');
      expect(w.todoRow().phase).toBe('building'); // claim 已进 building
      await w.done(buildStep.step.id, {
        status: 'success',
        hasChanges: false,
        sessionId: 'pi-b1',
      });
      expect(w.todoRow().phase).toBe('failed');
      expect(w.buildRow(buildId).errorMessage).toBe('构建零改动');
      expect(w.stepRow(buildStep.step.id).status).toBe('failed');
    } finally {
      w.s.dispose();
    }
  });

  test('负例：hasChanges=true → 照常进 review（有物过闸）', async () => {
    const w = await setupWorld();
    try {
      await w.startBuild(false);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, {
        status: 'success',
        hasChanges: true,
        sessionId: 'pi-b2',
      });
      expect(w.todoRow().phase).toBe('review');
      expect(w.todoRow().hasChanges).toBe(true);
    } finally {
      w.s.dispose();
    }
  });

  test('版本墙负例：老 daemon 不携带 hasChanges → fail-open 照常 review', async () => {
    const w = await setupWorld();
    try {
      await w.startBuild(false);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, { status: 'success', sessionId: 'pi-b3' });
      expect(w.todoRow().phase).toBe('review');
    } finally {
      w.s.dispose();
    }
  });

  test('失败方式 3（B-C14 假完成形状）：done success 零产出零 errorMessage → 按失败收尾', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(false);
      const buildStep = await w.claim();
      // 流中断 + auto_retry + 零产出的机器回报形状：success、无 errorMessage、
      // 无产物（hasChanges=false）——不当 done，闸 2 拦下。
      await w.done(buildStep.step.id, {
        status: 'success',
        hasChanges: false,
        sessionId: 'pi-b4',
      });
      expect(w.todoRow().phase).toBe('failed');
      expect(w.stepRow(buildStep.step.id).status).toBe('failed');
      expect(w.buildRow(buildId).errorMessage).toBe('构建零改动');
    } finally {
      w.s.dispose();
    }
  });

  test('失败方式 4（不误伤）：review 步 hasChanges=false 照常收 verdict，不落 failed', async () => {
    const w = await setupWorld();
    try {
      await w.startBuild(false);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, {
        status: 'success',
        hasChanges: true,
        sessionId: 'pi-b5',
      });
      expect(w.todoRow().phase).toBe('review');
      const res = await call(w.s.app, 'POST', `/api/builds/${buildStep.step.buildId}/steps`, {
        body: { action: 'review', agentId: AGENT_ID },
      });
      expect(res.status).toBe(202);
      const reviewStep = await w.claim();
      expect(reviewStep.step.kind).toBe('review');
      // 审核步只读收尾恒报 hasChanges=false（#511 设计）——闸 2 只钉 build 步，
      // review 步零「改动」是合法空产物，不落 failed。
      await w.done(reviewStep.step.id, {
        status: 'success',
        hasChanges: false,
        sessionId: 'pi-r1',
      });
      expect(w.todoRow().phase).toBe('review');
      expect(w.stepRow(reviewStep.step.id).status).toBe('done');
      expect(w.buildRow(buildStep.step.buildId).errorMessage).toBeNull();
    } finally {
      w.s.dispose();
    }
  });

  test('失败方式 5（真值源）：无 repo 项目 hasChanges=true 照常 review——闸不读恒空投影', async () => {
    const w = await setupWorld();
    try {
      // 本 harness 项目不绑 repo：服务端 changes 投影（readBuildChanges）对该
      // 形态恒 files:[]。若闸读投影，这里会被「零改动」误拦——真值 = done
      // 载荷 hasChanges（daemon 侧 worktree 判定）。
      await w.startBuild(false);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, {
        status: 'success',
        hasChanges: true,
        sessionId: 'pi-b6',
      });
      expect(w.todoRow().phase).toBe('review');
    } finally {
      w.s.dispose();
    }
  });
});

// #1195 闸 2 的偏离点名面：agent 在自建分支交付（PR 已开）而收尾计数按会话
// 分支判零时，「构建零改动」把失败原因彻底说反（看起来像 agent 没干活）。
// daemon 收尾上报 workBranchDrift（expected=契约分支 / actual=实际 HEAD 分支）。
// #1277：偏离即硬失败，不再只在 hasChanges=false 时拒绝。失败方式：
//  6. hasChanges=false + drift → errorMessage 点名两分支且说明步窗口内无提交，
//     step/todo failed、review 不可达
//  7. hasChanges=true + drift → 同样硬失败（#1275 并集面：过闸进 review +
//     保留 PR 回填，在此反转）。原因点名两分支，不套用「未见任何提交」，
//     review 不可达，done 携带的 PR 不留在 build 行
//  8. hasChanges=false 无 drift → 「构建零改动」逐字不变（现状钉扎）
//  9. 版本墙：老 daemon 载荷（无 drift 字段）→ 行为与现状逐字一致
describe('闸 2 偏离点名（#1195）：分支偏离不再是「构建零改动」', () => {
  const DRIFT = {
    expected: 'pacman/conv-0198f6c0-0000-7000-8000-000000000000',
    actual: 'dogfood/tracer-1153-verification-note',
  };

  test('失败方式 6：hasChanges=false + workBranchDrift → 失败原因点名分支偏离', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(false);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, {
        status: 'success',
        hasChanges: false,
        workBranchDrift: DRIFT,
        sessionId: 'pi-d1',
      });
      expect(w.todoRow().phase).toBe('failed');
      expect(w.stepRow(buildStep.step.id).status).toBe('failed');
      const msg = w.buildRow(buildId).errorMessage ?? '';
      expect(msg).not.toBe('构建零改动');
      expect(msg).toContain(DRIFT.actual);
      expect(msg).toContain(DRIFT.expected);
    } finally {
      w.s.dispose();
    }
  });

  test('失败方式 7：hasChanges=true + workBranchDrift → 硬失败，点名两分支，不保留 PR', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(false);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, {
        status: 'success',
        hasChanges: true,
        workBranchDrift: DRIFT,
        prUrl: 'https://github.com/example/repo/pull/1277',
        prNumber: 1277,
        sessionId: 'pi-d2',
      });
      expect(w.todoRow().phase).toBe('failed');
      expect(w.stepRow(buildStep.step.id).status).toBe('failed');
      const msg = w.buildRow(buildId).errorMessage ?? '';
      expect(msg).toContain(DRIFT.actual);
      expect(msg).toContain(DRIFT.expected);
      expect(msg).not.toBe('构建零改动');
      expect(msg).not.toContain('未见任何提交');
      expect(w.buildRow(buildId).prUrl).toBeNull();
      expect(w.buildRow(buildId).prNumber).toBeNull();
    } finally {
      w.s.dispose();
    }
  });

  test('失败方式 9：老 daemon 载荷（无 drift 字段）→「构建零改动」不变', async () => {
    const w = await setupWorld();
    try {
      const buildId = await w.startBuild(false);
      const buildStep = await w.claim();
      await w.done(buildStep.step.id, {
        status: 'success',
        hasChanges: false,
        sessionId: 'pi-d3',
      });
      expect(w.buildRow(buildId).errorMessage).toBe('构建零改动');
    } finally {
      w.s.dispose();
    }
  });
});
