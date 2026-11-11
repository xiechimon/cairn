import { expect, type Locator, type Page, test } from '@playwright/test';
import { pressAndExpect } from './helpers.js';

const SCHEDULES = '/app/schedules?scenario=01';

const PROJECT = '/app/project/ZAQczKCu0MOAzC1ZqcFlX/tasks?scenario=r2-24b';

const MACHINE_DETAIL = '/app/resources/machines/Kd8fG2hJ4mN9pQ1rStUvWx3?scenario=06';
const AUTHORIZE = '/app/machines/authorize';

const MACHINES = '/app/resources/machines?scenario=06';

const dialog = (page: Page) => page.getByRole('dialog', { name: '新建任务' });
const home = (page: Page) => page.getByTestId('home-c');

/** Retired-binding negative (XMON-37), the retry law inverted: six delivered
 *  presses of the old key could not all be lost if it were still bound, so a
 *  surface that stays closed across the loop is proof it is unbound. */
async function pressesStayClosed(
  page: Page,
  key: string,
  surface: Locator,
) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
    await expect(surface).toHaveCount(0);
  }
}

test('⌘C and the retired N and C do nothing on a page', async ({ page }) => {
  await page.goto(SCHEDULES);
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.keyboard.press('Meta+c');
  await expect(home(page)).toHaveCount(0);
  await pressesStayClosed(page, 'n', home(page));
  await pressesStayClosed(page, 'c', home(page));
  await expect(page).toHaveURL(/\/app\/schedules/);
});

test('Space no longer opens the Coordinator; ⌘J navigates home, composer focused, default consumed', async ({
  page,
}) => {
  await page.goto(SCHEDULES);
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.keyboard.press('Space');
  await expect(home(page)).toHaveCount(0);

  await page.evaluate(() => {
    const probe = window as unknown as { cmdJConsumed?: boolean };
    window.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        probe.cmdJConsumed = event.defaultPrevented;
      }
    });
  });
  await pressAndExpect(page, 'Meta+j', home(page));
  await expect(page).toHaveURL(/\/app\?scenario=01$/);
  await expect(page.getByTestId('chief-composer-input')).toBeFocused();
  const consumed = await page.evaluate(
    () => (window as unknown as { cmdJConsumed?: boolean }).cmdJConsumed,
  );
  expect(consumed).toBe(true);
});

test('editable focus swallows C and ⌘J — the c lands IN the input', async ({ page }) => {
  await page.goto(SCHEDULES);

  await pressAndExpect(page, 'Meta+k', page.getByRole('dialog', { name: '搜索' }));
  const field = page.getByRole('dialog', { name: '搜索' }).getByRole('textbox');
  await expect(field).toBeFocused();

  await page.keyboard.press('c');
  await expect(dialog(page)).toHaveCount(0);
  await page.keyboard.press('Meta+j');
  await expect(page).toHaveURL(/\/app\/schedules/);
  await expect(field).toHaveValue('c');
});

test('textarea focus (Coordinator composer) swallows C', async ({ page }) => {
  await page.goto(SCHEDULES);
  await pressAndExpect(page, 'Meta+j', home(page));
  const composer = page.getByTestId('chief-composer-input');
  await expect(composer).toBeFocused();
  await page.keyboard.press('c');
  await expect(dialog(page)).toHaveCount(0);
  await expect(composer).toHaveValue('c');
});

test('Space on a focused button activates it natively; ⌘J fires past button focus', async ({
  page,
}) => {
  await page.goto(SCHEDULES);
  const searchRow = page.getByRole('button', { name: '搜索' });
  await expect(searchRow).toBeVisible();

  await searchRow.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('dialog', { name: '搜索' })).toBeVisible();
  await expect(home(page)).toHaveCount(0);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '搜索' })).toBeHidden();
  await searchRow.focus();
  await pressAndExpect(page, 'Meta+j', home(page));
  await expect(page.getByTestId('chief-composer-input')).toBeFocused();
});

test('⌘J on a project page lands on that project chat', async ({ page }) => {
  await page.goto(PROJECT);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressAndExpect(page, 'Meta+j', home(page));
  await expect(page).toHaveURL(/\/app\?scenario=r2-24b&project=ZAQczKCu0MOAzC1ZqcFlX&chat=1$/);
  await expect(page.getByTestId('chief-composer-input')).toBeFocused();
});

test('the collapsed rail search icon hovers the ⌘K hint', async ({ page }) => {
  await page.goto(SCHEDULES);
  await page.locator('button[aria-label="收起侧边栏"]').click();
  const railSearch = page.getByRole('button', { name: '搜索' });
  await expect(railSearch).toBeVisible();

  const hint = page.locator('[data-slot="tooltip-content"]');
  await page.mouse.move(700, 400);
  await expect(hint).toHaveCount(0);
  await railSearch.hover();
  await expect(hint).toBeVisible();
  await expect(hint.locator('[data-slot="kbd"]')).toHaveText('⌘K');
});

test('N stays retired — neither the Coordinator nor a dialog opens', async ({ page }) => {
  await page.goto(SCHEDULES);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressesStayClosed(page, 'n', home(page));
  await expect(dialog(page)).toHaveCount(0);
});

test.describe('⌘J leaves overlay routes for the Coordinator page', () => {
  test('machine detail: ⌘J navigates to the Coordinator page', async ({ page }) => {
    await page.goto(MACHINE_DETAIL);
    await expect(page.locator('[inert] [data-testid="home-c"]')).toHaveCount(1);
    await pressAndExpect(page, 'Meta+j', page.getByTestId('machine-detail'), 'hidden');
    await expect(page.locator('[inert] [data-testid="home-c"]')).toHaveCount(0);
    await expect(home(page)).toBeVisible();
    await expect(page.getByTestId('chief-composer-input')).toBeFocused();
  });

  test('machine authorize: ⌘J navigates to the Coordinator page', async ({ page }) => {
    await page.goto(AUTHORIZE);
    await expect(page.locator('.authorize-backdrop')).toBeVisible();
    await pressAndExpect(page, 'Meta+j', home(page));
    await expect(page).toHaveURL(/\/app$/);
  });

  test('back from the authorize page returns to the machines section', async ({ page }) => {
    await page.goto(MACHINES);
    await page.getByRole('button', { name: '添加机器' }).click();
    const dialog = page.getByRole('dialog', { name: '添加机器' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('link', { name: '浏览器授权注册 →' }).click();
    await page.waitForURL((u) => u.pathname === '/app/machines/authorize');
    await expect(page.locator('.authorize-backdrop')).toBeVisible();
    await page.goBack();
    await page.waitForURL((u) => u.pathname === '/app/settings/machines');
    await expect(page.getByRole('button', { name: '添加机器' })).toBeVisible();
  });
});
