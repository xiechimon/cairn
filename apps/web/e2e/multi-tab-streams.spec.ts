import { expect, type Page, test } from '@playwright/test';
import { bootLiveServer } from './live-server';

const TAB_COUNT = 7;
const STREAM_PATH = /\/api\/teams\/[^/]+\/stream(?:\?|$)/;

function watchStream(page: Page): () => 'eventsource' | 'websocket' | null {
  let source: 'eventsource' | 'websocket' | null = null;
  page.on('response', (response) => {
    if (STREAM_PATH.test(response.url()) && response.status() === 200) source = 'eventsource';
  });
  page.on('websocket', (socket) => {
    if (!STREAM_PATH.test(socket.url())) return;
    socket.on('framereceived', ({ payload }) => {
      if (payload.toString().includes('"hello"') || payload.toString().includes('\\"hello\\"')) {
        source = 'websocket';
      }
    });
    socket.on('close', () => {
      if (source === 'websocket') source = null;
    });
  });
  return () => source;
}

async function seedConversation(base: string): Promise<void> {
  const teams = await fetch(`${base}/api/teams`, { signal: AbortSignal.timeout(5_000) });
  expect(teams.ok).toBe(true);
  const [{ id: teamId }] = (await teams.json()) as [{ id: string }];
  const provider = await fetch(`${base}/api/teams/${teamId}/providers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(5_000),
    body: JSON.stringify({
      providerId: 'e2e-relay',
      label: 'e2e relay',
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      models: [{ id: 'e2e-model', name: 'e2e-model' }],
    }),
  });
  expect(provider.status).toBe(201);
  const rule = await fetch(`${base}/api/teams/${teamId}/routing-rules/coordinator`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(5_000),
    body: JSON.stringify({ provider: 'e2e-relay', modelId: 'e2e-model' }),
  });
  expect(rule.ok).toBe(true);
}

test('seven tabs load the conversation alongside seven live streams on plain HTTP', async ({ context }) => {
  test.setTimeout(90_000);
  const server = await test.step('start the isolated HTTP/1.1 server', () => bootLiveServer(null));
  try {
    await seedConversation(server.base);

    const tabs: { page: Page; ready: ReturnType<typeof watchStream> }[] = [];
    for (let index = 0; index < TAB_COUNT; index++) {
      const page = await test.step(`open tab ${index + 1}`, () => context.newPage(), { timeout: 8_000 });
      const ready = watchStream(page);
      tabs.push({ page, ready });
      await test.step(`tab ${index + 1} reaches the app`, () =>
        page.goto(`${server.base}/app`, { waitUntil: 'domcontentloaded', timeout: 8_000 }),
      );
      if (index < TAB_COUNT - 1) {
        await expect
          .poll(ready, { message: `tab ${index + 1} starts a real stream`, timeout: 8_000 })
          .not.toBeNull();
      }
    }

    for (const [index, { page }] of [...tabs.entries()].reverse()) {
      await expect(
        page.getByTestId('chief-composer-input'),
        `tab ${index + 1} loads its conversation`,
      ).toBeVisible({ timeout: 8_000 });
    }
    await expect.poll(() => tabs.filter(({ ready }) => ready() === 'websocket').length).toBe(TAB_COUNT);
  } finally {
    await server.dispose();
  }
});

test('the app retries unavailable tickets without starting SSE, but accepts legacy servers', async ({ page }) => {
  const server = await bootLiveServer(null);
  try {
    await seedConversation(server.base);
    let reply = 503;
    let requests = 0;
    let eventSources = 0;
    await page.route('**/api/auth/stream-ticket', (route) => {
      requests++;
      return reply === 200 ? route.continue() : route.fulfill({ status: reply });
    });
    page.on('request', (request) => {
      if (request.resourceType() === 'eventsource' && STREAM_PATH.test(request.url())) {
        eventSources++;
      }
    });
    const ready = watchStream(page);
    await page.goto(`${server.base}/app`);
    await expect.poll(() => requests).toBeGreaterThanOrEqual(2);
    expect(eventSources).toBe(0);

    reply = 200;
    await expect.poll(ready).toBe('websocket');

    for (const status of [404, 405]) {
      reply = status;
      const legacy = watchStream(page);
      await page.reload();
      await expect.poll(legacy).toBe('eventsource');
    }
  } finally {
    await server.dispose();
  }
});
