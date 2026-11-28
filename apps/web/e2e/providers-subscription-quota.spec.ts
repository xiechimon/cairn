import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const now = Date.now();
const hour = 3_600_000;
const window = { name: 'seven_day', utilization: 0.39, observedAt: now, resetsAt: now + hour };
const activity = { fiveHour: { runs: 2, limited: 1 }, sevenDay: { runs: 8, limited: 3 }, resetsAt: now + hour };
const account = (kind: string, id = kind, windows: unknown[] = []) => ({
  id, kind: `${kind}-subscription`, label: id, createdAt: now, expiresAt: null, models: [],
  windows, enabled: true, stepsLast24h: 5, runnerId: null, runnerOffline: kind === 'antigravity',
});

async function open(page: Page, opts: { old?: boolean; quotaResponse?: unknown; slowDevin?: Promise<void> } = {}) {
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/claude-subscriptions') return json([
      account('claude', 'claude', [window]),
      account('claude', 'expired', [{ ...window, resetsAt: now - hour }]),
    ]);
    if (path === '/api/teams/t1/antigravity-subscriptions') return json([account('antigravity', 'antigravity', [
      { ...window, name: 'gemini-5h' }, { ...window, name: 'gemini-weekly' },
    ])]);
    if (path === '/api/teams/t1/devin-subscriptions') return json([account('devin')]);
    if (path === '/api/teams/t1/doubao-subscriptions') return json({ subscriptions: [account('doubao')], runnerLogins: [] });
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [{
      id: 'chatgpt', label: 'ChatGPT', kind: 'custom', providerId: 'openai-codex',
      baseUrl: 'https://chatgpt.com/backend-api', api: 'openai-responses', authHeader: false,
      compat: {}, models: [], createdBy: 'fixture-owner', createdAt: now, updatedAt: now,
    }] });
    if (path.endsWith('/claude-subscriptions/quota') || path.endsWith('/antigravity-subscriptions/quota')) return json({});
    if (path.includes('/subscription-quota/')) {
      if (opts.old) return json({ error: 'not found' }, 404);
      if (opts.quotaResponse !== undefined) return json(opts.quotaResponse);
      if (path.endsWith('/devin') && opts.slowDevin !== undefined) {
        return opts.slowDevin.then(() => json({ windows: [], activity })).catch(() => {});
      }
      const chatgpt = path.endsWith('/chatgpt');
      return json({ windows: chatgpt ? [window] : [], activity: path.endsWith('/doubao')
        ? { ...activity, fiveHour: { runs: 0, limited: 0 } } : activity });
    }
    return undefined;
  });
  await page.goto('/app/resources/providers');
}

function select(page: Page, id: string) {
  return page.locator(`[data-instance-id="${id}"]`).getByRole('button').first().click();
}
const quota = (page: Page) => page.getByTestId('subscription-quota');

for (const [kind, id, bars] of [['Claude reported window', 'subscription:claude', 1],
  ['Antigravity reported pools', 'subscription:antigravity', 2],
  ['ChatGPT recorded response', 'provider:chatgpt', 1]] as const) {
  test(kind, async ({ page }) => {
    await open(page);
    await select(page, id);
    await expect(quota(page)).toContainText('订阅额度');
    if (id !== 'provider:chatgpt') await expect(quota(page)).toContainText('5 次运行');
    await expect(quota(page).getByRole('progressbar')).toHaveCount(bars);
    await expect(quota(page).getByTestId('subscription-quota-reset')).toHaveCount(bars);
  });
}

for (const kind of ['devin', 'doubao', 'expired']) {
  test(`${kind}: recorded activity replaces missing or expired snapshot`, async ({ page }) => {
    await open(page);
    await select(page, `subscription:${kind}`);
    await expect(quota(page)).toContainText('Cairn 记录');
    await expect(quota(page)).toContainText('8 次运行');
    await expect(quota(page)).toContainText('3 次限流');
    await expect(quota(page).getByRole('progressbar')).toHaveCount(0);
    await expect(quota(page).getByTestId('subscription-quota-reset')).toHaveCount(1);
  });
}

test('live detail retires a window when its reset arrives', async ({ page }) => {
  await page.clock.install({ time: new Date(now) });
  await open(page);
  await select(page, 'subscription:claude');
  await expect(quota(page).getByRole('progressbar')).toHaveCount(1);
  await page.clock.fastForward(hour + 1000);
  await expect(quota(page)).toContainText('Cairn 记录');
  await expect(quota(page).getByRole('progressbar')).toHaveCount(0);
});

test('switch during read on a narrow dark screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 812 });
  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'dark'));
  const { promise, resolve } = Promise.withResolvers<void>();
  await open(page, { slowDevin: promise });
  await select(page, 'subscription:devin');
  await expect(quota(page)).toContainText('正在读取额度');
  await page.getByTestId('subscription-detail').waitFor();
  await page.goBack();
  await select(page, 'subscription:doubao');
  resolve();
  await expect(quota(page)).toContainText('0 次运行');
  await expect(quota(page)).not.toContainText('2 次运行');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test('old server returns successful but unrecognized quota data', async ({ page }) => {
  const opts: { quotaResponse: unknown } = { quotaResponse: {} };
  await open(page, opts);
  for (const response of [
    {},
    [],
    { windows: [], activity: { ...activity, fiveHour: { runs: -1, limited: 0 } } },
    { windows: [], activity: { ...activity, resetsAt: 'tomorrow' } },
    { windows: [{ ...window, utilization: -1 }], activity },
    { windows: [{ ...window, observedAt: 9e15 }], activity },
    { windows: [{}], activity },
  ]) {
    opts.quotaResponse = response;
    await page.goto('/app/resources/providers');
    await select(page, 'subscription:devin');
    await expect(page.getByTestId('subscription-detail')).toBeVisible();
    await expect(quota(page)).toContainText('读取额度失败');
    await expect(quota(page)).not.toContainText('0 次运行');
  }
});

test('old server: failed read is not zero usage', async ({ page }) => {
  await open(page, { old: true });
  await select(page, 'subscription:devin');
  await expect(quota(page)).toContainText('读取额度失败');
  await expect(quota(page)).not.toContainText('0 次运行');
});
