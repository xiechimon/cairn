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

async function openPicker(page: Page) {
  await page.locator('#prj-new-repo').click();
  const picker = page.getByTestId('github-picker');
  await expect(picker).toBeVisible();
  return picker;
}

test('1. unconnected click `GitHub 仓库` → auth button + manual fallback link, no picker', async ({ page }) => {
  await page.goto(NEW_PROJECT);
  await selectGithub(page);

  await expect(page.locator('#prj-new-repo')).toHaveText('认证 GitHub');
  await expect(page.getByRole('button', { name: '手动输入 owner/repo' })).toBeVisible();
  await expect(page.getByTestId('github-picker')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'GitHub 仓库' })).toHaveCount(0);
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
  await expect(picker.getByRole('button', { name: '手动输入 owner/repo' })).toBeVisible();
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

test('7. manual fallback: picker footer and the unconnected-face link both switch back to the owner/repo input', async ({ page }) => {

  await page.goto(PICKER);
  await selectGithub(page);
  const picker = await openPicker(page);
  await picker.getByRole('button', { name: '手动输入 owner/repo' }).click();
  await expect(picker).toHaveCount(0);
  const input = page.locator('#prj-new-repo');
  await expect(input).toHaveAttribute('placeholder', 'owner/repo');
  await input.fill('octocat/hello-world');
  await expect(input).toHaveValue('octocat/hello-world');
});

test('7b. unconnected-face manual link → input; swap button can go back to the repo menu', async ({ page }) => {
  await page.goto(NEW_PROJECT);
  await selectGithub(page);
  await page.getByRole('button', { name: '手动输入 owner/repo' }).click();
  const input = page.locator('#prj-new-repo');
  await expect(input).toHaveAttribute('placeholder', 'owner/repo');
  await page.getByRole('button', { name: '选择仓库' }).click();
  await expect(page.getByRole('menu', { name: '仓库' })).toBeVisible();
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

test('10. row-list keyboard contract: focus enters the list, Arrow/typeahead moves, Enter selects and takes effect, focus returns', async ({
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
