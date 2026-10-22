// #1236 完成任务确认 dialog（真 web dist + 真 server + 假机器 wire，零 daemon
// 零 LLM——merge/plan/build 步由探针认领后直接回报，时序确定）。
//
// 生产取证（卡 #44，2026-10-12）：rework 卡在 review 点「更多 → 完成 → 完成」
// 后 dialog 关闭、相位不变、库里零 merge 步零宣告行——POST 从未发出。钉住的
// 失败方式，逐条对应一个测试：
//  1. 静默 no-op：详情页单卡查询未就位（失败/在途）时页面从列表缓存渲染出
//     review 面，dialog 确认此前因 onConfirm 缺位走 onClose——弹层关闭、零
//     请求、零反馈。修复面 = 目标缺失时弹层不关、role=alert 行可见报错。
//  2. 202 后零反馈：merge 是 delegated 语义，弹层关闭后相位要等机器跑完合并
//     步才推进，此前中间无任何成功提示。修复面 = 202 即 success toast +
//     时间线宣告行；假机器收尾合并步 → 相位 done。
//  3. 合并勾选语义：checkbox 此前是装饰（勾与不勾都发 merge）。修复面 =
//     勾选语义对齐参照产品（r1 §153：不勾 = 完成任务、分支保持原状）——
//     不勾 = PATCH phase done（#901 板面 done 落位闸同一写面语义，server 落
//     DONE_ANNOUNCEMENT 审计行），零 merge 步。
//  4. server 拒绝被压平：409（相位漂移 / #1217 双 PR 守卫）此前被压成固定句
//     「合并请求未送出」——失实（请求送出了）且丢可操作信息。修复面 = 4xx
//     server 文案原样透出、弹层不关。
//  5. failed 卡（build 腿已交付，#702 恢复面）：done 只能经合并步落地
//     （failed→done 不是相位机边），勾选框锁死不给出「不合并完成」的假选项。
//
// 多 build 态完成语义（票面验收 3）：合并路恒指向 latestBuildId（当前轮分支，
// rework 复用路 = 同一 build 续轮）；不合并完成是 todo 级动作，与 build 数无
// 关。腿 2 用 rework 卡（revision 回流轮，卡 #44 同形）、腿 3 用单 build 卡
// （验收 4 回归：单 build 完成流程不变）。
//
// 证据截图：DONE_DIALOG_EVIDENCE=<dir> DONE_DIALOG_LABEL=<前缀> 时落盘
// （before/after 双腿各跑一遍），默认不落。

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Browser, chromium, type Page, expect as pexpect } from '@playwright/test';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import {
  build as buildTable,
  message as messageTable,
  plan as planTable,
  step as stepTable,
} from '../../apps/server/src/db/schema.js';
import { AGENT_ID, api, bootRealServer, type RealServer, waitFor } from './helpers.js';

const ROOT = resolve(fileURLToPath(import.meta.url), '../../..');
const WEB_DIST = join(ROOT, 'apps/web/dist');

const EVIDENCE_DIR = process.env.DONE_DIALOG_EVIDENCE ?? null;
const EVIDENCE_LABEL = process.env.DONE_DIALOG_LABEL ?? 'shot';

let server: RealServer;
let browser: Browser;
let page: Page;
let projectId = '';
let machineToken = '';

const PLAN_MD =
  '# Plan\n\nContext: 探针。\nChanges: 探针改动。\nEdge cases: 无。\nVerification: 集成测试。\n';

// —— DB 真值辅助 ————————————————————————————————————————————————

type StepKind = 'build' | 'chief' | 'merge' | 'plan' | 'review';

function stepsOf(buildId: string, kind?: StepKind) {
  return server.db
    .select()
    .from(stepTable)
    .where(
      kind === undefined
        ? eq(stepTable.buildId, buildId)
        : and(eq(stepTable.buildId, buildId), eq(stepTable.kind, kind)),
    )
    .all();
}

function messagesOf(buildId: string): string {
  return JSON.stringify(
    server.db.select().from(messageTable).where(eq(messageTable.conversationId, buildId)).all(),
  );
}

// —— 假机器 wire（board-trio / drive-903 同方）———————————————————

