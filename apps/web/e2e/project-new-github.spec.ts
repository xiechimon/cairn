import { expect, type Page, test } from '@playwright/test';

const NEW_PROJECT = '/app/project/new?scenario=01';
const PICKER = '/app/project/new?scenario=github-picker';

async function selectGithub(page: Page) {
  await page.locator('#prj-new-repo').click();
  const menu = page.getByRole('menu', { name: '仓库' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitemradio', { name: 'GitHub 仓库' }).click();
  await expect(menu).not.toBeVisible();
}

async function pickSource(page: Page, label: string) {
  await page.getByRole('button', { name: '切换仓库来源' }).click();
  const menu = page.getByRole('menu', { name: '仓库' });
  await menu.getByRole('menuitemradio', { name: label }).click();
  await expect(menu).not.toBeVisible();
}

async function openPicker(page: Page) {
  await page.locator('#prj-new-repo').click();
  const picker = page.getByTestId('github-picker');
  await expect(picker).toBeVisible();
  return picker;
}

test('1. unconnected click `GitHub 仓库` → auth button, manual entry only in the source menu, no picker', async ({ page }) => {
  await page.goto(NEW_PROJECT);
  await selectGithub(page);

  await expect(page.locator('#prj-new-repo')).toHaveText('认证 GitHub');
  await expect(page.getByRole('button', { name: '手动输入 owner/repo' })).toHaveCount(0);
  await expect(page.getByTestId('github-picker')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'GitHub 仓库' })).toHaveCount(0);
  await page.getByRole('button', { name: '切换仓库来源' }).click();
  await expect(
    page.getByRole('menu', { name: '仓库' }).getByRole('menuitemradio', { name: '手动输入 owner/repo' }),
  ).toBeVisible();
});

test('2. fixture accept law: clicking the auth button → connected face, trigger opens the picker (empty list face)', async ({
  page,
}) => {
  await page.goto(NEW_PROJECT);
  await selectGithub(page);
  await page.locator('#prj-new-repo').click();
  await expect(page.locator('#prj-new-repo')).not.toHaveText('认证 GitHub');
  await expect(page.locator('#prj-new-repo')).toContainText('选择 GitHub 仓库');
  const picker = await openPicker(page);

  await expect(picker.getByText('没有匹配的仓库')).toBeVisible();
  await expect(picker.getByRole('button', { name: '手动输入 owner/repo' })).toHaveCount(0);
});

test('3. landing param connected → picker auto-opens + list of 3 rows + param cleared, no replay on reload', async ({
  page,
}) => {
  await page.goto(`${PICKER}&oauth=connected&github=connection`);
  const picker = page.getByTestId('github-picker');
  await expect(picker).toBeVisible();
  await expect(picker.getByRole('option')).toHaveCount(3);
  await expect(picker.getByText('已连接 · octocat', { exact: true })).toBeVisible();
  await expect(page).toHaveURL((url) => !url.searchParams.has('oauth'));
  await page.reload();
  await expect(page.getByTestId('github-picker')).toHaveCount(0);
});

test('4. picker search: q filters hits, no hits go to the empty-face copy', async ({ page }) => {
  await page.goto(PICKER);
  await selectGithub(page);
  const picker = await openPicker(page);
  const search = picker.getByRole('textbox', { name: '搜索仓库' });
  await search.fill('CAIRN');
  await expect(picker.getByRole('option')).toHaveCount(1);
  await expect(picker.getByRole('option')).toHaveAccessibleName('xiechimon/cairn');
  await search.fill('zzz-nope');
  await expect(picker.getByRole('option')).toHaveCount(0);
  await expect(picker.getByText('没有匹配的仓库')).toBeVisible();
});

test('5. picker single-select → trigger fills back owner/repo + project name fills back the repo name + panel closes', async ({
  page,
}) => {
  await page.goto(PICKER);
  await selectGithub(page);
  const picker = await openPicker(page);
  await picker.getByRole('option', { name: 'octocat/hello-world' }).click();
  await expect(picker).not.toBeVisible();
  await expect(page.locator('#prj-new-repo')).toContainText('octocat/hello-world');
  await expect(page.locator('#prj-new-name')).toHaveValue('hello-world');
});

