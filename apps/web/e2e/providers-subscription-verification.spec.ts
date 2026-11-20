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

type Verify =
  | 'ok'
  | 'auth'
  | 'timeout'
  | 'unavailable'
  | 'quota'
  | 'rate-limited'
  | 'forbidden'
  | 'reset'
  | 'restart'
  | 'slow';

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
        case 'forbidden':
          return json({ error: 'only the owner token can do this' }, 403);
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
    if (path === '/api/teams/t1/claude-subscriptions/s1/test' && verify.current === 'forbidden') {
      return json({ error: 'only the owner token can do this' }, 403);
    }
    if (
      path === '/api/teams/t1/claude-subscriptions/s1/upstream-models' &&
      verify.current === 'forbidden'
    ) {
      return json({ error: 'only the owner token can do this' }, 403);
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

const PASSED_CHECK = {
  at: NOW - 3_600_000,
  ok: true,
  reason: null,
  check: 'model-request',
  command: 'claude -p --model claude-haiku-5-5',
  model: 'claude-haiku-5-5',
  durationMs: 3_700,
} as const;

const HEALTHY: ClaudeSubscriptionListEntry = {
  id: 's1',
  kind: 'claude-subscription',
  label: 'Claude subscription',
  expiresAt: null,
  createdAt: NOW - 10 * HOUR,
  lastUsedAt: NOW - 120_000,
  lastCheck: PASSED_CHECK,
};

const NOT_RUN: { mode: Verify; reason: string; shot: string }[] = [
  {
    mode: 'forbidden',
    reason: '这台设备是配对设备，没有权限运行验证，订阅状态没有改变。请在运行 Cairn 的电脑上打开这一页再验证。',
    shot: 'not-run-paired-device',
  },
  { mode: 'rate-limited', reason: '验证太频繁，这次没有运行。请 10 秒后重试。', shot: 'not-run-rate-limited' },
  {
    mode: 'reset',
    reason: '没连上服务器，这次没有验证，订阅状态没有改变。服务器可能正在重启，请稍后重试。',
    shot: 'not-run-connection-dropped',
  },
  {
    mode: 'restart',
    reason: '没连上服务器，这次没有验证，订阅状态没有改变。服务器可能正在重启，请稍后重试。',
    shot: 'not-run-server-restarting',
  },
];

for (const notRun of NOT_RUN) {
  test(`verify refused as ${notRun.mode}: the healthy status stays and the real reason shows`, async ({
    page,
  }) => {
    await open(page, { current: notRun.mode }, [HEALTHY]);
    await expect(status(page)).toHaveText('可用');
    await verify(page).click();
    await expect(feedback(page)).toHaveAttribute('data-phase', 'not-run');
    await expect(feedback(page)).toContainText(notRun.reason);
    await expect(feedback(page)).not.toContainText('验证没有通过');
    await expect(page.getByTestId('subscription-verify-detail')).toContainText('通过');
    await expect(status(page)).toHaveText('可用');
    await expect(row(page)).toContainText('可用');
    await expect(row(page)).not.toHaveAttribute('data-tone', 'fail');
    await expect(verify(page)).toHaveText('验证');
    await shot(page, notRun.shot);
  });
}

test('a paired device testing models or opening upstream is told why, not that the models failed', async ({
  page,
}) => {
  await open(page, { current: 'forbidden' }, [HEALTHY]);
  await page.getByTestId('subscription-test-all').click();
  await expect(page.getByTestId('model-test-refused')).toContainText(
    '这台设备是配对设备，没有权限测试模型',
  );
  await expect(page.getByTestId('subscription-model-failures')).toHaveCount(0);
  await expect(page.getByTestId('subscription-models-summary')).not.toContainText('失败');
  await expect(page.locator('[data-testid="subscription-model"][data-check="failed"]')).toHaveCount(0);
  await shot(page, 'model-test-paired-device');

  await page.getByTestId('subscription-pick-upstream').click();
  await expect(page.getByTestId('upstream-error')).toContainText(
    '这台设备是配对设备，没有权限获取上游模型',
  );
});

test('an account nobody has used shows one muted line instead of dashes', async ({ page }) => {
  const mode = { current: 'ok' as Verify };
  await open(page, mode, [
    { id: 's1', kind: 'claude-subscription', label: 'Spare laptop', expiresAt: null, createdAt: NOW - 60_000 },
  ]);
  await expect(page.getByTestId('subscription-detail').getByText('还没用过')).toHaveCount(1);
  await expect(page.getByTestId('subscription-detail')).not.toContainText('—');
  await shot(page, 'never-used');
});
