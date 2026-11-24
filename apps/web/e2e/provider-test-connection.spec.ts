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
  configurationFingerprint: 'a'.repeat(32),
};
const CHANGED_FINGERPRINT = 'b'.repeat(32);

const OK = {
  configurationFingerprint: RECORD.configurationFingerprint,
  status: 'ok',
  reason: null,
  failure: null,
  httpStatus: null,
  detail: null,
  latencyMs: 412,
};
const NOT_FOUND = {
  configurationFingerprint: RECORD.configurationFingerprint,
  status: 'failed',
  reason: 'The provider request failed. Check the key, model and connection settings.',
  failure: 'not-found',
  httpStatus: 404,
  detail: 'Model "large-model" is not supported by any configured account in this group',
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

test('an OAuth provider shows the same pick and test buttons', async ({ page }) => {
  const oauth = { ...RECORD, providerId: 'github-copilot' };
  await mockLive(page, { threads: [], messages: [] }, (path, _route, json) => {
    if (path === '/api/teams/t1/providers')
      return json({ presets: [], providers: [oauth], canTestConnection: true });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    return undefined;
  });
  await page.goto('/app/resources/providers');
  await expect(editor(page).getByRole('button', { name: '从上游选择' })).toBeVisible();
  await expect(editor(page).getByTestId('provider-test-all')).toBeEnabled();
  await expect(editor(page).getByRole('button', { name: '测试 small-model' })).toBeVisible();
});

const report = (page: Page) => page.getByTestId('model-test-result');
const MODEL_CHECK_WORDS = ['412 ms', '模型不存在', '个可用', '个失败', '上游没有这个模型', '测试未完成'];

test('test all pops its result up from the button, never reflows the editor, and leaves no status', async ({
  page,
}) => {
  const tested: string[] = [];
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/providers/prov-relay/test') {
      const model = route.request().postDataJSON().model as string;
      tested.push(model);
      return held.then(() => json(model === 'large-model' ? NOT_FOUND : OK));
    }
    if (path === '/api/teams/t1/providers')
      return json({ presets: [], providers: [RECORD], canTestConnection: true });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    return undefined;
  });
  await page.goto('/app/resources/providers');
  const manage = editor(page).getByRole('heading', { name: '管理' });
  const name = editor(page).getByLabel('名称');
  const top = async () =>
    ((await manage.boundingBox())?.y ?? Number.NaN) - ((await name.boundingBox())?.y ?? Number.NaN);
  const before = await top();
  await editor(page).getByTestId('provider-test-all').click();
  await expect(chip(page, 'small-model')).toHaveAttribute('data-check', 'running');
  await expect(report(page)).toHaveAttribute('data-phase', 'checking');
  await expect(report(page)).toContainText('正在测试 0/2 个模型…');
  await expect(editor(page).getByTestId('provider-models-summary')).toHaveText('2 个');
  await expect(editor(page).getByTestId('provider-test-all')).toHaveText('全部测试');
  expect(await top()).toBe(before);
  release?.();

  await expect(report(page)).toBeVisible();
  await expect(report(page)).toHaveAttribute('data-phase', 'failed');
  await expect(report(page)).toContainText('1/2 个模型未能连接：上游没有这个模型。');
  await expect(page.getByTestId('model-test-detail').locator('dt:text-is("small-model") + dd')).toContainText('通过 · 412 ms');
  await expect(page.getByTestId('model-test-detail').locator('dt:text-is("large-model") + dd')).toContainText('未通过 · 模型不存在');
  await expect(report(page)).not.toContainText('HTTP 404');
  await expect(report(page)).not.toContainText('not supported by any configured account');
  expect(await top()).toBe(before);
  await expect(chip(page, 'large-model')).toHaveAttribute('data-check', 'failed');
  for (const word of MODEL_CHECK_WORDS) await expect(editor(page)).not.toContainText(word);
  await expect(editor(page).getByTestId('provider-models-summary')).toHaveText('2 个');
  await expect(editor(page)).not.toContainText('Check the key');
  expect(tested.sort()).toEqual(['large-model', 'small-model']);

  await page.keyboard.press('Escape');
  await expect(report(page)).toHaveCount(0);

  await editor(page).getByRole('button', { name: '测试 small-model' }).click();
  await expect(report(page)).toContainText('small-model 回复了，能用。');
  await expect.poll(() => tested.length).toBe(3);
  expect(tested[2]).toBe('small-model');
  await editor(page).getByRole('heading', { name: '模型', exact: true }).click();
  await expect(report(page)).toHaveCount(0);
  expect(await top()).toBe(before);
});

test('editing the address drops results, including a test still running', async ({ page }) => {
  let record = { ...RECORD };
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/providers/prov-relay/test') {
      const { configurationFingerprint } = record;
      return held.then(() => json({ ...OK, configurationFingerprint }));
    }
    if (path === '/api/teams/t1/providers/prov-relay' && route.request().method() === 'PATCH') {
      record = { ...record, ...route.request().postDataJSON(), configurationFingerprint: CHANGED_FINGERPRINT };
      return json(record);
    }
    if (path === '/api/teams/t1/providers')
      return json({ presets: [], providers: [record], canTestConnection: true });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    return undefined;
  });
  await page.goto('/app/resources/providers');
  const row = page.getByTestId('provider-instance').filter({ hasText: RECORD.label });
  await expect(row.getByRole('button').first()).toHaveAccessibleName(/未检查/);
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
  await expect(row.getByRole('button').first()).toHaveAccessibleName(/未检查/);
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
  await expect(report(page)).toContainText('small-model 未能连接：测试未能完成，请重试。');
  await expect(page.getByTestId('model-test-detail').locator('dt:text-is("small-model") + dd')).toContainText('测试未完成');
});

