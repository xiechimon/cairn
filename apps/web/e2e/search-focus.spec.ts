import { expect, type Locator, type Page, test } from '@playwright/test';
import { decodePng, type DecodedPng } from './png.js';

// Issue #137 acceptance: ⌘K opens the panel with the input *already*
// focused — typing lands without a second click and filters the fixture
// todos — and the 常亮互斥 rule holds: while the panel is open it is the
// only lit focus surface (the page-layer selected pill dims under the
// scrim), and the page layer restores on close. Rides the plain board
// scenario ('01'); every open state here comes from the hotkey, never the
// fixture flag.
//
// #949 载体（#910 裁定 1/3）：面板 = role dialog + 可及名「搜索」；输入 =
// 面板 scope 的 textbox；scrim 无 role（Base UI Backdrop，data-slot 不作
// 钉扎载体）→ 暗角点击走视口坐标（scrim 铺满视口，旧 .search-scrim 定位
// 点击的同值用户路径）；页层选中 pill = aria-current="page"（#943 已立的
// 一级状态载体），pill 层 = 行的 ::before utility（#414/#943 同构）。

const BOARD = '/app?scenario=01';

const panel = (page: Page) => page.getByRole('dialog', { name: '搜索' });
const input = (page: Page) => panel(page).getByRole('textbox');
/** 页层常亮 pill（aria-current = #943 立的一级状态载体）。includeHidden：
 *  ⌘K 面板是 modal——开着时 Base UI 给背景挂 aria-hidden，缺省 role 引擎
 *  会把 complementary 整个滤掉，而本断言恰恰要在 scrim 下读它（旧
 *  .sidebar-row--selected CSS locator 无此过滤，载体等价性靠本开关保住）。 */
const litPill = (page: Page) =>
  page.getByRole('complementary', { includeHidden: true }).locator('[aria-current="page"]');

/** Background of the selected row (Paper Grouped sidebar: the row itself
 *  carries the sheet fill; the ::before pill layer retired). */
function pillBg(locator: Locator) {
  return locator.evaluate((el) => getComputedStyle(el).backgroundColor);
}

/** #159: the hovered row lights with the canon pill — its background
 *  equals the resolved --row-selected token (the look the r7 05 fixed
 *  selected row used to carry), not the generic #73 surface-hover tint. */
function isLit(locator: Locator) {
  return locator.evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--secondary)';
    document.documentElement.append(probe);
    const lit = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(el).backgroundColor === lit;
  });
}

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

/** Tallest vertical run of lit pixels in the rect [x0,x1) × [y0,y1), counted
 *  in device pixels. The caret (--text-primary, near white) clears the luma
 *  threshold on its own column; the placeholder glyph it sits on (--text-dim)
 *  stays under it, so a clipped caret reads as a short run and a whole one as
 *  the input's full height. */
function tallestRun(img: DecodedPng, x0: number, y0: number, x1: number, y1: number): number {
  let best = 0;
  for (let x = x0; x < x1; x += 1) {
    let run = 0;
    for (let y = y0; y < y1; y += 1) {
      const [r, g, b] = img.px(x, y);
      run = 0.2126 * r + 0.7152 * g + 0.0722 * b > 140 ? run + 1 : 0;
      if (run > best) best = run;
    }
  }
  return best;
}

/** ⌘K until the panel answers. goto resolves at `load`, but the hotkey
 *  listener registers in a passive effect after first paint — on a loaded
 *  machine the first press can predate hydration. The retry only re-presses
 *  a *lost* hotkey (a delivered one flips the panel visible, ending the
 *  loop); it never double-toggles. */
async function openPanel(page: Page) {
  // expanded rows OR rail rows — both live inside the complementary landmark
  await expect(page.getByRole('complementary')).toBeVisible();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await page.keyboard.press('Meta+k');
    const opened = await panel(page)
      .waitFor({ state: 'visible', timeout: 1000 })
      .then(() => true)
      .catch(() => false);
    if (opened) return;
  }
  throw new Error('⌘K never opened the search panel');
}

test('⌘K focuses the input — direct typing produces results', async ({ page }) => {
  await page.goto(BOARD);
  await openPanel(page);

  const field = input(page);
  await expect(field).toBeFocused(); // caret in the box, no click needed

  // keys go straight to the panel: the fixture probe todo filters in
  await page.keyboard.type('r3 lifecycle probe');
  const rows = panel(page).locator('[data-row-kind="todo"]');
  await expect(rows.first()).toContainText('r3 lifecycle probe');

  // and the empty-state 前往 group is gone — real filtering, not a repaint
  await expect(panel(page).getByText('前往', { exact: true })).toHaveCount(0);
});