test('6. fill-back law: manual name edits are not overwritten; equal to the last fill-back value follows the next pick', async ({ page }) => {
  await page.goto(PICKER);

  await page.locator('#prj-new-name').fill('My Thing');
  await selectGithub(page);
  let picker = await openPicker(page);
  await picker.getByRole('option', { name: 'octocat/hello-world' }).click();
  await expect(page.locator('#prj-new-name')).toHaveValue('My Thing');
  await expect(page.locator('#prj-new-repo')).toContainText('octocat/hello-world');

  await page.locator('#prj-new-name').fill('');
  picker = await openPicker(page);
  await picker.getByRole('option', { name: 'octocat/spoon-knife' }).click();
  await expect(page.locator('#prj-new-name')).toHaveValue('spoon-knife');
  picker = await openPicker(page);
  await picker.getByRole('option', { name: 'xiechimon/cairn' }).click();
  await expect(page.locator('#prj-new-name')).toHaveValue('cairn');
});

test('7. manual fallback: the source menu switches the connected face to the owner/repo input', async ({ page }) => {
  await page.goto(PICKER);
  await selectGithub(page);
  await pickSource(page, '手动输入 owner/repo');
  await expect(page.getByTestId('github-picker')).toHaveCount(0);
  const input = page.locator('#prj-new-repo');
  await expect(input).toHaveAttribute('placeholder', 'owner/repo');
  await input.fill('octocat/hello-world');
  await expect(input).toHaveValue('octocat/hello-world');
});

test('7b. manual entry and the auth button switch back and forth through the source menu', async ({ page }) => {
  await page.goto(NEW_PROJECT);
  await selectGithub(page);
  const field = page.locator('#prj-new-repo');
  for (let round = 0; round < 2; round += 1) {
    await pickSource(page, '手动输入 owner/repo');
    await expect(field).toHaveAttribute('placeholder', 'owner/repo');
    await pickSource(page, 'GitHub 仓库');
    await expect(field).toHaveText('认证 GitHub');
  }
});

test('8. landing param error three translations → inline error row (denied/state/exchange)', async ({ page }) => {
  const cases: [string, string][] = [
    ['denied', '授权已被取消。'],
    ['state', '连接已过期，请重新发起。'],
    ['exchange', '令牌交换失败，请稍后重试。'],
  ];
  for (const [reason, copy] of cases) {
    await page.goto(`${PICKER}&oauth=error&reason=${reason}&github=connection`);

    await expect(page.getByRole('alert')).toHaveText(copy);
    await expect(page).toHaveURL((url) => !url.searchParams.has('oauth'));
  }
});

test('9. disconnect button → back to the unconnected face (fixture accept law)', async ({ page }) => {
  await page.goto(PICKER);
  await selectGithub(page);
  const picker = await openPicker(page);
  await picker.getByRole('button', { name: '断开连接' }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.locator('#prj-new-repo')).toHaveText('认证 GitHub');
});

test('9b. limited App grant: one plain line names the limit and links to the app installations page', async ({
  page,
}) => {
  await page.goto('/app/project/new?scenario=github-picker-limited');
  await selectGithub(page);
  const picker = await openPicker(page);
  await expect(picker.getByText('只显示已授权给 Cairn 的仓库')).toBeVisible();
  const link = picker.getByRole('link', { name: '去 GitHub 授权更多仓库' });
  await expect(link).toHaveAttribute(
    'href',
    'https://github.com/apps/cairnwright/installations/new',
  );
});

test('10. grant-and-return: window focus and picker reopen refetch the repo list', async ({
  page,
}) => {
  let granted = [
    { id: 1, owner: 'octo', name: 'alpha', full_name: 'octo/alpha', private: true },
  ];
  let repoCalls = 0;
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub' } });
  });
  await page.route('**/api/teams', (route) =>
    route.fulfill({
      json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
    }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } }),
  );
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({ json: { thinkingLevels: [], githubOAuth: true } }),
  );
  await page.route('**/api/teams/team-1/github/connection', (route) =>
    route.fulfill({ json: { connected: true, login: 'octo' } }),
  );
  await page.route('**/api/github/repos', (route) => {
    repoCalls += 1;
    return route.fulfill({ json: { repos: granted } });
  });

  await page.goto('/app/project/new');
  await selectGithub(page);
  const picker = await openPicker(page);
  await expect(picker.getByRole('option')).toHaveCount(1);
  const afterOpen = repoCalls;
  expect(afterOpen).toBeGreaterThan(0);

  granted = [
    ...granted,
    { id: 2, owner: 'acme', name: 'beta', full_name: 'acme/beta', private: false },
  ];
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(picker.getByRole('option')).toHaveCount(2);
  expect(repoCalls).toBeGreaterThan(afterOpen);

  granted = [
    ...granted,
    { id: 3, owner: 'acme', name: 'gamma', full_name: 'acme/gamma', private: false },
  ];
  await page.keyboard.press('Escape');
  await expect(picker).not.toBeVisible();
  const beforeReopen = repoCalls;
  await openPicker(page);
  await expect(picker.getByRole('option')).toHaveCount(3);
  expect(repoCalls).toBeGreaterThan(beforeReopen);
});

