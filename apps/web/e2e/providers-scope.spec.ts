import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const FLEET = '/app/resources/providers?scenario=providers-fleet';
const NOW = Date.now();

const instance = (page: Page, id: string) =>
  page.locator(`[data-testid="provider-instance"][data-instance-id="${id}"]`);
const editor = (page: Page) => page.getByTestId('provider-editor');

test('one provider list for every Runner: no scope menu, no checked stamp', async ({ page }) => {
  await page.goto(FLEET);
  await expect(page.getByRole('combobox', { name: '设置作用于' })).toHaveCount(0);
  await expect(page.getByTestId('settings-scope')).toHaveCount(0);
  await expect(page.getByTestId('settings-checked')).toHaveCount(0);
  await expect(page.getByTestId('provider-instance')).toHaveCount(3);
  await expect(instance(page, 'claude-code')).toHaveCount(0);
});

test('provider rows open an editor; the selection lives in the URL and survives reload', async ({
  page,
}) => {
  await page.goto(FLEET);
  const rows = page.getByTestId('provider-instance');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toHaveAttribute('aria-current', 'true');
  await instance(page, 'provider:prov-relay').getByRole('button').first().click();
  await expect(page).toHaveURL(/item=provider%3Aprov-relay/);
  await expect(page).toHaveURL(/scenario=providers-fleet/);
  await expect(editor(page)).toContainText('OpenAI Chat Completions');
  await expect(editor(page).getByLabel('地址')).toHaveValue('https://gateway.example.invalid/v1');
  const models = editor(page).getByTestId('provider-model');
  await expect(models).toHaveCount(3);
  await expect(models.filter({ hasText: 'claude-opus-4-5' })).toHaveAttribute(
    'data-liveness',
    'dead',
  );
  await expect(models.filter({ hasText: 'claude-opus-4-5' })).toContainText('已下架');
  await expect(instance(page, 'provider:prov-relay')).toHaveAttribute('data-tone', 'warn');

  await page.reload();
  await expect(instance(page, 'provider:prov-relay')).toHaveAttribute('aria-current', 'true');
  await expect(editor(page).getByLabel('名称')).toHaveValue('R3 网关');
});

test('OAuth providers show no API key row; key providers show a write-only key row', async ({
  page,
}) => {
  await page.goto(`${FLEET}&item=provider%3Aprov-copilot`);
  await expect(editor(page)).toContainText('OAuth');
  await expect(editor(page).getByRole('button', { name: '更换', exact: true })).toHaveCount(0);
  await expect(editor(page).getByTestId('provider-test-all')).toBeVisible();
  await page.goto(`${FLEET}&item=provider%3Aprov-anthropic`);
  await expect(editor(page)).toContainText('Anthropic Messages');
  await expect(editor(page).getByRole('button', { name: '更换', exact: true })).toBeVisible();
});

test('an unknown item and a leftover scope param fall back to the first row', async ({ page }) => {
  await page.goto(`${FLEET}&scope=gone-machine&item=provider%3Agone`);
  await expect(page.getByTestId('provider-instance').first()).toHaveAttribute(
    'aria-current',
    'true',
  );
});

test('empty team: the list offers to add a provider and opens the picker', async ({ page }) => {
  await page.goto('/app/resources/providers?scenario=providers-empty');
  await expect(page.getByTestId('provider-instance')).toHaveCount(0);
  await expect(page.getByTestId('providers-empty')).toBeVisible();
  await page.getByTestId('routing-add-provider').click();
  await expect(page.getByRole('dialog', { name: '添加模型服务' })).toBeVisible();
});

test('phone width: the list sits above the editor and nothing overflows sideways', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(FLEET);
  const list = await page.getByTestId('provider-list').boundingBox();
  const panel = await editor(page).boundingBox();
  expect(list).not.toBeNull();
  expect(panel).not.toBeNull();
  if (list === null || panel === null) return;
  expect(panel.y).toBeGreaterThanOrEqual(list.y + list.height - 1);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
});

