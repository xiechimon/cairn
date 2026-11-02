import { expect, type Locator, type Page, test } from '@playwright/test';
import { pressAndExpect } from './helpers.js';

const BOARD = '/app?scenario=01&view=board';
const SCHEDULES = '/app/schedules?scenario=01';

const PROJECT = '/app/project/ZAQczKCu0MOAzC1ZqcFlX/files?scenario=r2-24b&tab=tasks';

const AGENT_DETAIL = '/app/resources/agents/r3-builder?scenario=agent-detail';
const AUTHORIZE = '/app/machines/authorize';

const MACHINES = '/app/resources/machines?scenario=06';

const dialog = (page: Page) => page.getByRole('dialog', { name: '新建任务' });
const home = (page: Page) => page.getByTestId('home-c');
const composerInput = (page: Page) => home(page).getByTestId('chief-composer-input');
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

test('C on the board lands on the home composer; ⌘C and the retired N do nothing', async ({
  page,
}) => {
  await page.goto(BOARD);
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.keyboard.press('Meta+c');
  await expect(home(page)).toHaveCount(0);
  await pressesStayClosed(page, 'n', home(page));
  await expect(page).toHaveURL(/view=board/);

  await page.keyboard.press('c');
  await expect(composerInput(page)).toBeFocused();
  await expect(page).not.toHaveURL(/view=board/);
  await expect(dialog(page)).toHaveCount(0);
});

test('sidebar `新任务` row drops the C badge and click lands on the home composer', async ({ page }) => {
  await page.goto(BOARD);
  const row = page.getByRole('complementary').getByRole('button', { name: '新任务' });
  await expect(row).toBeVisible();
  await expect(row.locator('kbd')).toHaveCount(0);
  await row.click();
  await expect(composerInput(page)).toBeFocused();
  await expect(dialog(page)).toHaveCount(0);
});

test('C on a non-board route lands on the home composer', async ({ page }) => {
  await page.goto(SCHEDULES);
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.keyboard.press('c');
  await expect(page).not.toHaveURL(/\/app\/schedules/);
  await expect(composerInput(page)).toBeFocused();
  await expect(dialog(page)).toHaveCount(0);
});

test('C on the project page lands on the home composer filtered to that project', async ({
  page,
}) => {
  await page.goto(PROJECT);
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.keyboard.press('c');
  await expect(page).toHaveURL(/\/app\?.*project=ZAQczKCu0MOAzC1ZqcFlX/);
  await expect(composerInput(page)).toBeFocused();
  await expect(dialog(page)).toHaveCount(0);
});

