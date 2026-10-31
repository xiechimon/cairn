import { MCP_TOOL_REGISTRY } from '@cairn/shared';
import { expect, test } from '@playwright/test';

test('the existing key flow submits MCP grant labels for Coordinator Thread entry', async ({
  page,
}, testInfo) => {
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
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: /^MCP 访问/ }).check();
  const read = ['Projects', 'Read Thread', 'Threads Waiting on Me', 'Thread Pull Requests'];
  const write = ['Start Thread', 'Reply Thread'];
  for (const grant of read)
    await dialog.getByRole('checkbox', { name: `读 ${grant}`, exact: true }).check();
  for (const grant of write)
    await dialog.getByRole('checkbox', { name: `写 ${grant}`, exact: true }).check();
  for (const grant of write)
    await expect(dialog.getByRole('checkbox', { name: `读 ${grant}`, exact: true })).toHaveCount(0);
  for (const grant of read)
    await expect(dialog.getByRole('checkbox', { name: `写 ${grant}`, exact: true })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('thread-key-grants.png') });
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/teams/team-1/api-keys',
  );
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  expect((await submitted).postDataJSON()).toMatchObject({
    mcpAccess: true,
    toolGrants: { read, write },
  });
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('cairn_example', { exact: true })).toBeVisible();
});

test('grant all submits each tool only in its registry kind column', async ({ page }) => {
  await page.goto('/app/api-keys');
  await page.getByRole('button', { name: '新建密钥' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: '授予全部', exact: true }).click();
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/api-keys'),
  );
  await page.route('**/api/teams/*/api-keys', (route) =>
    route.fulfill({ status: 201, json: { plaintext: 'cairn_example' } }),
  );
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  expect((await submitted).postDataJSON().toolGrants).toEqual({
    read: MCP_TOOL_REGISTRY.filter((tool) => tool.kind === 'read').map((tool) => tool.grant),
    write: MCP_TOOL_REGISTRY.filter((tool) => tool.kind === 'write').map((tool) => tool.grant),
  });
});