async function machineFetch(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${server.url}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${machineToken}`,
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
async function claimStep(): Promise<ClaimedStep | null> {
  const res = await machineFetch('POST', '/api/machine/tasks/claim', {});
  if (res.status !== 200) throw new Error(`claim → ${res.status} ${JSON.stringify(res.body)}`);
  const payload = res.body.step as { step?: ClaimedStep } | undefined;
  const claimed = (payload?.step ?? payload) as ClaimedStep | undefined;
  return claimed?.id != null ? claimed : null;
}

async function doneStep(
  stepId: string,
  status: 'success' | 'failed',
  extra?: { errorMessage?: string; hasChanges?: boolean },
): Promise<void> {
  const res = await machineFetch('POST', `/api/machine/done/${stepId}`, {
    status,
    ...(extra?.errorMessage !== undefined ? { errorMessage: extra.errorMessage } : {}),
    ...(extra?.hasChanges !== undefined ? { hasChanges: extra.hasChanges } : {}),
  });
  if (res.status !== 200)
    throw new Error(`done → ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
}

/** 反复 claim 直到拿到本 build 满足判定的步。别卡 build 的步 = 前序腿失败
 *  留下的残步，按 failed 收掉（防一条红腿把后续腿的 claim 面全部污染——
 *  base 腿 merge 步留 pending 即此形）；本 build 的计划外步不该出现，出现即炸。 */
async function waitForStep(
  ownBuildId: string,
  predicate: (s: ClaimedStep) => boolean,
  timeoutMs = 30_000,
): Promise<ClaimedStep> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const step = await claimStep();
    if (step !== null) {
      if (step.buildId !== ownBuildId) {
        await doneStep(step.id, 'failed', { errorMessage: '探针残步收掉（前序腿遗留）' });
        continue;
      }
      if (predicate(step)) return step;
      throw new Error(`claim 到计划外的步：${JSON.stringify(step)}`);
    }
    if (Date.now() > deadline) throw new Error('waitForStep 超时：判据步始终未出现');
    await new Promise((r) => setTimeout(r, 200));
  }
}

// —— 铺垫辅助 ————————————————————————————————————————————————

let cardSeq = 0;

/** 造一张卡在 review 的任务。rework = 走一遍 #701 请求修改回流轮
 *  （review → revision → plan v1 落库 → confirm → build → review，
 *  生产卡 #44 同形：同一 build 多轮、latestBuildId 在位）。 */
async function driveToReview(spec: string, opts: { rework: boolean }) {
  cardSeq += 1;
  const title = `完成弹层探针 #${cardSeq}`;
  const created = await api(server.url, 'POST', `/api/projects/${projectId}/todos`, {
    title,
    spec,
  });
  expect(created.status).toBe(201);
  const todoId = (created.body as { id: string }).id;
  const started = await api(server.url, 'POST', `/api/projects/${projectId}/builds`, {
    todoIds: [todoId],
    assignment: { plan: { agentId: AGENT_ID }, build: { agentId: AGENT_ID } },
    withPlan: false,
  });
  expect(started.status).toBe(201);
  const buildId = (started.body as { builds: { id: string }[] }).builds[0]!.id;

  const runBuildStep = async () => {
    const step = await waitForStep(buildId, (s) => s.kind === 'build');
    await doneStep(step.id, 'success', { hasChanges: true });
    await waitFor(() => server.todoPhase(todoId) === 'review', 15_000);
  };
  await runBuildStep();

  if (opts.rework) {
    // review 关口人肉打回（#701）：review → planning + 重规划步入队。
    const revision = await api(server.url, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'revision',
      side: 'plan',
      feedback: '探针：请求修改，方案补一处边界说明。',
      clientMessageId: crypto.randomUUID(),
    });
    expect(revision.status).toBe(202);
    const planStep = await waitForStep(buildId, (s) => s.kind === 'plan');
    // plan.md 产物落库（真链路由 daemon 上传；探针直落同一行形——completeStep
    // 的 plan 腿只读 planTable 行）。
    server.db
      .insert(planTable)
      .values({
        id: `plan-probe-${planStep.id}`,
        buildId,
        version: 1,
        content: PLAN_MD,
        stepId: planStep.id,
        createdAt: Date.now(),
      })
      .run();
    server.db
      .update(buildTable)
      .set({ planDocId: `plan-probe-${planStep.id}` })
      .where(eq(buildTable.id, buildId))
      .run();
    await doneStep(planStep.id, 'success');
    await waitFor(() => server.todoPhase(todoId) === 'confirm', 15_000);
    const confirm = await api(server.url, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'confirm',
    });
    expect(confirm.status).toBe(202);
    await runBuildStep();
  }
  return { todoId, buildId, title };
}

// —— UI 辅助 ————————————————————————————————————————————————

async function openDetailViaBoard(title: string): Promise<void> {
  await page.goto(`${server.url}/app`);
  await page.getByRole('link', { name: title }).click();
  await pexpect(page.locator('.detail-shell [data-testid="detail-main"]')).toBeVisible({
    timeout: 15_000,
  });
}

