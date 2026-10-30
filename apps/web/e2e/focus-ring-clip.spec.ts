import { expect, test } from '@playwright/test';
import { keyboardFocus, readRing, settleTransitions } from './helpers.js';

test('filter chip focus ring stays whole inside the chip strip', async ({ page }) => {
  await page.goto('/app?column=pending');
  const chip = page.getByRole('button', { name: '清除待处理筛选' });
  await keyboardFocus(page, chip);
  expect(await readRing(chip)).toEqual({ focused: true, outline: 'solid 2px', clippedBy: [] });
});

test('api key permission checkboxes keep whole focus rings while the list scrolls', async ({
  page,
}) => {
  await page.goto('/app/api-keys');
  await page.getByRole('button', { name: '新建密钥' }).first().click();
  const boxes = page.getByRole('dialog').getByRole('checkbox', { name: /^(读|写) / });
  const count = await boxes.count();
  expect(count).toBeGreaterThan(8);
  await keyboardFocus(page, boxes.first());
  for (let i = 0; i < count; i += 1) {
    const box = boxes.nth(i);
    const label = await box.getAttribute('aria-label');
    expect({ label, ...(await readRing(box)) }).toEqual({
      label,
      focused: true,
      outline: 'solid 2px',
      clippedBy: [],
    });
    await page.keyboard.press('Tab');
    await settleTransitions(page);
  }
});

test('the existing key flow submits MCP grant labels for Coordinator Thread entry', async ({ page }, testInfo) => {
  await page.route('**/api/**', (route, request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/stream')) return route.abort();
    if (path === '/api/teams/team-1/api-keys' && request.method() === 'POST')
      return route.fulfill({ status: 201, json: { plaintext: 'cairn_example' } });
    if (path === '/api/teams')
      return route.fulfill({ json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }] });
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
  for (const grant of read) await dialog.getByRole('checkbox', { name: `读 ${grant}`, exact: true }).check();
  for (const grant of write) await dialog.getByRole('checkbox', { name: `写 ${grant}`, exact: true }).check();
  await page.screenshot({ path: testInfo.outputPath('thread-key-grants.png') });
  const submitted = page.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/teams/team-1/api-keys');
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  expect((await submitted).postDataJSON()).toMatchObject({ mcpAccess: true, toolGrants: { read, write } });
  await expect(dialog).not.toBeVisible();
  await expect(page.getByText('cairn_example', { exact: true })).toBeVisible();
});
