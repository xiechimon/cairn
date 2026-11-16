import { expect, type Locator, type Page, test } from '@playwright/test';
import { pressAndExpect } from './helpers.js';

const SCHEDULES = '/app?scenario=01&pane=tasks&tab=scheduled';


const MACHINE_DETAIL = '/app/resources/machines/Kd8fG2hJ4mN9pQ1rStUvWx3?scenario=06';
const AUTHORIZE = '/app/machines/authorize';

const MACHINES = '/app/resources/machines?scenario=06';

const dialog = (page: Page) => page.getByRole('dialog', { name: '新建任务' });
const home = (page: Page) => page.getByTestId('home-c');
const tasksPanel = (page: Page) => page.getByRole('complementary', { name: '任务' });

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

test('⌘C and the retired N and C do nothing away from the plain home', async ({ page }) => {
  await page.goto(SCHEDULES);
  await expect(tasksPanel(page)).toBeVisible();
  await page.keyboard.press('Meta+c');
  await expect(dialog(page)).toHaveCount(0);
  await pressesStayClosed(page, 'n', dialog(page));
  await pressesStayClosed(page, 'c', dialog(page));
  await expect(tasksPanel(page)).toBeVisible();
  await expect(page).toHaveURL(/[?&]tab=scheduled/);
});

test('Space no longer opens the Coordinator; ⌘J navigates home, composer focused, default consumed', async ({
  page,
}) => {
  await page.goto(SCHEDULES);
  await expect(tasksPanel(page)).toBeVisible();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('chief-composer-input')).not.toBeFocused();
  await expect(page).toHaveURL(/[?&]tab=scheduled/);

  await page.evaluate(() => {
    const probe = window as unknown as { cmdJConsumed?: boolean };
    window.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        probe.cmdJConsumed = event.defaultPrevented;
      }
    });
  });
  await pressAndExpect(page, 'Meta+j', tasksPanel(page), 'hidden');
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
  await expect(page).toHaveURL(/[?&]tab=scheduled/);
  await expect(field).toHaveValue('c');
});

test('textarea focus (Coordinator composer) swallows C', async ({ page }) => {
  await page.goto(SCHEDULES);
  await pressAndExpect(page, 'Meta+j', tasksPanel(page), 'hidden');
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
  await page.getByTestId('sidebar-reopen').click();
  await page.mouse.move(700, 400);
  const searchRow = page.getByRole('button', { name: '搜索' });
  await expect(searchRow).toBeVisible();

  await searchRow.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('dialog', { name: '搜索' })).toBeVisible();
  await expect(page).toHaveURL(/[?&]tab=scheduled/);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '搜索' })).toBeHidden();
  await searchRow.focus();
  await pressAndExpect(page, 'Meta+j', tasksPanel(page), 'hidden');
  await expect(page.getByTestId('chief-composer-input')).toBeFocused();
});

test('the collapsed sidebar peek search icon hovers the ⌘K hint', async ({ page }) => {
  await page.goto('/app?scenario=01');
  await page.locator('button[aria-label="收起侧边栏"]').click();
  await expect(page.getByRole('button', { name: '搜索' })).toBeHidden();

  const hint = page.locator('[data-slot="tooltip-content"]');
  await page.mouse.move(700, 400);
  await expect(hint).toHaveCount(0);
  await page.getByTestId('sidebar-reopen').hover();
  const peek = page.getByTestId('sidebar-peek');
  await expect(peek).toHaveAttribute('data-open', '');
  const peekSearch = peek.getByRole('button', { name: '搜索' });
  await peekSearch.hover();
  await expect(hint.filter({ has: page.locator('[data-slot="kbd"]') })).toBeVisible();
  await expect(hint.locator('[data-slot="kbd"]')).toHaveText('⌘K');
});

test('N stays retired — no dialog opens and the panel stays put', async ({ page }) => {
  await page.goto(SCHEDULES);
  await expect(tasksPanel(page)).toBeVisible();
  await pressesStayClosed(page, 'n', dialog(page));
  await expect(page).toHaveURL(/[?&]tab=scheduled/);
});

test.describe('⌘J leaves overlay routes for the Coordinator page', () => {
  test('machine detail: ⌘J navigates to the Coordinator page', async ({ page }) => {
    await page.goto(MACHINE_DETAIL);
    await expect(page.locator('[inert] [data-testid="home-c"]')).toHaveCount(1);
    await pressAndExpect(page, 'Meta+j', page.getByRole('dialog', { name: '设置' }), 'hidden');
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
    await page.getByRole('button', { name: '添加执行机' }).click();
    const dialog = page.getByRole('dialog', { name: '添加执行机' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('link', { name: '浏览器授权注册 →' }).click();
    await page.waitForURL((u) => u.pathname === '/app/machines/authorize');
    await expect(page.locator('.authorize-backdrop')).toBeVisible();
    await page.goBack();
    await page.waitForURL((u) => u.pathname === '/app/settings/machines');
    await expect(page.getByRole('button', { name: '添加执行机' })).toBeVisible();
  });
});

test('the Mac app menu opens search, settings and the Coordinator composer', async ({ page }) => {
  await page.addInitScript(() => {
    const listeners = new Set<(command: string) => void>();
    const shell = window as unknown as {
      cairnDesktop: unknown;
      sendDesktopMenu: (command: string) => void;
    };
    shell.cairnDesktop = {
      menu: {
        subscribe: (listener: (command: string) => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    };
    shell.sendDesktopMenu = (command) => {
      for (const listener of listeners) listener(command);
    };
  });
  const send = (command: string) =>
    page.evaluate(
      (sent) => (window as unknown as { sendDesktopMenu: (c: string) => void }).sendDesktopMenu(sent),
      command,
    );
  const search = page.getByRole('dialog', { name: '搜索' });
  const settings = page.getByRole('dialog', { name: '设置' });

  await page.goto(SCHEDULES);
  await expect(tasksPanel(page)).toBeVisible();
  await send('search');
  await expect(search).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(search).toBeHidden();

  await send('settings');
  await expect(settings).toBeVisible();
  await expect(page).toHaveURL(/\/app\/settings\?scenario=01$/);

  await send('compose');
  await expect(settings).toBeHidden();
  await expect(page.getByTestId('chief-composer-input')).toBeFocused();
});
