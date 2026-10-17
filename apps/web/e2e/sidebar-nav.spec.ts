import { expect, type Locator, type Page, test } from '@playwright/test';

// Issue #121 acceptance: the sidebar nav family (rail + expanded rows,
// team name, 新建项目) are react-router Links — clicks navigate
// client-side with no document reload, the URL/pill/aria-current follow,
// and the fixture ?scenario= survives the hop. The 安装 App entries are
// gone from both sidebar states and /zh/install takes the registered
// unmatched-path redirect to /app. Non-selected rows tint the
// --sidebar-hover pill on hover in both themes (#128 cds alpha ladder over
// the sidebar layer); the selected row keeps its deeper --sidebar-active
// pill under hover.
// #943/#910 重钉：行 locator 走一级 role/name（link 行 = 可及名即行文案，
// rail 态 aria-label 同名）；选中态断言从 .sidebar-row--selected /
// .sidebar-team-row--active 状态类换 aria-current="page"（裁定 3 灰区：
// 状态类归行为、载体改 aria-*）；侧栏容器 = complementary role；用户 chip
// = button/Xmon Dai（fixture USER_NAME）。pill 的 ::before 探针值不动
// （--sidebar-hover/--sidebar-active 槽值 #915 已翻，本 spec 现值即新正典）。

declare global {
  interface Window {
    __spaCanary?: string;
  }
}

/** Computed background of a row's ::before pill layer. */
function pillBg(locator: Locator) {
  return locator.evaluate((el) => getComputedStyle(el, '::before').backgroundColor);
}

/** Plant the canary after load; any document navigation wipes it. */
async function plantCanary(page: Page) {
  await page.evaluate(() => {
    window.__spaCanary = 'alive';
  });
}

test('nav rows hop client-side: no reload, pill + aria-current follow', async ({ page }) => {
  await page.goto('/app?scenario=01');
  await plantCanary(page);

  const schedules = page.getByRole('complementary').getByRole('link', { name: '定时' });
  await schedules.click();

  await expect(page).toHaveURL('/app/schedules?scenario=01');
  expect(await page.evaluate(() => window.__spaCanary)).toBe('alive');
  await expect(schedules).toHaveAttribute('aria-current', 'page');

  const board = page.getByRole('link', { name: '工作台' });
  await expect(board).not.toHaveAttribute('aria-current', 'page');
});

test('subrow and team name hop client-side too', async ({ page }) => {
  await page.goto('/app?scenario=01');
  await plantCanary(page);

  await page.getByRole('link', { name: '技能' }).click();
  await expect(page).toHaveURL('/app/resources/skills?scenario=01');
  expect(await page.evaluate(() => window.__spaCanary)).toBe('alive');

  await page.getByRole('link', { name: 'Pacman' }).click();
  await expect(page).toHaveURL('/app/team?scenario=01');
  expect(await page.evaluate(() => window.__spaCanary)).toBe('alive');
  // team 头行的选中态载体 = 品牌链接上的 aria-current（#943 新增；旧
  // .sidebar-team-row--active 状态类断言按裁定 3 换 aria-*）
  await expect(page.getByRole('link', { name: 'Pacman' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('rail rows hop client-side', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pacman.sidebar-collapsed', '1'));
  await page.goto('/app?scenario=03');
  await plantCanary(page);

  await page.getByRole('complementary').getByRole('link', { name: '定时' }).click();
  await expect(page).toHaveURL('/app/schedules?scenario=03');
  expect(await page.evaluate(() => window.__spaCanary)).toBe('alive');
});

test('安装 App entries are gone from both sidebar states', async ({ page }) => {
  await page.goto('/app?scenario=01');
  // 负钉换一级载体（role+name），语义 = 任何「安装」入口不得复活
  await expect(page.getByRole('link', { name: /安装/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /安装/ })).toHaveCount(0);
  await expect(page.locator('a[href^="/zh/install"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Xmon Dai' })).toBeVisible();
});

test('collapsed rail carries no install icon', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pacman.sidebar-collapsed', '1'));
  await page.goto('/app?scenario=03');
  await expect(page.getByRole('link', { name: /安装/ })).toHaveCount(0);
  await expect(page.getByRole('complementary').getByRole('link', { name: '定时' })).toBeVisible();
});

test('/zh/install redirects to /app (unmatched-path divergence, 01 §8)', async ({ page }) => {
  await page.goto('/zh/install');
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole('complementary')).toBeVisible();
});

test('hover tints the row pill — dark default + light theme', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const row = page.getByRole('complementary').getByRole('link', { name: '定时' });

  expect(await pillBg(row)).toBe('rgba(0, 0, 0, 0)');
  await row.hover();
  // --sidebar-hover dark = 5% warm white over the sidebar layer (#128),
  // reached over the 150ms color step
  await expect.poll(() => pillBg(row)).toBe('rgba(255, 252, 248, 0.05)');

  await page.addInitScript(() => localStorage.setItem('pacman-theme', 'light'));
  await page.goto('/app?scenario=01');
  const lightRow = page.getByRole('complementary').getByRole('link', { name: '定时' });
  await lightRow.hover();
  // --sidebar-hover light = 5% warm ink
  await expect.poll(() => pillBg(lightRow)).toBe('rgba(28, 25, 21, 0.05)');
});

test('rail hover tints the 24px pill', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pacman.sidebar-collapsed', '1'));
  await page.goto('/app?scenario=03');
  const row = page.getByRole('complementary').getByRole('link', { name: '定时' });

  expect(await pillBg(row)).toBe('rgba(0, 0, 0, 0)');
  await row.hover();
  await expect.poll(() => pillBg(row)).toBe('rgba(255, 252, 248, 0.05)');
});

test('selected row keeps its own pill under hover', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const board = page.getByRole('link', { name: '工作台' });
  await expect(board).toHaveAttribute('aria-current', 'page');

  await board.hover();
  // past the 150ms step: the ::before layer keeps the deeper selected tint
  // (--sidebar-active, #128) — hover must not wash it back to the hover
  // step
  await page.waitForTimeout(250);
  expect(await pillBg(board)).toBe('rgba(255, 252, 248, 0.1)');
  await expect(board).toHaveAttribute('aria-current', 'page');
});
