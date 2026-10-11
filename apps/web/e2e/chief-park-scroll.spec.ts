import { expect, type Page, test } from '@playwright/test';

// #1067: the chief window's parked (minimized) carrier changed from
// display:none to inert/opacity-0 (Multica's real form). Base UI keepMounted
// parks the closed popup with the `hidden` attribute, and browsers do not
// preserve scrollTop across display:none — so "minimize keeps the scroll
// position" was physically unreachable on that carrier (#1009 A1 verdict 2).
// This spec pins the new carrier contract:
//
//   1. scroll-position survival: scroll to the middle, minimize, reopen —
//      the viewport must land where it was (pre-fix it resets to the
//      default position; on this fixture the reopen face lands at the end
//      because defaultScrollPosition="end" re-arms when the scroller remounts
//      its layout under display:none — scrollTop is dropped to 0 and the
//      jump-to-latest law re-runs on open).
//   2. parked window takes no keyboard focus: Tab never enters the parked
//      subtree (inert is asserted as a DOM attribute, and the focus walk is
//      exercised against the page behind).
//   3. parked window is not in the accessibility tree: aria-hidden is set on
//      the carrier while parked (assertable, not "looks like").
//   4. parked window is not visible and not clickable: opacity-0 +
//      visibility/pointer-events neutralization (a parked window must not eat
//      a click aimed at the page under it, and must not flash on reopen).
//   5. entry/exit animation still rides the data-open/data-closed states
//      (the carrier swap must not regress the D7 fade+zoom legs).

const drawer = (page: Page) => page.locator('.chief-drawer');
const body = (page: Page) => page.getByTestId('chief-body');

test.describe('chief parked-window carrier (#1067)', () => {
  test('minimize preserves the scroll position', async ({ page }) => {
    await page.goto('/app?scenario=chief-scroll-park');
    await expect(drawer(page)).toBeVisible();

    // the stream overflows the window
    const geom = await body(page).evaluate((el) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
    }));
    expect(geom.scrollHeight).toBeGreaterThan(geom.clientHeight + 500);

    // scroll to the middle (not 0, not the end) — real wheel input, not a
    // programmatic scrollTo: the scroller's follow law disarms ("reader
    // scrolled away from the edge") on user-intent scroll events, which is
    // the face a human minimize actually rides on
    const winBox = await drawer(page).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    for (let i = 0; i < 14; i++) {
      await page.mouse.wheel(
        winBox.x + winBox.width / 2,
        winBox.y + winBox.height / 2,
        { deltaY: 120 },
      );
      await page.waitForTimeout(30);
    }
    // let the scroller's own scroll-state settle
    await page.waitForTimeout(250);
    const before = await body(page).evaluate((el) => el.scrollTop);
    expect(before).toBeGreaterThan(200);
    expect(before).toBeLessThan(geom.scrollHeight - geom.clientHeight - 200);

    // minimize (the only close action, ADR 0013 D3)
    await page.locator('button[aria-label="最小化"]').click();
    await expect(drawer(page)).toBeHidden();

    // the carrier must NOT be display:none while parked — that is the whole
    // point of the swap: scrollTop physically survives only on a rendered box
    const parkedDisplay = await drawer(page).evaluate(
      (el) => getComputedStyle(el).display,
    );
    expect(parkedDisplay).not.toBe('none');

    // reopen: lands where it was, not at the default end position
    await page.locator('.chief-fab').click();
    await expect(drawer(page)).toBeVisible();
    // wait out the entry animation before reading geometry
    await page.waitForTimeout(400);
    const after = await body(page).evaluate((el) => el.scrollTop);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(8);
  });

  test('parked window is inert, aria-hidden, invisible and unclickable', async ({
    page,
  }) => {
    await page.goto('/app?scenario=chief-scroll-park');
    await expect(drawer(page)).toBeVisible();
    await page.locator('button[aria-label="最小化"]').click();
    await expect(drawer(page)).toBeHidden();

    const parked = await drawer(page).evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        inert: el.inert,
        ariaHidden: el.getAttribute('aria-hidden'),
        display: cs.display,
        visibility: cs.visibility,
        opacity: cs.opacity,
        pointerEvents: cs.pointerEvents,
      };
    });
    // focus + a11y tree: the carrier itself carries both signals
    expect(parked.inert).toBe(true);
    expect(parked.ariaHidden).toBe('true');
    // visual + hit-test: no painted pixels, no eaten clicks
    expect(parked.display).not.toBe('none'); // the scroll-preserving carrier
    expect(parked.visibility).toBe('hidden');
    expect(parked.opacity).toBe('0');
    expect(parked.pointerEvents).toBe('none');
  });

  test('Tab never enters the parked window', async ({ page }) => {
    await page.goto('/app?scenario=chief-scroll-park');
    await expect(drawer(page)).toBeVisible();
    await page.locator('button[aria-label="最小化"]').click();
    await expect(drawer(page)).toBeHidden();

    // the composer textarea is the first focusable inside the window —
    // walk the page's tab order from the body; it must never receive focus
    const composer = page.getByTestId('chief-composer-input');
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      await expect(composer).not.toBeFocused();
    }
  });

  test('the parked window does not eat a click aimed at the page under it', async ({
    page,
  }) => {
    await page.goto('/app?scenario=chief-scroll-park');
    await expect(drawer(page)).toBeVisible();
    // park with the pointer parked over the window's screen area
    await page.locator('button[aria-label="最小化"]').click();
    await expect(drawer(page)).toBeHidden();

    // the window occupies the bottom-right 380x600 of the viewport; click the
    // board face inside that region — pointer-events:none + visibility:hidden
    // must let it through to the page (no open-on-click, no swallowed click)
    const box = await drawer(page).evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    const beforeOpen = await drawer(page).evaluate(
      (el) => el.getAttribute('aria-hidden') === 'true',
    );
    expect(beforeOpen).toBe(true);
    // click dead-center of the parked window's box
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(drawer(page)).toBeHidden();
    // sanity: the click landed on the page, not on the parked carrier — the
    // page's active element chain must not include the drawer subtree
    const focusInside = await page.evaluate(
      () => document.activeElement?.closest('.chief-drawer') != null,
    );
    expect(focusInside).toBe(false);
  });

  test('entry and exit animations still ride data-open/data-closed', async ({
    page,
  }) => {
    await page.goto('/app?scenario=chief-scroll-park');
    const win = drawer(page);
    await expect(win).toBeVisible();
    // open state carries the data-open attribute (the animate-in leg's hook)
    await expect(win).toHaveAttribute('data-open', '');

    await page.locator('button[aria-label="最小化"]').click();
    // closed state carries data-closed while the exit animation runs
    await expect(win).toHaveAttribute('data-closed', '');
    // …and after the exit leg + the park, the carrier stays parked (hidden
    // per Playwright's visibility model) but mounted
    await expect(win).toBeHidden();
    await expect(win).toHaveCount(1);
  });
});
