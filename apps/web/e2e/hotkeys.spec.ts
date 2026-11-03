import { expect, type Locator, type Page, test } from '@playwright/test';
import { pressAndExpect } from './helpers.js';

const SCHEDULES = '/app/schedules?scenario=01';

const PROJECT = '/app/project/ZAQczKCu0MOAzC1ZqcFlX/files?scenario=r2-24b&tab=tasks';

const AGENT_DETAIL = '/app/resources/agents/r3-builder?scenario=agent-detail';
const AUTHORIZE = '/app/machines/authorize';

const MACHINES = '/app/resources/machines?scenario=06';

const dialog = (page: Page) => page.getByRole('dialog', { name: '新建任务' });
const home = (page: Page) => page.getByTestId('home-c');
const drawer = (page: Page) => page.locator('.chief-drawer');

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

async function pressesStayHidden(
  page: Page,
  key: string,
  surface: Locator,
) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
    await expect(surface).toBeHidden();
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

test('Space no longer opens the drawer; ⌘J does, composer focused, default consumed', async ({
  page,
}) => {
  await page.goto(SCHEDULES);
  await expect(page.getByRole('complementary')).toBeVisible();
  // #442: the Space binding is gone — it is the native scroll key again and
  // must not wake the drawer (the ⌘N test's immediate-count negative form)
  await page.keyboard.press('Space');
  await expect(drawer(page)).toBeHidden();

  await pressAndExpect(page, 'Meta+j', drawer(page));
  await expect(page.getByTestId('chief-composer-input')).toBeFocused();

  await pressAndExpect(page, 'Meta+j', drawer(page), 'hidden');
  await expect(drawer(page)).toBeHidden();

  // Default-consumed, the page-testable half: a probe listener installed
  // after the app's (hook proven live above; same target + phase fires in
  // registration order) sees the delivered ⌘J already preventDefaulted.
  // Blur first — with the composer focused the editable guard swallows the
  // chord before preventDefault ever runs. Browser-level interception of
  // ⌘J (Firefox's downloads library) is not observable from in-page.
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    const probe = window as unknown as { cmdJConsumed?: boolean };
    window.addEventListener('keydown', (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'j') {
        probe.cmdJConsumed = event.defaultPrevented;
      }
    });
  });
  await pressAndExpect(page, 'Meta+j', drawer(page));
  const consumed = await page.evaluate(
    () => (window as unknown as { cmdJConsumed?: boolean }).cmdJConsumed,
  );
  expect(consumed).toBe(true);
  await pressAndExpect(page, 'Meta+j', drawer(page), 'hidden');
  await expect(drawer(page)).toBeHidden();
});

test('⌘J wakes the chief drawer on a non-home route', async ({ page }) => {
  await page.goto(SCHEDULES);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressAndExpect(page, 'Meta+j', drawer(page));
  await expect(page.getByTestId('chief-composer-input')).toBeFocused();
  await expect(page).toHaveURL(/\/app\/schedules/);
  await pressAndExpect(page, 'Meta+j', drawer(page), 'hidden');
  await expect(drawer(page)).toBeHidden();
});

test('editable focus swallows C and ⌘J — the c lands IN the input', async ({ page }) => {
  await page.goto(SCHEDULES);

  await pressAndExpect(page, 'Meta+k', page.getByRole('dialog', { name: '搜索' }));
  const field = page.getByRole('dialog', { name: '搜索' }).getByRole('textbox');
  await expect(field).toBeFocused();

  await page.keyboard.press('c');
  await expect(dialog(page)).toHaveCount(0);
  // #442: the same editable guard swallows ⌘J — typing must never wake a
  // surface, and the chord inserts no text of its own
  await page.keyboard.press('Meta+j');
  await expect(drawer(page)).toBeHidden();
  // no preventDefault hijack — the c typed through into the query
  await expect(field).toHaveValue('c');
});

test('textarea focus (chief composer) swallows C', async ({ page }) => {
  await page.goto(SCHEDULES);
  await pressAndExpect(page, 'Meta+j', drawer(page));
  const composer = page.getByTestId('chief-composer-input');
  await expect(composer).toBeFocused();
  await page.keyboard.press('c');
  await expect(dialog(page)).toHaveCount(0);
  await expect(drawer(page)).toBeVisible();
  await pressAndExpect(page, 'Meta+j', drawer(page), 'hidden');
  await expect(drawer(page)).toBeHidden();
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
  await expect(drawer(page)).toBeHidden();

  // Close the panel (its input holds focus — editable would swallow the
  // chord) and refocus the button row: ⌘J's guard is editable-only, so it
  // must fire even with a control focused — the chord carries no native
  // activation semantics of its own
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '搜索' })).toBeHidden();
  await searchRow.focus();
  await pressAndExpect(page, 'Meta+j', drawer(page));
  await expect(page.getByTestId('chief-composer-input')).toBeFocused();
  await pressAndExpect(page, 'Meta+j', drawer(page), 'hidden');
  await expect(drawer(page)).toBeHidden();
});

