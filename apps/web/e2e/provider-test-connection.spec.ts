import { expect, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const RECORD = {
  kind: 'custom', providerId: 'relay-fixture', label: 'Relay connection',
  baseUrl: 'https://gateway.example.invalid/v1', api: 'openai-completions',
  authHeader: false, compat: {}, models: [{ id: 'small-model', name: 'Small model' }],
  id: 'prov-relay', createdBy: 'u1', createdAt: 1, updatedAt: 1,
};

for (const canTestConnection of [false, undefined]) {
  test(`owner-only check is hidden when capability is ${canTestConnection}`, async ({ page }) => {
    await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
      if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [RECORD], canTestConnection });
      if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
      return undefined;
    });
    await page.goto('/app/resources/providers');
    const editor = page.getByTestId('provider-editor');
    await expect(editor.getByLabel('名称')).toHaveValue('Relay connection');
    await expect(editor.getByRole('button', { name: '测试', exact: true })).toHaveCount(0);
  });
}

test('connection check shows only a status and scrubbed failure details', async ({ page }) => {
  let result = { status: 'ok', reason: null as string | null };
  const posts: string[] = [];
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/providers/prov-relay/test') {
      posts.push(route.request().method());
      return json(result);
    }
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [RECORD], canTestConnection: true });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    return undefined;
  });
  await page.goto('/app/resources/providers');
  const editor = page.getByTestId('provider-editor');
  await expect(editor.getByLabel('名称')).toHaveValue('Relay connection');
  await editor.getByRole('button', { name: '测试', exact: true }).click();
  const outcome = editor.getByTestId('provider-test-result');
  await expect(outcome).toHaveText('连接正常');
  expect(posts).toEqual(['POST']);
  result = { status: 'failed', reason: 'Incorrect credential: [REDACTED]' };
  await editor.getByRole('button', { name: '测试', exact: true }).click();
  await expect(outcome).toHaveText('连接失败，请检查连接设置后重试。');
  await editor.getByText('详情', { exact: true }).click();
  await expect(editor.getByTestId('provider-test-reason')).toHaveText(result.reason);
  await expect(outcome).not.toContainText('small-model');
});

for (const pending of [false, true]) {
  test(`editing connection settings invalidates a ${pending ? 'pending' : 'completed'} check`, async ({ page }) => {
    let record = { ...RECORD };
    let release: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
      if (path === '/api/teams/t1/providers/prov-relay/test') return (pending ? held : Promise.resolve()).then(() => json({ status: 'ok', reason: null }));
      if (path === '/api/teams/t1/providers/prov-relay' && route.request().method() === 'PATCH') {
        record = { ...record, ...route.request().postDataJSON(), updatedAt: 2 };
        return json(record);
      }
      if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [record], canTestConnection: true });
      if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
      return undefined;
    });
    await page.goto('/app/resources/providers');
    const editor = page.getByTestId('provider-editor');
    await editor.getByRole('button', { name: '测试', exact: true }).click();
    if (pending) await expect(editor.getByRole('button', { name: '测试中…', exact: true })).toBeDisabled();
    else await expect(editor.getByTestId('provider-test-result')).toHaveText('连接正常');
    const saved = page.waitForResponse((response) => response.request().method() === 'PATCH' && response.url().endsWith('/providers/prov-relay'));
    await editor.getByLabel('地址', { exact: true }).fill('https://new-gateway.example.invalid/v1');
    await editor.getByLabel('地址', { exact: true }).press('Tab');
    await saved;
    await expect(editor.getByRole('button', { name: '测试', exact: true })).toBeEnabled();
    if (pending) {
      const finished = page.waitForResponse((response) => response.url().endsWith('/providers/prov-relay/test'));
      release?.();
      await finished;
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    }
    await expect(editor.getByTestId('provider-test-result')).toHaveCount(0);
  });
}

test('pending checks disable repeat clicks and transport errors use safe copy', async ({ page }) => {
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/providers/prov-relay/test') return held.then(() => route.abort());
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [RECORD], canTestConnection: true });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    return undefined;
  });
  await page.goto('/app/resources/providers');
  const editor = page.getByTestId('provider-editor');
  await editor.getByRole('button', { name: '测试', exact: true }).click();
  await expect(editor.getByRole('button', { name: '测试中…', exact: true })).toBeDisabled();
  release?.();
  await expect(editor.getByTestId('provider-test-result')).toHaveText('测试没能跑完，请重试。');
});
