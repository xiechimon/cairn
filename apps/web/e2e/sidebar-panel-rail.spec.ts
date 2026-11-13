import { expect, type Page, test } from '@playwright/test';

const HOME = '/app?scenario=chief-draft';

const sidebar = (page: Page) => page.locator('.board-sidebar');
const railed = (page: Page) => page.locator('.board-sidebar--collapsed');
const tasksToggle = (page: Page) => page.getByTestId('home-c').getByTestId('tasks-toggle');

const reopen = (page: Page) => page.getByTestId('sidebar-reopen');

async function expectFull(page: Page) {
  await expect(sidebar(page)).toBeVisible();
  await expect(railed(page)).toHaveCount(0);
  await expect(reopen(page)).toHaveCount(0);
}

async function expectHidden(page: Page) {
  await expect(sidebar(page)).toHaveCount(0);
  await expect(reopen(page)).toBeVisible();
}

async function expectRail(page: Page) {
  await expect(railed(page)).toBeVisible();
  await expect(reopen(page)).toHaveCount(0);
}

test.describe('wide screens', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('opening a side panel hides the sidebar completely and closing it restores the sidebar', async ({
    page,
  }) => {
    await page.goto(HOME);
    await expectFull(page);
    await tasksToggle(page).click();
    await expect(page.locator('.side-panel')).toBeVisible();
    await expectHidden(page);
    const sheet = await page.locator('.board-sheet').evaluate((el) => [
      el.getBoundingClientRect().left,
      getComputedStyle(el).borderLeftWidth,
    ]);
    expect(sheet).toEqual([0, '0px']);
    const box = await reopen(page).evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return [rect.width, rect.height, rect.left + rect.width / 2, rect.top + rect.height / 2];
    });
    expect(box).toEqual([28, 28, 24, 24]);
    await tasksToggle(page).click();
    await expect(page.locator('.side-panel')).toHaveCount(0);
    await expectFull(page);
    expect(await page.evaluate(() => localStorage.getItem('cairn.sidebar-collapsed'))).not.toBe('1');
  });

  test('a page opened with a panel in the URL starts with the sidebar hidden', async ({ page }) => {
    await page.goto(`${HOME}&pane=tasks`);
    await expectHidden(page);
  });

  test('a task thread hides the sidebar like the other panels', async ({ page }) => {
    await page.goto('/app?scenario=home-c&thread=home-c-working-a');
    await expect(page.getByTestId('side-chat')).toBeVisible();
    await expectHidden(page);
  });

  test('the toggle left behind has an accessible name and a tooltip', async ({ page }) => {
    await page.goto(`${HOME}&pane=tasks`);
    await expect(reopen(page)).toHaveAttribute('aria-label', '展开侧边栏');
    await reopen(page).hover();
    await expect(
      page.locator('[data-slot="tooltip-content"]').filter({ hasText: '展开侧边栏' }),
    ).toBeVisible();
  });

  test('expanding the sidebar while a panel is open sticks, also after the panel closes', async ({
    page,
  }) => {
    await page.goto(`${HOME}&pane=tasks`);
    await reopen(page).click();
    await expectFull(page);
    const made = page.getByTestId('home-c').getByRole('button', { name: '成果' });
    await made.click();
    await expect(page.locator('.side-panel')).toBeVisible();
    await expectFull(page);
    await made.click();
    await expect(page.locator('.side-panel')).toHaveCount(0);
    await expectFull(page);
  });

  test('collapsing by hand while a panel is open hides the sidebar and leaves the rail after the panel closes', async ({
    page,
  }) => {
    await page.goto(`${HOME}&pane=tasks`);
    await reopen(page).click();
    await sidebar(page).getByRole('button', { name: '收起侧边栏' }).click();
    await expectHidden(page);
    await tasksToggle(page).click();
    await expect(page.locator('.side-panel')).toHaveCount(0);
    await expectRail(page);
    expect(await page.evaluate(() => localStorage.getItem('cairn.sidebar-collapsed'))).toBe('1');
  });

  test('a sidebar the owner collapsed before opening a panel hides with it and returns as the rail', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
    await page.goto(HOME);
    await expectRail(page);
    await tasksToggle(page).click();
    await expectHidden(page);
    await tasksToggle(page).click();
    await expect(page.locator('.side-panel')).toHaveCount(0);
    await expectRail(page);
  });

  test('a project home with a task thread open keeps the rail', async ({ page }) => {
    await page.goto('/app?scenario=home-c&project=ZAQczKCu0MOAzC1ZqcFlX&thread=home-c-working-a');
    await expect(page.getByTestId('project-home')).toBeVisible();
    await expect(page.getByTestId('side-chat')).toBeVisible();
    await expectRail(page);
  });

  test('every rail icon has an accessible name and a tooltip', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
    await page.goto(HOME);
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
    await expect(reopen(page)).toHaveCount(0);
  });
});
