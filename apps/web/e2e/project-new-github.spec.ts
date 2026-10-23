import { expect, type Page, test } from '@playwright/test';

// spec 12 / #361 G2-T4：新建项目 GitHub 认证 + repo picker（fixture 面
// 接线钉；live OAuth 真链路 = server test/github-oauth.test.ts + verify-
// cairn probe）。github 选态三面：未认证 = 认证钮 + 手动兜底链接；已认证 =
// picker 触发钮（单选回填 owner/repo 走 hosted 同款 trigger-label 律）+
// 锚定 picker 弹层（搜索 / 列表 / 断开 / 手动兜底，#67/#127 家族律）；
// manual = 现状 owner/repo input（isGithubRepoRef 闸不变，提交面归 live）。
// 回填律（G2-T3 一致）：项目名仅当空或仍等于上次回填值时覆盖，手改不动。
// Each test pins one failure mode:
// 1. 未认证点「GitHub 仓库」→ 认证钮 + 手动链接在，无 picker、无 input
// 2. fixture accept 律：点认证钮 → 已认证面就位（trigger 开 picker；
//    scenario 01 无 repos fixture = 空面文案，footer 兜底链接仍在）
// 3. 着陆参 oauth=connected&github=connection → repoSel 复位 github +
//    picker 自动开 + 列表渲染 + 清参（刷新不重放）
// 4. picker 搜索：q 命中过滤 / 无命中空面文案
// 5. picker 单选 → trigger 回填 full_name + 项目名回填 repo 名 + 收面板
// 6. 回填律：手改过的名称不覆盖；名称等于上次回填值时跟随再选
// 7. 手动兜底链接 → 切回现状 owner/repo input（未认证面与 picker footer
//    两入口都通）
// 8. 着陆参 oauth=error&reason=denied|state|exchange → 内联三译文案
//    （#243 词汇不变，落 picker 面内联错误行）
// 9. 断开钮 → 回未认证面（fixture accept 律）
// 10. 行表键盘契约（t-0070 裁决③）：焦点进列表 / Arrow roving 回环 /
//     typeahead / Enter 即选即关生效 / 焦点归还触发钮（重开落选中行）

const NEW_PROJECT = '/app/project/new?scenario=01';
const PICKER = '/app/project/new?scenario=github-picker';

// #946/#910 载体：picker 面板 = github-picker testid（无 role 的结构容器，
// 面板语义由内层 role=listbox/option 承载）；仓库行 = role=option（可及名
// = full_name）；其余走 role=button/menu + 文案、role=alert、exact text。
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

test('1. 未认证点「GitHub 仓库」→ 认证钮 + 手动兜底链接，无 picker', async ({ page }) => {
  await page.goto(NEW_PROJECT);
  await selectGithub(page);
  // 认证钮 = #prj-new-repo 续作位（label「仓库」关联命名，文案判面）
  await expect(page.locator('#prj-new-repo')).toHaveText('认证 GitHub');
  await expect(page.getByRole('button', { name: '手动输入 owner/repo' })).toBeVisible();
  await expect(page.getByTestId('github-picker')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'GitHub 仓库' })).toHaveCount(0);
});

test('2. fixture accept 律：点认证钮 → 已认证面，trigger 开 picker（空列表面）', async ({
  page,
}) => {
  await page.goto(NEW_PROJECT);
  await selectGithub(page);
  await page.locator('#prj-new-repo').click();
  await expect(page.locator('#prj-new-repo')).not.toHaveText('认证 GitHub');
  await expect(page.locator('#prj-new-repo')).toContainText('选择 GitHub 仓库');
  const picker = await openPicker(page);
  // scenario 01 无 repos fixture：空面文案 + footer 手动兜底仍可达
  await expect(picker.getByText('没有匹配的仓库')).toBeVisible();
  await expect(picker.getByRole('button', { name: '手动输入 owner/repo' })).toBeVisible();
});

