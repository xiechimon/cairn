import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const RECORD = {
  kind: 'custom',
  providerId: 'relay-fixture',
  label: 'Relay connection',
  baseUrl: 'https://gateway.example.invalid/v1',
  api: 'openai-completions',
  authHeader: false,
  compat: {},
  models: [
    { id: 'small-model', name: 'Small model' },
    { id: 'large-model', name: 'Large model' },
  ],
  id: 'prov-relay',
  createdBy: 'u1',
  createdAt: 1,
  updatedAt: 1,
};

const OK = { status: 'ok', reason: null, failure: null, httpStatus: null, latencyMs: 412 };
const NOT_FOUND = {
  status: 'failed',
  reason: 'The provider request failed. Check the key, model and connection settings.',
  failure: 'not-found',
  httpStatus: 404,
  latencyMs: null,
};

const editor = (page: Page) => page.getByTestId('provider-editor');
const chip = (page: Page, id: string) =>
  editor(page).locator(`[data-testid="provider-model"][data-model-id="${id}"]`);

for (const canTestConnection of [false, undefined]) {
  test(`owner-only tests are hidden when capability is ${canTestConnection}`, async ({ page }) => {
    await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
      if (path === '/api/teams/t1/providers')
        return json({ presets: [], providers: [RECORD], canTestConnection });
      if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
      return undefined;
    });
    await page.goto('/app/resources/providers');
    await expect(editor(page).getByLabel('名称')).toHaveValue('Relay connection');
    await expect(editor(page).getByTestId('provider-test-all')).toHaveCount(0);
    await expect(editor(page).getByRole('button', { name: /^测试 / })).toHaveCount(0);
    await expect(editor(page).getByRole('button', { name: '从上游选择' })).toHaveCount(0);
  });
}

test('test all sends one request per model and shows latency or the failure kind', async ({
  page,
}) => {
  const tested: string[] = [];
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/providers/prov-relay/test') {
      const model = route.request().postDataJSON().model as string;
      tested.push(model);
      return json(model === 'large-model' ? NOT_FOUND : OK);
    }
    if (path === '/api/teams/t1/providers')
      return json({ presets: [], providers: [RECORD], canTestConnection: true });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    return undefined;
  });
  await page.goto('/app/resources/providers');
  await editor(page).getByTestId('provider-test-all').click();
  await expect(chip(page, 'small-model')).toHaveAttribute('data-check', 'ok');
  await expect(chip(page, 'small-model')).toContainText('412 ms');
  await expect(chip(page, 'large-model')).toHaveAttribute('data-check', 'failed');
  await expect(chip(page, 'large-model')).toContainText('模型不存在');
  await expect(editor(page).getByTestId('provider-model-failures')).toContainText(
    '上游没有这个模型',
  );
  await expect(editor(page).getByTestId('provider-models-summary')).toHaveText(
    '1 个可用 · 1 个失败',
  );
  await expect(editor(page)).not.toContainText('Check the key');
  expect(tested.sort()).toEqual(['large-model', 'small-model']);

  await editor(page).getByRole('button', { name: '测试 small-model' }).click();
  await expect.poll(() => tested.length).toBe(3);
  expect(tested[2]).toBe('small-model');
});

test('editing the address drops results, including a test still running', async ({ page }) => {
  let record = { ...RECORD };
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/providers/prov-relay/test') return held.then(() => json(OK));
    if (path === '/api/teams/t1/providers/prov-relay' && route.request().method() === 'PATCH') {
      record = { ...record, ...route.request().postDataJSON(), updatedAt: 2 };
      return json(record);
    }
    if (path === '/api/teams/t1/providers')
      return json({ presets: [], providers: [record], canTestConnection: true });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    return undefined;
  });
  await page.goto('/app/resources/providers');
  await editor(page).getByRole('button', { name: '测试 small-model' }).click();
  await expect(chip(page, 'small-model')).toHaveAttribute('data-check', 'running');
  const address = editor(page).getByLabel('地址', { exact: true });
  await address.fill('https://new-gateway.example.invalid/v1');
  await address.press('Tab');
  await expect(chip(page, 'small-model')).toHaveAttribute('data-check', 'none');
  const finished = page.waitForResponse((r) => r.url().endsWith('/providers/prov-relay/test'));
  release?.();
  await finished;
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  await expect(chip(page, 'small-model')).toHaveAttribute('data-check', 'none');
});

test('a transport error reads as not finished', async ({ page }) => {
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/providers/prov-relay/test') return route.abort();
    if (path === '/api/teams/t1/providers')
      return json({ presets: [], providers: [RECORD], canTestConnection: true });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    return undefined;
  });
  await page.goto('/app/resources/providers');
  await editor(page).getByRole('button', { name: '测试 small-model' }).click();
  await expect(chip(page, 'small-model')).toContainText('没测完');
  await expect(editor(page).getByTestId('provider-model-failures')).toContainText(
    '测试没能跑完，请重试。',
  );
});

test('an empty provider offers the upstream list; a failed list falls back to adding by ID', async ({
  page,
}) => {
  const patches: string[] = [];
  let record = { ...RECORD, models: [] as { id: string; name: string }[] };
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/providers/prov-relay/upstream-models')
      return json({ status: 'failed', failure: 'not-found', httpStatus: 404 });
    if (path === '/api/teams/t1/providers/prov-relay/test') return json(OK);
    if (path === '/api/teams/t1/providers/prov-relay' && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      patches.push(JSON.stringify(body));
      record = { ...record, ...body, updatedAt: 2 };
      return json(record);
    }
    if (path === '/api/teams/t1/providers')
      return json({ presets: [], providers: [record], canTestConnection: true });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    return undefined;
  });
  await page.goto('/app/resources/providers');
  await expect(editor(page)).toContainText('还没选模型');
  await editor(page).getByRole('button', { name: '获取上游模型' }).click();
  const picker = page.getByRole('dialog', { name: '从上游选择模型' });
  await expect(picker.getByTestId('upstream-error')).toContainText('上游没有提供模型清单');
  const typed = picker.getByLabel('模型 ID');
  await typed.fill('custom-model');
  await typed.press('Enter');
  await picker.getByTestId('upstream-save').click();
  await expect
    .poll(() => patches)
    .toEqual(['{"models":[{"id":"custom-model","name":"custom-model"}]}']);
  await expect(chip(page, 'custom-model')).toHaveAttribute('data-check', 'ok');
});
