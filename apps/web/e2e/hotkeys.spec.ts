import { expect, type Page, test } from '@playwright/test';
import { pressUntil } from './helpers.js';

// Issue #389 + #442 + #468 + XMON-37 acceptance, re-pinned for ADR 0013
// (#1009 A0): the 快捷键组 — C opens the
// new-task dialog from any page (XMON-37 retires #389's N; the sidebar keeps
// its 新任务 row, now carrying the C kbd badge,
// upstream todos.dev form), and ⌘J (Ctrl+J off macOS — the ⌘K search
// registration's cmd/ctrl dual-receipt form) wakes the chief window with
// focus landing in the composer (dialog-family autofocus law, narrowed by
// A0 to closed→open transitions — MUL-5522 same-law: a persisted-open load
// must not steal focus). ⌘J is a toggle (#468): the second press closes
// the window, including from the composer focus the open itself landed —
// the editable guard exempts the drawer's own interior, otherwise the
// chord could never close what it opened. ADR 0013 D3: Esc never closes
// the panel (Minimize + ⌘J are the only dismissals), and D6 parks the
// closed window hidden-but-mounted, so the drawer face's negative
// assertions ride toBeHidden / pressesStayHidden while the dialog family
// keeps its count-0 carrier. C stays open-only, matching the
// row-click semantics. Guards keep native semantics: editable targets
// (input/textarea/select/contenteditable) swallow both keys OUTSIDE the
// drawer — typing must never wake a surface; ⌘J's guard is editable-only —
// buttons and links carry no native ⌘J semantics, so a focused control
// must not block the chord. Space's binding is removed (#442 replaces
// #389's): scrolling and focused-control activation are fully returned,
// nothing preventDefaults them. Modifier-less C still passes through modifier
// chords — ⌘C is the browser's copy and must never wake the dialog — and the
// retired N opens nothing. Each test pins one failure mode:
// 1. C on the board opens the dialog (hotkey listener live); ⌘C does not
//    (copy keeps its chord) and the retired plain N does not
// 2. the sidebar 新任务 row renders the C badge and click-opens the dialog
// 3. C on a non-board route opens the dialog in place (no navigation)
// 4. C on the project page opens that page's own dialog (route-project
//    chip), not a second global instance
// 5. Space no longer opens the drawer; ⌘J does with the composer focused,
//    and ⌘J's default is consumed (a probe listener registered after the
//    app's sees the delivered keydown already preventDefaulted)
// 6. ⌘J wakes the drawer on a non-board route (schedules)
// 7. editable focus OUTSIDE the drawer swallows both keys — the c lands IN
//    the input, ⌘J keeps the drawer shut
// 8. textarea focus (chief composer) swallows C — the guard family is
//    input + textarea + select + contenteditable; the app ships no
//    contenteditable surface today, so that branch stays code-only
//    (a synthetic node would test the guard, not the app)
// 9. Space on a focused button fires the button natively (activation
//    returned, no hijack); ⌘J fires the drawer even with a button focused
//    (guard narrowed to editable-only); modifier-less C stays live
// 10. ⌘J toggles shut from the composer focus (drawer-interior exemption
//     missing → the guard swallows the closing chord), and the full
//     open→close→open loop rides one listener
// 11. the toggle rides the non-board singleton hook too (schedules)
// 12. the FAB click stays open-only; ⌘J closes what the click opened
// 13. hovering the robot FAB surfaces the ⌘J kbd hint (at rest it stays
//     hidden — no phantom chip in captures); the wake families carry the
//     same hint through the shared consumption point
// 14. the collapsed rail's search icon hovers the ⌘K hint (the expanded
//     rows already carry their always-on badges)
//
// XMON-95 adds the new-task dialog's ⌘↵ (Ctrl+↵ off macOS) chord on
// 保存并开始 — the first *surface-scoped* chord: it rides the same
// useChordHotkey registration form, gated on the dialog's open flag, and
// its guard exempts the dialog's own textarea (the ⌘J drawer-interior
// exemption law transplanted — the chord that owns a surface must fire from
// that surface's editable interior, or the autofocused spec textarea would
// swallow it before it ever ran). Fixture 保存并开始 collapses to the save
// path by documented design (use-new-task-surface.ts:297 — onSaveAndStart is
// live-only), so the landing is the local card the 保存 button also lands.
// 15. ⌘↵ and Ctrl+↵ inside the dialog fire 保存并开始 (card lands, dialog
//     closes) — both platform receipts on one registration
// 16. the dialog's dismiss chord stays scoped: with it closed, ⌘↵ on the
//     board lands nothing (the enabled gate is what keeps a closed dialog's
//     listener off the window)
// 17. the disabled gate holds on the keyboard path too: an empty spec plus
//     ⌘↵ creates no card (a chord that ignores the button's gate would save
//     a blank task)
// 18. the 未保存闸 confirm layer is the dialog's *sibling*, so the enabled
//     gate has to cover it as well: with the layer up, ⌘↵ still saves
//     nothing (the chord would otherwise start a real run under the
//     "discard?" question)
// 19. plain ↵ in the spec textarea is NOT hijacked — it stays the newline
//     key (no modifier, no fire, native default untouched)
// 20. the 保存并开始 button carries a visible ⌘↵ badge at rest (the
//     always-on form; kbd-hint's hover chip is the other face)
//
// XMON-87 adds the family's only binding that consumes a native browser key.
// 21. Tab switches the dialog's project from the composer focus the open
//     itself lands (the dialog-interior exemption, ⌘J's drawer narrowing),
//     wraps at the ends, and leaves focus in the composer so typing is not
//     interrupted
// 22. the same from the chip's own focus, list open or not; Shift+Tab is NOT
//     consumed — with Tab spent on switching, it is the way out of the seat
// 23. off the two driving seats (mention button / footer) Tab stays native
// 24. the project chip hovers its Tab hint (at rest it stays hidden)
// 25. outside the dialog (closed) Tab stays native — no dialog, no listbox
// 26. the 未保存闸 confirm layer is that chord's own sibling too: with it
//     up, Tab cycles nothing — the layer has no focus trap, so eating Tab
//     there would be a keyboard trap (继续编辑 / 放弃并关闭 unreachable)
//
// #645 puts the retired N back on the board — drawer-scoped: the drawer
// head's new-thread + fires on a bare N while the drawer is open, and the
// button carries the family's hover hint.
// 27. the drawer new-thread + hovers the N hint (at rest it stays hidden)
//     and advertises aria-keyshortcuts — KbdHint's fourth consumption point
// 28. with the drawer closed N stays retired: six delivered presses open
//     neither the drawer nor the dialog (the enabled gate keeps the
//     listener off the window; XMON-37's global retirement holds). The
//     live fire / scope / input-guard faces ride the verify-pacman probe
//     drive-chief-new-thread-key.mjs (docs/verify/645) — fixture faces
//     cannot observe the fire (onNewThread is live-only)
//
// #1141 retires the last two suppressed routes (agent detail, machine
// authorize — the docked-era wake-pair absence kept as suppression by
// #1009 A0): the FAB renders and ⌘J stays registered everywhere. Each
// test pins one route's failure mode.
// 29. the agent-detail edit face renders the FAB and ⌘J wakes the drawer
//     in place (composer focused, toggle closes — the #468 contract now
//     on this route)
// 30. the machine-authorize page does the same (route fixed inset-0 card
//     shares the viewport with the corner FAB — z-(--z-floating) rung)
// 31. route switch keeps the window open (ADR 0013 D6 persistence): the
//     drawer opened on the authorize page survives the SPA route back
//     (machines → dialog link → authorize, browser back — the D6 contract
//     covers client-side route switches only, not a document reload)