test('mid-exit reopen refocuses the retained input', async ({ page }) => {
  await page.goto(BOARD);
  await openPanel(page);
  await expect(input(page)).toBeFocused();

  // reopen inside the 150ms retained-mount window: the input never
  // detaches, so the mount-time focus path can't fire — the open
  // transition must refocus (#137 regression guard; if the window is
  // missed the remount path refocuses instead and the assertion still
  // holds, so the guard is timing-robust)
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+k');
  await expect(input(page)).toBeFocused();
});

test('scrim 可点关: clicking the dark area closes the panel', async ({ page }) => {
  await page.goto(BOARD);
  await openPanel(page);

  // the scrim's own centre sits under the 520×440 panel, so the click goes to
  // a dark corner: only the scrim paints there (it spans the viewport, so
  // viewport coordinates are its own — the #949 carrier note above)
  await page.mouse.click(20, 20);
  await expect(panel(page)).toBeHidden();
});

test('常亮互斥: page-layer pill dims while the panel is open, restores on close', async ({
  page,
}) => {
  await page.goto(BOARD);
  const pill = litPill(page);
  await expect(pill).toHaveCount(1);
  expect(await pillBg(pill)).not.toBe(TRANSPARENT); // lit at rest

  await openPanel(page);
  // poll, don't snapshot: the pill's background-color rides the 150ms
  // sidebar transition, so an immediate read lands mid-fade
  await expect.poll(() => pillBg(pill)).toBe(TRANSPARENT); // extinguished
  // #159: at rest the panel lights no row of its own (no fixed 常亮) — the
  // hovered row becomes the single lit surface while the page pill stays dim
  await expect(panel(page).locator('[data-selected]')).toHaveCount(0);
  const row = panel(page).getByRole('button').first();
  await row.hover();
  await expect.poll(() => isLit(row)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect.poll(() => pillBg(pill)).not.toBe(TRANSPARENT); // restored
});

test('常亮互斥 holds on the collapsed rail form', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pacman.sidebar-collapsed', '1');
  });
  await page.goto(BOARD);
  const rail = litPill(page);
  await expect(rail).toHaveCount(1);
  expect(await pillBg(rail)).not.toBe(TRANSPARENT);

  await openPanel(page);
  await expect.poll(() => pillBg(rail)).toBe(TRANSPARENT);

  await page.keyboard.press('Escape');
  await expect(panel(page)).toBeHidden();
  await expect.poll(() => pillBg(rail)).not.toBe(TRANSPARENT);
});

// XMON-79: the caret was shaved to a sliver in the state ⌘K opens in. The
// field was a frameless inline input (the old .input--palette skin, retired
// with the #574 move to components/ui/input) that inherited .input's 8px
// corner radius, which belongs to the boxed skin. Blink's UA sheet forces `overflow: clip`
// on <input>, clipping to the padding box *following the corners*; at 16px
// tall an 8px radius is a stadium, and the caret is painted at the text
// origin — the padding-box left edge, x=0 — exactly where the arc has eaten
// the height. Empty input is the state the panel opens in, so the reported
// symptom is this one.
//
// Asserted as pixels, not as a computed border-radius: the invariant is that
// the caret is *visible*, not that some property holds a particular value.
test('the caret is not clipped where it meets the input edge', async ({ page }) => {
  await page.goto(BOARD);
  await openPanel(page);
  const field = input(page);
  await expect(field).toBeFocused();

  // The panel scales in from `transform-origin: 50% 0`. Until that transition
  // ends the input sits at scaled coordinates — mid-flight the 16px field
  // measures 15.55px wide at x 499 — and a clip built from those numbers
  // lands beside the caret and reads an empty window. A screenshot settles
  // the panel by itself (Playwright fast-forwards finite transitions); a box
  // read does not, so wait the transition out before measuring.
  await expect(panel(page)).toHaveCSS('transform', 'none');
  const box = (await field.boundingBox())!;

  // The clip starts one lane left of the input so the caret column is never
  // flush against the bitmap edge; the row's magnifier sits 3px further left
  // again, outside the window, so nothing but the caret can light it up.
  const clip = {
    x: Math.round(box.x) - 1,
    y: Math.round(box.y) - 2,
    width: 4,
    height: Math.round(box.height) + 4,
  };

  // A caret blinks, and a screenshot keeps whichever phase it lands in. An
  // edit that changes the selection restarts the phase visible, so every
  // frame is taken right after typing+backspacing back to position 0 —
  // deterministic, rather than a sleep racing the blink timer.
  const caretHeight = async () => {
    await page.keyboard.type('a');
    await page.keyboard.press('Backspace');
    const shot = decodePng(await page.screenshot({ clip, caret: 'initial' }));
    return tallestRun(shot, 0, 0, shot.width, shot.height);
  };
  const frames = [await caretHeight(), await caretHeight(), await caretHeight()];

  // Full caret height in this field is 16px == the input's own height.
  // Measured: 6px with the inherited radius, 16px without it.
  expect(Math.max(...frames)).toBeGreaterThanOrEqual(box.height - 2);
});
