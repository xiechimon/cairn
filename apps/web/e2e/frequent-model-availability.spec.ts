import { expect, request, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { LOBEHUB_MONO } from '../src/icons/lobehub-mono.js';
import { bootLiveServer, type LiveServer } from './live-server';

let server: LiveServer;
let api: APIRequestContext;

test.setTimeout(120_000);

test.beforeAll(async () => {
  server = await bootLiveServer(null);
  api = await request.newContext({ baseURL: server.base });

  const teams = (await (await api.get('/api/teams')).json()) as { id: string }[];
  const teamId = teams[0]!.id;

  const started = await api.post('/api/machine/enroll/start', {
    data: { name: 'e2e-runner' },
  });
  expect(started.status()).toBe(200);
  const { enrollId } = (await started.json()) as { enrollId: string };
  const confirmed = await api.post('/api/machine/enroll/confirm', { data: { enrollId } });
  expect(confirmed.status()).toBe(200);
  const { machine } = (await confirmed.json()) as { machine: { token: string } };

  const presence = await api.post('/api/machine/presence', {
    headers: { authorization: `Bearer ${machine.token}` },
    data: {
      capabilities: { mcpServers: [], skills: [], devin: { installed: false } },
      claudeCode: {
        installed: true,
        hostname: 'e2e-runner',
        models: [{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }],
      },
    },
  });
  expect(presence.status()).toBe(200);

  const created = await api.post(`/api/teams/${teamId}/devin-subscriptions`, {
    data: { label: 'e2e devin', token: 'e2e-devin-subscription-token' },
  });
  expect(created.status()).toBe(201);
  const { id: subscriptionId } = (await created.json()) as { id: string };
  const renamed = await api.patch(`/api/teams/${teamId}/devin-subscriptions/${subscriptionId}`, {
    data: { models: [{ id: 'swe-2-high', name: 'SWE-2' }] },
  });
  expect(renamed.status()).toBe(200);

  const put = await api.put(`/api/teams/${teamId}/top-models`, {
    headers: { origin: server.base },
    data: {
      models: [
        { provider: 'devin', modelId: 'swe-2-high', thinkingLevel: null },
        { provider: 'claude-code', modelId: 'claude-sonnet-5-5', thinkingLevel: null },
      ],
    },
  });
  expect(put.status()).toBe(200);
});

test.afterAll(async () => {
  await api?.dispose();
  await server?.dispose();
});

async function frequentRow(page: Page, modelName: string): Promise<Locator> {
  await page.goto(`${server.base}/app/settings/routing`);
  const row = page
    .getByRole('dialog', { name: '设置' })
    .getByTestId('frequent-model-row')
    .filter({ hasText: modelName });
  await expect(row).toBeVisible();
  return row;
}

async function expectThinkingLevels(row: Locator, modelName: string, expected: string[]) {
  const trigger = row.getByRole('combobox', { name: `${modelName} 的思考强度` });
  await trigger.click();
  await expect(row.page().getByRole('option')).toHaveText(expected);
  await row.page().keyboard.press('Escape');
}

test('a stored SWE-2 row resolves against the live model sources', async ({ page }) => {
  const row = await frequentRow(page, 'SWE-2');
  await expect(row).not.toHaveAttribute('data-unavailable', '');
  await expect(row).not.toContainText('不可用');
  await expect(row).toContainText('Devin');

  const icon = row.getByTestId('frequent-model-mark').locator('svg');
  await expect(icon.locator('path').first()).toHaveAttribute('d', LOBEHUB_MONO.devin.paths[0]!);

  await expectThinkingLevels(row, 'SWE-2', ['Default (High)', 'Medium', 'High', 'Max']);
});

test('a stored Claude Sonnet 5.5 row resolves against the live model sources', async ({ page }) => {
  const row = await frequentRow(page, 'Claude Sonnet 5.5');
  await expect(row).not.toHaveAttribute('data-unavailable', '');
  await expect(row).not.toContainText('不可用');
  await expect(row).toContainText('Claude Code');

  const icon = row.getByTestId('frequent-model-mark').locator('svg');
  await expect(icon).toHaveAttribute('viewBox', LOBEHUB_MONO.claude.viewBox);
  await expect(icon.locator('path').first()).toHaveAttribute('d', LOBEHUB_MONO.claude.paths[0]);
  await expect(icon.locator('path').first()).toHaveAttribute('fill', '#D97757');

  await expectThinkingLevels(row, 'Claude Sonnet 5.5', [
    'Default (Medium)',
    'Low',
    'Medium',
    'High',
    'Xhigh',
    'Max',
  ]);
});
