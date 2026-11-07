import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const NOW = Date.now();
const HOUR = 3_600_000;
const SHOTS = process.env.SUBSCRIPTION_SHOTS;
const SCHEME = process.env.SUBSCRIPTION_SCHEME === 'light' ? 'light' : 'dark';
const WIDTH = Number(process.env.SUBSCRIPTION_WIDTH ?? 1440);

test.use({
  colorScheme: SCHEME,
  viewport: { width: WIDTH, height: WIDTH < 500 ? 812 : 732 },
});

type Verify = 'ok' | 'auth' | 'timeout' | 'unavailable' | 'rate-limited' | 'reset' | 'restart' | 'slow';

async function open(page: Page, verify: { current: Verify }, subscriptions?: unknown[]) {
  const accounts = subscriptions ?? [
    {
      id: 's1',
      kind: 'claude-subscription',
      label: 'Claude subscription',
      expiresAt: null,
      createdAt: NOW - 10 * HOUR,
      plan: 'max',
      state: 'ok',
      cooldownUntil: null,
      windows: [
        { name: 'five_hour', utilization: 0.38, resetsAt: NOW + HOUR, observedAt: NOW },
        { name: 'seven_day', utilization: 0.12, resetsAt: NOW + 50 * HOUR, observedAt: NOW },
      ],
      lastUsedAt: NOW - 120_000,
      stepsLast24h: 7,
    },
  ];
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/claude-subscriptions') return json(accounts);
    if (path === '/api/teams/t1/claude-subscriptions/stickiness') return json({ threads: [] });
    if (path.endsWith('/steps')) return json({ steps: [], hasEarlier: false });
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/claude-subscriptions/s1/verify') {
      switch (verify.current) {
        case 'ok':
          return json({ ok: true });
        case 'auth':
          return json({ ok: false, reason: 'auth' });
        case 'timeout':
          return json({ ok: false, reason: 'timeout' });
        case 'unavailable':
          return json({ ok: false, reason: 'unavailable' });
        case 'rate-limited':
          return json({ error: 'wait' }, 429);
        case 'reset':
          return route.abort('connectionreset');
        case 'restart':
          return json({ error: 'Bad Gateway' }, 502);
        case 'slow':
          return new Promise<void>((resolve) =>
            setTimeout(() => resolve(json({ ok: true })), 2_500),
          );
      }
    }
    return undefined;
  });
  await page.goto('/app/settings/providers');
}

async function shot(page: Page, name: string) {
  if (SHOTS === undefined) return;
  const base = `${SHOTS}/${name}-${WIDTH}-${SCHEME}`;
  await page.screenshot({ path: `${base}.png` });
  if (WIDTH < 500) {
    await page.getByTestId('subscription-detail').screenshot({ path: `${base}-detail.png` });
  }
}

const row = (page: Page) => page.getByTestId('provider-instance').first();
const status = (page: Page) => page.getByTestId('subscription-status');
const verify = (page: Page) => page.getByTestId('subscription-verify');

test('a settled account reads one status, never available next to verifying', async ({ page }) => {
  const mode = { current: 'slow' as Verify };
  await open(page, mode);
  await expect(row(page)).toContainText('订阅 · Max · 可用');
  await expect(status(page)).toHaveText('可用');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, 'available-with-quota');

  await verify(page).click();
  await expect(status(page)).toHaveText('验证中…');
  await expect(row(page)).toContainText('验证中…');
  await expect(row(page)).not.toContainText('可用');
  await expect(page.getByTestId('subscription-detail')).not.toContainText('可用');
  await expect(verify(page)).toBeDisabled();
  await shot(page, 'verifying');

  await expect(status(page)).toHaveText('可用');
  await expect(page.getByText('「Claude subscription」验证通过')).toBeVisible();
  await expect(row(page)).not.toContainText('验证中');
});

const FAILURES: { mode: Verify; reason: string; shot: string }[] = [
  { mode: 'auth', reason: '登录已失效，请重新生成令牌后再添加', shot: 'failed-auth' },
  { mode: 'timeout', reason: '验证超时，请重试', shot: 'failed-timeout' },
  { mode: 'unavailable', reason: '服务器上找不到 claude 命令', shot: 'failed-unavailable' },
  { mode: 'rate-limited', reason: '验证太频繁，请 10 秒后重试', shot: 'failed-rate-limited' },
  { mode: 'reset', reason: '连接中断，服务器可能正在重启，请重试', shot: 'failed-connection-dropped' },
  { mode: 'restart', reason: '连接中断，服务器可能正在重启，请重试', shot: 'failed-server-restarting' },
];

for (const failure of FAILURES) {
  test(`verify ends as ${failure.mode}: one failed status with its reason, then Retry passes`, async ({
    page,
  }) => {
    const mode = { current: failure.mode };
    await open(page, mode);
    await verify(page).click();
    await expect(status(page)).toHaveText('验证失败');
    await expect(page.getByTestId('subscription-detail')).toContainText(failure.reason);
    await expect(row(page)).toContainText('订阅 · Max · 验证失败');
    await expect(page.getByTestId('subscription-reason')).toHaveText(failure.reason);
    await expect(row(page)).not.toContainText('可用');
    await expect(page.getByText('验证失败', { exact: true })).toHaveCount(1);
    await expect(verify(page)).toHaveText('重试');
    await expect(verify(page)).toBeEnabled();
    await expect(row(page)).toHaveAttribute('data-tone', 'fail');
    await shot(page, failure.shot);

    mode.current = 'ok';
    await verify(page).click();
    await expect(status(page)).toHaveText('可用');
    await expect(row(page)).not.toContainText('验证失败');
  });
}

test('an account nobody has used shows one muted line instead of dashes', async ({ page }) => {
  const mode = { current: 'ok' as Verify };
  await open(page, mode, [
    { id: 's1', kind: 'claude-subscription', label: 'Spare laptop', expiresAt: null, createdAt: NOW - 60_000, plan: null },
  ]);
  await expect(page.getByTestId('subscription-detail').getByText('还没用过')).toHaveCount(1);
  await expect(page.getByTestId('subscription-detail')).not.toContainText('—');
  await shot(page, 'never-used');
});
