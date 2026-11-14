import { expect, type Page, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

const FLEET = '/app/resources/providers?scenario=providers-fleet';
const NOW = Date.now();

const scopeSelect = (page: Page) => page.getByRole('combobox', { name: '设置作用于' });
const pickScope = async (page: Page, text: string) => {
  await scopeSelect(page).click();
  await page.getByRole('option').filter({ hasText: text }).first().click();
};
const instance = (page: Page, id: string) =>
  page.locator(`[data-testid="provider-instance"][data-instance-id="${id}"]`);
const editor = (page: Page) => page.getByTestId('provider-editor');

test('scope menu: all machines first, one option per machine, offline and Orb marked', async ({
  page,
}) => {
  await page.goto(FLEET);
  await expect(scopeSelect(page)).toContainText('所有机器');
  await expect(scopeSelect(page).locator('svg.lucide-server')).toBeVisible();
  await scopeSelect(page).click();
  await expect(page.getByRole('option')).toHaveText([
    '所有机器',
    'xmonsMac-3574.local',
    'build-box',
    'build-box-orb',
    'old-laptop · 离线',
    'new-box',
  ]);
  await expect(page.getByRole('option').first().locator('svg.lucide-server')).toBeVisible();
  const machineOptions = page.getByRole('option').filter({ has: page.locator('svg.lucide-monitor') });
  await expect(machineOptions).toHaveCount(5);
  for (const option of await machineOptions.all()) {
    await expect(option.locator('svg.lucide-monitor')).toBeVisible();
    expect(await option.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(scopeSelect(page)).toContainText('所有机器');
  await expect(page.getByText('DESKTOP-OLD')).toHaveCount(0);
});

test('team tab: provider rows open an editor; the selection lives in the URL and survives reload', async ({
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
  await expect(editor(page).getByRole('button', { name: '更换 API key' })).toHaveCount(0);
  await page.goto(`${FLEET}&item=provider%3Aprov-anthropic`);
  await expect(editor(page)).toContainText('Anthropic Messages');
  await expect(editor(page).getByRole('button', { name: '更换 API key' })).toBeVisible();
});

test('unknown scope and item fall back to the team tab and its first row', async ({ page }) => {
  await page.goto(`${FLEET}&scope=gone-machine&item=provider%3Agone`);
  await expect(scopeSelect(page)).toContainText('所有机器');
  await expect(page.getByTestId('provider-instance').first()).toHaveAttribute(
    'aria-current',
    'true',
  );
});

test('machine tab: Claude Code reports version, sign-in state and slots; runtimes follow enabledRuntimes', async ({
  page,
}) => {
  await page.goto(FLEET);
  await pickScope(page, 'build-box-orb');
  await expect(page).toHaveURL(/scope=fleet-box-orb/);
  await expect(scopeSelect(page).locator('svg.lucide-monitor')).toBeVisible();
  const cc = instance(page, 'claude-code');
  await expect(cc).toContainText('v2.1.316');
  await expect(cc).toContainText('未登录');
  await expect(cc).toHaveAttribute('data-tone', 'warn');
  await expect(cc.getByRole('switch')).toBeChecked();
  await expect(instance(page, 'pi').getByRole('switch')).not.toBeChecked();
  await expect(editor(page)).toContainText('/home/u/.local/bin/claude');
  const slots = editor(page).getByTestId('provider-model');
  await expect(slots).toHaveCount(2);
  await expect(slots.first()).toContainText('default-sonnet');
  await expect(slots.first()).toContainText('claude-sonnet-5-5');
});

test('offline machine keeps its last report and says it is offline', async ({ page }) => {
  await page.goto(`${FLEET}&scope=fleet-old`);
  const cc = instance(page, 'claude-code');
  await expect(cc).toContainText('离线');
  await expect(cc).toHaveAttribute('data-tone', 'warn');
  await expect(editor(page)).toContainText('glm-5.3');
  await expect(cc.getByRole('switch')).toBeDisabled();
});

test('machine without a Claude Code report says so instead of guessing', async ({ page }) => {
  await page.goto(`${FLEET}&scope=fleet-new`);
  const cc = instance(page, 'claude-code');
  await expect(cc).toContainText('还没上报');
  await expect(cc).toHaveAttribute('data-tone', 'off');
  await expect(instance(page, 'pi').getByRole('switch')).toBeChecked();
});

test('empty team: the list offers to add a provider and opens the picker', async ({ page }) => {
  await page.goto('/app/resources/providers?scenario=providers-empty');
  await expect(page.getByTestId('provider-instance')).toHaveCount(0);
  await page.getByRole('button', { name: '添加服务商' }).click();
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

test('live: edits and runtime switches send the agreed requests', async ({ page }) => {
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
    if (path === '/api/teams/t1/providers') return json({ presets: [], providers: [provider] });
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

  await editor(page).getByRole('button', { name: '更换 API key' }).click();
  await editor(page).getByLabel('新的 API key').fill('sk-test-new');
  await editor(page).getByRole('button', { name: '保存', exact: true }).click();
  await expect.poll(() => calls).toContain('PATCH p1 {"apiKey":"sk-test-new"}');

  await editor(page).getByLabel('添加模型').fill('claude-opus-5-5');
  await editor(page).getByLabel('添加模型').press('Enter');
  await expect
    .poll(() => calls)
    .toContain(
      'PATCH p1 {"models":[{"id":"claude-haiku-5-5","name":"Claude Haiku 5.5"},{"id":"claude-opus-5-5","name":"claude-opus-5-5"}]}',
    );

  await editor(page).getByRole('button', { name: '移除 Claude Haiku 5.5' }).click();
  await expect
    .poll(() => calls)
    .toContain('PATCH p1 {"models":[{"id":"claude-opus-5-5","name":"claude-opus-5-5"}]}');

  await editor(page).getByRole('button', { name: '移除', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '移除', exact: true }).click();
  await expect.poll(() => calls).toContain('DELETE p1');

  await pickScope(page, 'box');
  await instance(page, 'claude-code').getByRole('switch').click();
  await expect
    .poll(() => calls)
    .toContain('PATCH m1 {"enabledRuntimes":["pi","claude-code"]}');
});

const REMOTE = 'Kd8fG2hJ4mN9pQ1rStUvWx3';
const LOCAL = 'TlZ2sSD4EJCxjNJqVhdo_';

for (const [scenario, scope, status] of [
  ['10', REMOTE, '已登录'],
  ['10-cc-loggedout', REMOTE, '未登录'],
  ['10-cc-bin-gone', REMOTE, '未安装'],
  ['10-cc-missing', LOCAL, '未安装'],
  ['10-cc-noconfig', LOCAL, '已安装，未配置模型槽'],
] as const) {
  test(`Claude Code state from the daemon report: ${scenario} reads ${status}`, async ({ page }) => {
    await page.goto(`/app/resources/providers?scenario=${scenario}&scope=${scope}`);
    await expect(instance(page, 'claude-code')).toContainText(status);
  });
}

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
      bodies.push(JSON.stringify(body.models.map((m: { id: string }) => m.id)));
      const reply = () => json({ ...provider, ...body });
      return bodies.length === 1 ? firstHeld.then(reply) : reply();
    }
    return undefined;
  });
  await page.goto('/app/resources/providers');

  const add = editor(page).getByLabel('添加模型');
  await add.fill('claude-opus-5-5');
  await add.press('Enter');
  await expect.poll(() => bodies.length).toBe(1);
  await expect(editor(page).getByRole('button', { name: '移除 Claude Haiku 5.5' })).toBeDisabled();
  await expect(add).toHaveAttribute('readonly', '');

  release();
  await expect(editor(page).getByRole('button', { name: '移除 Claude Haiku 5.5' })).toBeEnabled();
  await add.fill('claude-sonnet-5-5');
  await add.press('Enter');
  await expect
    .poll(() => bodies)
    .toEqual([
      '["claude-haiku-5-5","claude-opus-5-5"]',
      '["claude-haiku-5-5","claude-opus-5-5","claude-sonnet-5-5"]',
    ]);
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
