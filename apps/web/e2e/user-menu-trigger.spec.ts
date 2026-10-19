import { type Locator, expect, type Page, test } from '@playwright/test';

// Issue #127 acceptance: the sidebar avatar chips (expanded + rail shapes)
// open the user-menu popover on a real click — toggle on the chip, close on
// outside click and Esc, the anchored-overlay family affordances.
// #943/#910: the chips ride the一级 role carrier — both shapes are the
// button whose accessible name is the fixture user (aria-label = USER_NAME,
// fixtures.ts 'Xmon Dai'); the .sidebar-user/.rail-user class pins retired.
// #163 replaces the frozen-capture geometry assertion (224×244 @ (8,410),
// r7 17/16d) with the anchoring law — precedent: #135 re-cut the
// visual-polish assertions with 裁决 v2. The menu is bottom-anchored above
// the avatar chip: 224 wide, its left edge on the chip's left edge (Paper
// Grouped sidebar: the chip sits inside the 12px sidebar padding),
// the bottom edge rides a viewport-height-invariant distance, and the panel
// never covers the chip at any viewport height (the dogfood symptom: the
// frozen top:410px buried the avatar on short windows). Both chip shapes
// obey the same law.
// The 外观 segment (#122) is reachable from the
// click-opened menu, so the theme switch is no longer behind a
// fixture-only door. Rides menu-less scenarios ('01', '17b'): every open
// state here comes from the trigger, never the fixture flag.

const BOARD = '/app?scenario=01';
const THEME_KEY = 'pacman-theme'; // apps/web/src/theme.ts THEME_STORAGE_KEY
/** 用户 chip 的一级载体：aria-label = fixture USER_NAME（'Xmon Dai'），
 *  展开态与 rail 态同名同钮（#127 两态共开合面）。 */
const USER_NAME = 'Xmon Dai';

const menu = (page: Page) => page.locator('.user-menu');
const userChip = (page: Page) => page.getByRole('button', { name: USER_NAME });

/** #656: the menu rides an enter keyframe (scale .98 + fade) — geometry/
 *  hit-test reads must wait for it to settle, otherwise they catch a
 *  mid-animation box (precedent: checkbox-unified / dead-buttons settle waits).
 *  #854: the transition moved off the panel onto the primitive's Popup wrapper
 *  (the panel is now its static child), so the wait has to watch the ancestor
 *  that actually animates — reading the panel's own animations returns an empty
 *  list and the sample lands mid-scale (measured 222.59 against the 224 box).
 *  #943/#910 裁定 1: data-slot 不作 spec 钉扎载体——动画等待改爬直接父级
 *  （Popup wrapper 就是 .user-menu 的 parentElement，#854 的「静态子」结构）。 */
async function expectMenuSettled(page: Page) {
  await expect(menu(page)).toBeVisible();
  await menu(page).evaluate((el) =>
    Promise.all(
      (el.parentElement ?? el).getAnimations({ subtree: true }).map((a) => a.finished),
    ),
  );
}

/** #854: the panel is positioned by the primitive's Positioner (JS +
 *  autoUpdate) instead of by CSS, so a viewport change moves it a frame or two
 *  later rather than synchronously with layout — reading straight after
 *  `setViewportSize` catches the previous box (measured 343 against a required
 *  ~293). Wait for the box to stop moving, then read. */
async function expectMenuRepositioned(page: Page) {
  let prev = await menu(page).boundingBox();
  for (let i = 0; i < 40; i += 1) {
    await page.waitForTimeout(16);
    const next = await menu(page).boundingBox();
    if (prev != null && next != null && prev.x === next.x && prev.y === next.y) return;
    prev = next;
  }
}

/** The menu must own the hit-test at its own center — nothing (click
 *  catcher, board content, rail clipping) may sit above the panel. */
