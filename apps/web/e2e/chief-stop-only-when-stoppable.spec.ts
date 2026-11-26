import { expect, type Page, test } from '@playwright/test';
import { mockLive, type Row, THREAD } from './chief-home-mock.js';

const QUEUED = {
  position: 1,
  waitingFor: null,
  blocked: { kind: 'machine-offline', missing: [] },
};

type Reply = { status: number; body: unknown };

async function open(
  page: Page,
  thread: Record<string, unknown>,
  messages: Row[],
  refusal?: Reply,
) {
  const stops: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (
      (request.method() === 'POST' && path.endsWith('/stop')) ||
      (request.method() === 'DELETE' && path.includes('/chief/threads/'))
    )
      stops.push(
        [request.method(), path, request.postData()].filter((part) => part !== null).join(' '),
      );
  });
  await mockLive(
    page,
    { threads: [{ ...THREAD, activeRun: { phase: 'chief' }, ...thread }], messages },
    (path, route, json) => {
      const stopping =
        (route.request().method() === 'POST' && path.endsWith('/stop')) ||
        (route.request().method() === 'DELETE' && path.includes('/chief/threads/'));
      return stopping && refusal !== undefined ? json(refusal.body, refusal.status) : undefined;
    },
  );
  await page.goto('/app');
  await expect(page.getByTestId('chief-composer-input')).toBeVisible();
  return stops;
}

async function pressEscape(page: Page) {
  await page.getByTestId('chief-composer-input').click();
  await page.keyboard.press('Escape');
}

for (const [name, thread] of [
  [
    'waiting for a computer',
    { turnRunning: false, turnQueue: { ...QUEUED, stepId: 'system-turn' } },
  ],
  ['waiting on quota', { turnRunning: false, turnQueue: null }],
] as const) {
  test(`a system turn ${name} offers no stop button and Esc sends nothing`, async ({ page }) => {
    const stops = await open(page, thread, [
      { id: 'm1', role: 'user', content: '上一句', createdAt: 10 },
      { id: 'm2', role: 'assistant', content: '上一轮回复。', createdAt: 11 },
    ]);
    await expect(page.getByText('上一轮回复。')).toBeVisible();
    await expect(page.getByTestId('chief-composer-stop')).toHaveCount(0);
    await expect(page.getByTestId('chief-composer-input')).toHaveAttribute(
      'placeholder',
      '尚未开始，新消息会排在后面',
    );
    await pressEscape(page);
    await page.waitForTimeout(300);
    expect(stops).toEqual([]);
  });
}

const STOP = 'POST /api/teams/t1/chief/threads/chief-home/stop';

test('a queued message waiting for a computer keeps stop, and Esc stops it without deleting it', async ({
  page,
}) => {
  const stops = await open(
    page,
    { turnRunning: false, turnQueue: { ...QUEUED, stepId: 'q1' } },
    [{ id: 'q1', role: 'user', content: '排着队的一句', createdAt: 10 }],
  );
  await expect(page.getByTestId('chief-composer-stop')).toBeVisible();
  await pressEscape(page);
  await expect.poll(() => stops).toEqual([`${STOP} {"messageId":"q1"}`]);
  await expect(page.getByTestId('chief-composer-input')).toHaveValue('');
});

for (const waitingRerun of ['ready', 'held'] as const) {
  test(`a started turn waiting to run again (${waitingRerun}) offers stop`, async ({ page }) => {
    const stops = await open(page, { turnRunning: false, waitingRerun, turnQueue: null }, [
      { id: 'm1', role: 'user', content: '读过的一句', createdAt: 10 },
    ]);
    await expect(page.getByTestId('chief-composer-stop')).toBeVisible();
    await pressEscape(page);
    await expect.poll(() => stops).toEqual([`${STOP} {}`]);
  });
}

test('a running turn keeps stop, and Esc stops it', async ({ page }) => {
  const stops = await open(page, { turnRunning: true, turnQueue: null }, [
    { id: 'm1', role: 'user', content: '正在跑的一句', createdAt: 10 },
  ]);
  await expect(page.getByTestId('chief-composer-stop')).toBeVisible();
  await pressEscape(page);
  await expect.poll(() => stops).toEqual([`${STOP} {}`]);
});

test('a running turn keeps stop while a later message is held', async ({ page }) => {
  const stops = await open(
    page,
    { turnRunning: true, turnQueue: null, pending: [{ messageId: 'q2', state: 'held' }] },
    [
      { id: 'm1', role: 'user', content: '正在跑的一句', createdAt: 10 },
      { id: 'q2', role: 'user', content: '暂缓的一句', createdAt: 11 },
    ],
  );
  await expect(page.getByText('暂缓的一句')).toBeVisible();
  await expect(page.getByTestId('chief-composer-stop')).toBeVisible();
  await pressEscape(page);
  await expect.poll(() => stops).toEqual([`${STOP} {}`]);
});

const SERVER_TEXT = /chief|database|message|already|Coordinator 已经开始/;

test('stop on a queued message whose turn already ended stays quiet and keeps the message sent', async ({
  page,
}) => {
  const stops = await open(
    page,
    { turnRunning: false, turnQueue: { ...QUEUED, stepId: 'q1' } },
    [{ id: 'q1', role: 'user', content: '排着队的一句', createdAt: 10 }],
    {
      status: 409,
      body: {
        error: 'chief turn already started (Coordinator 已经开始处理这条了)',
        reason: 'nothing-to-stop',
      },
    },
  );
  await page.getByTestId('chief-composer-stop').click();
  await expect.poll(() => stops.length).toBe(1);
  await page.waitForTimeout(500);
  await expect(page.locator('[data-sonner-toast]')).toHaveCount(0);
  await expect(page.getByTestId('chief-composer-input')).toHaveValue('');
});

for (const [name, thread] of [
  ['a running turn', { turnRunning: true, turnQueue: null }],
  ['a queued message', { turnRunning: false, turnQueue: { ...QUEUED, stepId: 'm1' } }],
] as const) {
  test(`a failed stop of ${name} shows no server text`, async ({ page }) => {
    await open(page, thread, [{ id: 'm1', role: 'user', content: '一句话', createdAt: 10 }], {
      status: 500,
      body: { error: 'database is locked' },
    });
    await page.getByTestId('chief-composer-stop').click();
    const toast = page.locator('[data-sonner-toast]');
    await expect(toast).toContainText('停止失败，请重试。');
    await expect(toast).not.toContainText(SERVER_TEXT);
  });
}
