// 板面 UI 可靠性三缺陷（#1216）：真 web 生产构建 + 真 server + 假机器 wire
// （零 daemon 零 LLM——chief 编排回合由探针认领后直接 relay run_builds，
// 派发时序确定）。三条失败场景各自先钉「改前必现」的红：
//   ① 保存并开始：编排回合在飞期间卡面此前零标识、开始钮照亮——连点即
//      重复线程（生产库同卡 3–5 条「开始任务 #N」线程实证）。修复面 =
//      卡面/详情主钮翻禁用「编排中」+ 一次点击经 chief 派发进规划。
//   ② failed 重跑：点击后卡面与详情零状态变化（编排落位不写相位是 #640
//      设计，但「看不见在飞」被体验为无响应）。修复面 = 重跑必落新编排
//      线程 + 在飞态可见 + chief 派发后 buildHistory 增长可见。
//   ③ 详情缺失三态：todo 查询失败/未命中此前渲染成永久空白壳（return
//      null，无解释无重试无回板，删除入口够不着）。修复面 = 加载中/
//      加载失败(可重试)/不存在(回看板) 三态面板 + failed 卡详情可删。
//
// 假机器 wire 配方同 verify-cairn drive-903（enroll → claim → relay →
// done）；claim 响应双层包装 {step:{step,…}}。三台机器分道：M1 钉 ①的
// 规划步（钉选是 claim 硬约束，别机看不见，防陈旧步顶歪后续认领）、M2 走
// chief 回合与 ②的执行步、M3 铺垫失败卡。waitForStep 对计划外 chief 步
// （零改动闸触发的 wake 轮）done 收掉——无级联；plan/build 步按 buildId
// 钉死判据，认领面永不歧义。

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { orchestrateThreadTitle } from '@cairn/shared';
import { type Browser, chromium, type Page, expect as pexpect } from '@playwright/test';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { chiefThread, todo as todoTable } from '../../apps/server/src/db/schema.js';
import { AGENT_ID, api, bootRealServer, type RealServer, waitFor } from './helpers.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const WEB_DIST = join(ROOT, 'apps/web/dist');

let server: RealServer;
let browser: Browser;
let page: Page;
let projectId = '';
let tokens: { m1: string; m2: string; m3: string }; // machine wire token

const SPECS = {
  oneClick: '一次点击进规划探针：回复 ok 即可。',
  rerun: '重跑探针：构建失败后重跑必须产生新 build。',
  deletable: '删除探针：failed 卡详情必须可删。',
};

// —— DB 真值辅助 ————————————————————————————————————————————————

function orchestrateThreads(seqNum: number) {
  return server.db
    .select()
    .from(chiefThread)
    .where(eq(chiefThread.title, orchestrateThreadTitle(seqNum)))
    .all();
}

function latestBuildIdOf(todoId: string): string | null {
  return (
    server.db.select().from(todoTable).where(eq(todoTable.id, todoId)).get()?.latestBuildId ?? null
  );
}

// —— 假机器 wire（drive-903 同方）———————————————————————————————

async function machineFetch(
  token: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return {
    status: res.status,
    body: (await res.json().catch(() => ({}))) as Record<string, unknown>,
  };
}

interface ClaimedStep {
  id: string;
  kind: string;
  buildId: string;
}

/** 认领下一步（无步时 server 长轮询 claimHoldMs≈1s 后空手而归 → null）。 */
async function claimStep(token: string): Promise<ClaimedStep | null> {
  const res = await machineFetch(token, 'POST', '/api/machine/tasks/claim', {});
  if (res.status !== 200) throw new Error(`claim → ${res.status} ${JSON.stringify(res.body)}`);
  const payload = res.body.step as { step?: ClaimedStep } | undefined;
  const claimed = (payload?.step ?? payload) as ClaimedStep | undefined;
  return claimed?.id != null ? claimed : null;
}

