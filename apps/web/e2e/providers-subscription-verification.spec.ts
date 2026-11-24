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

const passedCheck = () => ({
  at: Date.now(),
  ok: true,
  reason: null,
  check: 'sign-in',
  command: 'GET https://api.anthropic.com/v1/models',
  model: null,
  durationMs: 2400,
});

type Verify =
  | 'ok'
  | 'auth'
  | 'timeout'
  | 'unavailable'
  | 'quota'
  | 'rate-limited'
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
          return json({ ok: true, check: passedCheck() });
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
            setTimeout(() => resolve(json({ ok: true, check: passedCheck() })), 2_500),
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
const detail = (page: Page) => page.getByTestId('subscription-detail');
const verify = (page: Page) => page.getByTestId('subscription-verify');
const result = (page: Page) => page.getByTestId('subscription-verify-feedback');
const below = (page: Page) => page.getByTestId('subscription-models');

const CHECK_WORDS = ['未验证', '可用', '验证中', '验证失败', '登录失效', '验证超时', '无法验证', '连接中断', '验证太频繁'];

async function expectNoCheckStatus(page: Page) {
  for (const word of CHECK_WORDS) {
    await expect(row(page)).not.toContainText(word);
    await expect(detail(page)).not.toContainText(word);
  }
  await expect(page.getByTestId('subscription-status')).toHaveCount(0);
}

const top = async (page: Page) =>
  ((await below(page).boundingBox())?.y ?? Number.NaN) -
  ((await detail(page).boundingBox())?.y ?? Number.NaN);

