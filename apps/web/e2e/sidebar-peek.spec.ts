import { expect, type Page, test } from '@playwright/test';

const HOME = '/app?scenario=chief-draft';
const COLLAPSED = 'cairn.sidebar-collapsed';

const docked = (page: Page) => page.locator('.board-shell > .board-sidebar');
const reopen = (page: Page) => page.getByTestId('sidebar-reopen');
const peek = (page: Page) => page.getByTestId('sidebar-peek');
const tasksToggle = (page: Page) => page.getByTestId('home-c').getByTestId('tasks-toggle');

async function expectFull(page: Page) {
  await expect(docked(page)).toBeVisible();
  await expect(reopen(page)).toHaveCount(0);
}

async function expectCollapsed(page: Page) {
  await expect(docked(page)).toHaveCount(0);
  await expect(reopen(page)).toBeVisible();
  await expect(peek(page)).not.toHaveAttribute('data-open');
  await expect(page.locator('.board-sidebar')).toBeHidden();
}

const sheetLeft = (page: Page) =>
  page.locator('.board-sheet').evaluate((el) => el.getBoundingClientRect().left);

test.describe('wide screens', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('collapsed leaves only the 28px toggle at the 24/24 centre and no icon rail', async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, '1'), COLLAPSED);
    await page.goto(HOME);
    await expectCollapsed(page);
    expect(await sheetLeft(page)).toBe(0);
    const box = await reopen(page).evaluate((el) => {
      const rect = el.getBoundingClientRect();
      return [rect.width, rect.height, rect.left + rect.width / 2, rect.top + rect.height / 2];
    });
    expect(box).toEqual([28, 28, 24, 24]);
  });

  test('hovering the toggle floats the full sidebar over the page and leaving tucks it away', async ({
    page,
  }) => {
    await page.addInitScript((key) => localStorage.setItem(key, '1'), COLLAPSED);
    await page.goto(HOME);
    await page.mouse.move(700, 400);
    await reopen(page).hover();
    await expect(peek(page)).toHaveAttribute('data-open', '');
    await expect(page.getByRole('complementary')).toBeVisible();
    await expect(peek(page).locator('[data-slot="sidebar-project-row"]').first()).toBeVisible();
    expect(await sheetLeft(page)).toBe(0);
    await page.mouse.move(120, 400);
    await page.waitForTimeout(500);
    await expect(peek(page)).toHaveAttribute('data-open', '');
    await page.mouse.move(900, 400);
    await expect(peek(page)).not.toHaveAttribute('data-open');
    expect(await page.evaluate((key) => localStorage.getItem(key), COLLAPSED)).toBe('1');
  });

  test('a quick pass over the toggle does not open the peek', async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, '1'), COLLAPSED);
    await page.goto(HOME);
    await page.mouse.move(700, 400);
    await page.mouse.move(24, 24);
    await page.mouse.move(700, 24);
    await page.waitForTimeout(500);
    await expect(peek(page)).not.toHaveAttribute('data-open');
  });

  test('the left screen edge opens the peek too', async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, '1'), COLLAPSED);
    await page.goto(HOME);
    await page.mouse.move(700, 500);
    await page.mouse.move(2, 500);
    await page.mouse.move(3, 501);
    await expect(peek(page)).toHaveAttribute('data-open', '');
  });

  test('a project in the peek opens its conversation and the sidebar stays collapsed', async ({
    page,
  }) => {
    await page.addInitScript((key) => localStorage.setItem(key, '1'), COLLAPSED);
    await page.goto(HOME);
    await reopen(page).hover();
    await peek(page).locator('[data-slot="sidebar-project-row"]').first().click();
    await expect(page).toHaveURL(/project=.*chat=1/);
    await page.mouse.move(900, 400);
    await expectCollapsed(page);
  });

  test('a project menu opened from the peek keeps the peek open', async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, '1'), COLLAPSED);
    await page.goto(HOME);
    await reopen(page).hover();
    const row = peek(page).locator('[data-slot="sidebar-project-row"]').first();
    await row.hover();
    await peek(page).getByRole('button', { name: /的菜单$/ }).first().click();
    const menu = page.locator('[data-slot="dropdown-menu-content"]');
    await expect(menu).toBeVisible();
    await menu.getByRole('menuitem').first().hover();
    await page.waitForTimeout(600);
    await expect(peek(page)).toHaveAttribute('data-open', '');
  });

  test('the toggle expands the docked sidebar and the peek is gone', async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, '1'), COLLAPSED);
    await page.goto(HOME);
    await reopen(page).click();
    await expectFull(page);
    await expect(peek(page)).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), COLLAPSED)).toBe('0');
  });

  test('collapsing by hand does not pop the peek back under the pointer', async ({ page }) => {
    await page.goto(HOME);
    const collapse = docked(page).getByRole('button', { name: '收起侧边栏' });
    const box = await collapse.boundingBox();
    if (box === null) throw new Error('no collapse button');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await page.mouse.move(box.x + box.width / 2 + 1, box.y + box.height / 2 + 1);
    await page.waitForTimeout(600);
    await expectCollapsed(page);
    await page.mouse.move(700, 400);
    await reopen(page).hover();
    await expect(peek(page)).toHaveAttribute('data-open', '');
  });

  test('keyboard focus on the toggle opens the peek inside it and Escape returns focus', async ({
    page,
  }) => {
    await page.addInitScript((key) => localStorage.setItem(key, '1'), COLLAPSED);
    await page.goto(HOME);
    await page.keyboard.press('Shift');
    await reopen(page).focus();
    await expect(peek(page)).toHaveAttribute('data-open', '');
    await expect(peek(page).getByRole('button', { name: '展开侧边栏' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(peek(page).getByRole('button', { name: '搜索' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(peek(page)).not.toHaveAttribute('data-open');
    await expect(reopen(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expectFull(page);
  });

  test('opening a side panel collapses the sidebar and closing it restores the sidebar', async ({
    page,
  }) => {
    await page.goto(HOME);
    await expectFull(page);
    await tasksToggle(page).click();
    await expect(page.locator('.side-panel')).toBeVisible();
    await expectCollapsed(page);
    const sheet = await page
      .locator('.board-sheet')
      .evaluate((el) => [el.getBoundingClientRect().left, getComputedStyle(el).borderLeftWidth]);
    expect(sheet).toEqual([0, '0px']);
    await tasksToggle(page).click();
    await expect(page.locator('.side-panel')).toHaveCount(0);
    await expectFull(page);
    expect(await page.evaluate((key) => localStorage.getItem(key), COLLAPSED)).not.toBe('1');
  });

  test('a page opened with a panel or a task thread starts collapsed', async ({ page }) => {
    await page.goto(`${HOME}&pane=tasks`);
    await expectCollapsed(page);
    await page.goto('/app?scenario=home-c&thread=home-c-working-a');
    await expect(page.getByTestId('side-chat')).toBeVisible();
    await expectCollapsed(page);
  });

  test('the toggle has an accessible name and a tooltip', async ({ page }) => {
    await page.goto(`${HOME}&pane=tasks`);
    await expect(reopen(page)).toHaveAttribute('aria-label', '展开侧边栏');
    await reopen(page).hover();
    await expect(
      page.locator('[data-slot="tooltip-content"]').filter({ hasText: '展开侧边栏' }),
    ).toBeVisible();
  });

  test('expanding while a panel is open sticks, also after the panel closes', async ({ page }) => {
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

  test('a sidebar collapsed by hand stays collapsed after a panel opens and closes', async ({
    page,
  }) => {
    await page.addInitScript((key) => localStorage.setItem(key, '1'), COLLAPSED);
    await page.goto(HOME);
    await expectCollapsed(page);
    await tasksToggle(page).click();
    await expectCollapsed(page);
    await tasksToggle(page).click();
    await expect(page.locator('.side-panel')).toHaveCount(0);
    await expectCollapsed(page);
  });
});

test.describe('touch screens', () => {
  test.use({ viewport: { width: 1024, height: 768 }, hasTouch: true });

  test('a tap on the toggle expands without a hover peek', async ({ page }) => {
    await page.addInitScript((key) => localStorage.setItem(key, '1'), COLLAPSED);
    await page.goto(HOME);
    await reopen(page).tap();
    await expectFull(page);
  });
});

test.describe('narrower screens keep their layout', () => {
  test('at 390px the drawer trigger stays and no peek appears', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript((key) => localStorage.setItem(key, '1'), COLLAPSED);
    await page.goto(`${HOME}&pane=tasks`);
    await expect(page.getByRole('button', { name: '展开侧边栏' }).first()).toBeVisible();
    await expect(reopen(page)).toHaveCount(0);
    await expect(peek(page)).toHaveCount(0);
  });
});
