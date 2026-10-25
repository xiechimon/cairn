import { expect, type Page, test } from '@playwright/test';

const STRESS = '/app?scenario=board-stress';
const NATURAL_FLOOR = 200;

const ZOOM_LEVELS = [
  { zoom: '110%', width: 1309 },
  { zoom: '120%', width: 1200 },
];

const drawer = (page: Page) => page.locator('.chief-drawer');
const scroller = (page: Page) => page.getByTestId('board-scroller');

function measure(page: Page) {
  return scroller(page).evaluate((el) => {
    const s = el.getBoundingClientRect();
    return {
      scroller: { left: s.left, right: s.right, width: s.width },
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      scrollLeft: el.scrollLeft,
      columns: [...el.querySelectorAll('[data-column]')].map((c) => {
        const r = c.getBoundingClientRect();
        return {
          id: c.getAttribute('data-column'),
          left: r.left,
          right: r.right,
          width: r.width,
        };
      }),
    };
  });
}

const pageSpill = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('natural-state board fits the zoomed-out-equivalent viewports (#1035)', () => {
  for (const { zoom, width } of ZOOM_LEVELS) {
    test(`no horizontal scroll at ${zoom} zoom (${width}px CSS viewport), all 4 columns whole`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 732 });
      await page.goto(STRESS);
      await page.waitForSelector('[data-column]');

      const m = await measure(page);
      expect(m.columns).toHaveLength(4);
      expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
      const last = m.columns[3]!;
      expect(last.right).toBeLessThanOrEqual(m.scroller.right + 1);

      for (const c of m.columns) expect(c.width).toBeGreaterThanOrEqual(NATURAL_FLOOR - 1);

      expect(await pageSpill(page)).toBeLessThanOrEqual(0);
    });
  }

  test('125% zoom (1152): 248 sidebar keeps the flow above the floor — four columns fit', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1152, height: 732 });
    await page.goto(STRESS);
    await page.waitForSelector('[data-column]');
    const m = await measure(page);
    for (const c of m.columns) expect(c.width).toBeGreaterThanOrEqual(NATURAL_FLOOR - 1);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
    expect(await pageSpill(page)).toBeLessThanOrEqual(0);
  });

  test('natural floor still holds at 1024: honest scroll instead of collapsed columns', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 732 });
    await page.goto(STRESS);
    await page.waitForSelector('[data-column]');

    const m = await measure(page);
    for (const c of m.columns) expect(c.width).toBeGreaterThanOrEqual(NATURAL_FLOOR - 1);
    expect(m.scrollWidth).toBeGreaterThan(m.clientWidth);
    expect(await pageSpill(page)).toBeLessThanOrEqual(0);
  });

  test('the floating window never re-arms a docked floor (yield retired, ADR 0013 D1)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1309, height: 732 });
    await page.goto(STRESS);
    await page.waitForSelector('[data-column]');
    const natural = await measure(page);
    expect(natural.scrollWidth).toBeLessThanOrEqual(natural.clientWidth);

    await page.keyboard.press('Meta+j');
    await expect(drawer(page)).toBeVisible();
    await drawer(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const open = await measure(page);
    expect(open.scrollWidth).toBeLessThanOrEqual(open.clientWidth);
    for (const c of open.columns) expect(c.width).toBeGreaterThanOrEqual(NATURAL_FLOOR - 1);
    expect(open.columns.map((c) => Math.round(c.width))).toEqual(
      natural.columns.map((c) => Math.round(c.width)),
    );

    await drawer(page).getByRole('button', { name: '最小化' }).click();
    await expect(drawer(page)).toBeHidden();
    const restored = await measure(page);
    expect(restored.scrollWidth).toBeLessThanOrEqual(restored.clientWidth);
    for (const c of restored.columns) expect(c.width).toBeGreaterThanOrEqual(NATURAL_FLOOR - 1);
    expect(await pageSpill(page)).toBeLessThanOrEqual(0);
  });

  test('worst-case card data stays in-column at the 125% boundary width', async ({ page }) => {
    await page.setViewportSize({ width: 1152, height: 732 });
    await page.goto(STRESS);
    await page.waitForSelector('[data-todo-id]');

    const card = page.locator('[data-column="todo"] [data-todo-id]').first();
    const overflow = await card.evaluate((el) => ({
      spill: el.scrollWidth - el.clientWidth,
      titleSpill: (() => {
        const t = el.querySelector('h3');
        return t == null ? 0 : t.scrollWidth - t.clientWidth;
      })(),
    }));
    expect(overflow.spill).toBeLessThanOrEqual(1);
    expect(overflow.titleSpill).toBeLessThanOrEqual(1);
  });
});
