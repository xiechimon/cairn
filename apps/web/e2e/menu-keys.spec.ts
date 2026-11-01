import { expect, type Locator, type Page, test } from '@playwright/test';

const DETAIL = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27';

async function captionFontSize(page: Page) {
  return page.evaluate(() => {
    const probe = document.createElement('span');
    probe.className = 'text-caption';
    document.body.append(probe);
    const size = getComputedStyle(probe).fontSize;
    probe.remove();
    return size;
  });
}

const moreMenu = (page: Page) => page.getByRole('menu', { name: '更多' });
const confirmDialog = (page: Page) => page.locator('.delete-confirm');

async function expectFocusWithin(locator: Locator) {
  await expect
    .poll(() => locator.evaluate((el) => el.contains(document.activeElement)))
    .toBe(true);
}

async function openMoreMenu(page: Page) {
  await page.goto(DETAIL);
  await page.getByRole('button', { name: '更多' }).click();
  await expect(moreMenu(page)).toBeVisible();
  await expectFocusWithin(moreMenu(page));
}

async function openGalleryMenu(page: Page) {
  await page.goto('/design.html');
  await page.getByRole('button', { name: 'Task actions' }).click();
  const menu = page.getByTestId('gallery-task-menu');
  await expect(menu).toBeVisible();
  return menu;
}

test('every row of the task menu shows one quiet letter and the destructive row confirms', async ({
  page,
}) => {
  await openMoreMenu(page);
  const rows = moreMenu(page).getByRole('menuitem');
  const count = await rows.count();
  expect(count).toBeGreaterThan(3);
  for (let i = 0; i < count; i += 1) {
    const hint = rows.nth(i).locator('[data-slot="dropdown-menu-shortcut"]');
    await expect(hint).toHaveCount(1);
    await expect(hint).toHaveText(/^[A-Z,]$/);
  }
  const hint = moreMenu(page).locator('[data-action="delete"] [data-slot="dropdown-menu-shortcut"]');
  const captionSize = await captionFontSize(page);
  const style = await hint.evaluate((el) => {
    const css = getComputedStyle(el);
    return {
      size: css.fontSize,
      align: css.textAlign,
      numeric: css.fontVariantNumeric,
      boxShadow: css.boxShadow,
      border: css.borderTopWidth,
    };
  });
  expect(style.size).toBe(captionSize);
  expect(style.align).toBe('right');
  expect(style.numeric).toContain('tabular-nums');
  expect(style.boxShadow).toBe('none');
  expect(style.border).toBe('0px');
  await expect(moreMenu(page).locator('[data-action="delete"]')).toContainText('…');
});

test('pressing a row letter runs that row and closes the menu', async ({ page }) => {
  await openMoreMenu(page);
  await page.keyboard.press('d');
  await expect(confirmDialog(page)).toBeVisible();
  await expect(moreMenu(page)).toBeHidden();
});

test('a letter that no row owns neither moves focus nor reaches the global hotkeys', async ({
  page,
}) => {
  await openMoreMenu(page);
  await page.keyboard.press('ArrowDown');
  const focused = await page.evaluate(() => document.activeElement?.textContent);
  await page.keyboard.press('q');
  await page.keyboard.press('n');
  await expect(moreMenu(page)).toBeVisible();
  expect(await page.evaluate(() => document.activeElement?.textContent)).toBe(focused);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('a row letter does not leak to the global new-task key', async ({ page }) => {
  await openMoreMenu(page);
  await page.keyboard.press('c');
  await expect(page.getByRole('dialog', { name: /新任务/ })).toHaveCount(0);
});

test('arrow keys, Enter and Escape keep working in a keyed menu', async ({ page }) => {
  await openMoreMenu(page);
  const rows = moreMenu(page).getByRole('menuitem');
  await page.keyboard.press('ArrowDown');
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(moreMenu(page)).toBeHidden();

  await page.getByRole('button', { name: '更多' }).click();
  await expect(moreMenu(page)).toBeVisible();
  await expectFocusWithin(moreMenu(page));
  await page.keyboard.press('End');
  await expect(rows.last()).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(confirmDialog(page)).toBeVisible();
});

test('modifier chords are left alone', async ({ page }) => {
  await openMoreMenu(page);
  await page.keyboard.press('Control+d');
  await expect(confirmDialog(page)).toHaveCount(0);
  await expect(moreMenu(page)).toBeVisible();
});

test('gallery menu: a submenu opens on its letter and its own letters pick a row', async ({
  page,
}) => {
  const menu = await openGalleryMenu(page);
  await page.keyboard.press('m');
  const sub = page.getByRole('menuitem', { name: 'web' });
  await expect(sub).toBeVisible();
  await page.keyboard.press('w');
  await expect(page.getByText('Last picked: Move to web')).toBeVisible();
  await expect(menu).toBeHidden();
});

test('gallery menu: a letter on a checkbox row toggles it and a radio letter selects it', async ({
  page,
}) => {
  await page.goto('/design.html');
  await page.getByRole('button', { name: 'View options' }).click();
  const done = page.getByRole('menuitemcheckbox', { name: /Show done tasks/ });
  await expect(done).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.press('s');
  await expect(done).toHaveAttribute('aria-checked', 'false');
  const title = page.getByRole('menuitemradio', { name: /Title/ });
  await expect(title).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('t');
  await expect(title).toHaveAttribute('aria-checked', 'true');
});

test('gallery menu: a letter typed into a filter field inside a menu types instead of acting', async ({
  page,
}) => {
  await page.goto('/design.html');
  await page.getByRole('button', { name: 'Label filter' }).click();
  const field = page.getByRole('textbox', { name: 'Filter labels' });
  await field.focus();
  await page.keyboard.type('bug');
  await expect(field).toHaveValue('bug');
  await expect(page.getByTestId('gallery-label-menu')).toBeVisible();
  await expect(page.getByText('Last picked: Label bug')).toHaveCount(0);
});

test('gallery menu: composing text does not fire a row', async ({ page }) => {
  const menu = await openGalleryMenu(page);
  await menu.evaluate((el) => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'd', isComposing: true, bubbles: true, cancelable: true }),
    );
  });
  await expect(menu).toBeVisible();
  await expect(page.getByText('Last picked: Delete')).toHaveCount(0);
});

test('global keys stay visible on the controls they trigger, without hover', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const captionSize = await captionFontSize(page);
  const aside = page.getByRole('complementary');
  const search = aside.getByRole('button', { name: /搜索/ }).locator('[data-slot="key-hint"]');
  const create = aside.getByRole('button', { name: /新任务/ }).locator('[data-slot="key-hint"]');
  await expect(search).toHaveText('⌘K');
  await expect(create).toHaveText('C');
  for (const hint of [search, create]) {
    await expect(hint).toHaveCSS('opacity', '1');
    await expect(hint).toHaveCSS('font-size', captionSize);
  }
});

test('the board new-task bar shows its key as the same quiet hint, not a boxed key', async ({
  page,
}) => {
  await page.goto('/app?view=board');
  const bar = page.getByTestId('board-new-task-bar');
  await expect(bar.locator('[data-slot="kbd"]')).toHaveCount(0);
  await expect(bar.locator('[data-slot="key-hint"]')).toHaveText('C');
});