const BOARD = '/app?scenario=01';
const SCHEDULES = '/app/schedules?scenario=01';
/** XMON-87 的 Tab 换项目要有第二个项目才检得出来（scenario 01 只有一个）：
 *  boardProjectPicker 场景 = r3-lifecycle + r2-inventory 双行。 */
const PROJECTS = '/app?scenario=newtask-projects';
/** 该场景首行的项目 id（显示名 r3-lifecycle）；记忆位存的是 id 不是名字。 */
const FIRST_PROJECT_ID = 'ZAQczKCu0MOAzC1ZqcFlX';
const PROJECT = '/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=r2-24b&tab=tasks';
/** #1141：两条原抑制路由。agent 详情走 agent-detail 场景（fixtures.ts 的
 *  r3-builder 详情记录，agent-delete.spec 同款 URL 形态）。 */
const AGENT_DETAIL = '/app/resources/agents/r3-builder?scenario=agent-detail';
const AUTHORIZE = '/app/machines/authorize';
/** #1141 D6 腿：机器页（scenario 06，machine-add-dialog.spec 同款 URL）——
 *  添加机器弹层里的「浏览器授权注册 →」Link 是通往授权页的真实 SPA 入口。 */
const MACHINES = '/app/resources/machines?scenario=06';

const dialog = (page: Page) => page.locator('.new-task-dialog');
const drawer = (page: Page) => page.locator('.chief-drawer');

