import { MCP_TOOL_REGISTRY } from '@cairn/shared';
import { expect, test } from '@playwright/test';
import { stubLiveApiKeys } from './helpers.js';

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
  const dialog = page.getByRole('dialog', { name: '新建密钥' });
  await dialog.getByRole('radio', { name: '自定义', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'MCP 访问', exact: true }).check();
  const labels: Record<string, string> = {
    Projects: '项目',
    'Read Thread': '查看线程',
    'Threads Waiting on Me': '等我处理的线程',
    'Thread Pull Requests': '线程的 PR',
    'Start Thread': '新建线程',
    'Reply Thread': '回复线程',
  };
  const read = ['Projects', 'Threads Waiting on Me', 'Read Thread', 'Thread Pull Requests'];
  const write = ['Start Thread', 'Reply Thread'];
  const readGroup = dialog.getByRole('group', { name: '读取', exact: true });
  const writeGroup = dialog.getByRole('group', { name: '写入', exact: true });
  for (const grant of read)
    await readGroup.getByRole('checkbox', { name: labels[grant], exact: true }).check();
  for (const grant of write)
    await writeGroup.getByRole('checkbox', { name: labels[grant], exact: true }).check();
  for (const grant of write)
    await expect(readGroup.getByRole('checkbox', { name: labels[grant], exact: true })).toHaveCount(
      0,
    );
  for (const grant of read)
    await expect(writeGroup.getByRole('checkbox', { name: labels[grant], exact: true })).toHaveCount(
      0,
    );
  await page.screenshot({ path: testInfo.outputPath('thread-key-grants.png') });
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      new URL(request.url()).pathname === '/api/teams/team-1/api-keys',
  );
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  expect((await submitted).postDataJSON()).toMatchObject({
    mcpAccess: true,
    toolGrants: {
      read: MCP_TOOL_REGISTRY.filter((tool) => tool.kind === 'read').map((tool) => tool.grant),
      write,
    },
  });
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('cairn_example', { exact: true })).toBeVisible();
});

test('a new key defaults to connecting a runner and nothing else', async ({ page }) => {
  await stubLiveApiKeys(page);
  await page.goto('/app/api-keys');
  await page.getByRole('button', { name: '新建密钥' }).first().click();
  const dialog = page.getByRole('dialog', { name: '新建密钥' });
  await expect(dialog.getByRole('radio', { name: '执行机', exact: true })).toBeChecked();
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/api-keys'),
  );
  await page.route('**/api/teams/*/api-keys', (route) =>
    route.fulfill({ status: 201, json: { plaintext: 'cairn_example' } }),
  );
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  expect((await submitted).postDataJSON()).toMatchObject({
    gitAccess: false,
    mcpAccess: false,
    machineAccess: true,
    toolGrants: { read: [], write: [] },
  });
});

test('turning on MCP with no tools picked starts from the read tools', async ({ page }) => {
  await stubLiveApiKeys(page);
  await page.goto('/app/api-keys');
  await page.getByRole('button', { name: '新建密钥' }).first().click();
  const dialog = page.getByRole('dialog', { name: '新建密钥' });
  await dialog.getByRole('radio', { name: '自定义', exact: true }).click();
  await dialog.getByRole('checkbox', { name: 'MCP 访问', exact: true }).check();
  const readGroup = dialog.getByRole('group', { name: '读取', exact: true });
  const writeGroup = dialog.getByRole('group', { name: '写入', exact: true });
  await expect(readGroup.getByRole('checkbox', { checked: false })).toHaveCount(0);
  await expect(writeGroup.getByRole('checkbox', { checked: true })).toHaveCount(0);
});

test('the 全部 preset submits each tool only in its registry kind column', async ({ page }) => {
  await stubLiveApiKeys(page);
  await page.goto('/app/api-keys');
  await page.getByRole('button', { name: '新建密钥' }).first().click();
  const dialog = page.getByRole('dialog', { name: '新建密钥' });
  await dialog.getByRole('radio', { name: '全部', exact: true }).click();
  const submitted = page.waitForRequest(
    (request) =>
      request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/api-keys'),
  );
  await page.route('**/api/teams/*/api-keys', (route) =>
    route.fulfill({ status: 201, json: { plaintext: 'cairn_example' } }),
  );
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  expect((await submitted).postDataJSON()).toMatchObject({
    gitAccess: true,
    mcpAccess: true,
    machineAccess: true,
    toolGrants: {
      read: MCP_TOOL_REGISTRY.filter((tool) => tool.kind === 'read').map((tool) => tool.grant),
      write: MCP_TOOL_REGISTRY.filter((tool) => tool.kind === 'write').map((tool) => tool.grant),
    },
  });
});
