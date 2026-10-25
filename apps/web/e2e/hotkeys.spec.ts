import { expect, type Locator, type Page, test } from '@playwright/test';
import { pressAndExpect } from './helpers.js';

const BOARD = '/app?scenario=01';
const SCHEDULES = '/app/schedules?scenario=01';

const PROJECTS = '/app?scenario=newtask-projects';

const FIRST_PROJECT_ID = 'ZAQczKCu0MOAzC1ZqcFlX';
const PROJECT = '/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=r2-24b&tab=tasks';

const AGENT_DETAIL = '/app/resources/agents/r3-builder?scenario=agent-detail';
const AUTHORIZE = '/app/machines/authorize';

const MACHINES = '/app/resources/machines?scenario=06';

const dialog = (page: Page) => page.locator('.new-task-dialog');
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

test('C on the board opens the new-task dialog; ⌘C and the retired N do not', async ({
  page,
}) => {
  await page.goto(BOARD);
  await expect(page.getByRole('complementary')).toBeVisible();
  // modifier chords pass through — ⌘C is the browser's own copy chord and
  // must keep working (the dialog may not steal it)
  await page.keyboard.press('Meta+c');
  await expect(dialog(page)).toHaveCount(0);
  // XMON-37: N is retired — the same press that used to open the dialog now
  // does nothing, and the listener is proven live by the C press below
  await pressesStayClosed(page, 'n', dialog(page));

  await pressAndExpect(page, 'c', dialog(page));

  await expect(page.locator('.new-task-spec')).toBeFocused();
  await pressAndExpect(page, 'Escape', dialog(page), 'hidden');
  await expect(dialog(page)).toHaveCount(0);
});

test('sidebar `新任务` row carries the C badge and click-opens the dialog', async ({ page }) => {
  await page.goto(BOARD);
  const row = page.getByRole('complementary').getByRole('button', { name: '新任务' });
  await expect(row).toBeVisible();
  await expect(row.getByText('C', { exact: true })).toHaveText('C');
  await row.click();
  await expect(dialog(page)).toBeVisible();
  await pressAndExpect(page, 'Escape', dialog(page), 'hidden');
  await expect(dialog(page)).toHaveCount(0);
});

test('C on a non-board route opens the dialog in place', async ({ page }) => {
  await page.goto(SCHEDULES);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressAndExpect(page, 'c', dialog(page));
  // in place — the route never hops to the board
  await expect(page).toHaveURL(/\/app\/schedules/);
  await pressAndExpect(page, 'Escape', dialog(page), 'hidden');
  await expect(dialog(page)).toHaveCount(0);
});