async function openAcceptDialog(): Promise<void> {
  await page.locator('.detail-head-icon--more').click();
  const menu = page.getByRole('menu', { name: '更多' });
  await pexpect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: '完成' }).click();
  await pexpect(page.getByRole('dialog', { name: '完成任务' })).toBeVisible();
}

function acceptDialog() {
  return page.getByRole('dialog', { name: '完成任务' });
}

async function shot(name: string): Promise<void> {
  if (EVIDENCE_DIR == null) return;
  mkdirSync(EVIDENCE_DIR, { recursive: true });
  await page.screenshot({ path: join(EVIDENCE_DIR, `${EVIDENCE_LABEL}-${name}.png`) });
}

beforeAll(async () => {
  // web 生产构建（scenario-blind = 恒 live 数据源；集成面文件串行，#349）。
  const build = spawnSync('pnpm', ['--filter', '@pacman/web', 'exec', 'vite', 'build'], {
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
  // local 形态项目：合并落地（applyMergeLanding）只对 hosted 生效，本文件的
  // 判据面是弹层→写面→相位，不是 bare repo 落地（那面归 g2t2）——local 让
  // 假机器回报的 merge 步不背真 commit 也能按生产语义走完 completeStep。
  const userRepo = mkdtempSync(join(tmpdir(), 'pacman-done-dialog-repo-'));
  spawnSync('git', ['init', '-b', 'main'], { cwd: userRepo });
  const project = await api(server.url, 'POST', '/api/projects', {
    name: 'done-dialog-probe',
    repoKind: 'local',
    localPath: userRepo,
    teamId: server.teamId,
  });
  expect(project.status).toBe(201);
  projectId = (project.body as { id: string }).id;
  const key = await api(server.url, 'POST', `/api/teams/${server.teamId}/api-keys`, {
    name: 'done-dialog-m1-key',
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
    body: JSON.stringify({ teamId: server.teamId, name: 'done-dialog-m1', cliVersion: '0.1.0' }),
  });
  const body = (await res.json()) as { token?: string };
  if (res.status !== 200 || body.token == null)
    throw new Error(`enroll → ${res.status} ${JSON.stringify(body)}`);
  machineToken = body.token;
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 732 } });
}, 300_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe('#1236 完成任务确认 dialog（真 web dist + 真 server + 假机器 wire）', () => {
  test('① 单卡查询未就位：确认不静默关——弹层留着、alert 可见、零请求、相位不动', async () => {
    const card = await driveToReview('静默 no-op 探针：详情单卡查询失败时确认不得静默。', {
      rework: true,
    });
    let merges = 0;
    await page.route('**/api/builds/*/merge', (route) => {
      merges += 1;
      return route.continue();
    });
    // 单卡读面失败（列表读面照活）——页面从列表缓存渲染出 review 面，
    // wireTodo 缺位 ⇒ buildId 缺位（生产卡 #44 的取证同形：零 POST 落库）。
    await page.route(`**/api/todos/${card.todoId}`, (route) => route.abort());
    try {
      await page.goto(`${server.url}/app/todo/${card.todoId}`);
      await pexpect(page.locator('.detail-shell [data-testid="detail-main"]')).toBeVisible({
        timeout: 15_000,
      });
      await openAcceptDialog();
      const dialog = acceptDialog();
      await dialog.getByRole('button', { name: '完成' }).click();
      // 点击落定后再拍（before 腿 = 弹层已静默关闭的页面；after 腿 = alert
      // 行在位）——shot 先于断言，红腿也留得下证据。
      await page.waitForTimeout(600);
      await shot('silent-noop');
      // 修复面：弹层不关 + 可见报错；改前此处弹层静默关闭（onConfirm 缺位
      // 走 onClose），下面两条断言即红。
      await pexpect(dialog).toBeVisible();
      await pexpect(dialog.getByRole('alert')).toHaveText(
        '任务数据未就绪，完成请求未送出。请刷新页面后重试。',
      );
      expect(merges).toBe(0);
      expect(server.todoPhase(card.todoId)).toBe('review');
    } finally {
      await page.unroute(`**/api/todos/${card.todoId}`);
      await page.unroute('**/api/builds/*/merge');
    }
  }, 120_000);

  test('② rework 卡合并完成：202 即可见成功反馈，机器收尾合并步后相位进 done', async () => {
    const card = await driveToReview('合并完成探针：rework 卡 review 点完成必须真落地。', {
      rework: true,
    });
    await openDetailViaBoard(card.title);
    await openAcceptDialog();
    const dialog = acceptDialog();
    await dialog.getByRole('button', { name: '完成' }).click();
    await page.waitForTimeout(600);
    await shot('merge-toast');
    // 成功反馈立即可见（改前：弹层关闭后到相位推进之间零标识）。
    await pexpect(page.getByText('已发起合并，合并完成后任务进入已完成。')).toBeVisible();
    await pexpect(dialog).toHaveCount(0);
    // 恰好一条 merge 步入队（confirm 在飞禁用 = 双击不双发）+ 宣告行落库。
    await waitFor(() => stepsOf(card.buildId, 'merge').length >= 1, 10_000);
    expect(stepsOf(card.buildId, 'merge').length).toBe(1);
    expect(messagesOf(card.buildId)).toContain('发起了合并');
    // 假机器收尾合并步 → 相位 done + 🎉 时间线行。
    const mergeStep = await waitForStep(card.buildId, (s) => s.kind === 'merge');
    await doneStep(mergeStep.id, 'success');
    await waitFor(() => server.todoPhase(card.todoId) === 'done', 15_000);
    expect(messagesOf(card.buildId)).toContain('🎉 任务已完成');
  }, 120_000);

  test('③ 不勾合并 = 完成但不合并：PATCH done 即落、零 merge 步、分支保持原状', async () => {
    const card = await driveToReview('不合并完成探针：checkbox 必须是真选项。', {
      rework: false,
    });
    await openDetailViaBoard(card.title);
    await openAcceptDialog();
    const dialog = acceptDialog();
    const box = dialog.locator('input[type="checkbox"]');
    await pexpect(box).toBeChecked();
    await dialog.getByRole('checkbox', { name: '将改动合并到默认分支' }).click();
    await pexpect(box).not.toBeChecked();
    await shot('uncheck');
    await dialog.getByRole('button', { name: '完成' }).click();
    await pexpect(page.getByText('任务已完成，改动保留在会话分支。')).toBeVisible();
    await waitFor(() => server.todoPhase(card.todoId) === 'done', 10_000);
    // 零 merge 步（不发起合并）+ #902 审计行在（PATCH done 同一写面有痕）。
    expect(stepsOf(card.buildId, 'merge').length).toBe(0);
    expect(messagesOf(card.buildId)).toContain('标记为已完成');
    await shot('done-without-merge');
  }, 120_000);

  test('④ server 拒绝（409）：弹层不关 + server 文案原样可见', async () => {
    const card = await driveToReview('拒绝可见探针：409 文案不得被压平。', { rework: false });
    const reject =
      '本任务已有已合并的 PR #1202，本 build 又开了 PR #1205——疑似重复交付，拒绝发起合并（请人工复核后处理）';
    await page.route(`**/api/builds/${card.buildId}/merge`, (route) =>
      route.fulfill({ status: 409, json: { error: reject } }),
    );
    try {
      await openDetailViaBoard(card.title);
      await openAcceptDialog();
      const dialog = acceptDialog();
      await dialog.getByRole('button', { name: '完成' }).click();
      await page.waitForTimeout(600);
      await shot('reject-409');
      await pexpect(dialog).toBeVisible();
      // 改前此处显示固定句「合并请求未送出，请重试。」——失实且丢可操作信息。
      await pexpect(dialog.getByRole('alert')).toHaveText(reject);
      expect(server.todoPhase(card.todoId)).toBe('review');
    } finally {
      await page.unroute(`**/api/builds/${card.buildId}/merge`);
    }
  }, 120_000);

  test('⑤ failed 卡（build 腿已交付）：合并勾选锁死——done 只能经合并落地', async () => {
    const card = await driveToReview('失败卡锁定探针：不许给出假选项。', { rework: false });
    // review → AI 审核步失败 → todo failed（#702 恢复面前置：build 腿 done）。
    const review = await api(server.url, 'POST', `/api/builds/${card.buildId}/steps`, {
      action: 'review',
      agentId: AGENT_ID,
    });
    expect(review.status).toBe(202);
    const reviewStep = await waitForStep(card.buildId, (s) => s.kind === 'review');
    await doneStep(reviewStep.id, 'failed', { errorMessage: '探针：审核步失败' });
    await waitFor(() => server.todoPhase(card.todoId) === 'failed', 15_000);

    await openDetailViaBoard(card.title);
    await openAcceptDialog();
    const dialog = acceptDialog();
    const box = dialog.locator('input[type="checkbox"]');
    // failed→done 不是相位机边（#702：done 仍只能经合并步落地）——不合并
    // 完成对 failed 卡是假选项：勾选锁死 + 原因写在旁边。
    await pexpect(box).toBeChecked();
    await pexpect(box).toBeDisabled();
    await pexpect(dialog.getByText('失败任务只能经合并完成，不能跳过合并。')).toBeVisible();
    await shot('failed-locked');
  }, 120_000);
});
