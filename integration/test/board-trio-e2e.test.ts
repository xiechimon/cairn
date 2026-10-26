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
let tokens: { m1: string; m2: string; m3: string };

const SPECS = {
  oneClick: '一次点击进规划探针：回复 ok 即可。',
  rerun: '重跑探针：构建失败后重跑必须产生新 build。',
  deletable: '删除探针：failed 卡详情必须可删。',
};

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
      throw new Error(`claimed an unexpected step: ${JSON.stringify(step)}`);
    }
    if (Date.now() > deadline)
      throw new Error('waitForStep timed out: criteria step never appeared');
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function runChiefDispatch(
  token: string,
  threadId: string,
  input: { todoIds: string[]; withPlan: boolean },
): Promise<void> {
  const claimed = await waitForStep(token, (s) => s.buildId === threadId && s.kind === 'chief');
  await relayRunBuilds(claimed.id, token, input);
  await doneStep(token, claimed.id, 'success');
}

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
  if (buildId == null)
    throw new Error(`startBuilds response has no build: ${JSON.stringify(started.body)}`);
  const step = await waitForStep(claimToken, (s) => s.buildId === buildId && s.kind === 'build');
  await doneStep(claimToken, step.id, 'failed', { errorMessage: '探针：让这一轮失败' });
  await waitFor(() => server.todoPhase(record.id) === 'failed', 15_000);
  return record;
}

async function openBoard(): Promise<void> {
  await page.goto(`${server.url}/app?view=board`);
  await pexpect(
    page.getByRole('complementary').getByRole('button', { name: '新任务' }),
  ).toBeVisible({ timeout: 30_000 });
}

async function openDetailByTitle(title: string): Promise<void> {
  await page.goto(`${server.url}/app?view=board`);
  await page.getByRole('link', { name: title }).click();
  await pexpect(page.locator('.detail-shell [data-testid="detail-main"]')).toBeVisible({
    timeout: 15_000,
  });
}

