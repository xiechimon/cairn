import { expect, type Page, test } from '@playwright/test';

const HOME = '/app?scenario=home-c';

const chip = (page: Page) => page.getByTestId('machines-button');
const panel = (page: Page) => page.getByRole('complementary', { name: '电脑' });

test('the computer chip names only the Coordinator machine and its running count', async ({
  page,
}) => {
  await page.goto(HOME);
  await expect(chip(page)).toContainText('xmonsMac');
  await expect(chip(page)).toContainText('2 在跑');
  await expect(chip(page)).not.toContainText('+1');
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'false');
});

test('the chip opens one card per computer, the Coordinator machine first, with placeholder capabilities', async ({
  page,
}) => {
  await page.goto(HOME);
  await chip(page).click();
  await expect(panel(page)).toBeVisible();
  await expect(page).toHaveURL(/[?&]pane=machines/);
  await expect(chip(page)).toHaveAttribute('aria-pressed', 'true');

  const cards = panel(page).locator('[data-slot="list-card"]');
  await expect(cards).toHaveCount(2);
  await expect(cards.nth(0)).toContainText('xmonsMac');
  await expect(cards.nth(0)).toContainText('Coordinator 在这台');
  await expect(cards.nth(0)).toContainText('在线 · 2/8 在跑');
  await expect(cards.nth(1)).toContainText('omarchy');
  await expect(cards.nth(1)).toContainText('离线');
  await expect(cards.nth(1).getByTestId('machine-screen')).toHaveCount(0);
  await expect(cards.nth(1).getByTestId('machine-screen-hint')).toHaveCount(0);
  await expect(cards.nth(0).getByTestId('machine-screen')).toHaveCount(0);
  await expect(cards.nth(0).getByTestId('machine-screen-hint')).toHaveText(
    '未开启桌面控制，开启后这里显示屏幕',
  );
  expect((await cards.nth(0).getByTestId('machine-screen-hint').boundingBox())!.height).toBeLessThan(
    48,
  );

  for (const name of ['桌面控制', '浏览器']) {
    const toggles = panel(page).getByRole('switch', { name });
    await expect(toggles).toHaveCount(2);
    for (const toggle of await toggles.all()) {
      await expect(toggle).toBeDisabled();
      await expect(toggle).not.toBeChecked();
    }
  }
  await expect(panel(page).getByText('已安装')).toHaveCount(0);
  await expect(panel(page).getByText('未安装')).toHaveCount(0);
  await expect(panel(page)).toContainText('辅助功能');

  await panel(page).getByRole('link', { name: '添加电脑' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/machines/);
});

test('the chip title names the Coordinator machine and its state', async ({ page }) => {
  await page.goto(HOME);
  await expect(chip(page)).toHaveAttribute('title', 'xmonsMac · 在线 · 2/8 在跑');
});

test('with one computer the panel says work runs on the Coordinator machine', async ({ page }) => {
  await page.goto('/app?scenario=home-c-empty&pane=machines');
  await expect(panel(page)).toContainText('没有其他电脑时，任务都在 Coordinator 这台电脑上跑。');
});

test('at phone width the chip shrinks to its icon and leaves the title whole', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(HOME);
  const box = await chip(page).boundingBox();
  expect(box?.width ?? 0).toBeLessThanOrEqual(60);
  const title = page.getByTestId('home-c').getByRole('heading', { level: 1 });
  await expect(title).toHaveText('Coordinator');
  expect(await title.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
});

test('the icon-only header buttons show a tooltip with their name on hover', async ({
  page,
}) => {
  await page.goto(HOME);
  for (const [name, tip] of [
    ['任务', '任务，3 件等你'],
    ['成果', '成果'],
  ] as const) {
    const button = page.getByTestId('home-c-pane-buttons').getByRole('button', { name });
    await button.hover();
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText(tip);
    await page.mouse.move(0, 0);
    await expect(page.locator('[data-slot="tooltip-content"]')).toHaveCount(0);
  }
});
