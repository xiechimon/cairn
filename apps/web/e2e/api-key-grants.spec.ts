import { MCP_TOOL_REGISTRY } from '@cairn/shared';
import { expect, test } from '@playwright/test';
import { stubLiveApiKeys } from './helpers.js';

test('a new key needs a MY_KEY name, gets every permission, and shows its plaintext once', async ({
  page,
}) => {
  await page.route('**/api/**', (route, request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/stream')) return route.abort();
    if (path === '/api/teams/team-1/api-keys' && request.method() === 'POST')
      return route.fulfill({ status: 201, json: { plaintext: 'cairn_example' } });
    if (path === '/api/teams')
      return route.fulfill({
        json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
      });
    if (path === '/api/user/me')
      return route.fulfill({ json: { id: 'user-1', displayName: 'Owner', avatarUrl: null } });
    if (path === '/api/teams/team-1/api-keys') return route.fulfill({ json: [] });
    return route.fulfill({ status: 500, json: { error: 'Unrelated API surface' } });
  });
  await page.goto('/app/api-keys');
  await page.getByRole('button', { name: '新建密钥', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建密钥' });
  const name = dialog.getByLabel('名称', { exact: true });
  const create = dialog.getByRole('button', { name: '创建', exact: true });
  await expect(dialog.getByRole('radio')).toHaveCount(0);
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await expect(create).toBeDisabled();
  for (const bad of ['laptop', '1KEY', 'MY-KEY']) {
    await name.fill(bad);
    await expect(dialog.getByRole('alert')).toHaveText(
      '名称只能用大写字母、数字和下划线，不能以数字开头，如 MY_KEY。',
    );
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
  await expect(page.getByText('cairn_example', { exact: true })).toBeVisible();
});

test('Enter in the name field creates the key once the name is valid', async ({ page }) => {
  await stubLiveApiKeys(page);
  await page.goto('/app/api-keys');
  await page.getByRole('button', { name: '新建密钥' }).first().click();
  const dialog = page.getByRole('dialog', { name: '新建密钥' });
  const name = dialog.getByLabel('名称', { exact: true });
  await name.fill('bad');
  await name.press('Enter');
  await expect(dialog).toBeVisible();
  await page.route('**/api/teams/*/api-keys', (route) =>
    route.fulfill({ status: 201, json: { plaintext: 'cairn_example' } }),
  );
  await name.fill('LAPTOP');
  await name.press('Enter');
  await expect(dialog).not.toBeVisible();
});
