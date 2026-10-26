import { expect, type Page, test } from '@playwright/test';

// #1094: the header thread switcher on the chief window had no height cap —
// a long thread list ran past the window bottom and the WINDOW_CLS
// overflow-hidden clipped it, so tail rows were neither visible nor
// clickable, with no way to scroll to them. Failure modes pinned here
// (fixture face; the click→active-switch law rides the live-face verify
// evidence because onThread is live-only by design, use-chief-surface.ts):
//   1. tail row unreachable: with 22 threads the last menuitem must sit
//      inside the window box, the list must be scrollable (scrollHeight >
//      clientHeight) and the tail row must accept a real click — pre-fix
//      the click times out on the clipped row.
//   2. short-list regression: the r5 116 canon face (2 threads) keeps its
//      natural content height, shows no scrollbar and keeps the 264px
//      width — the cap must be inert below the limit.
//   3. keyboard reachability: Tab from the first row lands on the tail row
//      and the scroll container carries the focused row into its visible
//      scroll port (break-ui face; the Enter→switch assertion is live-face
//      verify evidence for the same onThread reason as mode 1).

const drawer = (page: Page) => page.locator('.chief-drawer');
const menu = (page: Page) => page.getByRole('menu');

test.describe('chief thread switcher long-list scroll (#1094)', () => {
  test('the 22-thread list caps inside the window and the tail row is clickable', async ({
    page,
  }) => {
    await page.goto('/app?scenario=chief-threads-long');
    await expect(menu(page)).toBeVisible();
    const items = menu(page).getByRole('menuitem');
    await expect(items).toHaveCount(22);

    // the whole menu box stays inside the window box (pre-fix: 22 rows ×
    // 30px + 8px padding ≈ 668px from top-8 → the tail clears the 600px
    // window and is clipped away)
    const menuBox = await menu(page).boundingBox();
    const winBox = await drawer(page).boundingBox();
    expect(menuBox).not.toBeNull();
    expect(winBox).not.toBeNull();
    expect(menuBox!.y + menuBox!.height).toBeLessThanOrEqual(winBox!.y + winBox!.height);

    // capped and scrollable: content taller than the visible port
    const scroll = await menu(page).evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);

    // the tail row accepts a real click. `force: true` on purpose: the
    // pre-fix row is clipped by a position:fixed ancestor, and Playwright's
    // actionability hit test skips fixed-position clip checks — a plain
    // click would pass on the broken geometry. Force-click still exercises
    // the real click path at the element's centre point.
    await items.last().scrollIntoViewIfNeeded();
    await expect(items.last()).toBeVisible();
    await items.last().click({ force: true });

    // the crux: after the list scrolls to the very bottom, the tail row
    // lies inside the menu's scroll port AND inside the window — pre-fix
    // scrollIntoViewIfNeeded is a no-op (nothing scrolls), the row sits
    // ~100px below the window bottom and gets clipped away
    const tail = await items.last().evaluate((el) => {
      const scroller = el.parentElement!;
      const win = scroller.closest('.chief-drawer')!;
      const er = el.getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      const wr = win.getBoundingClientRect();
      return {
        withinScroller: er.bottom <= sr.bottom + 1 && er.top >= sr.top - 1,
        withinWindow: er.bottom <= wr.bottom + 1 && er.top >= wr.top - 1,
      };
    });
    expect(tail.withinScroller).toBe(true);
    expect(tail.withinWindow).toBe(true);
  });

  test('the short canon list (r5 116, 2 threads) keeps its natural height', async ({ page }) => {
    await page.goto('/app?scenario=116');
    await expect(menu(page)).toBeVisible();
    const geom = await menu(page).evaluate((el) => ({
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      // #1113: offsetWidth, not getBoundingClientRect().width. The drawer
      // window enters with zoom-in-95 (scale 0.95→1 over --dur-overlay,
      // WINDOW_MOTION_CLS) and the rect is transform-affected: sampled
      // mid-entry it reads width×scale(t) (262 then: first frame 248.9), and the CI
      // flakes (261.78 on #1105, 260.34 on main) are late-entry frames
      // under load. offsetWidth is the layout integer: transform-invariant,
      // so the exact pin below stays deterministic without a tolerance
      // that would swallow real width regressions.
      offsetWidth: el.offsetWidth,
    }));
    expect(geom.clientHeight).toBe(76);
    expect(geom.scrollHeight).toBeLessThanOrEqual(geom.clientHeight);
    // width on the 4px grid (w-66, #1398; was 262)
    expect(geom.offsetWidth).toBe(264);
  });

  test('Tab walks the list to the tail row and scrolls it into view', async ({ page }) => {
    await page.goto('/app?scenario=chief-threads-long');
    const items = menu(page).getByRole('menuitem');
    await expect(items).toHaveCount(22);

    await items.first().focus();
    for (let i = 0; i < 21; i++) await page.keyboard.press('Tab');
    await expect(items.last()).toBeFocused();

    // the focused tail row sits inside the menu's visible scroll port —
    // a focused-but-clipped row is the keyboard face of the same bug
    const within = await items.last().evaluate((el) => {
      const scroller = el.parentElement!;
      const er = el.getBoundingClientRect();
      const sr = scroller.getBoundingClientRect();
      return er.bottom <= sr.bottom + 1 && er.top >= sr.top - 1;
    });
    expect(within).toBe(true);
  });
});
