import { MCP_TOOL_REGISTRY } from '@cairn/shared';
import { expect, test } from '@playwright/test';
import { stubLiveApiKeys } from './helpers.js';

const CREATED_ROW = {
  id: 'key-new',
  name: 'CI_RUNNER_2',
  masked: 'cairn_exam…',
  gitAccess: true,
  mcpAccess: true,
  machineAccess: true,
};

const KEY = `cairn_${'6a85c15de8ad7575'.repeat(4)}`;

test('a new key needs a MY_KEY name, gets every permission, and shows its plaintext once in a modal while its row stays masked', async ({
  page,
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  let keys: (typeof CREATED_ROW)[] = [];
  await page.route('**/api/**', (route, request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/stream')) return route.abort();
    if (path === '/api/teams/team-1/api-keys' && request.method() === 'POST') {
      keys = [CREATED_ROW];
      return route.fulfill({ status: 201, json: { ...CREATED_ROW, plaintext: KEY } });
    }
    if (path === '/api/teams')
      return route.fulfill({
        json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
      });
    if (path === '/api/user/me')
      return route.fulfill({ json: { id: 'user-1', displayName: 'Owner', avatarUrl: null } });
    if (path === '/api/teams/team-1/api-keys') return route.fulfill({ json: keys });
    return route.fulfill({ status: 500, json: { error: 'Unrelated API surface' } });
  });
  await page.goto('/app/api-keys');
  await page.getByRole('button', { name: '新建 API 密钥', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建 API 密钥' });
  const name = dialog.getByLabel('名称', { exact: true });
  const create = dialog.getByRole('button', { name: '创建', exact: true });
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(create).toBeDisabled();
  for (const bad of ['laptop', '1KEY', 'MY-KEY']) {
    await name.fill(bad);
    await expect(dialog.getByRole('alert')).toHaveText('只能用大写字母、数字和下划线，不能以数字开头。');
    await expect(create).toBeDisabled();
  }
  await name.fill('  CI_RUNNER_2  ');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/teams/team-1/api-keys',
  );
  await create.click();
  expect((await submitted).postDataJSON()).toEqual({
    name: 'CI_RUNNER_2',
    gitAccess: true,
    mcpAccess: true,
    machineAccess: true,
    toolGrants: {
      read: MCP_TOOL_REGISTRY.filter((tool) => tool.kind === 'read').map((tool) => tool.grant),
      write: MCP_TOOL_REGISTRY.filter((tool) => tool.kind === 'write').map((tool) => tool.grant),
    },
  });
  await expect(dialog).not.toBeVisible();
  const reveal = page.getByRole('dialog', { name: '保存你的 API 密钥' });
  await expect(reveal).toBeVisible();
  const field = reveal.getByRole('textbox', { name: '新的 API 密钥', exact: true });
  await expect(field).toHaveValue(KEY);
  expect(
    await field.evaluate((el) => ({
      clippedX: el.scrollWidth > el.clientWidth,
      clippedY: el.scrollHeight > el.clientHeight,
      scrolled: el.scrollLeft + el.scrollTop,
    })),
    'the whole key, cairn_ prefix included, is visible without scrolling',
  ).toEqual({ clippedX: false, clippedY: false, scrolled: 0 });
  await expect(reveal).toContainText('关闭后无法再次查看');
  await expect(reveal).toContainText('cairn_');
  await expect(reveal.getByRole('button', { name: '关闭', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(reveal).toBeVisible();
  await reveal.getByRole('button', { name: '复制', exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(KEY);

  const rows = page.getByTestId('api-key-row');
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByText('cairn_exam…', { exact: true })).toBeVisible();
  await expect(rows.first().getByText(KEY, { exact: true })).toHaveCount(0);
  await expect(rows.first().getByRole('button', { name: '复制', exact: true })).toHaveCount(0);

  await reveal.getByRole('button', { name: '我已保存', exact: true }).click();
  await expect(reveal).toBeHidden();
  await expect(page.getByText(KEY, { exact: true })).toHaveCount(0);
  await expect(rows).toHaveCount(1);
  await expect(rows.first().getByRole('button', { name: '删除 CI_RUNNER_2', exact: true })).toBeVisible();
});

test('Enter in the name field creates the key once the name is valid', async ({ page }) => {
  await stubLiveApiKeys(page);
  await page.goto('/app/api-keys');
  await page.getByRole('button', { name: '新建 API 密钥' }).first().click();
  const dialog = page.getByRole('dialog', { name: '新建 API 密钥' });
  const name = dialog.getByLabel('名称', { exact: true });
  await name.fill('bad');
  await name.press('Enter');
  await expect(dialog).toBeVisible();
  await page.route('**/api/teams/*/api-keys', (route) =>
    route.fulfill({ status: 201, json: { plaintext: KEY } }),
  );
  await name.fill('LAPTOP');
  await name.press('Enter');
  await expect(dialog).not.toBeVisible();
});

test('deleting a key asks first, sends DELETE for that key, and drops its row; a failed delete puts it back', async ({
  page,
}) => {
  let keys = [
    { id: 'key-1', name: 'SCRIPT_KEY', masked: 'cairn_afe07565…', gitAccess: true, mcpAccess: true, machineAccess: true },
    { id: 'key-2', name: 'MCP_CLIENT', masked: 'cairn_0b1c2d3e…', gitAccess: true, mcpAccess: true, machineAccess: true },
  ];
  let failNextDelete = false;
  const deleted: string[] = [];
  await page.route('**/api/**', (route, request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/stream')) return route.abort();
    if (path === '/api/teams')
      return route.fulfill({
        json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
      });
    if (path === '/api/user/me')
      return route.fulfill({ json: { id: 'user-1', displayName: 'Owner', avatarUrl: null } });
    const keyMatch = /^\/api\/teams\/team-1\/api-keys\/([^/]+)$/.exec(path);
    if (keyMatch !== null && request.method() === 'DELETE') {
      if (failNextDelete) {
        failNextDelete = false;
        return route.fulfill({ status: 500, json: { error: 'disk full' } });
      }
      deleted.push(keyMatch[1] ?? '');
      keys = keys.filter((key) => key.id !== keyMatch[1]);
      return route.fulfill({ status: 204, body: '' });
    }
    if (path === '/api/teams/team-1/api-keys') return route.fulfill({ json: keys });
    return route.fulfill({ status: 500, json: { error: 'Unrelated API surface' } });
  });
  await page.goto('/app/api-keys');
  await expect(page.getByText('SCRIPT_KEY', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '删除 SCRIPT_KEY', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: '删除 SCRIPT_KEY' });
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: '取消', exact: true }).click();
  await expect(confirm).not.toBeVisible();
  expect(deleted).toEqual([]);

  await page.getByRole('button', { name: '删除 SCRIPT_KEY', exact: true }).click();
  await confirm.getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByText('SCRIPT_KEY', { exact: true })).toHaveCount(0);
  await expect(page.getByText('MCP_CLIENT', { exact: true })).toBeVisible();
  expect(deleted).toEqual(['key-1']);

  failNextDelete = true;
  await page.getByRole('button', { name: '删除 MCP_CLIENT', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: '删除 MCP_CLIENT' })
    .getByRole('button', { name: '删除', exact: true })
    .click();
  await expect(page.getByText('未能删除，请重试。')).toBeVisible();
  await expect(page.getByText('MCP_CLIENT', { exact: true })).toBeVisible();
});
