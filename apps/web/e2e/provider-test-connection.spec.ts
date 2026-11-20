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

const OK = {
  status: 'ok',
  reason: null,
  failure: null,
  httpStatus: null,
  detail: null,
  latencyMs: 412,
};
const NOT_FOUND = {
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
const MODEL_CHECK_WORDS = ['412 ms', '模型不存在', '个可用', '个失败', '上游没有这个模型', '没测完'];

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
  await expect(report(page)).toContainText('1/2 个模型没连上：上游没有这个模型。');
  await expect(page.getByTestId('model-test-detail').locator('dt:text-is("small-model") + dd')).toContainText('通过 · 412 ms');
  await expect(page.getByTestId('model-test-detail').locator('dt:text-is("large-model") + dd')).toContainText('没通过 · 模型不存在');
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
  await expect(report(page)).toContainText('small-model 没连上：测试没能跑完，请重试。');
  await expect(page.getByTestId('model-test-detail').locator('dt:text-is("small-model") + dd')).toContainText('没测完');
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