test('11. row-list keyboard contract: focus enters the list, Arrow/typeahead moves, Enter selects and takes effect, focus returns', async ({
  page,
}) => {
  await page.goto(PICKER);
  await selectGithub(page);
  const picker = await openPicker(page);
  const rows = picker.getByRole('option');
  await expect(rows).toHaveCount(3);

  await expect(rows.first()).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(rows.nth(2)).toBeFocused();

  await page.keyboard.press('x');
  await expect(rows.nth(2)).toBeFocused();
  await page.waitForTimeout(550);
  await page.keyboard.press('o');
  await expect(rows.first()).toBeFocused();

  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(picker).not.toBeVisible();
  await expect(page.locator('#prj-new-repo')).toContainText('octocat/spoon-knife');
  await expect(page.locator('#prj-new-repo')).toBeFocused();

  await page.keyboard.press('Enter');
  await expect(picker).toBeVisible();
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(picker).not.toBeVisible();
  await expect(page.locator('#prj-new-repo')).toBeFocused();
});

test('12. device sign-in: auth button shows a code, completion offers the App install, then the picker lists repos', async ({
  page,
}) => {
  let connected = false;
  const polls: string[] = [];
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub' } });
  });
  await page.route('**/api/teams', (route) =>
    route.fulfill({ json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }] }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } }),
  );
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({
      json: {
        thinkingLevels: [],
        githubOAuth: false,
        githubDeviceInstallUrl: 'https://github.com/apps/cairnwright/installations/new',
      },
    }),
  );
  await page.route('**/api/teams/team-1/github/connection', (route) =>
    route.fulfill({ json: connected ? { connected: true, login: 'octo' } : { connected: false } }),
  );
  await page.route('**/api/github/repos', (route) =>
    route.fulfill({
      json: { repos: [{ id: 1, owner: 'octo', name: 'alpha', full_name: 'octo/alpha', private: true }] },
    }),
  );
  await page.route('**/api/teams/team-1/github/connection/device', (route) =>
    route.fulfill({
      json: {
        attemptId: 'attempt-1',
        userCode: 'WDJB-MJHT',
        verificationUri: 'https://github.com/login/device',
        intervalSeconds: 1,
        expiresInSeconds: 900,
      },
    }),
  );
  await page.route('**/api/teams/team-1/github/connection/device/attempt-1', (route) => {
    polls.push(route.request().method());
    if (polls.length < 2) return route.fulfill({ json: { status: 'pending', intervalSeconds: 1 } });
    connected = true;
    return route.fulfill({ json: { status: 'complete', login: 'octo' } });
  });

  await page.goto('/app/project/new');
  await selectGithub(page);
  const field = page.locator('#prj-new-repo');
  await expect(field).toHaveText('认证 GitHub');
  await field.click();
  const device = page.getByRole('dialog', { name: '在 GitHub 上授权 Cairn' });
  await expect(device.getByText('WDJB-MJHT')).toBeVisible();
  await expect(page.getByText(/CAIRN_GITHUB/)).toHaveCount(0);
  const install = page.getByRole('dialog', { name: '选择 Cairn 能用的仓库' });
  await expect(install).toBeVisible({ timeout: 10_000 });
  await install.getByRole('button', { name: '完成' }).click();
  const picker = page.getByTestId('github-picker');
  await expect(picker).toBeVisible();
  await picker.getByRole('option', { name: 'octo/alpha' }).click();
  await expect(field).toHaveText('octo/alpha');
  await expect(page.locator('#prj-new-name')).toHaveValue('alpha');
});
