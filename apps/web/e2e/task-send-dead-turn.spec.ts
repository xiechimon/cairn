import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, type Page, test } from '@playwright/test';
import { bootLiveServer, type LiveServer } from './live-server';

let server: LiveServer;

test.beforeAll(async () => {
  server = await bootLiveServer(null);
});

test.afterAll(async () => {
  await server?.dispose();
});

async function api<T>(path: string, body?: unknown, method = 'POST', token?: string): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== undefined) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${server.base}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  expect(res.status, `${method} ${path}`).toBeLessThan(300);
  return (await res.json()) as T;
}

function serverDb(): DatabaseSync {
  const db = new DatabaseSync(join(server.home, 'server', 'server.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env.CAIRN_REVIEW_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, name), fullPage: false });
}

test('a task message sent while the running turn lost its runner shows at once and starts a new turn', async ({
  page,
}) => {
  const [team] = await api<{ id: string }[]>('/api/teams', undefined, 'GET');
  const teamId = team!.id;
  await api(`/api/teams/${teamId}/providers`, {
    providerId: 'e2e-relay',
    label: 'e2e relay',
    baseUrl: 'http://127.0.0.1:9/v1',
    api: 'openai-completions',
    models: [{ id: 'e2e-model', name: 'e2e-model' }],
  });
  await api(
    `/api/teams/${teamId}/routing-rules/session`,
    { provider: 'e2e-relay', modelId: 'e2e-model' },
    'PATCH',
  );
  const key = await api<{ plaintext: string }>(`/api/teams/${teamId}/api-keys`, {
    name: 'E2E_RUNNER_KEY',
    gitAccess: false,
    mcpAccess: false,
    machineAccess: true,
    toolGrants: { read: [], write: [] },
  });
  const runner = await api<{ machineId: string; token: string }>(
    '/api/machine/enroll',
    { teamId, name: 'crashed-runner', cliVersion: '0.1.0', capabilities: { mcpServers: [], skills: [] } },
    'POST',
    key.plaintext,
  );
  const project = await api<{ id: string }>('/api/projects', { name: 'Cairn', teamId });
  const todo = await api<{ id: string }>(`/api/projects/${project.id}/todos`, {
    title: 'Dead turn task',
    spec: '看一下进度',
  });

  const runnerStream = new AbortController();
  void fetch(`${server.base}/api/machine/stream`, {
    headers: { authorization: `Bearer ${runner.token}` },
    signal: runnerStream.signal,
  })
    .then((res) => res.body?.getReader().read())
    .catch(() => {});

  const buildId = 'dead-task-build';
  const deadTurn = 'dead-task-step';
  const crashedAt = Date.now() - 10 * 60_000;
  const db = serverDb();
  db.prepare(
    `insert into build (id, todoId, withPlan, triggerSource, createdAt)
     values (?, ?, 0, 'user', ?)`,
  ).run(buildId, todo.id, crashedAt);
  db.prepare(
    `update todo set phase = 'building', phaseAt = ?, latestBuildId = ?, lastRunAt = ? where id = ?`,
  ).run(crashedAt, buildId, crashedAt, todo.id);
  db.prepare(
    `insert into step (id, buildId, kind, status, machineId, prompt, createdAt, claimedAt, lastHeartbeatAt)
     values (?, ?, 'session', 'claimed', ?, '看一下任务进度', ?, ?, ?)`,
  ).run(deadTurn, buildId, runner.machineId, crashedAt, crashedAt, crashedAt);
  const stepStatus = (id: string) =>
    (db.prepare('select status from step where id = ?').get(id) as { status: string } | undefined)
      ?.status ?? null;

  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`${server.base}/app?project=${project.id}&thread=${todo.id}`);
  const sidePanel = page.getByTestId('side-chat-panel');
  const composer = sidePanel.locator('[data-testid="composer-card"] textarea');
  await expect(composer).toBeEditable();
  const text = '直接插话重开这一轮';
  await composer.fill(text);
  await composer.press('Enter');
  await expect(sidePanel.getByTestId('user-bubble').filter({ hasText: text })).toBeVisible({
    timeout: 300,
  });
  await expect(composer).toHaveValue('');
  await shot(page, 'dead-turn-optimistic.png');

  await expect.poll(() => stepStatus(deadTurn), { timeout: 5_000 }).toBe('stopped');
  const nextTurnRow = () =>
    db
      .prepare(
        `select id, status, prompt from step where buildId = ? and kind = 'session' and id != ? order by createdAt desc limit 1`,
      )
      .get(buildId, deadTurn) as { id: string; status: string; prompt: string | null } | undefined;
  await expect.poll(() => nextTurnRow()?.status ?? 'none', { timeout: 5_000 }).toBe('pending');
  expect(nextTurnRow()?.prompt).toBe(text);
  await api('/api/machine/tasks/claim', {}, 'POST', runner.token);
  await expect
    .poll(() => nextTurnRow()?.status ?? 'none', { timeout: 5_000 })
    .not.toMatch(/^(none|pending)$/);
  await expect(sidePanel.getByTestId('user-bubble').filter({ hasText: text })).toBeVisible({
    timeout: 5_000,
  });
  await shot(page, 'dead-turn-started.png');
  db.close();
  runnerStream.abort();
});

test('task thread rapid repeated sends stay optimistic and in order, and failures roll back with error and restored text', async ({
  page,
}) => {
  const [team] = await api<{ id: string }[]>('/api/teams', undefined, 'GET');
  const teamId = team!.id;
  const project = await api<{ id: string }>('/api/projects', { name: 'RapidProj', teamId });
  const todo = await api<{ id: string }>(`/api/projects/${project.id}/todos`, {
    title: 'Rapid insert task',
    spec: '测试快速连续插话',
  });

  const buildId = 'rapid-task-build';
  const liveStep = 'rapid-task-step';
  const now = Date.now();
  const db = serverDb();
  db.prepare(
    `insert into build (id, todoId, withPlan, triggerSource, createdAt)
     values (?, ?, 0, 'user', ?)`,
  ).run(buildId, todo.id, now);
  db.prepare(
    `update todo set phase = 'building', phaseAt = ?, latestBuildId = ?, lastRunAt = ? where id = ?`,
  ).run(now, buildId, now, todo.id);
  db.prepare(
    `insert into step (id, buildId, kind, status, prompt, createdAt, claimedAt, lastHeartbeatAt)
     values (?, ?, 'session', 'claimed', '运行中', ?, ?, ?)`,
  ).run(liveStep, buildId, now, now, now);

  const postedOrder: string[] = [];
  let releaseFirst!: () => void;
  let releaseSecond!: () => void;
  let failThird = false;
  let releaseThird!: () => void;
  let callIndex = 0;

  await page.route(`**/api/todos/${todo.id}/messages`, async (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    callIndex += 1;
    const idx = callIndex;
    const body = request.postDataJSON() as { content: string };
    postedOrder.push(body.content);
    if (idx === 1) {
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      return route.fallback();
    }
    if (idx === 2) {
      await new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
      return route.fallback();
    }
    if (failThird) {
      await new Promise<void>((resolve) => {
        releaseThird = resolve;
      });
      return route.fulfill({ status: 500, json: { error: '发送被服务端拒绝' } });
    }
    return route.fallback();
  });

  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(`${server.base}/app?project=${project.id}&thread=${todo.id}`);
  const sidePanel = page.getByTestId('side-chat-panel');
  const composer = sidePanel.locator('[data-testid="composer-card"] textarea');
  await expect(composer).toBeEditable();

  await composer.fill('第一条快速消息');
  await composer.press('Enter');
  await expect(
    sidePanel.getByTestId('user-bubble').filter({ hasText: '第一条快速消息' }),
  ).toBeVisible({ timeout: 300 });
  await expect(composer).toHaveValue('');

  await composer.fill('第二条快速消息');
  await composer.press('Enter');
  await expect(
    sidePanel.getByTestId('user-bubble').filter({ hasText: '第二条快速消息' }),
  ).toBeVisible({ timeout: 300 });
  await expect(composer).toHaveValue('');
  await shot(page, 'rapid-two-sending-1440-light.png');

  await expect.poll(() => postedOrder).toEqual(['第一条快速消息']);
  releaseFirst();
  await expect.poll(() => postedOrder).toEqual(['第一条快速消息', '第二条快速消息']);
  releaseSecond();

  const bubbles = sidePanel.getByTestId('user-bubble');
  await expect(bubbles).toHaveCount(2);
  await expect(bubbles.nth(0)).toContainText('第一条快速消息');
  await expect(bubbles.nth(1)).toContainText('第二条快速消息');
  await shot(page, 'rapid-two-settled-1440-light.png');

  failThird = true;
  await composer.fill('会失败的消息');
  await composer.press('Enter');
  await expect(
    sidePanel.getByTestId('user-bubble').filter({ hasText: '会失败的消息' }),
  ).toBeVisible({ timeout: 300 });
  await expect(composer).toHaveValue('');
  await expect.poll(() => postedOrder).toEqual([
    '第一条快速消息',
    '第二条快速消息',
    '会失败的消息',
  ]);
  releaseThird();

  await expect(sidePanel.getByTestId('user-bubble').filter({ hasText: '会失败的消息' })).toHaveCount(
    0,
  );
  await expect(sidePanel.getByTestId('side-chat-send-error')).toBeVisible();
  await expect(sidePanel.getByTestId('side-chat-send-error')).toContainText('发送被服务端拒绝');
  await expect(composer).toHaveValue('会失败的消息');
  await shot(page, 'failed-rollback-1440-light.png');

  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page, 'failed-rollback-1440-dark.png');
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, 'failed-rollback-390-dark.png');
  await page.emulateMedia({ colorScheme: 'light' });
  await shot(page, 'failed-rollback-390-light.png');

  db.close();
});