test('C1: a Cairn 429 retest keeps the last success and only the detail says not finished', async ({ page }) => {
  let tested = 0;
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/providers/prov-relay/test') {
      tested += 1;
      return tested === 1 ? json(OK) : route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Too many requests' }),
      });
    }
    if (path === '/api/teams/t1/providers')
      return json({ presets: [], providers: [RECORD], canTestConnection: true });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    return undefined;
  });
  await page.goto('/app/resources/providers');
  const row = page.getByTestId('provider-instance').filter({ hasText: RECORD.label });
  await editor(page).getByRole('button', { name: '测试 small-model' }).click();
  await expect(report(page)).toHaveAttribute('data-phase', 'passed');
  await expect(row).toHaveAttribute('data-tone', 'ok');
  const started = Date.now();
  await page.keyboard.press('Escape');
  await editor(page).getByRole('button', { name: '测试 small-model' }).click();
  await expect(page.getByTestId('model-test-detail')).toContainText('测试未完成');
  expect(Date.now() - started).toBeLessThan(10_000);
  expect(tested).toBe(2);
  await expect(row).toHaveAttribute('data-tone', 'ok');
  await expect(row.getByRole('button').first()).toHaveAccessibleName(/可用/);
  await expect(row.getByTestId('provider-subtitle')).not.toContainText(/更新|新版|最近使用/);
});

test('C1: save-and-test after a model change shows the provider failure in both row and detail', async ({ page }) => {
  let record = { ...RECORD, models: [RECORD.models[0]!] };
  const fingerprints: string[] = [];
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/providers/prov-relay/upstream-models')
      return json({ status: 'ok', models: RECORD.models });
    if (path === '/api/teams/t1/providers/prov-relay/test') {
      fingerprints.push(record.configurationFingerprint);
      return json({
        ...(route.request().postDataJSON().model === 'large-model' ? NOT_FOUND : OK),
        configurationFingerprint: record.configurationFingerprint,
      });
    }
    if (path === '/api/teams/t1/providers/prov-relay' && route.request().method() === 'PATCH') {
      record = { ...record, ...route.request().postDataJSON(), configurationFingerprint: CHANGED_FINGERPRINT };
      return json(record);
    }
    if (path === '/api/teams/t1/providers')
      return json({ presets: [], providers: [record], canTestConnection: true });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    return undefined;
  });
  await page.goto('/app/resources/providers');
  const row = page.getByTestId('provider-instance').filter({ hasText: RECORD.label });
  await editor(page).getByRole('button', { name: '测试 small-model' }).click();
  await expect(report(page)).toHaveAttribute('data-phase', 'passed');
  await expect(row).toHaveAttribute('data-tone', 'ok');
  await page.keyboard.press('Escape');
  await editor(page).getByRole('button', { name: '从上游选择' }).click();
  const picker = page.getByRole('dialog', { name: '从上游选择模型' });
  await picker.getByRole('checkbox', { name: /large-model/ }).check();
  await picker.getByTestId('upstream-save').click();
  await expect(page.getByTestId('model-test-detail')).toContainText('未通过 · 模型不存在');
  await expect(chip(page, 'large-model')).toHaveAttribute('data-check', 'failed');
  expect(fingerprints).toEqual([RECORD.configurationFingerprint, CHANGED_FINGERPRINT]);
  await expect(row).toHaveAttribute('data-tone', 'fail');
  await expect(row.getByRole('button').first()).toHaveAccessibleName(/模型不存在/);
  await expect(row.getByTestId('provider-subtitle')).toHaveText('自定义端点 · 2 个模型');
});

test('an empty provider offers the upstream list; a failed list falls back to adding by ID', async ({
  page,
}) => {
  const patches: string[] = [];
  let record = { ...RECORD, models: [] as { id: string; name: string }[] };
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/providers/prov-relay/upstream-models')
      return json({ status: 'failed', failure: 'not-found', httpStatus: 404 });
    if (path === '/api/teams/t1/providers/prov-relay/test')
      return json({ ...OK, configurationFingerprint: record.configurationFingerprint });
    if (path === '/api/teams/t1/providers/prov-relay' && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      patches.push(JSON.stringify(body));
      record = { ...record, ...body, configurationFingerprint: CHANGED_FINGERPRINT };
      return json(record);
    }
    if (path === '/api/teams/t1/providers')
      return json({ presets: [], providers: [record], canTestConnection: true });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    return undefined;
  });
  await page.goto('/app/resources/providers');
  await expect(editor(page)).toContainText('尚未选择模型');
  await expect(editor(page).getByTestId('provider-test-all')).toBeDisabled();
  await editor(page).getByRole('button', { name: '从上游选择' }).click();
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
