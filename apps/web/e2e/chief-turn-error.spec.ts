import { expect, test } from '@playwright/test';
import { mockLive, THREAD } from './chief-home-mock';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'en'));
});

test('a failed turn says so in a plain sentence, keeps the raw text in a tooltip and retries the last message', async ({
  page,
}) => {
  const sent: string[] = [];
  await mockLive(
    page,
    {
      threads: [THREAD],
      messages: [
        { id: 'm1', role: 'user', content: 'Check the repo', createdAt: 10 },
        {
          id: 'm2',
          role: 'system',
          content: JSON.stringify({
            kind: 'chief_turn_error',
            message: 'chief agent not bound (503) {"code":"E_UNBOUND"}',
          }),
          createdAt: 11,
        },
      ],
    },
    (path, route, json) => {
      if (path === `/api/conversations/${THREAD.id}/messages` && route.request().method() === 'POST') {
        sent.push((route.request().postDataJSON() as { content: string }).content);
        return json({ thread: THREAD }, 201);
      }
      return undefined;
    },
  );
  await page.goto('/app');
  const row = page.getByTestId('chief-turn-error');
  await expect(row).toHaveText('This turn did not finish');
  await expect(page.getByRole('alert').filter({ has: row })).toContainText(
    'The model provider returned an error this time.',
  );
  await expect(page.getByRole('alert').filter({ has: row })).toHaveAttribute('title', /E_UNBOUND/);
  await expect(page.getByTestId('chief-stream')).not.toContainText('E_UNBOUND');
  await page.getByTestId('chief-turn-retry').click();
  await expect.poll(() => sent).toEqual(['Check the repo']);
});

test('only the latest failed turn offers retry once the owner has sent another message', async ({
  page,
}) => {
  const failure = (id: string, createdAt: number) => ({
    id,
    role: 'system',
    content: JSON.stringify({ kind: 'chief_turn_error', message: 'provider timeout' }),
    createdAt,
  });
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'm1', role: 'user', content: 'Check the repo', createdAt: 10 },
      failure('m2', 11),
      { id: 'm3', role: 'user', content: 'Open the pull request', createdAt: 12 },
      failure('m4', 13),
    ],
  });
  await page.goto('/app');
  await expect(page.getByTestId('chief-turn-error')).toHaveCount(2);
  const alerts = page.getByRole('alert').filter({ has: page.getByTestId('chief-turn-error') });
  await expect(alerts.first().getByTestId('chief-turn-retry')).toHaveCount(0);
  await expect(alerts.last().getByTestId('chief-turn-retry')).toBeVisible();
});

test('a turn that could not reach the model says why in plain words, links to providers and retries the message', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'zh'));
  const sent: string[] = [];
  await mockLive(
    page,
    {
      threads: [THREAD],
      messages: [
        {
          id: 'm0',
          role: 'system',
          content: JSON.stringify({
            kind: 'chief_turn_error',
            message: 'Coordinator turn ended: model_error "Connection error."',
          }),
          createdAt: 9,
        },
        { id: 'm1', role: 'user', content: '你好', createdAt: 10 },
        {
          id: 'm2',
          role: 'system',
          content: JSON.stringify({
            kind: 'chief_turn_error',
            message: 'Coordinator turn ended: model_error "Connection error."',
          }),
          createdAt: 11,
        },
      ],
    },
    (path, route, json) => {
      if (path === `/api/conversations/${THREAD.id}/messages` && route.request().method() === 'POST') {
        sent.push((route.request().postDataJSON() as { content: string }).content);
        return json({ thread: THREAD }, 201);
      }
      return undefined;
    },
  );
  await page.goto('/app');
  const alerts = page.getByRole('alert').filter({ has: page.getByTestId('chief-turn-error') });
  await expect(page.getByTestId('chief-turn-error')).toHaveText(['连不上模型服务', '连不上模型服务']);
  await expect(alerts.first()).not.toContainText('本地网络');
  const alert = alerts.last();
  await expect(alert).toContainText('地址填错了');
  await expect(alert).not.toContainText('系统设置');
  await expect(page.getByTestId('chief-stream')).not.toContainText('Connection error.');
  await expect(alert.getByRole('link', { name: '打开模型服务设置' })).toHaveAttribute(
    'href',
    /\/app\/settings\/providers/,
  );
  await alert.getByTestId('chief-turn-retry').click();
  await expect.poll(() => sent).toEqual(['你好']);
});

test.describe('on a Mac', () => {
  test.use({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  });

  test('an unreachable model also names the macOS Local Network setting', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cairn.locale', 'zh'));
    await mockLive(page, {
      threads: [THREAD],
      messages: [
        { id: 'm1', role: 'user', content: '你好', createdAt: 10 },
        {
          id: 'm2',
          role: 'system',
          content: JSON.stringify({
            kind: 'chief_turn_error',
            message: 'Coordinator turn ended: model_error "connect EHOSTUNREACH 192.0.2.10:8080"',
          }),
          createdAt: 11,
        },
      ],
    });
    await page.goto('/app');
    const alert = page.getByRole('alert').filter({ has: page.getByTestId('chief-turn-error') });
    await expect(alert).toContainText('系统设置 → 隐私与安全性 → 本地网络');
    await expect(alert.getByTestId('chief-turn-retry')).toBeVisible();
  });
});

test('a rejected API key says so and links to the key', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'zh'));
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'm1', role: 'user', content: '你好', createdAt: 10 },
      {
        id: 'm2',
        role: 'system',
        content: JSON.stringify({
          kind: 'chief_turn_error',
          message: 'Coordinator turn ended: model_error "401: {\\"message\\":\\"Invalid API key\\"}"',
        }),
        createdAt: 11,
      },
    ],
  });
  await page.goto('/app');
  const alert = page.getByRole('alert').filter({ has: page.getByTestId('chief-turn-error') });
  await expect(page.getByTestId('chief-turn-error')).toHaveText('模型服务不接受这个 API key');
  await expect(alert.getByRole('link', { name: '重新填写 API key' })).toBeVisible();
  await expect(alert.getByTestId('chief-turn-retry')).toBeVisible();
});

test('a forbidden model request is not reported as a bad API key', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.locale', 'zh'));
  await mockLive(page, {
    threads: [THREAD],
    messages: [
      { id: 'm1', role: 'user', content: '你好', createdAt: 10 },
      {
        id: 'm2',
        role: 'system',
        content: JSON.stringify({
          kind: 'chief_turn_error',
          message: 'Coordinator turn ended: model_error "403: model not available in your region"',
        }),
        createdAt: 11,
      },
    ],
  });
  await page.goto('/app');
  await expect(page.getByTestId('chief-turn-error')).toHaveText('这一轮没有完成');
});