test('live: provider edits send the agreed requests and touch no Runner', async ({ page }) => {
  const calls: string[] = [];
  let provider = {
    kind: 'custom',
    id: 'p1',
    providerId: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    api: 'anthropic-messages',
    authHeader: true,
    compat: { supportsDeveloperRole: false },
    models: [{ id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' }],
    createdBy: 'u1',
    createdAt: NOW,
    updatedAt: NOW,
  };
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    const method = route.request().method();
    if (path === '/api/teams/t1/providers')
      return json({ presets: [], providers: [provider], canTestConnection: true });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/machines')
      return json([
        {
          id: 'm1',
          name: 'box',
          teamId: 't1',
          online: true,
          latestCliVersion: null,
          kind: 'remote',
          enabledRuntimes: ['pi'],
        },
      ]);
    if (path === '/api/teams/t1/providers/p1' && method === 'PATCH') {
      const body = route.request().postDataJSON();
      calls.push(`PATCH p1 ${JSON.stringify(body)}`);
      provider = { ...provider, ...body };
      return json(provider);
    }
    if (path === '/api/teams/t1/providers/p1/upstream-models') {
      return json({
        status: 'ok',
        models: [
          { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
          { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
        ],
      });
    }
    if (path === '/api/teams/t1/providers/p1/test') {
      calls.push(`TEST p1 ${route.request().postDataJSON().model}`);
      return json({ status: 'ok', reason: null, failure: null, httpStatus: null, latencyMs: 412 });
    }
    if (path === '/api/teams/t1/providers/p1' && method === 'DELETE') {
      calls.push('DELETE p1');
      return route.fulfill({ status: 204 });
    }
    if (path === '/api/machines/m1' && method === 'PATCH') {
      calls.push(`PATCH m1 ${JSON.stringify(route.request().postDataJSON())}`);
      return json({});
    }
    return undefined;
  });
  await page.goto('/app/resources/providers');

  const name = editor(page).getByLabel('名称');
  await name.fill('Anthropic 主账号');
  await name.press('Enter');
  await expect.poll(() => calls).toContain('PATCH p1 {"label":"Anthropic 主账号"}');

  const baseUrl = editor(page).getByLabel('地址');
  await baseUrl.fill('https://proxy.example.invalid');
  await baseUrl.blur();
  await expect.poll(() => calls).toContain('PATCH p1 {"baseUrl":"https://proxy.example.invalid"}');

  await editor(page).getByRole('button', { name: '更换', exact: true }).click();
  await editor(page).getByLabel('新的 API key').fill('sk-test-new');
  await editor(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => calls).toContain('PATCH p1 {"apiKey":"sk-test-new"}');

  await editor(page).getByRole('button', { name: '从上游选择' }).click();
  const picker = page.getByRole('dialog', { name: '从上游选择模型' });
  await picker.getByRole('checkbox').nth(1).click();
  await picker.getByTestId('upstream-save').click();
  await expect
    .poll(() => calls)
    .toContain(
      'PATCH p1 {"models":[{"id":"claude-haiku-5-5","name":"Claude Haiku 5.5"},{"id":"claude-opus-5-5","name":"Claude Opus 5.5"}]}',
    );
  await expect.poll(() => calls).toContain('TEST p1 claude-opus-5-5');

  await editor(page).getByRole('button', { name: '移除 claude-haiku-5-5' }).click();
  await expect
    .poll(() => calls)
    .toContain('PATCH p1 {"models":[{"id":"claude-opus-5-5","name":"Claude Opus 5.5"}]}');

  await editor(page).getByRole('button', { name: '移除', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '移除', exact: true }).click();
  await expect.poll(() => calls).toContain('DELETE p1');

  expect(calls.filter((call) => call.startsWith('PATCH m1'))).toEqual([]);
});

test('live: a second model edit waits for the first and keeps its result', async ({ page }) => {
  const bodies: string[] = [];
  let release: () => void = () => undefined;
  const firstHeld = new Promise<void>((resolve) => {
    release = resolve;
  });
  const provider = {
    kind: 'custom',
    id: 'p1',
    providerId: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    api: 'anthropic-messages',
    authHeader: true,
    compat: { supportsDeveloperRole: false },
    models: [
      { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' },
      { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
      { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
    ],
    createdBy: 'u1',
    createdAt: NOW,
    updatedAt: NOW,
  };
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [provider] });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/machines') return json([]);
    if (path === '/api/teams/t1/providers/p1' && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      bodies.push(JSON.stringify(body.models.map((m: { id: string }) => m.id)));
      const reply = () => json({ ...provider, ...body });
      return bodies.length === 1 ? firstHeld.then(reply) : reply();
    }
    return undefined;
  });
  await page.goto('/app/resources/providers');

  await editor(page).getByRole('button', { name: '移除 claude-opus-5-5' }).click();
  await expect.poll(() => bodies.length).toBe(1);
  await expect(editor(page).getByRole('button', { name: '移除 claude-haiku-5-5' })).toBeDisabled();

  release();
  await expect(editor(page).getByRole('button', { name: '移除 claude-haiku-5-5' })).toBeEnabled();
  await editor(page).getByRole('button', { name: '移除 claude-sonnet-5-5' }).click();
  await expect
    .poll(() => bodies)
    .toEqual(['["claude-haiku-5-5","claude-sonnet-5-5"]', '["claude-haiku-5-5"]']);
});

test('live: a finished save does not wipe a draft typed into another field', async ({ page }) => {
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let provider = {
    kind: 'custom',
    id: 'p1',
    providerId: 'anthropic',
    label: 'Anthropic',
    baseUrl: 'https://api.anthropic.com',
    api: 'anthropic-messages',
    authHeader: true,
    compat: { supportsDeveloperRole: false },
    models: [{ id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' }],
    createdBy: 'u1',
    createdAt: NOW,
    updatedAt: NOW,
  };
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [provider] });
    if (path === '/api/teams/t1/model-sources') return json({ sources: [] });
    if (path === '/api/teams/t1/machines') return json([]);
    if (path === '/api/teams/t1/providers/p1' && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON();
      return held.then(() => {
        provider = { ...provider, ...body, updatedAt: provider.updatedAt + 1 };
        return json(provider);
      });
    }
    return undefined;
  });
  await page.goto('/app/resources/providers');

  const name = editor(page).getByLabel('名称');
  await name.fill('Anthropic 主账号');
  await name.press('Enter');
  const baseUrl = editor(page).getByLabel('地址');
  await baseUrl.fill('https://proxy.example.invalid');
  release();
  await expect(instance(page, 'provider:p1')).toContainText('Anthropic 主账号');
  await expect(baseUrl).toHaveValue('https://proxy.example.invalid');
  await expect(baseUrl).toBeFocused();
});

test('the sample data shows the owner controls, so design screenshots match the real page', async ({
  page,
}) => {
  await page.goto('/app/settings/routing?scenario=model-routing');
  await page.locator('[data-testid="provider-instance"]:not([data-instance-id^="subscription:"])').first().click();
  await expect(editor(page).getByRole('button', { name: '从上游选择' })).toBeVisible();
  await expect(editor(page).getByTestId('provider-test-all')).toBeVisible();
  const chip = editor(page).getByTestId('provider-model').first();
  await expect(chip.getByRole('button', { name: /^测试 / })).toBeVisible();
  await expect(chip.getByRole('button', { name: /^移除 / })).toBeVisible();
  await page.locator('[data-instance-id="subscription:sub-personal"]').click();
  await expect(page.getByTestId('subscription-detail').getByTestId('subscription-verify')).toBeVisible();
});
