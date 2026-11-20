import { expect, test } from '@playwright/test';
import { bootLiveServer, type LiveServer } from './live-server';

let server: LiveServer;

test.beforeAll(async () => {
  server = await bootLiveServer(null);
});

test.afterAll(async () => {
  await server?.dispose();
});

test('a fresh install creates the coordinator rule in the UI and the Coordinator then answers a message', async ({
  page,
}) => {
  const sendStatuses: number[] = [];
  page.on('response', (response) => {
    if (response.request().method() === 'POST' && /\/chief\/threads$/.test(response.url())) {
      sendStatuses.push(response.status());
    }
  });
  const composer = () => page.getByTestId('home-c').getByTestId('chief-composer-input');

  await page.goto(`${server.base}/app`);
  await expect(page.getByTestId('first-run-setup')).toBeVisible();
  await expect(page.getByTestId('first-run-skip')).toHaveCount(0);
  await expect(page.getByTestId('home-c')).toHaveCount(0);

  const teams = (await (await fetch(`${server.base}/api/teams`)).json()) as { id: string }[];
  const teamId = teams[0]?.id;
  const provider = await fetch(`${server.base}/api/teams/${teamId}/providers`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      providerId: 'e2e-relay',
      label: 'e2e relay',
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      models: [{ id: 'e2e-model', name: 'e2e-model' }],
    }),
  });
  expect(provider.status).toBe(201);

  await page.goto(`${server.base}/app/settings/work-routing#route-coordinator`);
  const settings = page.getByRole('dialog', { name: '设置' });
  const creator = settings.getByTestId('routing-rule-new-coordinator');
  await expect(creator).toBeVisible();
  await expect(settings.getByTestId('routing-rule-new-session')).toHaveCount(0);
  await expect(settings.getByTestId('frequent-models-empty')).toBeVisible();
  await expect(settings.getByTestId('routing-coordinator-default')).toContainText(
    '当前默认：e2e-model · e2e relay',
  );
  await expect(creator.locator('.routing-rule-level-select')).toHaveCount(0);

  await creator.locator('.routing-rule-model-select').click();
  await page.locator('.routing-rule-model-menu .routing-rule-model-row', { hasText: 'e2e-model' }).click();

  await expect(settings.getByTestId('routing-rule-coordinator')).toBeVisible();
  await expect(settings.getByTestId('routing-rule-new-coordinator')).toHaveCount(0);
  const settingsBody = (await (
    await fetch(`${server.base}/api/teams/${teamId}/routing-settings`)
  ).json()) as { rules: { use: string; provider: string; modelId: string }[] };
  expect(settingsBody.rules.find((rule) => rule.use === 'coordinator')).toMatchObject({
    provider: 'e2e-relay',
    modelId: 'e2e-model',
  });

  await page.goto(`${server.base}/app`);
  await expect(page.getByTestId('first-run-setup')).toHaveCount(0);
  await composer().fill('second message after the rule');
  await composer().press('Enter');
  await expect.poll(() => sendStatuses.length).toBe(1);
  expect(sendStatuses[0]).toBeLessThan(300);
  await expect(page.getByTestId('chief-stream')).toContainText('second message after the rule');
});