async function relayRunBuilds(
  stepId: string,
  token: string,
  input: { todoIds: string[]; withPlan: boolean },
): Promise<void> {
  const res = await machineFetch(token, 'POST', `/api/machine/tool/${stepId}`, {
    name: 'run_builds',
    params: {
      todoIds: input.todoIds,
      withPlan: input.withPlan,
      dispatchReason: '#1216 集成探针派发',
      assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
    },
  });
  if (res.status !== 200)
    throw new Error(`relay run_builds → ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
}

async function doneStep(
  token: string,
  stepId: string,
  status: 'success' | 'failed',
  extra?: { errorMessage?: string; hasChanges?: boolean },
): Promise<void> {
  const res = await machineFetch(token, 'POST', `/api/machine/done/${stepId}`, {
    status,
    ...(extra?.errorMessage !== undefined ? { errorMessage: extra.errorMessage } : {}),
    ...(extra?.hasChanges !== undefined ? { hasChanges: extra.hasChanges } : {}),
  });
  if (res.status !== 200)
    throw new Error(`done → ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
}

/** 反复 claim 直到拿到满足判定的步；计划外 chief 步（零改动闸的 wake 轮）
 *  done 收掉（无级联），plan/build 步判据按 buildId 钉死不该出现别的。 */
async function waitForStep(
  token: string,
  predicate: (s: ClaimedStep) => boolean,
  timeoutMs = 30_000,
): Promise<ClaimedStep> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const step = await claimStep(token);
    if (step !== null) {
      if (predicate(step)) return step;
      if (step.kind === 'chief') {
        await doneStep(token, step.id, 'success');
        continue;
      }
      throw new Error(`claim 到计划外的步：${JSON.stringify(step)}`);
    }
    if (Date.now() > deadline) throw new Error('waitForStep 超时：判据步始终未出现');
    await new Promise((r) => setTimeout(r, 200));
  }
}

/** 认领并跑完一整个 chief 编排回合：claim → relay run_builds → done。 */
async function runChiefDispatch(
  token: string,
  threadId: string,
  input: { todoIds: string[]; withPlan: boolean },
): Promise<void> {
  const claimed = await waitForStep(token, (s) => s.buildId === threadId && s.kind === 'chief');
  await relayRunBuilds(claimed.id, token, input);
  await doneStep(token, claimed.id, 'success');
}

// —— 铺垫辅助 ————————————————————————————————————————————————

/** 造一张 failed 卡：建 todo → API 起直执行 build → 认领 → 上报失败。 */
async function seedFailedTodo(
  title: string,
  spec: string,
  claimToken: string,
): Promise<{ id: string; seqNum: number }> {
  const created = await api(server.url, 'POST', `/api/projects/${projectId}/todos`, {
    title,
    spec,
  });
  expect(created.status).toBe(201);
  const record = created.body as { id: string; seqNum: number };
  const started = await api(server.url, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [record.id],
    assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
    withPlan: false,
  });
  expect(started.status).toBe(201);
  const buildId = (started.body as { builds: { id: string }[] }).builds[0]?.id;
  if (buildId == null) throw new Error(`startBuilds 响应无 build：${JSON.stringify(started.body)}`);
  const step = await waitForStep(claimToken, (s) => s.buildId === buildId && s.kind === 'build');
  await doneStep(claimToken, step.id, 'failed', { errorMessage: '探针：让这一轮失败' });
  await waitFor(() => server.todoPhase(record.id) === 'failed', 15_000);
  return record;
}

// —— UI 辅助 ————————————————————————————————————————————————

async function openBoard(): Promise<void> {
  await page.goto(`${server.url}/app`);
  await pexpect(
    page.getByRole('complementary').getByRole('button', { name: '新任务' }),
  ).toBeVisible({ timeout: 30_000 });
}

async function openDetailByTitle(title: string): Promise<void> {
  await page.goto(`${server.url}/app`);
  await page.getByRole('link', { name: title }).click();
  await pexpect(page.locator('.detail-shell [data-testid="detail-main"]')).toBeVisible({
    timeout: 15_000,
  });
}

