import { expect, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const FIXTURE = '/app/resources/model-routing?scenario=model-routing';
const NOW = Date.now();
const HOUR = 3_600_000;

test('fixture: vendor sections pool quota per window and the graph routes every use', async ({
  page,
}) => {
  await page.goto(FIXTURE);
  const claude = page.locator('[data-testid="vendor-section"][data-vendor="claude"]');
  await expect(claude.getByTestId('pool-window')).toHaveCount(2);
  await expect(claude.getByTestId('account-row')).toHaveCount(3);
  await expect(claude.locator('[data-window="five_hour"]')).toContainText('29%');
  await expect(claude.locator('[data-window="five_hour"]')).toContainText('未上报');
  await expect(page.getByTestId('vendor-section')).toHaveCount(1);

  const work = claude.locator('[data-testid="account-row"][data-state="cooling"]');
  await expect(work).toContainText('冷却至');
  await claude.getByRole('button', { name: '展开 Personal' }).click();
  await expect(claude.getByTestId('account-detail')).toContainText('Fix flaky merge-gate test');
  await expect(claude.getByTestId('account-detail')).toContainText('Daemon claim loop rework');

  await page.getByRole('tab', { name: /Grok 1/ }).click();
  await expect(page).toHaveURL(/vendor=grok/);
  await expect(
    page.locator('[data-testid="vendor-section"][data-vendor="grok"] [data-window="billing_period"]'),
  ).toContainText('88%');
  await expect(page.getByRole('button', { name: '添加 Grok 账户' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('tab', { name: /Grok 1/ })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('tab', { name: /Codex 1/ }).click();
  await page.getByRole('button', { name: '添加 ChatGPT · Codex 账户' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  const added = new URL(page.url()).searchParams;
  expect(added.has('vendor') || added.has('tab')).toBe(false);
  await page.goBack();

  await expect(page.getByTestId('routing-section')).toHaveCount(0);
  await page.getByRole('tab', { name: '路由' }).click();
  await expect(page).toHaveURL(/tab=routing/);
  await expect(page.getByTestId('subscription-accounts')).toHaveCount(0);
  const graph = page.getByTestId('routing-section');
  await expect(graph.locator('[data-slot="routing-node"]')).toHaveCount(11);
  await expect(graph.locator('[data-slot="routing-node"][data-unavailable]')).toHaveCount(2);
  await expect(graph).toContainText('ChatGPT · Personal');
  await expect(graph).toContainText('Claude Code · mea-wsl');
  await expect(graph.locator('svg path')).toHaveCount(5);
});

test('fixture: empty team shows every vendor with an add action and no quota', async ({ page }) => {
  await page.goto('/app/resources/model-routing?scenario=model-routing-empty');
  await expect(page.getByRole('tablist', { name: '订阅账户' }).getByRole('tab')).toHaveText([
    /Claude 0/,
    /Codex 0/,
    /Grok 0/,
  ]);
  await expect(page.getByTestId('pool-window')).toHaveCount(0);
  await expect(page.getByText('还没有 Claude 账户')).toBeVisible();
  await page.getByRole('tab', { name: /Grok 0/ }).click();
  await expect(page.getByText('还没有 Grok 账户')).toBeVisible();
  await page.getByRole('tab', { name: '路由' }).click();
  await expect(page.getByTestId('routing-empty')).toBeVisible();
});

test('settings opens model routing from the providers section', async ({ page }) => {
  await page.goto('/app/resources/providers?scenario=10');
  await page.getByRole('dialog', { name: '设置' }).getByRole('link', { name: '订阅与路由' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/routing\?scenario=10/);
  await expect(page.getByRole('heading', { name: '模型路由' })).toBeVisible();
});

test('live: rename, verify, remove and the Claude usage switch hit the agreed routes', async ({
  page,
}) => {
  const calls: string[] = [];
  let usage: 'subscription-only' | 'allow-paid' = 'subscription-only';
  const subscriptions = [
    {
      id: 's1',
      kind: 'claude-subscription',
      label: 'Personal',
      expiresAt: null,
      createdAt: NOW - 10 * HOUR,
      plan: 'max',
      state: 'ok',
      cooldownUntil: null,
      windows: [
        { name: 'five_hour', utilization: 0.3, resetsAt: NOW + HOUR, observedAt: NOW },
        { name: 'seven_day', utilization: 0.9, resetsAt: NOW + 50 * HOUR, observedAt: NOW },
      ],
      lastUsedAt: NOW - 60_000,
      stepsLast24h: 4,
    },
    { id: 's2', kind: 'claude-subscription', label: 'Legacy', expiresAt: null, createdAt: NOW },
  ];
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    const method = route.request().method();
    if (path === '/api/teams/t1/claude-subscriptions') return json(subscriptions);
    if (path === '/api/teams/t1/claude-subscriptions/stickiness') return json({ error: 'nf' }, 404);
    if (path.endsWith('/steps')) return json({ error: 'nf' }, 404);
    if (path === '/api/teams/t1/claude-subscriptions/s1' && method === 'PATCH') {
      calls.push(`PATCH s1 ${route.request().postDataJSON().label}`);
      return json({ ...subscriptions[0], label: 'Main' });
    }
    if (path === '/api/teams/t1/claude-subscriptions/s1/verify') {
      calls.push('verify s1');
      return json({ ok: true });
    }
    if (path === '/api/teams/t1/claude-subscriptions/s2' && method === 'DELETE') {
      calls.push('DELETE s2');
      return route.fulfill({ status: 204 });
    }
    if (path === '/api/teams/t1/providers')
      return json({
        presets: [],
        providers: [
          {
            kind: 'custom',
            id: 'p1',
            providerId: 'openai-codex',
            label: 'ChatGPT Pro',
            baseUrl: '',
            api: 'openai-responses',
            authHeader: false,
            compat: {},
            models: [],
            createdBy: 'u1',
            createdAt: NOW,
            updatedAt: NOW,
          },
        ],
      });
    if (path === '/api/teams/t1/model-routing')
      return json({
        edges: [
          { use: 'coordinator', modelId: 'claude-opus-5-5', effort: 'high', connectionId: 's1' },
        ],
        connections: [
          {
            id: 's1',
            vendor: 'anthropic',
            kind: 'subscription',
            models: ['claude-opus-5-5'],
            available: true,
          },
        ],
        quota: [],
        settings: { claudeUsage: usage },
      });
    if (path === '/api/teams/t1' && method === 'PATCH') {
      usage = route.request().postDataJSON().claudeUsage;
      calls.push(`PATCH team ${usage}`);
      return json({ id: 't1', name: 't' });
    }
    return undefined;
  });
  await page.goto('/app/resources/model-routing');

  const claude = page.locator('[data-testid="vendor-section"][data-vendor="claude"]');
  await expect(claude.getByTestId('account-row')).toHaveCount(2);
  await expect(claude.locator('[data-window="seven_day"]')).toContainText('10%');
  await expect(claude.getByRole('button', { name: /^展开/ })).toHaveCount(0);
  const personal = claude.locator('[data-account-id="s1"]');
  await personal.getByTestId('account-more').click();
  await page.getByRole('menuitem', { name: /重命名/ }).click();
  await personal.getByTestId('account-rename-input').fill('Main');
  await personal.getByTestId('account-rename-input').press('Enter');
  await expect.poll(() => calls).toContain('PATCH s1 Main');

  await personal.getByTestId('account-more').click();
  await page.getByRole('menuitem', { name: /验证/ }).click();
  await expect.poll(() => calls).toContain('verify s1');

  await page.getByRole('tab', { name: /Codex 1/ }).click();
  const codexRow = page.locator('[data-account-id="p1"]');
  await expect(codexRow).toContainText('ChatGPT Pro');
  await codexRow.getByTestId('account-more').click();
  const codexMenu = page.getByRole('menu', { name: 'ChatGPT Pro 的操作' });
  await expect(codexMenu.getByRole('menuitem', { name: /重命名/ })).toBeVisible();
  await expect(codexMenu.getByRole('menuitem', { name: /验证/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(codexMenu).toHaveCount(0);
  await page.getByRole('tab', { name: /Claude 2/ }).click();

  await claude.locator('[data-account-id="s2"]').getByTestId('account-more').click();
  const legacyMenu = page.getByRole('menu', { name: 'Legacy 的操作' });
  await expect(legacyMenu.getByRole('menuitem', { name: /移除/ })).toBeVisible();
  await expect(legacyMenu.getByRole('menuitem', { name: /重命名/ })).toHaveCount(0);
  await legacyMenu.getByRole('menuitem', { name: /移除/ }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Legacy');
  await confirm.getByRole('button', { name: '移除', exact: true }).click();
  await expect.poll(() => calls).toContain('DELETE s2');

  await page.getByRole('tab', { name: '路由' }).click();
  await expect(page.getByTestId('claude-usage-hint')).toContainText('只用订阅');
  await page.getByRole('radio', { name: '允许按量付费' }).click();
  await expect.poll(() => calls).toContain('PATCH team allow-paid');
  await expect(page.getByTestId('claude-usage-hint')).toContainText('按 token 付费的 Claude API key');
});