/** Retired-binding negative (XMON-37), the retry law inverted: six delivered
 *  presses of the old key could not all be lost if it were still bound, so a
 *  surface that stays closed across the loop is proof it is unbound. */
async function pressesStayClosed(
  page: Page,
  key: string,
  surface: ReturnType<Page['locator']>,
) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
    await expect(surface).toHaveCount(0);
  }
}

/** ADR 0013 D6 载体版的 pressesStayClosed：chief 窗关态驻 DOM（hidden），
 *  count-0 律只对其余弹层家族成立；窗面「保持关」= 保持 hidden。 */
async function pressesStayHidden(
  page: Page,
  key: string,
  surface: ReturnType<Page['locator']>,
) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.keyboard.press(key);
    await page.waitForTimeout(120);
    await expect(surface).toBeHidden();
  }
}

/** Escape-until-closed, same retry law as pressUntil: the close listener
 *  registers in a passive effect too, so an Escape fired right after open
 *  can be lost (renderer input processing lags the assertion read under
 *  load — CI evidence: the dialog stayed mounted 5s+). Escape on an
 *  already-closed surface is a no-op, so retries never double-fire. */
async function escapeUntilHidden(page: Page, surface: ReturnType<Page['locator']>) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.keyboard.press('Escape');
    const closed = await surface
      .waitFor({ state: 'hidden', timeout: 1000 })
      .then(() => true)
      .catch(() => false);
    if (closed) return;
  }
  throw new Error(`Escape never closed ${surface}`);
}

/** toggle close, same retry law as escapeUntilHidden: a delivered toggle
 *  hides the surface and the wait ends the loop; a lost key leaves it open
 *  and the re-press IS the toggle. A pathologically slow close makes the
 *  next press reopen — and the one after closes again — so the loop's end
 *  state is deterministically hidden, never a coin flip. 键固定 ⌘J——本文件里
 *  走这条 toggle 循环的面只有 chief 抽屉；XMON-87 的 Tab 换项目是「循环选择」
 *  语义、不关面，另有用例走 useProjectCycleHotkey。 */
async function toggleUntilHidden(page: Page, surface: ReturnType<Page['locator']>) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.keyboard.press('Meta+j');
    const closed = await surface
      .waitFor({ state: 'hidden', timeout: 1000 })
      .then(() => true)
      .catch(() => false);
    if (closed) return;
  }
  throw new Error('Meta+j never closed the surface');
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

  await pressUntil(page, 'c', dialog(page));
  // family law: the dialog's spec textarea owns focus on open (#394 单字段面)
  await expect(page.locator('.new-task-spec')).toBeFocused();
  await escapeUntilHidden(page, dialog(page));
  await expect(dialog(page)).toHaveCount(0);
});

test('sidebar 新任务 row carries the C badge and click-opens the dialog', async ({ page }) => {
  await page.goto(BOARD);
  const row = page.getByRole('complementary').getByRole('button', { name: '新任务' });
  await expect(row).toBeVisible();
  await expect(row.getByText('C', { exact: true })).toHaveText('C');
  await row.click();
  await expect(dialog(page)).toBeVisible();
  await escapeUntilHidden(page, dialog(page));
  await expect(dialog(page)).toHaveCount(0);
});