test('a check never reflows the page: the result pops up from Verify, closes on Esc and leaves no status', async ({
  page,
}) => {
  const mode = { current: 'slow' as Verify };
  await open(page, mode);
  await expect(row(page)).toContainText('订阅 · 3 个模型');
  const badge = row(page).getByTestId('subscription-quota-mini');
  await expect(badge).toHaveText('剩 62%');
  await expect(badge).toHaveAttribute('aria-label', '5 小时 剩 62%');
  const remaining = detail(page).getByRole('img', { name: '5 小时 剩 62%', exact: true });
  await expect(remaining).toBeVisible();
  await expect(remaining).toHaveText('剩 62%');
  await expect(badge).toHaveText((await remaining.textContent())!);
  await expect(detail(page).getByTestId('subscription-quota-reset').first()).toHaveText(
    /^· (59|60) 分钟后重置$/,
  );
  await expect(detail(page).getByTestId('subscription-quota-reset').nth(1)).not.toContainText(
    '小时后',
  );
  await expectNoCheckStatus(page);
  await expect(result(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const before = await top(page);
  await shot(page, 'idle');

  await verify(page).click();
  await expect(result(page)).toHaveAttribute('data-phase', 'checking');
  await expect(result(page)).toContainText('正在检查这个订阅的登录…');
  await expect(result(page).locator('[data-slot="spinner"]')).toHaveCount(1);
  await expect(verify(page)).toBeDisabled();
  await expect(verify(page)).toHaveText('验证');
  await expect(verify(page).locator('[data-slot="spinner"]')).toHaveCount(0);
  expect(await top(page)).toBe(before);
  await expectNoCheckStatus(page);
  await shot(page, 'checking');

  await expect(result(page)).toBeVisible();
  await expect(result(page)).toHaveAttribute('data-phase', 'passed');
  await expect(result(page)).toContainText('这个订阅的登录有效。');
  await expect(page.getByTestId('subscription-verify-detail')).toContainText(
    'GET https://api.anthropic.com/v1/models',
  );
  expect(await top(page)).toBe(before);
  await expectNoCheckStatus(page);
  await shot(page, 'connected');

  await page.keyboard.press('Escape');
  await expect(result(page)).toHaveCount(0);
  expect(await top(page)).toBe(before);
  await expectNoCheckStatus(page);
  await expect(verify(page)).toHaveText('验证');
});

const FAILURES: { mode: Verify; reason: string; shot: string }[] = [
  { mode: 'auth', reason: '这个订阅的登录已失效。先移除它，再在终端运行 claude setup-token，把新的 token 添加回来。', shot: 'failed-auth' },
  { mode: 'timeout', reason: '验证超时，请重试', shot: 'failed-timeout' },
  { mode: 'unavailable', reason: '暂时无法连接 Claude 服务，请检查网络后重试。', shot: 'failed-unavailable' },
  { mode: 'quota', reason: '模型额度已用尽，请等待额度恢复后重试。', shot: 'failed-quota' },
];

for (const failure of FAILURES) {
  test(`verify ends as ${failure.mode}: the reason pops up, an outside click closes it, no status stays`, async ({
    page,
  }) => {
    const mode = { current: failure.mode };
    await open(page, mode);
    const before = await top(page);
    await verify(page).click();
    await expect(result(page)).toBeVisible();
    await expect(result(page)).toHaveAttribute('data-phase', 'failed');
    await expect(result(page)).toContainText(failure.reason);
    await expect(result(page)).not.toContainText(/\b[45]\d\d\b|Bad Gateway/);
    expect(await top(page)).toBe(before);
    await expectNoCheckStatus(page);
    await expect(row(page)).not.toHaveAttribute('data-tone', 'fail');
    await expect(verify(page)).toBeEnabled();
    await shot(page, failure.shot);

    await detail(page).getByRole('heading', { name: '模型', exact: true }).click();
    await expect(result(page)).toHaveCount(0);

    mode.current = 'ok';
    await verify(page).click();
    await expect(result(page)).toHaveAttribute('data-phase', 'passed');
  });
}

const PASSED_CHECK = {
  at: NOW - 3_600_000,
  ok: true,
  reason: null,
  check: 'sign-in',
  command: 'GET https://api.anthropic.com/v1/models',
  model: null,
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
  { mode: 'rate-limited', reason: '验证太频繁，这次没有运行。', shot: 'not-run-rate-limited' },
  {
    mode: 'reset',
    reason: '未连接到服务器，本次未验证，订阅状态未改变。服务器可能正在重启，请稍后重试。',
    shot: 'not-run-connection-dropped',
  },
  {
    mode: 'restart',
    reason: '未连接到服务器，本次未验证，订阅状态未改变。服务器可能正在重启，请稍后重试。',
    shot: 'not-run-server-restarting',
  },
];

for (const notRun of NOT_RUN) {
  test(`verify refused as ${notRun.mode}: the popover says the check did not run, and nothing turns failed`, async ({
    page,
  }) => {
    await open(page, { current: notRun.mode }, [HEALTHY]);
    const before = await top(page);
    await verify(page).click();
    await expect(result(page)).toHaveAttribute('data-phase', 'not-run');
    await expect(result(page)).toContainText(notRun.reason);
    await expect(result(page)).not.toContainText('验证没有通过');
    await expect(page.getByTestId('subscription-verify-detail')).toContainText('没有运行');
    await expect(page.getByTestId('subscription-verify-detail')).not.toContainText('通过');
    expect(await top(page)).toBe(before);
    await expectNoCheckStatus(page);
    await expect(row(page)).not.toHaveAttribute('data-tone', 'fail');
    await expect(verify(page)).toHaveText('验证');
    await shot(page, notRun.shot);
    await page.keyboard.press('Escape');
    await expect(result(page)).toHaveCount(0);
  });
}

test('a stored last check is not shown until the user runs one', async ({ page }) => {
  const mode = { current: 'ok' as Verify };
  await open(page, mode, [
    {
      id: 's1',
      kind: 'claude-subscription',
      label: 'Checked earlier',
      expiresAt: null,
      createdAt: NOW - HOUR,
      lastCheck: {
        at: NOW - HOUR,
        ok: false,
        reason: 'auth',
        check: 'sign-in',
        command: 'GET https://api.anthropic.com/v1/models',
        model: null,
        durationMs: 900,
      },
    },
  ]);
  await expect(row(page)).toContainText('Checked earlier');
  await expect(row(page).getByTestId('subscription-quota-mini')).toHaveCount(0);
  await expectNoCheckStatus(page);
  await expect(result(page)).toHaveCount(0);
});

test('an account nobody has used shows one muted line instead of dashes', async ({ page }) => {
  const mode = { current: 'ok' as Verify };
  await open(page, mode, [
    { id: 's1', kind: 'claude-subscription', label: 'Spare laptop', expiresAt: null, createdAt: NOW - 60_000 },
  ]);
  await expect(page.getByTestId('subscription-detail').getByText('尚未使用')).toHaveCount(1);
  await expect(page.getByTestId('subscription-detail')).not.toContainText('—');
  await shot(page, 'never-used');
});
