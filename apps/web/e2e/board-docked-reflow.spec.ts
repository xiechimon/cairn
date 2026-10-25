import { expect, type Page, test } from '@playwright/test';

const STRESS = '/app?scenario=board-stress';
const FLOOR = 200;

const drawer = (page: Page) => page.locator('.chief-drawer');
const scroller = (page: Page) => page.getByTestId('board-scroller');

async function openWindow(page: Page) {
  await page.keyboard.press('Meta+j');
  await expect(drawer(page)).toBeVisible();
  await drawer(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

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

const roundCols = (m: Awaited<ReturnType<typeof measure>>) =>
  m.columns.map((c) => ({ id: c.id, left: Math.round(c.left), width: Math.round(c.width) }));

test.describe('board never reflows under the floating chief window (ADR 0013 D1)', () => {
  test('window open leaves the 1440 columns at their closed geometry', async ({ page }) => {
    await page.goto(STRESS);
    await page.waitForSelector('[data-column]');
    const closed = await measure(page);
    expect(closed.columns).toHaveLength(4);
    expect(closed.scrollWidth).toBeLessThanOrEqual(closed.clientWidth);

    await openWindow(page);
    const open = await measure(page);

    expect(roundCols(open)).toEqual(roundCols(closed));
    expect(open.scrollWidth).toBeLessThanOrEqual(open.clientWidth);
    for (const c of open.columns) expect(c.width).toBeGreaterThanOrEqual(FLOOR - 1);
  });

  test('narrowest usable viewport (1024): honest scroll identical open and closed', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 732 });
    await page.goto(STRESS);
    await page.waitForSelector('[data-column]');
    const closed = await measure(page);

    expect(closed.scrollWidth).toBeGreaterThan(closed.clientWidth);
    for (const c of closed.columns) expect(c.width).toBeGreaterThanOrEqual(FLOOR - 1);

    await openWindow(page);
    const open = await measure(page);

    expect(roundCols(open)).toEqual(roundCols(closed));
    expect(open.scrollWidth).toBeGreaterThan(open.clientWidth);
    const pageSpill = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(pageSpill).toBeLessThanOrEqual(0);
  });

  test('overflow stays reachable while the window is open', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 732 });
    await page.goto(STRESS);
    await page.waitForSelector('[data-column]');
    await openWindow(page);

    const box = await scroller(page).boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 40);
    await page.mouse.wheel(300, 0);
    await expect
      .poll(async () => (await measure(page)).scrollLeft, { timeout: 2000 })
      .toBeGreaterThan(0);

    await scroller(page).evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    const end = await measure(page);
    const last = end.columns[3]!;

    expect(last.right).toBeLessThanOrEqual(end.scroller.right + 1);
    expect(last.left).toBeGreaterThanOrEqual(end.scroller.left - 1);
    expect(last.width).toBeGreaterThanOrEqual(FLOOR - 1);
  });

  test('overflow discloses itself while the window is open: scrollbar stays native', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 732 });
    await page.goto(STRESS);
    await page.waitForSelector('[data-column]');
    await openWindow(page);

    await expect(scroller(page)).toHaveCSS('scrollbar-width', 'auto');
  });

  test('cards keep their exact width across window open/close', async ({ page }) => {
    await page.goto(STRESS);
    await page.waitForSelector('[data-todo-id]');
    const resting = await page
      .locator('[data-column="todo"] [data-todo-id]')
      .first()
      .boundingBox();
    expect(resting).not.toBeNull();
    await openWindow(page);
    const open = await page
      .locator('[data-column="todo"] [data-todo-id]')
      .first()
      .boundingBox();
    expect(open).not.toBeNull();

    expect(Math.abs(open!.width - resting!.width)).toBeLessThanOrEqual(1);
  });

  test('worst-case data holds while the window is open', async ({ page }) => {
    await page.goto(STRESS);
    await page.waitForSelector('[data-todo-id]');
    await openWindow(page);

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

    const header = page.locator('[data-column="building"] header');
    await expect(header).toContainText('120');
    const headSpill = await header.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(headSpill).toBeLessThanOrEqual(1);

    const m = await measure(page);
    const pending = m.columns.find((c) => c.id === 'pending');
    expect(pending).toBeDefined();
    expect(pending!.width).toBeGreaterThanOrEqual(FLOOR - 1);
    await expect(
      page.locator('[data-column="pending"]').getByText('没有等你处理的事', { exact: true }),
    ).toBeVisible();
  });

  test('RTL mirror: the first column stays whole at the scroll-start edge while open', async ({
    page,
  }) => {
    await page.goto(STRESS);
    await page.waitForSelector('[data-column]');

    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    await openWindow(page);

    const m = await measure(page);
    const byId = Object.fromEntries(m.columns.map((c) => [c.id, c]));

    expect(byId.todo!.right).toBeLessThanOrEqual(m.scroller.right + 1);
    expect(byId.todo!.right - byId.todo!.left).toBeGreaterThanOrEqual(FLOOR - 1);
    expect(byId.todo!.left).toBeGreaterThan(byId.building!.left);
    expect(byId.building!.left).toBeGreaterThan(byId.pending!.left);
    expect(byId.pending!.left).toBeGreaterThan(byId.done!.left);
  });

  test('resting geometry at 1440 is untouched by the floor token', async ({ page }) => {
    await page.goto('/app?scenario=01');
    await page.waitForSelector('[data-column]');

    const m = await measure(page);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
    expect(m.columns).toHaveLength(4);
    const first = m.columns[0]!.width;
    expect(first).toBeGreaterThan(FLOOR);
    expect(first).toBeLessThan(282);
    for (const c of m.columns) expect(Math.abs(c.width - first)).toBeLessThanOrEqual(1);
  });
});
