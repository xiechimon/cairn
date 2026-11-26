import { expect, type Page, test } from '@playwright/test';
import { mockLive, type Row, THREAD } from './chief-home-mock.js';

const QUEUED = {
  position: 1,
  waitingFor: null,
  blocked: { kind: 'machine-offline', missing: [] },
};

async function open(page: Page, thread: Record<string, unknown>, messages: Row[]) {
  const stops: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (
      (request.method() === 'POST' && path.endsWith('/stop')) ||
      (request.method() === 'DELETE' && path.includes('/chief/threads/'))
    )
      stops.push(`${request.method()} ${path}`);
  });
  await mockLive(page, {
    threads: [{ ...THREAD, activeRun: { phase: 'chief' }, ...thread }],
    messages,
  });
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

test('a queued message waiting for a computer keeps stop, and Esc withdraws it', async ({
  page,
}) => {
  const stops = await open(
    page,
    { turnRunning: false, turnQueue: { ...QUEUED, stepId: 'q1' } },
    [{ id: 'q1', role: 'user', content: '排着队的一句', createdAt: 10 }],
  );
  await expect(page.getByTestId('chief-composer-stop')).toBeVisible();
  await pressEscape(page);
  await expect.poll(() => stops).toEqual(['DELETE /api/teams/t1/chief/threads/chief-home/messages/q1']);
});

test('a running turn keeps stop, and Esc stops it', async ({ page }) => {
  const stops = await open(page, { turnRunning: true, turnQueue: null }, [
    { id: 'm1', role: 'user', content: '正在跑的一句', createdAt: 10 },
  ]);
  await expect(page.getByTestId('chief-composer-stop')).toBeVisible();
  await pressEscape(page);
  await expect.poll(() => stops).toEqual(['POST /api/teams/t1/chief/threads/chief-home/stop']);
});
