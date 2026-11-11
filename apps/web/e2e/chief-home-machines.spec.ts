import { expect, type Page, test } from '@playwright/test';

const HOME = '/app?scenario=home-c';

const chip = (page: Page) => page.getByTestId('machines-button');
const panel = (page: Page) => page.getByRole('complementary', { name: '电脑' });

test('the computer chip names only the Coordinator machine and its running count', async ({
  page,
}) => {
  await page.goto(HOME);
  await expect(chip(page)).toHaveAccessibleName(/xmonsMac/);
  await expect(chip(page)).toHaveAccessibleName(/2\/8 在跑/);
  await expect(chip(page)).not.toHaveAccessibleName(/\+1/);
  await expect(chip(page)).toHaveText('');
  await expect(page.getByTestId('machines-online-dot')).toHaveCount(1);
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
});

test('the chip opens a list with one row per computer, the Coordinator machine first, and no new-session button', async ({
  page,
}) => {
  await page.goto(HOME);
  await chip(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(page).toHaveURL(/[?&]pane=machines/);
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'true');

  await expect(panel(page).getByRole('heading', { name: '你的电脑' })).toBeVisible();
  const rows = panel(page).getByRole('button', { name: /xmonsMac|omarchy/ });
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('xmonsMac');
  await expect(rows.nth(0)).toContainText('在线 · 2/8 在跑 · Coordinator 在这台');
  await expect(rows.nth(1)).toContainText('omarchy');
  await expect(rows.nth(1)).toContainText('离线');
  await expect(panel(page).getByRole('switch')).toHaveCount(0);
  await expect(panel(page).getByRole('button', { name: /新会话|新任务|新建/ })).toHaveCount(0);
  await expect(panel(page)).toContainText('检查过');
  await expect(panel(page).getByRole('button', { name: '再检查一次' })).toBeEnabled();

  await panel(page).getByRole('link', { name: '添加电脑' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/machines/);
});

test('a row opens that computer in the same panel and the back controls return to the list', async ({
  page,
}) => {
  await page.goto(`${HOME}&pane=machines`);
  await panel(page).getByRole('button', { name: /xmonsMac/ }).click();
  await expect(page).toHaveURL(/[?&]pane=machines/);
  await expect(panel(page).getByRole('heading', { name: 'xmonsMac' })).toBeVisible();
  await expect(panel(page)).toContainText('在线 · 2/8 在跑 · Coordinator 在这台');
  await expect(panel(page).getByRole('heading', { name: '能力' })).toBeVisible();
  await expect(panel(page).getByText('辅助功能')).toBeVisible();
  for (const name of ['桌面控制', '浏览器']) {
    const toggle = panel(page).getByRole('switch', { name });
    await expect(toggle).toBeDisabled();
    await expect(toggle).not.toBeChecked();
  }
  await expect(panel(page).getByText('已安装')).toHaveCount(0);
  await expect(panel(page).getByText('未安装')).toHaveCount(0);
  await expect(panel(page).getByRole('heading', { name: '你的电脑' })).toHaveCount(0);

  await panel(page).getByRole('button', { name: '所有电脑' }).first().click();
  await expect(panel(page).getByRole('heading', { name: '你的电脑' })).toBeVisible();

  await panel(page).getByRole('button', { name: /omarchy/ }).click();
  await expect(panel(page).getByRole('heading', { name: 'omarchy' })).toBeVisible();
  await expect(panel(page)).toContainText('离线');
  await expect(panel(page).getByTestId('machine-screen-hint')).toHaveCount(0);
  await panel(page).getByRole('button', { name: '所有电脑' }).first().click();
  await expect(panel(page).getByRole('heading', { name: '你的电脑' })).toBeVisible();
});

test('re-checking refreshes the checked time without leaving the list', async ({ page }) => {
  await page.goto(`${HOME}&pane=machines`);
  await panel(page).getByRole('button', { name: '再检查一次' }).click();
  await expect(panel(page).getByRole('button', { name: '再检查一次' })).toBeEnabled();
  await expect(panel(page)).toContainText(/\d\d:\d\d 检查过/);
});

test('the chip name carries the Coordinator machine and its state', async ({ page }) => {
  await page.goto(HOME);
  await expect(chip(page)).toHaveAccessibleName('电脑 · xmonsMac · 在线 · 2/8 在跑');
});

test('with one computer the panel says work runs on the Coordinator machine', async ({ page }) => {
  await page.goto('/app?scenario=home-c-empty&pane=machines');
  await expect(panel(page)).toContainText('没有其他电脑时，任务都在 Coordinator 这台电脑上跑。');
});

test('at phone width the chip stays an icon and the title stays for screen readers', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HOME);
  const box = await chip(page).boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(60);
  const title = page.getByTestId('home-c').getByRole('heading', { level: 1 });
  await expect(title).toHaveText('Coordinator');
  await expect(title).toHaveClass(/sr-only/);
});

test('the icon-only header buttons show a tooltip with their name on hover', async ({
  page,
}) => {
  await page.goto(HOME);
  for (const [name, tip] of [
    ['任务', '任务，3 件等你'],
    ['成果', '成果'],
    ['电脑', '电脑 · xmonsMac · 在线 · 2/8 在跑'],
  ] as const) {
    const button = page.getByTestId('home-c-pane-buttons').getByRole('button', { name });
    await button.hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(tip);
    await page.mouse.move(0, 0);
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
  }
});
