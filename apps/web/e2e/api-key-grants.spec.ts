import { MCP_TOOL_REGISTRY } from '@cairn/shared';
import { expect, test } from '@playwright/test';
import { stubLiveApiKeys } from './helpers.js';

test('an MCP client key carries every tool, including Coordinator Thread entry, and shows its plaintext once', async ({
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
  await dialog.getByRole('radio', { name: 'MCP 客户端', exact: true }).click();
  await expect(dialog.getByTestId('apikey-usage-hint')).toHaveText(
    '让 Claude Code、Cursor 等客户端查看和操作工作台。',
  );
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/teams/team-1/api-keys',
  );
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  const body = (await submitted).postDataJSON();
  expect(body).toMatchObject({
    gitAccess: true,
    mcpAccess: true,
    machineAccess: false,
    toolGrants: {
      read: MCP_TOOL_REGISTRY.filter((tool) => tool.kind === 'read').map((tool) => tool.grant),
      write: MCP_TOOL_REGISTRY.filter((tool) => tool.kind === 'write').map((tool) => tool.grant),
    },
  });
  expect(body.toolGrants.read).toEqual(
    expect.arrayContaining(['Read Thread', 'Threads Waiting on Me', 'Thread Pull Requests']),
  );
  expect(body.toolGrants.write).toEqual(expect.arrayContaining(['Start Thread', 'Reply Thread']));
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('cairn_example', { exact: true })).toBeVisible();
});

test('a new key is a named runner key by default, with no permission to pick', async ({ page }) => {
  await stubLiveApiKeys(page);
  await page.goto('/app/api-keys');
  await page.getByRole('button', { name: '新建密钥' }).first().click();
  const dialog = page.getByRole('dialog', { name: '新建密钥' });
  await expect(dialog.getByRole('radio')).toHaveCount(2);
  await expect(dialog.getByRole('radio', { name: '执行机', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await dialog.getByLabel('名称（可选）').fill('  笔记本  ');
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/api-keys'),
  );
  await page.route('**/api/teams/*/api-keys', (route) =>
    route.fulfill({ status: 201, json: { plaintext: 'cairn_example' } }),
  );
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  expect((await submitted).postDataJSON()).toEqual({
    name: '笔记本',
    gitAccess: false,
    mcpAccess: false,
    machineAccess: true,
    toolGrants: { read: [], write: [] },
  });
});
