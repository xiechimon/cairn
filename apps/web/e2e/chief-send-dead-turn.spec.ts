import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from '@playwright/test';
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
  const marker = db
    .prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'step' AND name = ?",
    )
    .get('step_require_writer_generation_update');
  if (marker) db.function('cairn_step_write_generation', { deterministic: true }, () => 1);
  return db;
}

test('a message sent while the running turn lost its runner shows at once and starts a new turn', async ({
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
    `/api/teams/${teamId}/routing-rules/coordinator`,
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
  const channel = await api<{ id: string }>(`/api/teams/${teamId}/chief/channels/${project.id}`, {});

  const runnerStream = new AbortController();
  void fetch(`${server.base}/api/machine/stream`, {
    headers: { authorization: `Bearer ${runner.token}` },
    signal: runnerStream.signal,
  })
    .then((res) => res.body?.getReader().read())
    .catch(() => {});

  const deadTurn = 'dead-turn-step';
  const crashedAt = Date.now() - 10 * 60_000;
  const db = serverDb();
  db.prepare(
    `insert into step (id, buildId, kind, status, machineId, prompt, scopeProjectId, ownerMessageIds, createdAt, claimedAt, lastHeartbeatAt)
     values (?, ?, 'chief', 'claimed', ?, '看一下任务进度', ?, '[]', ?, ?, ?)`,
  ).run(deadTurn, channel.id, runner.machineId, project.id, crashedAt, crashedAt, crashedAt);
  db.prepare('update chief_thread set activeRun = ? where id = ?').run(
    JSON.stringify({ phase: 'chief' }),
    channel.id,
  );
  const stepStatus = (id: string) =>
    (db.prepare('select status from step where id = ?').get(id) as { status: string } | undefined)
      ?.status ?? null;

  await page.goto(`${server.base}/app?project=${project.id}`);
  const composer = page.getByTestId('home-c').getByTestId('chief-composer-input');
  await expect(composer).toBeEditable();
  const text = '你是什么 llm';
  await composer.fill(text);
  await composer.press('Enter');
  await expect(page.getByTestId('chief-stream').getByText(text)).toBeVisible({ timeout: 300 });
  await expect(composer).toHaveValue('');

  await expect.poll(() => stepStatus(deadTurn), { timeout: 5_000 }).toBe('stopped');
  const nextTurn = () =>
    (
      db
        .prepare(
          `select status from step where buildId = ? and kind = 'chief' and id != ? order by createdAt desc limit 1`,
        )
        .get(channel.id, deadTurn) as { status: string } | undefined
    )?.status ?? 'none';
  await expect.poll(nextTurn, { timeout: 5_000 }).not.toMatch(/^(none|pending)$/);
  db.close();
  runnerStream.abort();
});