async function expectMenuOnTop(page: Page) {
  const box = await menu(page).boundingBox();
  expect(box).not.toBeNull();
  const top = await page.evaluate(
    ([x, y]) => document.elementFromPoint(x, y)?.closest('.user-menu') != null,
    [box!.x + box!.width / 2, box!.y + box!.height / 2] as const,
  );
  expect(top).toBe(true);
}

/** #163 anchoring law, #388 收紧, #610 裁决 v3: capture width/x stand, and
 *  the menu bottom hugs the trigger ROW's top edge — the account row carries
 *  a visible border-t seam since #414, and the #388 anchor (img top + 4px)
 *  put the panel bottom 6px BELOW the row top, so the opaque panel hid that
 *  seam across its width and its shadow smeared the row face (dogfood #610:
 *  「盖到我这个线上」). The family baseline gap (4px) is therefore measured
 *  against the row box top, the visible structural edge; against the img the
 *  law keeps only its #163 half — the panel never covers the avatar.
 *  Returns the menu-bottom distance from the viewport bottom
 *  (the anchoring invariant: it must not depend on the viewport height). */
async function expectAnchoredAboveChip(page: Page, chip: Locator) {
  const box = await menu(page).boundingBox();
  const row = await chip.boundingBox();
  const img = await chip.locator('img').boundingBox();
  expect(box).not.toBeNull();
  expect(row).not.toBeNull();
  expect(img).not.toBeNull();
  expect(box!.x).toBe(row!.x);
  expect(box!.width).toBe(224);
  const gapToRowTop = row!.y - (box!.y + box!.height);
  expect(gapToRowTop).toBeGreaterThanOrEqual(3); // family 4px, subpixel-safe
  expect(gapToRowTop).toBeLessThanOrEqual(5);
  const gapToImg = img!.y - (box!.y + box!.height);
  expect(gapToImg).toBeGreaterThan(0); // never covers the avatar (#163)
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  return viewportHeight - (box!.y + box!.height);
}

test('expanded chip: click opens anchored above the chip, re-click closes', async ({ page }) => {
  await page.goto(BOARD);
  await expect(menu(page)).toBeHidden();

  const chip = userChip(page);
  await chip.click();

  await expectMenuSettled(page);
  await expect(chip).toHaveAttribute('aria-expanded', 'true');
  await expectAnchoredAboveChip(page, chip);
  await expectMenuOnTop(page);

  // re-clicking the chip lands on the family click-catcher at the same
  // point — the user-visible effect is the toggle closing
  await chip.click({ force: true });
  await expect(menu(page)).toBeHidden();
  await expect(chip).toHaveAttribute('aria-expanded', 'false');
});

test('outside click and Esc close the open menu', async ({ page }) => {
  await page.goto(BOARD);
  const chip = userChip(page);

  await chip.click();
  await expect(menu(page)).toBeVisible();
  await page.mouse.click(700, 300); // board canvas, far from the panel
  await expect(menu(page)).toBeHidden();

  await chip.click();
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
});

test('rail chip opens the same popover, unclipped by the 40px rail', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pacman.sidebar-collapsed', '1'));
  await page.goto(BOARD);

  const chip = userChip(page);
  await chip.click();

  await expectMenuSettled(page);
  await expectAnchoredAboveChip(page, chip);
  await expectMenuOnTop(page);

  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
});

test('#163 anchoring: bottom distance is viewport-invariant, the chip is never covered — both shapes', async ({
  page,
}) => {
  for (const collapsed of [false, true]) {
    await page.goto(BOARD);
    if (collapsed) {
      // collapse is mount-time state (storage-backed, #55) — set + reload
      await page.evaluate(() => localStorage.setItem('pacman.sidebar-collapsed', '1'));
      await page.reload();
    }
    // 两态同钮同名（#910 一级载体下 shape 差异对 spec 不可见）
    const chip = userChip(page);

    await chip.click();
    await expectMenuSettled(page);
    const anchorDistance = await expectAnchoredAboveChip(page, chip);

    // the dogfood symptom window first: at 600px the frozen top:410px
    // buried the chip — the anchored panel must ride the bottom instead
    for (const height of [600, 900, 550, 732]) {
      await page.setViewportSize({ width: 1440, height });
      await expectMenuRepositioned(page);
      const distance = await expectAnchoredAboveChip(page, chip);
      // bottom-anchored: the distance does not depend on the viewport height
      expect(Math.abs(distance - anchorDistance)).toBeLessThanOrEqual(1);
    }

    await page.keyboard.press('Escape');
    await expect(menu(page)).toBeHidden();
    await page.evaluate(() => localStorage.removeItem('pacman.sidebar-collapsed'));
    await page.setViewportSize({ width: 1440, height: 732 });
  }
});