test('Space no longer opens the drawer; ⌘J does, composer focused, default consumed', async ({
  page,
}) => {
  await page.goto(BOARD);
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

test('⌘J wakes the chief drawer on a non-board route', async ({ page }) => {
  await page.goto(SCHEDULES);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressAndExpect(page, 'Meta+j', drawer(page));
  await expect(page.getByTestId('chief-composer-input')).toBeFocused();
  await expect(page).toHaveURL(/\/app\/schedules/);
  await pressAndExpect(page, 'Meta+j', drawer(page), 'hidden');
  await expect(drawer(page)).toBeHidden();
});

test('editable focus swallows C and ⌘J — the c lands IN the input', async ({ page }) => {
  await page.goto(BOARD);

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
  await page.goto(BOARD);
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
  await page.goto(BOARD);
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

  await page.goto(BOARD);
  await searchRow.focus();
  await page.keyboard.press('c');
  await expect(composerInput(page)).toBeFocused();
});

test('⌘J toggles: the second press closes the drawer from its own composer focus', async ({
  page,
}) => {
  await page.goto(BOARD);
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

test('FAB click stays open-only; ⌘J closes what the click opened', async ({ page }) => {
  await page.goto(BOARD);
  const fab = page.getByRole('button', { name: '总管' });
  await expect(fab).toBeVisible();
  await fab.click();
  await expect(drawer(page)).toBeVisible();
  // ADR 0013 D4: the floating form unmounts the FAB while the window is
  // open (mutual exclusion) — a re-click cannot even land (the button is
  // gone), so the click face has no toggle to leak. The chord stays the
  // only keyboard close: the open autofocused the composer, and the
  // drawer-interior guard exemption lets ⌘J fire from there.
  await pressAndExpect(page, 'Meta+j', drawer(page), 'hidden');
  await expect(drawer(page)).toBeHidden();
});

test('the robot FAB surfaces the ⌘J hint on hover; at rest it stays hidden', async ({
  page,
}) => {
  await page.goto(BOARD);
  const fab = page.getByRole('button', { name: '总管' });

  const hint = page.locator('[data-slot="tooltip-content"]');
  await expect(hint).toHaveCount(0);
  await fab.hover();
  await expect(hint).toBeVisible();
  await expect(hint.locator('[data-slot="kbd"]')).toHaveText('⌘J');
});

test('a wake-family route carries the same ⌘J hint (single root FAB)', async ({
  page,
}) => {
  // ADR 0013 D4/D6: the per-shell wake FABs retired into one root-host FAB —
  // the hint rides the same Tooltip+Kbd carrier on every route (#983/#1004).
  await page.goto('/app/team?scenario=12');
  const fab = page.locator('button[aria-label="总管"]');

  const hint = page.locator('[data-slot="tooltip-content"]');
  await expect(hint).toHaveCount(0);
  await fab.hover();
  await expect(hint).toBeVisible();
  await expect(hint.locator('[data-slot="kbd"]')).toHaveText('⌘J');
});

test('the collapsed rail search icon hovers the ⌘K hint', async ({ page }) => {
  await page.goto(BOARD);
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
  await page.goto(BOARD);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressesStayHidden(page, 'n', drawer(page));
  await expect(dialog(page)).toHaveCount(0);
});

// ---- #1141: suppression retired — the chief surface is site-wide ---------

// The FAB assertion uses the chief-fab class hook (the spec-facing carrier,
// #1009 A0 ⑨) — the editable-guard faces are already pinned by tests 7/8
// above, these only pin that the formerly suppressed routes now render the
// launcher and answer the chord.
test.describe('#1141 suppression retired', () => {
  const fab = (page: Page) => page.locator('.chief-fab');

  test('agent detail renders the FAB; ⌘J wakes the drawer in place', async ({ page }) => {
    await page.goto(AGENT_DETAIL);
    await expect(page.locator('.agent-detail')).toBeVisible();
    await expect(fab(page)).toBeVisible();
    await pressAndExpect(page, 'Meta+j', drawer(page));
    await expect(page.getByTestId('chief-composer-input')).toBeFocused();
    await expect(page).toHaveURL(/\/app\/resources\/agents\/r3-builder/);
    await pressAndExpect(page, 'Meta+j', drawer(page), 'hidden');
    await expect(drawer(page)).toBeHidden();
  });

  test('machine authorize renders the FAB; ⌘J wakes the drawer in place', async ({ page }) => {
    await page.goto(AUTHORIZE);
    await expect(page.locator('.authorize-backdrop')).toBeVisible();
    await expect(fab(page)).toBeVisible();
    await pressAndExpect(page, 'Meta+j', drawer(page));
    await expect(page.getByTestId('chief-composer-input')).toBeFocused();
    await expect(page).toHaveURL(/\/app\/machines\/authorize/);
    await pressAndExpect(page, 'Meta+j', drawer(page), 'hidden');
    await expect(drawer(page)).toBeHidden();
  });

  test('the window opened on the authorize page survives the route back', async ({ page }) => {

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
    await page.waitForURL((u) => u.pathname === '/app/resources/machines');
    await expect(page.getByRole('button', { name: '添加机器' })).toBeVisible();
    await expect(drawer(page)).toBeVisible();
    await pressAndExpect(page, 'Meta+j', drawer(page), 'hidden');
    await expect(drawer(page)).toBeHidden();
  });
});
