import { expect, type Page, test } from '@playwright/test';
import type { ClaudeSubscriptionListEntry } from '@cairn/shared';
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

type Verify = 'ok' | 'auth' | 'timeout' | 'unavailable' | 'quota' | 'rate-limited' | 'reset' | 'restart' | 'slow';

async function open(page: Page, verify: { current: Verify }, subscriptions?: ClaudeSubscriptionListEntry[]) {
  const accounts = subscriptions ?? [
    {
      id: 's1',
      kind: 'claude-subscription',
      label: 'Claude subscription',
      expiresAt: null,
      createdAt: NOW - 10 * HOUR,
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
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [] });
    if (path === '/api/teams/t1/model-sources') {
      return json({
        sources: [
          {
            runtime: 'claude-code',
            installed: true,
            hostname: 'runner-1',
            machineId: 'm1',
            models: [
              { id: 'claude-opus-5-5', name: 'claude-opus-5-5', slot: 'default' },
              { id: 'claude-sonnet-5-5', name: 'claude-sonnet-5-5', slot: 'sonnet' },
              { id: 'claude-haiku-5-5', name: 'claude-haiku-5-5', slot: 'haiku' },
            ],
          },
        ],
      });
    }
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
        case 'quota':
          return json({ ok: false, reason: 'quota' });
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
  await page.goto('/app/settings/routing');
}

async function shot(page: Page, name: string) {
  if (SHOTS === undefined) return;
  await page.waitForTimeout(300);
  const base = `${SHOTS}/${name}-${WIDTH}-${SCHEME}`;
  await page.screenshot({ path: `${base}.png` });
  if (WIDTH < 500) {
    await page.getByTestId('subscription-detail').screenshot({ path: `${base}-detail.png` });
  }
}

const row = (page: Page) => page.getByTestId('provider-instance').first();
const status = (page: Page) => page.getByTestId('subscription-status');
const verify = (page: Page) => page.getByTestId('subscription-verify');
const feedback = (page: Page) => page.getByTestId('subscription-verify-feedback');

test('an unchecked account reads 未验证 until a check passes, and the result stays in place', async ({ page }) => {
  const mode = { current: 'slow' as Verify };
  await open(page, mode);
  await expect(row(page)).toContainText('订阅 · 3 个模型 · 未验证');
  await expect(status(page)).toHaveText('未验证');
  await expect(feedback(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await shot(page, 'unverified-with-quota');

  await verify(page).click();
  await expect(status(page)).toHaveText('验证中…');
  await expect(row(page)).toContainText('验证中…');
  await expect(page.getByTestId('subscription-detail')).not.toContainText('可用');
  await expect(verify(page)).toBeDisabled();
  await shot(page, 'verifying');

  await expect(status(page)).toHaveText('可用');
  await expect(feedback(page)).toHaveAttribute('data-phase', 'passed');
  await expect(feedback(page)).toContainText('Claude 回复了这次模型请求，订阅能用。');
  await expect(row(page)).toContainText('订阅 · 3 个模型 · 可用');
  await shot(page, 'passed');
});

const FAILURES: { mode: Verify; label: string; reason: string; shot: string }[] = [
  { mode: 'auth', label: '登录失效', reason: '这个订阅的登录已失效。先移除它，再在终端运行 claude setup-token，把新的 token 添加回来。', shot: 'failed-auth' },
  { mode: 'timeout', label: '验证超时', reason: '验证超时，请重试', shot: 'failed-timeout' },
  { mode: 'unavailable', label: '没法验证', reason: '服务器上找不到 claude 命令', shot: 'failed-unavailable' },
  { mode: 'quota', label: '额度用尽', reason: '模型额度已用尽，请等待额度恢复后重试。', shot: 'failed-quota' },
  { mode: 'rate-limited', label: '验证太频繁', reason: '验证太频繁，请 10 秒后重试', shot: 'failed-rate-limited' },
  { mode: 'reset', label: '连接中断', reason: '连接中断，服务器可能正在重启，请重试', shot: 'failed-connection-dropped' },
  { mode: 'restart', label: '连接中断', reason: '连接中断，服务器可能正在重启，请重试', shot: 'failed-server-restarting' },
];

for (const failure of FAILURES) {
  test(`verify ends as ${failure.mode}: one failed status, its reason in place, then a recheck passes`, async ({
    page,
  }) => {
    const mode = { current: failure.mode };
    await open(page, mode);
    await verify(page).click();
    await expect(status(page)).toHaveText(failure.label);
    await expect(feedback(page)).toHaveAttribute('data-phase', 'failed');
    await expect(feedback(page)).toContainText(failure.reason);
    await expect(row(page)).toContainText(`订阅 · 3 个模型 · ${failure.label}`);
    await expect(row(page)).not.toContainText('可用');
    await expect(verify(page)).toHaveText('重新验证');
    await expect(verify(page)).toBeEnabled();
    await expect(row(page)).toHaveAttribute('data-tone', 'fail');
    await shot(page, failure.shot);

    mode.current = 'ok';
    await verify(page).click();
    await expect(status(page)).toHaveText('可用');
    await expect(row(page)).not.toContainText(failure.label);
  });
}

test('an account nobody has used shows one muted line instead of dashes', async ({ page }) => {
  const mode = { current: 'ok' as Verify };
  await open(page, mode, [
    { id: 's1', kind: 'claude-subscription', label: 'Spare laptop', expiresAt: null, createdAt: NOW - 60_000 },
  ]);
  await expect(page.getByTestId('subscription-detail').getByText('还没用过')).toHaveCount(1);
  await expect(page.getByTestId('subscription-detail')).not.toContainText('—');
  await shot(page, 'never-used');
});