test('C on the project page opens the page’s own dialog (route project chip)', async ({
  page,
}) => {
  await page.goto(PROJECT);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressAndExpect(page, 'c', dialog(page));
  // exactly one instance — the page's own (project-empty-new-task.spec pins
  // the chip = the route's project, which the global sidebar dialog cannot
  // know); a second global instance would read 2 here
  await expect(dialog(page)).toHaveCount(1);
  await expect(dialog(page).locator('.new-task-project-name')).toHaveText('r3-lifecycle');
  await pressAndExpect(page, 'Escape', dialog(page), 'hidden');
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
  // fixture composer is readOnly — focus holds but typing lands nowhere;
  // the guard must keep C from opening the dialog behind the drawer
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

  // C is guarded by editability only — a focused button does not block it
  await searchRow.focus();
  await page.keyboard.press('c');
  await expect(dialog(page)).toBeVisible();
  await pressAndExpect(page, 'Escape', dialog(page), 'hidden');
  await expect(dialog(page)).toHaveCount(0);

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

test('the drawer new-thread + hovers the N hint and advertises aria-keyshortcuts', async ({
  page,
}) => {
  await page.goto(BOARD);
  await pressAndExpect(page, 'Meta+j', drawer(page));
  const newThread = drawer(page).locator('button[aria-label="新主题"]');
  await expect(newThread).toBeVisible();
  await expect(newThread).toHaveAttribute('aria-keyshortcuts', 'N');

  const hint = page.locator('[data-slot="tooltip-content"]');
  await expect(hint).toHaveCount(0);
  await newThread.hover();
  await expect(hint).toBeVisible();
  await expect(hint.locator('[data-slot="kbd"]')).toHaveText('N');
});

test('with the drawer closed, N stays retired — neither drawer nor dialog opens', async ({
  page,
}) => {
  await page.goto(BOARD);
  await expect(page.getByRole('complementary')).toBeVisible();
  // The new binding is drawer-scoped (the enabled gate): with the drawer
  // shut the listener is off the window, so the retired-global law
  // (XMON-37, test 1) holds on the drawer face too.
  await pressesStayHidden(page, 'n', drawer(page));
  await expect(dialog(page)).toHaveCount(0);
});

async function openNewTask(page: Page) {
  await page.goto(BOARD);
  await page.getByRole('complementary').getByRole('button', { name: '新任务' }).click();
  const dialog = page.locator('.new-task-dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Card landed by the save path, titled by the spec's first line. */
const landedCard = (page: Page, title: string) =>
  page.locator('[data-column="todo"] [data-todo-id]', { hasText: title });

test('⌘↵ and Ctrl+↵ inside the dialog fire `保存并开始` (card lands, dialog closes)', async ({
  page,
}) => {
  const dialog = await openNewTask(page);
  await dialog.locator('.new-task-spec').fill('⌘↵ 建的卡');
  // The autofocused spec textarea is an editable target — the chord must
  // still fire from it (dialog-interior exemption; without it the guard
  // swallows the press and this wait times out).
  await pressAndExpect(page, 'Meta+Enter', landedCard(page, '⌘↵ 建的卡'));
  await expect(dialog).not.toBeVisible();

  // Same registration, non-mac receipt: Ctrl+↵ lands a second card
  await page.getByRole('complementary').getByRole('button', { name: '新任务' }).click();
  await expect(dialog).toBeVisible();
  await dialog.locator('.new-task-spec').fill('Ctrl 建的卡');
  await pressAndExpect(page, 'Control+Enter', landedCard(page, 'Ctrl 建的卡'));
  await expect(dialog).not.toBeVisible();
});

test('with the dialog closed, ⌘↵ on the board lands nothing', async ({ page }) => {
  await page.goto(BOARD);
  await expect(page.getByRole('complementary')).toBeVisible();
  const cards = page.locator('[data-column="todo"] [data-todo-id]');
  const before = await cards.count();
  // Six delivered presses of a bound chord would land six cards (or at
  // least one) — a count that never moves is proof the listener is off the
  // window while the dialog is shut.
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.keyboard.press('Meta+Enter');
    await page.waitForTimeout(120);
    await expect(cards).toHaveCount(before);
  }
  await expect(dialog(page)).toHaveCount(0);
});

test('⌘↵ with an empty spec creates nothing (the button gate holds on the chord)', async ({
  page,
}) => {
  const dialog = await openNewTask(page);
  const cards = page.locator('[data-column="todo"] [data-todo-id]');
  const before = await cards.count();
  await expect(dialog.locator('.new-task-start')).toBeDisabled();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.keyboard.press('Meta+Enter');
    await page.waitForTimeout(120);
    await expect(cards).toHaveCount(before);
  }
  await expect(dialog).toBeVisible();
});

test('⌘↵ under the `未保存闸` confirm layer saves nothing (the layer owns the screen)', async ({
  page,
}) => {
  const dialog = await openNewTask(page);
  await dialog.locator('.new-task-spec').fill('闸下不该落的卡');
  const cards = page.locator('[data-column="todo"] [data-todo-id]');
  const before = await cards.count();

  await dialog.locator('.new-task-close').click();
  const layer = page.locator('.new-task-discard');
  await expect(layer).toBeVisible();

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.keyboard.press('Meta+Enter');
    await page.waitForTimeout(120);
    await expect(cards).toHaveCount(before);
  }
  await expect(layer).toBeVisible();
  await expect(dialog).toBeVisible();
});

test('plain ↵ in the spec textarea stays the newline key — no hijack', async ({ page }) => {
  const dialog = await openNewTask(page);
  const spec = dialog.locator('.new-task-spec');
  await spec.fill('第一行');
  await page.keyboard.press('Enter');
  // the native default is untouched: the newline lands in the field and the
  // dialog stays open
  await expect(spec).toHaveValue('第一行\n');
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-column="todo"] [data-todo-id]', { hasText: '第一行' })).toHaveCount(0);
});

test('the `保存并开始` button carries a visible ⌘↵ badge at rest', async ({ page }) => {
  const dialog = await openNewTask(page);
  const badge = dialog.locator('.new-task-start kbd');
  // always-on form (not kbd-hint's hover chip): visible with no pointer on it
  await expect(badge).toBeVisible();
  await expect(badge).toHaveText('⌘↵');
  // aria-hidden — the chip is a visual hint; the button's own name is its
  // accessible label (a glyph inside the name would be read aloud)
  await expect(badge).toHaveAttribute('aria-hidden', 'true');
});