test('外观 row works from the click-opened menu and the choice survives reopen', async ({
  page,
}) => {
  await page.goto(BOARD);
  await userChip(page).click();

  const light = page.locator('.user-menu-seg button', { hasText: '浅色' });
  await expect(light).toHaveAttribute('aria-checked', 'false'); // scenario 01 rides dark
  await light.click();

  expect(
    await page.evaluate(() => document.documentElement.classList.contains('light')),
  ).toBe(true);
  expect(await page.evaluate((k) => localStorage.getItem(k), THEME_KEY)).toBe('light');

  // close + reopen: the remounted menu reads the stored theme
  await page.keyboard.press('Escape');
  await expect(menu(page)).toBeHidden();
  await userChip(page).click();
  await expect(light).toHaveAttribute('aria-checked', 'true');
});

test('detail route: the trigger opens the menu over the confirm surface', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=17b');
  await userChip(page).click();

  await expectMenuSettled(page);
  await expectMenuOnTop(page);
});

/** #1245: the floating menu's registry Popup shell is w-72 + ring-1 around
 *  the panel's own w-56 border. A point 4px outside the panel must not land
 *  on that shell, and the panel must stay inside a 732px viewport with the
 *  #163 4px gap to the trigger row. */
test('#1245 floating menu is a single skin and stays inside the viewport', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 732 });
  await page.goto(BOARD);
  const chip = userChip(page);
  await chip.click();
  await expectMenuSettled(page);

  const sample = await menu(page).evaluate((panel) => {
    const shell = panel.parentElement;
    if (shell == null) return null;
    const panelBox = panel.getBoundingClientRect();
    const shellBox = shell.getBoundingClientRect();
    const hit = document.elementFromPoint(panelBox.right + 4, panelBox.top + panelBox.height / 2);
    const before = getComputedStyle(panel, '::before');
    const panelStyle = getComputedStyle(panel);
    const shellStyle = getComputedStyle(shell);
    return {
      panelW: panelBox.width,
      shellW: shellBox.width,
      hitSlot: hit?.getAttribute('data-slot') ?? null,
      panelBg: panelStyle.backgroundColor,
      shellBg: shellStyle.backgroundColor,
      shellRing: shellStyle.getPropertyValue('--tw-ring-shadow'),
      arrowContent: before.content,
      panelTop: panelBox.top,
      panelBottom: panelBox.bottom,
      vh: window.innerHeight,
      side: shell.parentElement?.getAttribute('data-side') ?? null,
    };
  });

  expect(sample).not.toBeNull();
  expect(Math.abs(sample!.shellW - sample!.panelW)).toBeLessThanOrEqual(1);
  expect(sample!.hitSlot).not.toBe('popover-content');
  expect(sample!.shellRing).not.toContain('1px');
  expect(sample!.shellBg).toBe('rgba(0, 0, 0, 0)');
  expect(sample!.panelBg).not.toBe('rgba(0, 0, 0, 0)');
  // Paper menu face (DESIGN.md 弹窗与菜单): no caret on the panel.
  expect(sample!.arrowContent).toBe('none');
  expect(sample!.side).toBe('top');
  expect(sample!.panelTop).toBeGreaterThanOrEqual(0);
  expect(sample!.panelBottom).toBeLessThanOrEqual(sample!.vh);
  await expectAnchoredAboveChip(page, chip);
});