/** 列定位（列头无逐列 testid，按列名文本锚 section）。 */
function cardInColumn(columnName: string, todoId: string) {
  return page
    .locator('section', {
      has: page.locator('.board-column-name', { hasText: columnName }),
    })
    .locator(`[data-todo-id="${todoId}"]`);
}

beforeAll(async () => {
  // web 生产构建（scenario-blind = 恒 live 数据源；集成面文件串行，#349）。
  const build = spawnSync('pnpm', ['--filter', '@cairn/web', 'exec', 'vite', 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  if (build.status !== 0) {
    throw new Error(`web build failed:\n${build.stdout}\n${build.stderr}`);
  }
  if (!existsSync(join(WEB_DIST, 'index.html'))) {
    throw new Error(`web dist missing at ${WEB_DIST}`);
  }
  server = await bootRealServer({
    // 假机器 wire 全程零 LLM 调用——provider 行只是 seed 位，指不存在口。
    providerBaseUrl: 'http://127.0.0.1:1/never-called',
    claimHoldMs: 1_000,
    webDir: WEB_DIST,
  });
  // chief 绑定（orchestrate 的 requireBoundAgent 前置）+ 探针项目。
  const patch = await api(server.url, 'PATCH', `/api/teams/${server.teamId}/chief`, {
    agent: { agentId: AGENT_ID, thinkingLevel: null },
  });
  expect(patch.status).toBe(200);
  const project = await api(server.url, 'POST', '/api/projects', {
    name: 'trio-probe',
    repoKind: 'hosted',
    teamId: server.teamId,
  });
  expect(project.status).toBe(201);
  projectId = (project.body as { id: string }).id;
  // 机器 wire：每台机器各持各的 api-key——机器身份按 key/team 认（同 key
  // 二次 enroll 复用同一 machineId，drive-895 同款 gotcha）。
  const enroll = async (name: string) => {
    const key = await api(server.url, 'POST', `/api/teams/${server.teamId}/api-keys`, {
      name: `${name}-key`,
      gitAccess: false,
      mcpAccess: false,
      toolGrants: { read: [], write: [] },
    });
    const keyBody = key.body as { plaintext?: string; record?: { plaintext?: string } };
    const keyPlain = keyBody.plaintext ?? keyBody.record?.plaintext;
    if (keyPlain == null) throw new Error(`api-key 无 plaintext：${JSON.stringify(key.body)}`);
    const res = await fetch(`${server.url}/api/machine/enroll`, {
      method: 'POST',
      headers: { authorization: `Bearer ${keyPlain}`, 'content-type': 'application/json' },
      body: JSON.stringify({ teamId: server.teamId, name, cliVersion: '0.1.0' }),
    });
    const body = (await res.json()) as { machineId?: string; token?: string };
    if (res.status !== 200 || body.token == null || body.machineId == null)
      throw new Error(`enroll ${name} → ${res.status} ${JSON.stringify(body)}`);
    return { id: body.machineId, token: body.token };
  };
  // #1259：三台照旧 enroll（wire 配方不变），agent 归属 = 首台 M1（helpers
  // 绑定缺省）——认领面统一走 M1，m2/m3 只是「团队里别的机器」的在场形。
  const [e1, e2, e3] = [await enroll('trio-m1'), await enroll('trio-m2'), await enroll('trio-m3')];
  tokens = { m1: e1.token, m2: e2.token, m3: e3.token };
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
}, 300_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe('#1216 板面 UI 可靠性三缺陷（真 web dist + 真 server + 假机器 wire）', () => {
  test('① 保存并开始：一次点击进派发流，在飞态拒重复编排', async () => {
    await openBoard();
    await page.getByRole('complementary').getByRole('button', { name: '新任务' }).click();
    await pexpect(page.locator('.new-task-spec')).toBeVisible();
    await page.locator('.new-task-spec').fill(SPECS.oneClick);
    await page.locator('.new-task-dialog').getByRole('button', { name: '保存并开始' }).click();

    // 落库真值：todo + 恰好一条编排线程（保存并开始的第二跳真的发了）。
    let todoId = '';
    let seqNum = 0;
    await waitFor(() => {
      const row = server.db
        .select()
        .from(todoTable)
        .all()
        .find((t) => t.spec.startsWith('一次点击进规划探针'));
      if (row === undefined) return false;
      todoId = row.id;
      seqNum = row.seqNum;
      return true;
    }, 15_000);
    await waitFor(() => orchestrateThreads(seqNum).length === 1, 15_000);

    // 修复面：在飞编排期间卡面「开始」让位给「编排中」底栏——改前此处是
    // 照亮的「开始」（连点即重复线程，生产库 #30 五连实证）。
    const card = page.locator(`[data-todo-id="${todoId}"]`);
    await pexpect(card.locator('.todo-card-orchestration')).toContainText('编排中', {
      timeout: 15_000,
    });
    await pexpect(card.locator('.todo-card-action')).toHaveCount(0);
    // 重复点击不可能：卡上没有可点的「开始」；线程数保持 1（无重复编排回合）。
    expect(orchestrateThreads(seqNum).length).toBe(1);

    // chief 派发（假机器认领编排回合 → relay run_builds → done）：一次点击
    // 的因果链走到底——相位离开 待开始（queued = 已启动等机器，02 §4.2），
    // 规划步入队。#1259：agent 归属机 = 首台 enroll 的 M1（helpers 绑定
    // 缺省），认领面统一走 M1（钉选已退役）。
    const thread = orchestrateThreads(seqNum)[0];
    if (thread === undefined) throw new Error('编排线程缺席');
    await runChiefDispatch(tokens.m1, thread.id, {
      todoIds: [todoId],
      withPlan: true,
    });
    await waitFor(() => server.todoPhase(todoId) === 'queued', 15_000);
    const buildId = latestBuildIdOf(todoId);
    if (buildId == null) throw new Error('run_builds 后 latestBuildId 缺席');

    // M1 认领规划步 → planning（「进规划」的机器侧真值；归属机闸使它只对
    // M1 可见，后续用例的认领面不受它干扰）。
    const planStep = await waitForStep(
      tokens.m1,
      (s) => s.buildId === buildId && s.kind === 'plan',
    );
    expect(planStep.kind).toBe('plan');
    await waitFor(() => server.todoPhase(todoId) === 'planning', 15_000);

    // UI 同步（SSE → invalidate，无 reload）：卡进 执行中 列；全程一条线程。
    await pexpect(cardInColumn('执行中', todoId)).toBeVisible({ timeout: 30_000 });
    expect(orchestrateThreads(seqNum).length).toBe(1);
  }, 180_000);

  test('② failed 重跑：线程必落 + 在飞态可见 + chief 派发后 buildHistory 增长', async () => {
    const seeded = await seedFailedTodo('重跑探针卡', SPECS.rerun, tokens.m1);
    await openDetailByTitle('重跑探针卡');

    // failed 详情主钮 = 重跑（相位词表），点开 dialog 再点 重跑。
    await pexpect(page.locator('.detail-head-action')).toHaveText('重跑');
    await page.locator('.detail-head-action').click();
    const dialog = page.locator('[role="dialog"]', { hasText: '这张任务将交给总管重新编排。' });
    await pexpect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '重跑' }).click();

    // 修复面：重跑点击必落新编排线程（改前生产实测两次点击零线程零提示）；
    // 主钮翻禁用「编排中」——在飞窗口不再零反馈。
    await waitFor(() => orchestrateThreads(seeded.seqNum).length === 1, 15_000);
    await pexpect(page.locator('.detail-head-action[data-orchestrating="true"]')).toHaveText(
      '编排中',
      { timeout: 15_000 },
    );
    await pexpect(page.locator('.detail-head-action[data-orchestrating="true"]')).toBeDisabled();

    // chief 派发（不钉机器，直执行）→ 新 build 落库：buildHistory 增长、
    // 相位离开 failed——「重跑必产生新 build」的可见闭环。
    const thread = orchestrateThreads(seeded.seqNum)[0];
    if (thread === undefined) throw new Error('重跑编排线程缺席');
    await runChiefDispatch(tokens.m1, thread.id, {
      todoIds: [seeded.id],
      withPlan: false,
    });
    await waitFor(() => server.todoPhase(seeded.id) === 'queued', 15_000);
    const record = (await api(server.url, 'GET', `/api/todos/${seeded.id}`)).body as {
      buildHistory: unknown[];
    };
    expect(record.buildHistory.length).toBe(2);

    // UI 离开失败面（chip 不再是 失败）。
    await pexpect(page.locator('.detail-chip')).not.toHaveText('失败', { timeout: 30_000 });

    // 收道：执行步认领后按 done 上报——零改动闸收尾 failed（生产 #27 同形，
    // errorMessage「构建零改动」），触发的 chief wake 轮由下一用例的
    // waitForStep 收掉，不留计划外 pending。
    const rerunBuildId = latestBuildIdOf(seeded.id);
    if (rerunBuildId == null) throw new Error('重跑后 latestBuildId 缺席');
    const buildStep = await waitForStep(
      tokens.m1,
      (s) => s.buildId === rerunBuildId && s.kind === 'build',
    );
    await doneStep(tokens.m1, buildStep.id, 'success', { hasChanges: false });
    await waitFor(() => server.todoPhase(seeded.id) === 'failed', 15_000);
  }, 180_000);

  test('③ failed 卡详情可删除；缺失/失败详情出解释态不出空白壳', async () => {
    const seeded = await seedFailedTodo('删除探针卡', SPECS.deletable, tokens.m1);

    // failed 详情正常渲染（改前生产实测：failed 卡详情白屏，删除够不着）。
    await openDetailByTitle('删除探针卡');
    await pexpect(page.locator('.detail-head-action')).toHaveText('重跑');

    // 删除链：更多 → 删除 → 确认层 → 回看板 + server 行消失。
    await page.locator('button[aria-label="更多"]').click();
    await page.getByRole('menuitem', { name: '删除' }).click();
    const confirm = page.locator('[role="alertdialog"][aria-label="删除任务"]');
    await pexpect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: '删除' }).click();
    await waitFor(async () => {
      const res = await fetch(`${server.url}/api/todos/${seeded.id}`);
      return res.status === 404;
    }, 15_000);
    await pexpect(page).toHaveURL(/\/app$/);
    await pexpect(page.locator(`[data-todo-id="${seeded.id}"]`)).toHaveCount(0);

    // 不存在的 id：改前 = 永久空白壳（return null，root 只剩总管球）；
    // 改后 = not-found 面板 + 回看板出口。
    await page.goto(`${server.url}/app/todo/does-not-exist-1216`);
    const unavailable = page.locator('[data-testid="detail-unavailable"]');
    await pexpect(unavailable).toBeVisible({ timeout: 15_000 });
    await pexpect(unavailable).toHaveAttribute('data-state', 'not-found');
    await unavailable.getByRole('button', { name: '回看板' }).click();
    await pexpect(page).toHaveURL(/\/app$/);
    await pexpect(
      page.getByRole('complementary').getByRole('button', { name: '新任务' }),
    ).toBeVisible();

    // 查询失败（网络层拒绝）：改前同为空白壳；改后 = error 态 + 重试钮，
    // 重试放通后页面自愈进正常详情（用②的失败卡——正是生产白屏那张的形态）。
    const rerunRow = server.db
      .select()
      .from(todoTable)
      .all()
      .find((t) => t.spec.startsWith('重跑探针'));
    if (rerunRow === undefined) throw new Error('重跑探针卡缺席（② 未跑成？）');
    await page.route('**/api/todos**', (route) => route.abort());
    await page.goto(`${server.url}/app/todo/${rerunRow.id}`);
    await pexpect(unavailable).toBeVisible({ timeout: 15_000 });
    await pexpect(unavailable).toHaveAttribute('data-state', 'error');
    await page.unroute('**/api/todos**');
    await unavailable.getByRole('button', { name: '重试' }).click();
    await pexpect(page.locator('.detail-shell [data-testid="detail-main"]')).toBeVisible({
      timeout: 15_000,
    });
  }, 180_000);
});
