import { expect, type Page, test } from '@playwright/test';

const HOME = '/app?scenario=home-c';

const chip = (page: Page) => page.getByTestId('machines-button');
const panel = (page: Page) => page.getByRole('complementary', { name: '电脑' });

test('the computer chip names the Coordinator machine, its running count and the others', async ({
  page,
}) => {
  await page.goto(HOME);
  await expect(chip(page)).toContainText('xmonsMac');
  await expect(chip(page)).toContainText('2 在跑');
  await expect(chip(page)).toContainText('+1');
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
  await expect(cards.nth(0)).toContainText('2/8 在跑');
  await expect(cards.nth(1)).toContainText('omarchy');
  await expect(cards.nth(1)).toContainText('离线');
  await expect(cards.nth(1).getByTestId('machine-screen')).toContainText('电脑离线');
  await expect(cards.nth(0).getByTestId('machine-screen')).toContainText('屏幕随桌面控制一起上线');

  for (const name of ['桌面控制', '浏览器']) {
    const toggles = panel(page).getByRole('switch', { name });
    await expect(toggles).toHaveCount(2);
    for (const toggle of await toggles.all()) {
      await expect(toggle).toBeDisabled();
      await expect(toggle).not.toBeChecked();
    }
  }
  await expect(panel(page)).toContainText('辅助功能');

  await panel(page).getByRole('link', { name: '添加电脑' }).click();
  await expect(page).toHaveURL(/\/app\/settings\/machines/);
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
