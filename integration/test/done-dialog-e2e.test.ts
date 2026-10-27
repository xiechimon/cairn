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
  '# Plan\nKind: fix\n\nContext: 探针。\nChanges: 探针改动。\nEdge cases: 无。\nVerification: 读回 README.md。\n';

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
        await doneStep(step.id, 'failed', { errorMessage: 'probe leftover step reaped' });
        continue;
      }
      if (predicate(step)) return step;
      throw new Error(`claimed an unexpected step: ${JSON.stringify(step)}`);
    }
    if (Date.now() > deadline)
      throw new Error('waitForStep timed out: criteria step never appeared');
    await new Promise((r) => setTimeout(r, 200));
  }
}

let cardSeq = 0;

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
    const revision = await api(server.url, 'POST', `/api/builds/${buildId}/steps`, {
      action: 'revision',
      side: 'plan',
      feedback: '探针：请求修改，方案补一处边界说明。',
      clientMessageId: crypto.randomUUID(),
    });
    expect(revision.status).toBe(202);
    const planStep = await waitForStep(buildId, (s) => s.kind === 'plan');
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

async function openDetailViaBoard(title: string): Promise<void> {
  await page.goto(`${server.url}/app?view=board`);
  await page.getByRole('link', { name: title }).click();
  await page
    .getByRole('complementary', { name: '任务面板' })
    .getByRole('link', { name: '展开为整页' })
    .click();
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
    providerBaseUrl: 'http://127.0.0.1:1/never-called',
    claimHoldMs: 1_000,
    webDir: WEB_DIST,
  });
  const userRepo = mkdtempSync(join(tmpdir(), 'cairn-done-dialog-repo-'));
  spawnSync('git', ['init', '-b', 'main'], { cwd: userRepo });
  const project = await api(server.url, 'POST', '/api/projects', {
    name: 'done-dialog-probe',
    repoKind: 'local',
    localPath: userRepo,
    teamId: server.teamId,
  });
  expect(project.status).toBe(201);
  projectId = (project.body as { id: string }).id;
  const policy = await api(server.url, 'PATCH', `/api/projects/${projectId}/merge-policy`, {
    mergePolicy: 'human',
  });
  expect(policy.status).toBe(200);
  const key = await api(server.url, 'POST', `/api/teams/${server.teamId}/api-keys`, {
    name: 'done-dialog-m1-key',
    gitAccess: false,
    mcpAccess: false,
    toolGrants: { read: [], write: [] },
  });
  const keyBody = key.body as { plaintext?: string; record?: { plaintext?: string } };
  const keyPlain = keyBody.plaintext ?? keyBody.record?.plaintext;
  if (keyPlain == null) throw new Error(`api-key has no plaintext: ${JSON.stringify(key.body)}`);
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
  page = await browser.newPage({ viewport: { width: 1440, height: 732 }, locale: 'zh-CN' });
}, 300_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe('#1236 task-done confirmation dialog (real web dist + real server + fake machine wire)', () => {
  test('① single-card query not ready: confirm does not close silently — dialog stays, alert visible, zero requests, phase unchanged', async () => {
    const card = await driveToReview('静默 no-op 探针：详情单卡查询失败时确认不得静默。', {
      rework: true,
    });
    let merges = 0;
    await page.route('**/api/builds/*/merge', (route) => {
      merges += 1;
      return route.continue();
    });
    await page.route(`**/api/todos/${card.todoId}`, (route) => route.abort());
    try {
      await page.goto(`${server.url}/app/todo/${card.todoId}`);
      await pexpect(page.locator('.detail-shell [data-testid="detail-main"]')).toBeVisible({
        timeout: 15_000,
      });
      await openAcceptDialog();
      const dialog = acceptDialog();
      await dialog.getByRole('button', { name: '完成' }).click();
      await page.waitForTimeout(600);
      await shot('silent-noop');
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

  test('② rework card merge done: success feedback visible at 202, phase reaches done after the machine finishes the merge step', async () => {
    const card = await driveToReview('合并完成探针：rework 卡 review 点完成必须真落地。', {
      rework: true,
    });
    await openDetailViaBoard(card.title);
    await openAcceptDialog();
    const dialog = acceptDialog();
    await dialog.getByRole('button', { name: '完成' }).click();
    await page.waitForTimeout(600);
    await shot('merge-toast');
    await pexpect(page.getByText('已发起合并，合并完成后任务进入已完成。')).toBeVisible();
    await pexpect(dialog).toHaveCount(0);
    await waitFor(() => stepsOf(card.buildId, 'merge').length >= 1, 10_000);
    expect(stepsOf(card.buildId, 'merge').length).toBe(1);
    expect(messagesOf(card.buildId)).toContain('发起了合并');
    const mergeStep = await waitForStep(card.buildId, (s) => s.kind === 'merge');
    await doneStep(mergeStep.id, 'success');
    await waitFor(() => server.todoPhase(card.todoId) === 'done', 15_000);
    expect(messagesOf(card.buildId)).toContain('🎉 任务已完成');
  }, 120_000);

  test('③ merge unchecked = done without merging: PATCH done lands immediately, zero merge steps, branch untouched', async () => {
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
    expect(stepsOf(card.buildId, 'merge').length).toBe(0);
    expect(messagesOf(card.buildId)).toContain('标记为已完成');
    await shot('done-without-merge');
  }, 120_000);

  test('④ server rejects (409): dialog stays open + server message visible verbatim', async () => {
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
      await pexpect(dialog.getByRole('alert')).toHaveText(reject);
      expect(server.todoPhase(card.todoId)).toBe('review');
    } finally {
      await page.unroute(`**/api/builds/${card.buildId}/merge`);
    }
  }, 120_000);

  test('⑤ failed card (build leg delivered): merge checkbox locked — done can only land via merge', async () => {
    const card = await driveToReview('失败卡锁定探针：不许给出假选项。', { rework: false });
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
    await pexpect(box).toBeChecked();
    await pexpect(box).toBeDisabled();
    await pexpect(dialog.getByText('失败任务只能经合并完成，不能跳过合并。')).toBeVisible();
    await shot('failed-locked');
  }, 120_000);
});