test('⌘J toggles: the second press closes the drawer from its own composer focus', async ({
  page,
}) => {
  await page.goto(SCHEDULES);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressAndExpect(page, 'Meta+j', drawer(page));
  await expect(page.getByTestId('chief-composer-input')).toBeFocused();
  // The drawer-interior exemption law (#468): the composer is an editable
  // target, but the chord that owns this surface must close it — without
  // the exemption the editable guard swallows the closing press and this
  // wait times out.
  await pressAndExpect(page, 'Meta+j', drawer(page), 'hidden');
  await expect(drawer(page)).toBeHidden();
  // The full loop rides the one singleton listener: open → close → open →
  // close, no re-registration between presses.
  await pressAndExpect(page, 'Meta+j', drawer(page));
  await pressAndExpect(page, 'Meta+j', drawer(page), 'hidden');
  await expect(drawer(page)).toBeHidden();
});

test('⌘J toggle rides the non-board singleton hook too (schedules)', async ({ page }) => {
  await page.goto(SCHEDULES);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressAndExpect(page, 'Meta+j', drawer(page));
  await pressAndExpect(page, 'Meta+j', drawer(page), 'hidden');
  await expect(drawer(page)).toBeHidden();
  await expect(page).toHaveURL(/\/app\/schedules/);
});

test('the collapsed rail search icon hovers the ⌘K hint', async ({ page }) => {
  await page.goto(SCHEDULES);
  await page.locator('button[aria-label="收起侧边栏"]').click();
  const railSearch = page.getByRole('button', { name: '搜索' });
  await expect(railSearch).toBeVisible();

  const hint = page.locator('[data-slot="tooltip-content"]');
  await expect(hint).toHaveCount(0);
  await railSearch.hover();
  await expect(hint).toBeVisible();
  await expect(hint.locator('[data-slot="kbd"]')).toHaveText('⌘K');
});

test('with the drawer closed, N stays retired — neither drawer nor dialog opens', async ({
  page,
}) => {
  await page.goto(SCHEDULES);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressesStayHidden(page, 'n', drawer(page));
  await expect(dialog(page)).toHaveCount(0);
});

// ---- #1141: suppression retired — the chief surface is site-wide ---------

test.describe('#1141 suppression retired', () => {
  test('agent detail: ⌘J wakes the drawer in place', async ({ page }) => {
    await page.goto(AGENT_DETAIL);
    await expect(page.locator('.agent-detail')).toBeVisible();
    await pressAndExpect(page, 'Meta+j', drawer(page));
    await expect(page.getByTestId('chief-composer-input')).toBeFocused();
    await expect(page).toHaveURL(/\/app\/resources\/agents\/r3-builder/);
    await pressAndExpect(page, 'Meta+j', drawer(page), 'hidden');
    await expect(drawer(page)).toBeHidden();
  });

  test('machine authorize: ⌘J wakes the drawer in place', async ({ page }) => {
    await page.goto(AUTHORIZE);
    await expect(page.locator('.authorize-backdrop')).toBeVisible();
    await pressAndExpect(page, 'Meta+j', drawer(page));
    await expect(page.getByTestId('chief-composer-input')).toBeFocused();
    await expect(page).toHaveURL(/\/app\/machines\/authorize/);
    await pressAndExpect(page, 'Meta+j', drawer(page), 'hidden');
    await expect(drawer(page)).toBeHidden();
  });

  test('the authorize page opens the window, and back returns to the machines section', async ({ page }) => {

    await page.goto(MACHINES);
    await page.getByRole('button', { name: '添加机器' }).click();
    const dialog = page.getByRole('dialog', { name: '添加机器' });
    await expect(dialog).toBeVisible();
    // leaving the dialog via the link is itself a client-side navigation
    await dialog.getByRole('link', { name: '浏览器授权注册 →' }).click();
    await page.waitForURL((u) => u.pathname === '/app/machines/authorize');
    await expect(page.locator('.authorize-backdrop')).toBeVisible();
    await pressAndExpect(page, 'Meta+j', drawer(page));
    await page.goBack();
    await page.waitForURL((u) => u.pathname === '/app/settings/machines');
    await expect(page.getByRole('button', { name: '添加机器' })).toBeVisible();
  });
});