function cardInColumn(columnName: string, todoId: string) {
  return page
    .locator('section', {
      has: page.locator('.board-column-name', { hasText: columnName }),
    })
    .locator(`[data-todo-id="${todoId}"]`);
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
  const enroll = async (name: string) => {
    const key = await api(server.url, 'POST', `/api/teams/${server.teamId}/api-keys`, {
      name: `${name}-key`,
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
      body: JSON.stringify({ teamId: server.teamId, name, cliVersion: '0.1.0' }),
    });
    const body = (await res.json()) as { machineId?: string; token?: string };
    if (res.status !== 200 || body.token == null || body.machineId == null)
      throw new Error(`enroll ${name} → ${res.status} ${JSON.stringify(body)}`);
    return { id: body.machineId, token: body.token };
  };
  const [e1, e2, e3] = [await enroll('trio-m1'), await enroll('trio-m2'), await enroll('trio-m3')];
  tokens = { m1: e1.token, m2: e2.token, m3: e3.token };
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 1440, height: 732 }, locale: 'zh-CN' });
}, 300_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe('#1216 board UI reliability triple defect (real web dist + real server + fake machine wire)', () => {
  test('① save-and-start: one click enters the dispatch flow; in-flight state rejects duplicate orchestration', async () => {
    await openBoard();
    await page.getByRole('complementary').getByRole('button', { name: '新任务' }).click();
    await pexpect(page.locator('.new-task-spec')).toBeVisible();
    await page.locator('.new-task-spec').fill(SPECS.oneClick);
    await page.locator('.new-task-dialog').getByRole('button', { name: '保存并开始' }).click();

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

    const card = page.locator(`[data-todo-id="${todoId}"]`);
    await pexpect(card.locator('.todo-card-orchestration')).toContainText('编排中', {
      timeout: 15_000,
    });
    await pexpect(card.locator('.todo-card-action')).toHaveCount(0);
    expect(orchestrateThreads(seqNum).length).toBe(1);

    const thread = orchestrateThreads(seqNum)[0];
    if (thread === undefined) throw new Error('orchestration thread missing');
    await runChiefDispatch(tokens.m1, thread.id, {
      todoIds: [todoId],
      withPlan: true,
    });
    await waitFor(() => server.todoPhase(todoId) === 'queued', 15_000);
    const buildId = latestBuildIdOf(todoId);
    if (buildId == null) throw new Error('latestBuildId missing after run_builds');

    const planStep = await waitForStep(
      tokens.m1,
      (s) => s.buildId === buildId && s.kind === 'plan',
    );
    expect(planStep.kind).toBe('plan');
    await waitFor(() => server.todoPhase(todoId) === 'planning', 15_000);

    await pexpect(cardInColumn('执行中', todoId)).toBeVisible({ timeout: 30_000 });
    expect(orchestrateThreads(seqNum).length).toBe(1);
  }, 180_000);

  test('② failed rerun: thread must land + visible in-flight + buildHistory grows after chief dispatch', async () => {
    const seeded = await seedFailedTodo('重跑探针卡', SPECS.rerun, tokens.m1);
    await openDetailByTitle('重跑探针卡');

    await pexpect(page.locator('.detail-head-action')).toHaveText('重跑');
    await page.locator('.detail-head-action').click();
    const dialog = page.locator('[role="dialog"]', { hasText: '这张任务将交给总管重新编排。' });
    await pexpect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: '重跑' }).click();

    await waitFor(() => orchestrateThreads(seeded.seqNum).length === 1, 15_000);
    await pexpect(page.locator('.detail-head-action[data-orchestrating="true"]')).toHaveText(
      '编排中',
      { timeout: 15_000 },
    );
    await pexpect(page.locator('.detail-head-action[data-orchestrating="true"]')).toBeDisabled();

    const thread = orchestrateThreads(seeded.seqNum)[0];
    if (thread === undefined) throw new Error('rerun orchestration thread missing');
    await runChiefDispatch(tokens.m1, thread.id, {
      todoIds: [seeded.id],
      withPlan: false,
    });
    await waitFor(() => server.todoPhase(seeded.id) === 'queued', 15_000);
    const record = (await api(server.url, 'GET', `/api/todos/${seeded.id}`)).body as {
      buildHistory: unknown[];
    };
    expect(record.buildHistory.length).toBe(2);

    await pexpect(page.locator('.detail-chip')).not.toHaveText('失败', { timeout: 30_000 });

    const rerunBuildId = latestBuildIdOf(seeded.id);
    if (rerunBuildId == null) throw new Error('latestBuildId missing after rerun');
    const buildStep = await waitForStep(
      tokens.m1,
      (s) => s.buildId === rerunBuildId && s.kind === 'build',
    );
    await doneStep(tokens.m1, buildStep.id, 'success', { hasChanges: false });
    await waitFor(() => server.todoPhase(seeded.id) === 'failed', 15_000);
  }, 180_000);

  test('③ failed card detail deletable; missing/failed detail shows an explained state, not an empty shell', async () => {
    const seeded = await seedFailedTodo('删除探针卡', SPECS.deletable, tokens.m1);

    await openDetailByTitle('删除探针卡');
    await pexpect(page.locator('.detail-head-action')).toHaveText('重跑');

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

    await page.goto(`${server.url}/app/todo/does-not-exist-1216`);
    const unavailable = page.locator('[data-testid="detail-unavailable"]');
    await pexpect(unavailable).toBeVisible({ timeout: 15_000 });
    await pexpect(unavailable).toHaveAttribute('data-state', 'not-found');
    await unavailable.getByRole('button', { name: '回看板' }).click();
    await pexpect(page).toHaveURL(/\/app$/);
    await pexpect(
      page.getByRole('complementary').getByRole('button', { name: '新任务' }),
    ).toBeVisible();

    const rerunRow = server.db
      .select()
      .from(todoTable)
      .all()
      .find((t) => t.spec.startsWith('重跑探针'));
    if (rerunRow === undefined) throw new Error('rerun probe card missing (did ② run?)');
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
