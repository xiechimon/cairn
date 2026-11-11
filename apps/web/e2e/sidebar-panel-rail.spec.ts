import { expect, type Page, test } from '@playwright/test';

const HOME = '/app?scenario=chief-draft';

const sidebar = (page: Page) => page.locator('.board-sidebar');
const railed = (page: Page) => page.locator('.board-sidebar--collapsed');
const tasksToggle = (page: Page) => page.getByTestId('home-c').getByTestId('tasks-toggle');

async function expectFull(page: Page) {
  await expect(sidebar(page)).toBeVisible();
  await expect(railed(page)).toHaveCount(0);
}

test.describe('wide screens', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('opening a side panel folds the sidebar to the rail and closing it restores the sidebar', async ({
    page,
  }) => {
    await page.goto(HOME);
    await expectFull(page);
    await tasksToggle(page).click();
    await expect(page.locator('.side-panel')).toBeVisible();
    await expect(railed(page)).toBeVisible();
    expect(await railed(page).evaluate((el) => el.getBoundingClientRect().width)).toBe(48);
    await tasksToggle(page).click();
    await expect(page.locator('.side-panel')).toHaveCount(0);
    await expectFull(page);
    expect(await page.evaluate(() => localStorage.getItem('cairn.sidebar-collapsed'))).not.toBe('1');
  });

  test('a page opened with a panel in the URL starts on the rail', async ({ page }) => {
    await page.goto(`${HOME}&pane=tasks`);
    await expect(railed(page)).toBeVisible();
  });

  test('expanding the rail while a panel is open sticks, also after the panel closes', async ({
    page,
  }) => {
    await page.goto(`${HOME}&pane=tasks`);
    await railed(page).getByRole('button', { name: '展开侧边栏' }).click();
    await expectFull(page);
    const made = page.getByTestId('home-c').getByRole('button', { name: '成果' });
    await made.click();
    await expect(page.locator('.side-panel')).toBeVisible();
    await expectFull(page);
    await made.click();
    await expect(page.locator('.side-panel')).toHaveCount(0);
    await expectFull(page);
  });

  test('collapsing by hand while a panel is open sticks after the panel closes', async ({ page }) => {
    await page.goto(`${HOME}&pane=tasks`);
    await railed(page).getByRole('button', { name: '展开侧边栏' }).click();
    await sidebar(page).getByRole('button', { name: '收起侧边栏' }).click();
    await expect(railed(page)).toBeVisible();
    await tasksToggle(page).click();
    await expect(page.locator('.side-panel')).toHaveCount(0);
    await expect(railed(page)).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('cairn.sidebar-collapsed'))).toBe('1');
  });

  test('a sidebar the owner collapsed before opening a panel stays collapsed after it closes', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
    await page.goto(HOME);
    await expect(railed(page)).toBeVisible();
    await tasksToggle(page).click();
    await expect(railed(page)).toBeVisible();
    await tasksToggle(page).click();
    await expect(page.locator('.side-panel')).toHaveCount(0);
    await expect(railed(page)).toBeVisible();
  });

  test('every rail icon has an accessible name and a tooltip', async ({ page }) => {
    await page.goto(`${HOME}&pane=tasks`);
    const items = railed(page).locator('a, button');
    const count = await items.count();
    expect(count).toBeGreaterThanOrEqual(7);
    for (let i = 0; i < count; i++) {
      const item = items.nth(i);
      const name = await item.getAttribute('aria-label');
      expect(name, `rail item ${i}`).toBeTruthy();
      await item.hover();
      await expect(page.locator('[data-slot="tooltip-content"]').filter({ hasText: name ?? '' })).toBeVisible();
      await page.mouse.move(700, 400);
    }
    await expect(railed(page).getByRole('link', { name: '新建项目' })).toBeVisible();
    await expect(railed(page).getByRole('link', { name: 'cairn' })).toBeVisible();
  });
});

test.describe('narrower screens keep their layout', () => {
  test('at 1000px the panel overlays and the sidebar stays as it was', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.goto(HOME);
    await expectFull(page);
    await tasksToggle(page).click();
    await expect(page.locator('.side-panel')).toBeVisible();
    await expectFull(page);
  });

  test('at 390px the drawer trigger stays and no rail appears', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${HOME}&pane=tasks`);
    await expect(page.getByRole('button', { name: '展开侧边栏' }).first()).toBeVisible();
    await expect(railed(page)).toHaveCount(0);
  });
});