test('C on a non-board route opens the dialog in place', async ({ page }) => {
  await page.goto(SCHEDULES);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressUntil(page, 'c', dialog(page));
  // in place — the route never hops to the board
  await expect(page).toHaveURL(/\/app\/schedules/);
  await escapeUntilHidden(page, dialog(page));
  await expect(dialog(page)).toHaveCount(0);
});

test('C on the project page opens the page’s own dialog (route project chip)', async ({
  page,
}) => {
  await page.goto(PROJECT);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressUntil(page, 'c', dialog(page));
  // exactly one instance — the page's own (project-empty-new-task.spec pins
  // the chip = the route's project, which the global sidebar dialog cannot
  // know); a second global instance would read 2 here
  await expect(dialog(page)).toHaveCount(1);
  await expect(dialog(page).locator('.new-task-project-name')).toHaveText('r3-lifecycle');
  await escapeUntilHidden(page, dialog(page));
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

  await pressUntil(page, 'Meta+j', drawer(page));
  await expect(page.getByTestId('chief-composer-input')).toBeFocused();
  // ADR 0013 D3：Esc 不收窗——收起走 ⌘J toggle（Minimize 钮同律）
  await toggleUntilHidden(page, drawer(page));
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
  await pressUntil(page, 'Meta+j', drawer(page));
  const consumed = await page.evaluate(
    () => (window as unknown as { cmdJConsumed?: boolean }).cmdJConsumed,
  );
  expect(consumed).toBe(true);
  await toggleUntilHidden(page, drawer(page));
  await expect(drawer(page)).toBeHidden();
});

test('⌘J wakes the chief drawer on a non-board route', async ({ page }) => {
  await page.goto(SCHEDULES);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressUntil(page, 'Meta+j', drawer(page));
  await expect(page.getByTestId('chief-composer-input')).toBeFocused();
  await expect(page).toHaveURL(/\/app\/schedules/);
  await toggleUntilHidden(page, drawer(page));
  await expect(drawer(page)).toBeHidden();
});

test('editable focus swallows C and ⌘J — the c lands IN the input', async ({ page }) => {
  await page.goto(BOARD);
  // open the ⌘K panel: its input is the editable focus target
  // #949: 面板载体 = role dialog + 可及名（.search-panel 类钉退役）
  await pressUntil(page, 'Meta+k', page.getByRole('dialog', { name: '搜索' }));
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
  await pressUntil(page, 'Meta+j', drawer(page));
  const composer = page.getByTestId('chief-composer-input');
  await expect(composer).toBeFocused();
  // fixture composer is readOnly — focus holds but typing lands nowhere;
  // the guard must keep C from opening the dialog behind the drawer
  await page.keyboard.press('c');
  await expect(dialog(page)).toHaveCount(0);
  await expect(drawer(page)).toBeVisible();
  await toggleUntilHidden(page, drawer(page));
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
  await escapeUntilHidden(page, dialog(page));
  await expect(dialog(page)).toHaveCount(0);

  // Space keeps its native button-activation semantics (#442 returned them
  // in full): the 搜索 row's own click fires (the panel opens) and the
  // drawer stays shut — no hijack
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
  await pressUntil(page, 'Meta+j', drawer(page));
  await expect(page.getByTestId('chief-composer-input')).toBeFocused();
  await toggleUntilHidden(page, drawer(page));
  await expect(drawer(page)).toBeHidden();
});

test('⌘J toggles: the second press closes the drawer from its own composer focus', async ({
  page,
}) => {
  await page.goto(BOARD);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressUntil(page, 'Meta+j', drawer(page));
  await expect(page.getByTestId('chief-composer-input')).toBeFocused();
  // The drawer-interior exemption law (#468): the composer is an editable
  // target, but the chord that owns this surface must close it — without
  // the exemption the editable guard swallows the closing press and this
  // wait times out.
  await toggleUntilHidden(page, drawer(page));
  await expect(drawer(page)).toBeHidden();
  // The full loop rides the one singleton listener: open → close → open →
  // close, no re-registration between presses.
  await pressUntil(page, 'Meta+j', drawer(page));
  await toggleUntilHidden(page, drawer(page));
  await expect(drawer(page)).toBeHidden();
});

