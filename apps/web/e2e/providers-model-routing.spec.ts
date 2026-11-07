import { expect, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const NOW = Date.now();
const HOUR = 3_600_000;

test('fixture: subscriptions sit in the provider list and the routing page keeps only the graph', async ({
  page,
}) => {
  await page.goto('/app/settings/providers?scenario=model-routing');
  const rows = page.getByTestId('provider-instance');
  await expect(rows.filter({ hasText: '订阅' })).toHaveCount(3);
  const work = page.locator('[data-instance-id^="subscription:"]', { hasText: '冷却至' });
  await expect(work).toHaveCount(1);
  await work.click();
  await expect(page.getByTestId('subscription-detail')).toHaveAttribute('data-account-id', 'sub-work');
  await page.locator('[data-instance-id^="subscription:"]', { hasText: 'Personal' }).first().click();
  const detail = page.getByTestId('subscription-detail');
  await expect(detail).toContainText('Fix flaky merge-gate test');
  await expect(detail).toContainText('Daemon claim loop rework');
  await expect(detail.locator('[data-window]')).toHaveCount(0);
  await expect(detail.getByRole('progressbar')).toHaveCount(2);

  await page.goto('/app/settings/routing?scenario=model-routing');
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByTestId('subscription-accounts')).toHaveCount(0);
  const graph = page.getByTestId('routing-section');
  await expect(graph.locator('[data-slot="routing-node"]')).toHaveCount(11);
  await expect(graph.locator('[data-slot="routing-node"][data-unavailable]')).toHaveCount(2);
  await expect(graph).toContainText('ChatGPT · Personal');
  await expect(graph).toContainText('Claude Code · mea-wsl');
  await expect(graph.locator('svg path')).toHaveCount(5);
});

test('old subscription links land on the provider list, old routing links on the routing page', async ({
  page,
}) => {
  await page.goto('/app/resources/model-routing?scenario=model-routing');
  await expect(page).toHaveURL(/\/app\/settings\/providers\?scenario=model-routing$/);
  await page.goto('/app/resources/model-routing?scenario=model-routing&vendor=grok');
  await expect(page).toHaveURL(/\/app\/settings\/providers\?scenario=model-routing$/);
  await page.goto('/app/resources/model-routing?scenario=model-routing&tab=routing');
  await expect(page).toHaveURL(/\/app\/settings\/routing\?scenario=model-routing$/);
  await page.goto('/app/settings/routing?scenario=model-routing&vendor=codex');
  await expect(page).toHaveURL(/\/app\/settings\/providers\?scenario=model-routing$/);
  await page.goto('/app/resources/model-routing?scenario=model-routing&scope=m1&vendor=claude');
  await expect(page).toHaveURL(/\/app\/settings\/providers\?scenario=model-routing$/);
  await page.goto('/app/settings/routing?scenario=model-routing&scope=m1&vendor=claude');
  await expect(page).toHaveURL(/\/app\/settings\/providers\?scenario=model-routing$/);
  await page.goto('/app/settings/routing?scenario=model-routing&tab=routing&vendor=codex');
  await expect(page).toHaveURL(/\/app\/settings\/routing\?/);
  await expect(page.getByTestId('routing-section')).toBeVisible();
});

test('fixture: empty team routing page says there is nothing to route yet', async ({ page }) => {
  await page.goto('/app/settings/routing?scenario=model-routing-empty');
  await expect(page.getByTestId('routing-empty')).toBeVisible();
});

test('the settings nav lists Providers and Routing', async ({ page }) => {
  await page.goto('/app/resources/providers?scenario=10');
  const settings = page.getByRole('dialog', { name: '设置' });
  await expect(settings.getByRole('link', { name: '订阅与路由' })).toHaveCount(0);
  await settings.getByRole('link', { name: '模型路由', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/settings\/routing\?scenario=10/);
  await expect(page.getByRole('heading', { name: '模型路由', exact: true })).toBeVisible();
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
  await page.goto('/app/resources/providers');

  const rows = page.locator('[data-testid="provider-instance"][data-instance-id^="subscription:"]');
  await expect(rows).toHaveCount(2);
  const personal = page.locator('[data-instance-id="subscription:s1"]');
  await personal.click();
  const detail = page.getByTestId('subscription-detail');
  await expect(detail.getByRole('progressbar')).toHaveCount(2);
  await expect(detail.getByRole('progressbar').nth(1)).toHaveAttribute('aria-valuenow', '10');
  await detail.getByLabel('名称', { exact: true }).fill('Main');
  await detail.getByLabel('名称', { exact: true }).press('Enter');
  await expect.poll(() => calls).toContain('PATCH s1 Main');

  await detail.getByTestId('subscription-verify').click();
  await expect.poll(() => calls).toContain('verify s1');

  const codex = page.locator('[data-instance-id="provider:p1"]');
  await expect(codex).toContainText('订阅');
  await codex.click();
  await expect(page.getByTestId('subscription-detail')).toHaveCount(0);

  await page.locator('[data-instance-id="subscription:s2"]').click();
  await expect(detail.getByLabel('名称', { exact: true })).toHaveCount(0);
  await detail.getByRole('button', { name: '移除', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toContainText('Legacy');
  await confirm.getByRole('button', { name: '移除', exact: true }).click();
  await expect.poll(() => calls).toContain('DELETE s2');

  await page.goto('/app/settings/routing');
  await expect(page.getByTestId('claude-usage-hint')).toContainText('只用订阅');
  await page.getByRole('radio', { name: '允许按量付费' }).click();
  await expect.poll(() => calls).toContain('PATCH team allow-paid');
  await expect(page.getByTestId('claude-usage-hint')).toContainText('按 token 付费的 Claude API key');
});