test('Tab cycles the dialog’s project chip from the composer focus', async ({ page }) => {
  await page.goto(PROJECTS);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressAndExpect(page, 'c', dialog(page));
  const chipName = page.locator('.new-task-project-name');
  await expect(page.locator('.new-task-spec')).toBeFocused();
  await expect(chipName).toHaveText('r3-lifecycle');

  await page.keyboard.press('Tab');
  await expect(chipName).toHaveText('r2-inventory');

  await expect(page.locator('.new-task-spec')).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('cairn.newTaskProjectId')))
    .toBe('r2-inventory');

  await page.keyboard.press('Tab');
  await expect(chipName).toHaveText('r3-lifecycle');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('cairn.newTaskProjectId')))
    .toBe(FIRST_PROJECT_ID);

  await pressAndExpect(page, 'Escape', dialog(page), 'hidden');
});

test('the chip cycles on Tab while the list is open; Shift+Tab keeps native movement', async ({
  page,
}) => {
  await page.goto(PROJECTS);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressAndExpect(page, 'c', dialog(page));
  const chip = page.locator('.new-task-project');
  const menu = page.locator('.new-task-project-menu');
  const checked = menu.locator('.new-task-project-row[aria-selected="true"] .new-task-project-row-name');

  await chip.click();
  await expect(menu).toBeVisible();
  await expect(checked).toHaveText('r3-lifecycle');
  await page.keyboard.press('Tab');
  await expect(checked).toHaveText('r2-inventory');
  await expect(page.locator('.new-task-project-name')).toHaveText('r2-inventory');
  await expect(chip).toBeFocused();
  await expect(menu).toBeVisible();

  await page.keyboard.press('Shift+Tab');
  await expect(chip).not.toBeFocused();
  await expect(menu).toBeHidden();
  await expect(page.locator('.new-task-project-name')).toHaveText('r2-inventory');
  await expect(dialog(page)).toBeVisible();
  await pressAndExpect(page, 'Escape', dialog(page), 'hidden');
});

test('Tab off the driving seats stays native (mention button keeps its own walk)', async ({
  page,
}) => {
  await page.goto(PROJECTS);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressAndExpect(page, 'c', dialog(page));
  const chipName = page.locator('.new-task-project-name');
  await expect(chipName).toHaveText('r3-lifecycle');

  const mention = page.locator('.new-task-dialog button[aria-label="提及"]');
  await mention.focus();
  await page.keyboard.press('Tab');

  await expect(chipName).toHaveText('r3-lifecycle');
  await expect(mention).not.toBeFocused();

  const hint = page.locator('[data-slot="tooltip-content"]');
  await pressAndExpect(page, 'Escape', hint, 'hidden');
  await pressAndExpect(page, 'Escape', dialog(page), 'hidden');
});

test('the project chip hovers its Tab hint (hidden at rest)', async ({ page }) => {
  await page.goto(PROJECTS);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressAndExpect(page, 'c', dialog(page));
  const chip = page.locator('.new-task-project');

  const hint = page.locator('[data-slot="tooltip-content"]');
  await expect(hint).toHaveCount(0);
  await chip.hover();
  await expect(hint).toBeVisible();
  await expect(hint.locator('[data-slot="kbd"]')).toHaveText('Tab');
  await pressAndExpect(page, 'Escape', dialog(page), 'hidden');
});

test('Tab cycles nothing while the `未保存闸` confirm layer is up (that layer owns the keyboard)', async ({
  page,
}) => {
  await page.goto(PROJECTS);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressAndExpect(page, 'c', dialog(page));
  const chipName = page.locator('.new-task-project-name');
  await expect(chipName).toHaveText('r3-lifecycle');
  await dialog(page).locator('.new-task-spec').fill('脏面');

  await page.keyboard.press('Escape');
  const layer = page.locator('.new-task-discard');
  await expect(layer).toBeVisible();
  await expect(layer.locator('.new-task-discard-keep')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(chipName).toHaveText('r3-lifecycle');

  expect(await page.evaluate(() => localStorage.getItem('cairn.newTaskProjectId'))).toBeNull();
});

test('with the dialog closed Tab stays native', async ({ page }) => {
  await page.goto(PROJECTS);
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.new-task-project')).toHaveCount(0);

  await expect
    .poll(() => page.evaluate(() => document.activeElement?.tagName ?? ''))
    .not.toBe('BODY');
  await expect(page.locator('.new-task-project-menu')).toHaveCount(0);
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