test('⌘J toggle rides the non-board singleton hook too (schedules)', async ({ page }) => {
  await page.goto(SCHEDULES);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressUntil(page, 'Meta+j', drawer(page));
  await toggleUntilHidden(page, drawer(page));
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
  await toggleUntilHidden(page, drawer(page));
  await expect(drawer(page)).toBeHidden();
});

test('the robot FAB surfaces the ⌘J hint on hover; at rest it stays hidden', async ({
  page,
}) => {
  await page.goto(BOARD);
  const fab = page.getByRole('button', { name: '总管' });
  // #1008 重钉：kbd-hint chip 退役 → 官网 Tooltip+Kbd 组合（#983 判决）。
  // 静息 = tooltip 不挂载（旧 visibility:hidden 常驻 DOM 的语义随件换代，
  // 原型实审裁决 3 过目：tooltip 进可及树 = a11y 增强）；挂载点是 body 级
  // portal，定位器走页面级。
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
  // #1008 重钉：Tooltip+Kbd 组合（同上），body 级 portal 走页面级定位器。
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
  // #1008 重钉：Tooltip+Kbd 组合，side=right sideOffset=8 = 旧 rail 落位。
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
  await pressUntil(page, 'Meta+j', drawer(page));
  const newThread = drawer(page).locator('button[aria-label="新主题"]');
  await expect(newThread).toBeVisible();
  await expect(newThread).toHaveAttribute('aria-keyshortcuts', 'N');
  // #1008 重钉：Tooltip+Kbd 组合，side=bottom sideOffset=8 = 旧 below 落位
  // （头部贴视口顶）。静息 = tooltip 不挂载。
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

// ---- XMON-95: the new-task dialog's ⌘↵ chord on 保存并开始 ----------------

/** Open the new-task dialog through the sidebar row (the #445 opener form). */
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

test('⌘↵ and Ctrl+↵ inside the dialog fire 保存并开始 (card lands, dialog closes)', async ({
  page,
}) => {
  const dialog = await openNewTask(page);
  await dialog.locator('.new-task-spec').fill('⌘↵ 建的卡');
  // The autofocused spec textarea is an editable target — the chord must
  // still fire from it (dialog-interior exemption; without it the guard
  // swallows the press and this wait times out).
  // The retry loop waits on the outcome (the card landing), not on a surface
  // opening: a lost press lands nothing, so a re-press cannot double-fire.
  await pressUntil(page, 'Meta+Enter', landedCard(page, '⌘↵ 建的卡'));
  await expect(dialog).not.toBeVisible();

  // Same registration, non-mac receipt: Ctrl+↵ lands a second card
  await page.getByRole('complementary').getByRole('button', { name: '新任务' }).click();
  await expect(dialog).toBeVisible();
  await dialog.locator('.new-task-spec').fill('Ctrl 建的卡');
  await pressUntil(page, 'Control+Enter', landedCard(page, 'Ctrl 建的卡'));
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

test('⌘↵ under the 未保存闸 confirm layer saves nothing (the layer owns the screen)', async ({
  page,
}) => {
  const dialog = await openNewTask(page);
  await dialog.locator('.new-task-spec').fill('闸下不该落的卡');
  const cards = page.locator('[data-column="todo"] [data-todo-id]');
  const before = await cards.count();
  // 弄脏后点 × → 未保存闸确认层起来。该层是 dialog **之外**的兄弟层（#318），
  // 所以 dialog 仍开着——闸只认 open 的话，⌘↵ 会在这句「要不要放弃？」之下把
  // 任务保存并开始（真起一次 agent 跑）。确认层两个按钮都不是可编辑目标，
  // 守卫拦不住，只能靠 enabled 在这一层缺席。
  await dialog.locator('.new-task-close').click();
  const layer = page.locator('.new-task-discard');
  await expect(layer).toBeVisible();
  // 六次投递若都送达会落六张卡（至少一张）；计数不动 = 和弦在这层缺席。
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

test('the 保存并开始 button carries a visible ⌘↵ badge at rest', async ({ page }) => {
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
  await pressUntil(page, 'c', dialog(page));
  const chipName = page.locator('.new-task-project-name');
  await expect(page.locator('.new-task-spec')).toBeFocused();
  await expect(chipName).toHaveText('r3-lifecycle');

  await page.keyboard.press('Tab');
  await expect(chipName).toHaveText('r2-inventory');
  // 换项目不搬打字的手：焦点留在 composer
  await expect(page.locator('.new-task-spec')).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pacman.newTaskProjectId')))
    .toBe('r2-inventory');

  // 末行再 Tab 环绕回首行（记忆位存的是项目 id：首行的 id 与显示名不同名，
  // fixture 里 PROJECT_ID 显示为 r3-lifecycle）
  await page.keyboard.press('Tab');
  await expect(chipName).toHaveText('r3-lifecycle');
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('pacman.newTaskProjectId')))
    .toBe(FIRST_PROJECT_ID);

  await escapeUntilHidden(page, dialog(page));
});

test('the chip cycles on Tab while the list is open; Shift+Tab keeps native movement', async ({
  page,
}) => {
  await page.goto(PROJECTS);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressUntil(page, 'c', dialog(page));
  const chip = page.locator('.new-task-project');
  const menu = page.locator('.new-task-project-menu');
  const checked = menu.locator('.new-task-project-row[aria-selected="true"] .new-task-project-row-name');

  // 鼠标开列表：chip 拿焦点，Tab 移的是勾选行（不用先关列表）
  await chip.click();
  await expect(menu).toBeVisible();
  await expect(checked).toHaveText('r3-lifecycle');
  await page.keyboard.press('Tab');
  await expect(checked).toHaveText('r2-inventory');
  await expect(page.locator('.new-task-project-name')).toHaveText('r2-inventory');
  await expect(chip).toBeFocused();
  await expect(menu).toBeVisible();

  // #1008 实审裁决 2：Shift+Tab = 离开触发钮的出口，Base UI trigger focus
  // guards 原生关面（对齐 registry、不维护两套语义；旧「列表保持开」契约随
  // 手写壳退役）。换项目结果不受影响（r2-inventory 保持回填）。
  await page.keyboard.press('Shift+Tab');
  await expect(chip).not.toBeFocused();
  await expect(menu).toBeHidden();
  await expect(page.locator('.new-task-project-name')).toHaveText('r2-inventory');
  await expect(dialog(page)).toBeVisible();
  await escapeUntilHidden(page, dialog(page));
});

test('Tab off the driving seats stays native (mention button keeps its own walk)', async ({
  page,
}) => {
  await page.goto(PROJECTS);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressUntil(page, 'c', dialog(page));
  const chipName = page.locator('.new-task-project-name');
  await expect(chipName).toHaveText('r3-lifecycle');

  const mention = page.locator('.new-task-dialog button[aria-label="提及"]');
  await mention.focus();
  await page.keyboard.press('Tab');
  // 项目没被换,焦点照常往前走
  await expect(chipName).toHaveText('r3-lifecycle');
  await expect(mention).not.toBeFocused();

  await escapeUntilHidden(page, dialog(page));
});

test('the project chip hovers its Tab hint (hidden at rest)', async ({ page }) => {
  await page.goto(PROJECTS);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressUntil(page, 'c', dialog(page));
  const chip = page.locator('.new-task-project');
  // #1008 重钉：Tab 提示 = TooltipTrigger→PopoverTrigger→Button 三层复合上的
  // Tooltip+Kbd（side=right sideOffset=8 = 旧 chip 右落位）；静息不挂载。
  const hint = page.locator('[data-slot="tooltip-content"]');
  await expect(hint).toHaveCount(0);
  await chip.hover();
  await expect(hint).toBeVisible();
  await expect(hint.locator('[data-slot="kbd"]')).toHaveText('Tab');
  await escapeUntilHidden(page, dialog(page));
});

test('Tab cycles nothing while the 未保存闸 confirm layer is up (that layer owns the keyboard)', async ({
  page,
}) => {
  await page.goto(PROJECTS);
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressUntil(page, 'c', dialog(page));
  const chipName = page.locator('.new-task-project-name');
  await expect(chipName).toHaveText('r3-lifecycle');
  await dialog(page).locator('.new-task-spec').fill('脏面');
  // 走 Esc 这条关闸路（键盘用户的关闸位；点 × 那条路焦点起点在关闭钮）。
  // #656 起确认层 = FloatingShell（sibling root）：initialFocus 走缺省，Base UI
  // 把焦点送进层内首个 tabbable（继续编辑钮；ClickCatcher tabIndex=-1 不在 tab
  // 序）——sibling root 的 Esc 路由依赖焦点在本层内（new-task-dialog.tsx 注记：
  // initialFocus=false 时 Esc 全被 modal dialog 吃掉，本层关不掉）。旧
  // OverlayMount 的「焦点仍停在 composer」契约随壳退役；入焦是异步的，用
  // toBeFocused 的轮询等它落定，不与单点断言赛跑。焦点入层后 Tab 在两个动作钮
  // 间原生走位（#247 可达性即此意），composer 的 Tab 和弦（换项目）在这一层
  // 缺席（enabled = open ∩ ¬discardOpen），哪条路都不会动项目。
  await page.keyboard.press('Escape');
  const layer = page.locator('.new-task-discard');
  await expect(layer).toBeVisible();
  await expect(layer.locator('.new-task-discard-keep')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(chipName).toHaveText('r3-lifecycle');
  // 换项目与写记忆位是同一个动作：没换 = 也没写。
  expect(await page.evaluate(() => localStorage.getItem('pacman.newTaskProjectId'))).toBeNull();
});

test('with the dialog closed Tab stays native', async ({ page }) => {
  await page.goto(PROJECTS);
  await expect(page.getByRole('complementary')).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator('.new-task-project')).toHaveCount(0);
  // 焦点落在页内某个真控件上(原生走位),不是被吞掉
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
    await pressUntil(page, 'Meta+j', drawer(page));
    await expect(page.getByTestId('chief-composer-input')).toBeFocused();
    await expect(page).toHaveURL(/\/app\/resources\/agents\/r3-builder/);
    await toggleUntilHidden(page, drawer(page));
    await expect(drawer(page)).toBeHidden();
  });

  test('machine authorize renders the FAB; ⌘J wakes the drawer in place', async ({ page }) => {
    await page.goto(AUTHORIZE);
    await expect(page.locator('.authorize-backdrop')).toBeVisible();
    await expect(fab(page)).toBeVisible();
    await pressUntil(page, 'Meta+j', drawer(page));
    await expect(page.getByTestId('chief-composer-input')).toBeFocused();
    await expect(page).toHaveURL(/\/app\/machines\/authorize/);
    await toggleUntilHidden(page, drawer(page));
    await expect(drawer(page)).toBeHidden();
  });

  test('the window opened on the authorize page survives the route back', async ({ page }) => {
    // ADR 0013 D6 persistence on the formerly suppressed detour: the drawer
    // stays open across a client-side route switch (single persistent
    // instance). D6 does NOT cover a document reload — page.goto would be one
    // (and on the fixture face localStorage persistence is read-only-disabled
    // by design, chief-draft-persist A0 S11), so the route switch rides the
    // real user path instead: machines → 添加机器 dialog → 浏览器授权注册 →
    // Link (#121 Link 律, scenario 随行) lands the authorize page, browser
    // back pops the SPA history to machines — no document request in between.
    await page.goto(MACHINES);
    await page.getByRole('button', { name: '添加机器' }).click();
    const dialog = page.getByRole('dialog', { name: '添加机器' });
    await expect(dialog).toBeVisible();
    // leaving the dialog via the link is itself a client-side navigation
    await dialog.getByRole('link', { name: '浏览器授权注册 →' }).click();
    await page.waitForURL((u) => u.pathname === '/app/machines/authorize');
    await expect(page.locator('.authorize-backdrop')).toBeVisible();
    await pressUntil(page, 'Meta+j', drawer(page));
    await page.goBack();
    await page.waitForURL((u) => u.pathname === '/app/resources/machines');
    await expect(page.getByRole('button', { name: '添加机器' })).toBeVisible();
    await expect(drawer(page)).toBeVisible();
    await toggleUntilHidden(page, drawer(page));
    await expect(drawer(page)).toBeHidden();
  });
});