test('3. 着陆参 connected → picker 自动开 + 列表 3 行 + 清参，刷新不重放', async ({
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

test('4. picker 搜索：q 命中过滤，无命中走空面文案', async ({ page }) => {
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

test('5. picker 单选 → trigger 回填 owner/repo + 项目名回填 repo 名 + 收面板', async ({
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

test('6. 回填律：手改名称不覆盖；等于上次回填值时跟随再选', async ({ page }) => {
  await page.goto(PICKER);
  // 手改过的名称：选仓不动它
  await page.locator('#prj-new-name').fill('My Thing');
  await selectGithub(page);
  let picker = await openPicker(page);
  await picker.getByRole('option', { name: 'octocat/hello-world' }).click();
  await expect(page.locator('#prj-new-name')).toHaveValue('My Thing');
  await expect(page.locator('#prj-new-repo')).toContainText('octocat/hello-world');
  // 名称清空后：选中回填，且「仍等于上次回填值」时再选跟随
  await page.locator('#prj-new-name').fill('');
  picker = await openPicker(page);
  await picker.getByRole('option', { name: 'octocat/spoon-knife' }).click();
  await expect(page.locator('#prj-new-name')).toHaveValue('spoon-knife');
  picker = await openPicker(page);
  await picker.getByRole('option', { name: 'xiechimon/cairn' }).click();
  await expect(page.locator('#prj-new-name')).toHaveValue('cairn');
});

test('7. 手动兜底：picker footer 与未认证面链接都切回 owner/repo input', async ({ page }) => {
  // 已认证面：footer 链接
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

test('7b. 未认证面手动链接 → input；swap 钮可回仓库菜单', async ({ page }) => {
  await page.goto(NEW_PROJECT);
  await selectGithub(page);
  await page.getByRole('button', { name: '手动输入 owner/repo' }).click();
  const input = page.locator('#prj-new-repo');
  await expect(input).toHaveAttribute('placeholder', 'owner/repo');
  await page.getByRole('button', { name: '选择仓库' }).click();
  await expect(page.getByRole('menu', { name: '仓库' })).toBeVisible();
});

test('8. 着陆参 error 三译 → 内联错误行（denied/state/exchange）', async ({ page }) => {
  const cases: [string, string][] = [
    ['denied', '授权已被取消。'],
    ['state', '连接已过期，请重新发起。'],
    ['exchange', '令牌交换失败，请稍后重试。'],
  ];
  for (const [reason, copy] of cases) {
    await page.goto(`${PICKER}&oauth=error&reason=${reason}&github=connection`);
    // 着陆即 github 选态：错误行不需任何交互就可见，清参不重放
    await expect(page.getByRole('alert')).toHaveText(copy);
    await expect(page).toHaveURL((url) => !url.searchParams.has('oauth'));
  }
});

test('9. 断开钮 → 回未认证面（fixture accept 律）', async ({ page }) => {
  await page.goto(PICKER);
  await selectGithub(page);
  const picker = await openPicker(page);
  await picker.getByRole('button', { name: '断开连接' }).click();
  await expect(picker).toHaveCount(0);
  await expect(page.locator('#prj-new-repo')).toHaveText('认证 GitHub');
});

// 10. 行表键盘契约（t-0070 裁决③：混合板维持手搓，契约与 dropdown-menu
// 收编面同等——开面焦点进列表 / Arrow roving / typeahead / Enter 即选即关
// 且真实生效 / Esc 与激活后焦点归还触发钮）。
test('10. 行表键盘契约：焦点进列表、Arrow/typeahead 移动、Enter 选中生效、焦点归还', async ({
  page,
}) => {
  await page.goto(PICKER);
  await selectGithub(page);
  const picker = await openPicker(page);
  const rows = picker.getByRole('option');
  await expect(rows).toHaveCount(3);
  // 开面焦点进列表（无选中行 = 首行）
  await expect(rows.first()).toBeFocused();
  // Arrow roving + 末端回环（loopFocus 律）
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(rows.nth(2)).toBeFocused();
  // typeahead：单字符前缀命中 xiechimon/cairn（fixture 第三行）；两次
  // 击键间隔 >500ms 缓冲窗——窗内连击会合成多字符缓冲（"xo" 无命中 =
  // typeahead 正确行为，不是丢键）。
  await page.keyboard.press('x');
  await expect(rows.nth(2)).toBeFocused();
  await page.waitForTimeout(550);
  await page.keyboard.press('o');
  await expect(rows.first()).toBeFocused();
  // Enter 即选即关且真实生效：trigger 回填 full_name，焦点归还触发钮
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(picker).not.toBeVisible();
  await expect(page.locator('#prj-new-repo')).toContainText('octocat/spoon-knife');
  await expect(page.locator('#prj-new-repo')).toBeFocused();
  // 重开（已选中行 = 焦点落选中行）→ Esc 关 + 焦点归还
  await page.keyboard.press('Enter');
  await expect(picker).toBeVisible();
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(picker).not.toBeVisible();
  await expect(page.locator('#prj-new-repo')).toBeFocused();
});
