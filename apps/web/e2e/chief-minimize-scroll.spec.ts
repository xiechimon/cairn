import { expect, type Page, test } from '@playwright/test';
import { evidencePanelShot } from './evidence';

// #1067: the chief window's parked carrier must not collapse to display:none.
// Failure modes pinned here (fixture face, scenario chief-scroll-long — 40
// alternating user/robot rows keep the stream far taller than the 600px
// window so the scroll position has a measurable middle):
//   1. scroll loss on minimize: Base UI keepMounted parks the closed popup
//      with the `hidden` attribute and tailwind preflight turns that into
//      display:none — the browser drops scrollTop on a display:none box and
//      the reopen lands at the default end position instead of the reader's
//      spot. Pre-fix this is the reproducible red: mid-scroll → minimize →
//      reopen → scrollTop far from the parked value.
//   2. docked focus leak: the parked window must not eat keyboard focus —
//      Tab from the board must never land inside the parked subtree.
//   3. docked a11y-tree leak: role queries run through the accessibility
//      tree, so the parked window's buttons must be unfindable by role
//      while parked (toBeHidden covers the same axis from the DOM side).
//   4. reopen autofocus regression: the closed→open migration autofocus law
//      (#389 / ADR 0013 D5) must still focus the composer on reopen.
//   5. FAB mutual exclusion regression (D4): with the window parked the FAB
//      is visible and its click reopens the window.

const drawer = (page: Page) => page.locator('.chief-drawer');
const fab = (page: Page) => page.locator('.chief-fab');
const minimize = (page: Page) => drawer(page).getByRole('button', { name: '最小化' });
const viewport = (page: Page) => page.getByTestId('chief-body');

/** scrollTop of the message-flow viewport (the real scroll container,
 * #1009 A1: MessageScrollerViewport carries chief-body). */
const scrollTopOf = (page: Page) => viewport(page).evaluate((el) => el.scrollTop);

/** settle the enter/exit animation before measuring (zoom-in-95 keeps the
 * transform on the box mid-flight, chief-panel.spec 同律). */
async function settled(page: Page) {
  await drawer(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

test.describe('chief minimize keeps the scroll position (#1067)', () => {
  test('scroll to the middle → minimize → reopen lands at the same spot', async ({ page }) => {
    await page.goto('/app?scenario=chief-scroll-long');
    await settled(page);

    // a real middle: park the viewport at half its scrollable range —
    // neither 0 (an unscrolled box would vacuously pass) nor max (the
    // defaultScrollPosition="end" landing spot would mask the loss)
    const range = await viewport(page).evaluate(
      (el) => el.scrollHeight - el.clientHeight,
    );
    expect(range).toBeGreaterThan(200);
    await viewport(page).evaluate((el) => {
      el.scrollTop = Math.floor((el.scrollHeight - el.clientHeight) / 2);
    });
    const parked = await scrollTopOf(page);
    expect(parked).toBeGreaterThan(50);
    expect(parked).toBeLessThan(range - 50);
    await evidencePanelShot(page, 'scroll-mid-before-minimize.png', drawer(page));

    await minimize(page).click();
    await expect(drawer(page)).toBeHidden();
    // the parked carrier must still hold the reader's spot (pre-fix:
    // display:none clamps scrollTop to 0)
    const whileParked = await scrollTopOf(page);
    await evidencePanelShot(page, 'scroll-parked-window.png', drawer(page));

    await fab(page).click();
    await settled(page);
    await expect(drawer(page)).toBeVisible();
    const reopened = await scrollTopOf(page);
    await evidencePanelShot(page, 'scroll-reopened-same-spot.png', drawer(page));

    expect(Math.abs(whileParked - parked)).toBeLessThanOrEqual(2);
    expect(Math.abs(reopened - parked)).toBeLessThanOrEqual(2);
  });

  test('the parked window is out of the a11y tree and does not eat focus', async ({ page }) => {
    await page.goto('/app?scenario=chief-scroll-long');
    await settled(page);

    await minimize(page).click();
    await expect(drawer(page)).toBeHidden();

    // role queries go through the accessibility tree: the parked subtree's
    // controls must be unfindable (toBeHidden already pins the DOM axis)
    await expect(page.getByRole('button', { name: '最小化' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '新主题' })).toHaveCount(0);

    // keyboard focus must never enter the parked subtree: walk the page's
    // tab order and assert every stop lands outside the drawer
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(
        () => document.activeElement?.closest('.chief-drawer') != null,
      );
      expect(inside).toBe(false);
    }
  });

  test('reopen still focuses the composer (closed→open autofocus law)', async ({ page }) => {
    await page.goto('/app?scenario=chief-scroll-long');
    await settled(page);
    const composer = page.getByTestId('chief-composer-input');

    await minimize(page).click();
    await expect(drawer(page)).toBeHidden();

    await fab(page).click();
    await settled(page);
    await expect(drawer(page)).toBeVisible();
    // #389 / ADR 0013 D5: the reopen migration owns the composer focus —
    // the parked-carrier change must not stall the rAF retry loop
    await expect(composer).toBeFocused();
  });

  test('FAB is visible while the window is parked and reopens it (D4)', async ({ page }) => {
    await page.goto('/app?scenario=chief-scroll-long');
    await settled(page);

    await minimize(page).click();
    await expect(drawer(page)).toBeHidden();
    await expect(fab(page)).toBeVisible();

    await fab(page).click();
    await settled(page);
    await expect(drawer(page)).toBeVisible();
  });
});
