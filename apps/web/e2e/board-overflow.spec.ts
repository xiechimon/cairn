import { expect, type Page, test } from '@playwright/test';

const OVERFLOW = '/app?scenario=board-overflow';
const list = (page: Page, column = 'todo') => page.locator(`[data-column-list="${column}"]`);

test('overflow column bottom does not exit the viewport: column hugs the scroller visible height (row height pinned)', async ({ page }) => {
  await page.goto(OVERFLOW);
  const probe = await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="board-scroller"]');
    const column = document.querySelector('[data-column="todo"]');
    if (scroller == null || column == null) return null;
    const s = scroller.getBoundingClientRect();
    const c = column.getBoundingClientRect();
    return { scrollerBottom: s.bottom, columnBottom: c.bottom, columnTop: c.top, scrollerTop: s.top };
  });
  expect(probe).not.toBeNull();

  expect(probe!.columnBottom).toBeLessThanOrEqual(probe!.scrollerBottom + 1);

  expect(probe!.columnTop).toBeGreaterThanOrEqual(probe!.scrollerTop - 1);
});

test('card list has a scroll exit: scrollHeight > clientHeight and the container scrolls', async ({ page }) => {
  await page.goto(OVERFLOW);
  const metrics = await list(page).evaluate((el) => ({
    scrollHeight: el.scrollHeight,
    clientHeight: el.clientHeight,
    overflowY: getComputedStyle(el).overflowY,
  }));

  expect(metrics.overflowY).toBe('auto');
  expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight);
});

test('list scrollable: scrollTo moves scrollTop, wheel works too', async ({ page }) => {
  await page.goto(OVERFLOW);
  const before = await list(page).evaluate((el) => el.scrollTop);
  await list(page).evaluate((el) => el.scrollTo({ top: 400 }));
  const after = await list(page).evaluate((el) => el.scrollTop);
  expect(after).toBeGreaterThan(before);

  const box = await list(page).boundingBox();
  if (box == null) throw new Error('overflow list missing');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await list(page).evaluate((el) => el.scrollTo({ top: 0 }));
  await page.mouse.wheel(0, 240);
  await expect
    .poll(async () => list(page).evaluate((el) => el.scrollTop), { timeout: 2000 })
    .toBeGreaterThan(0);
});

test('column header pinned: header viewport position stays put while the list scrolls', async ({ page }) => {
  await page.goto(OVERFLOW);
  const header = page.locator('[data-column="todo"] header');
  const before = (await header.boundingBox())!.y;
  await list(page).evaluate((el) => el.scrollTo({ top: 400 }));
  const after = (await header.boundingBox())!.y;
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
});

test('card top/bottom edges held by block padding: first card top edge and scrolled-to-bottom last card bottom edge do not touch the clip line', async ({ page }) => {
  await page.goto(OVERFLOW);

  await page
    .locator('.todo-card')
    .first()
    .evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const listEl = list(page);

  const top = await page.evaluate(() => {
    const l = document.querySelector('[data-column-list="todo"]');
    const c = document.querySelector('[data-column="todo"] [data-todo-id]');
    if (l == null || c == null) return null;
    return { gap: c.getBoundingClientRect().top - l.getBoundingClientRect().top };
  });
  expect(top).not.toBeNull();
  expect(top!.gap).toBeGreaterThanOrEqual(1);

  const bottom = await page.evaluate(() => {
    const l = document.querySelector('[data-column-list="todo"]');
    if (l == null) return null;
    l.scrollTo({ top: l.scrollHeight });
    const cards = l.querySelectorAll('[data-todo-id]');
    const last = cards[cards.length - 1];
    if (last == null) return null;
    return {
      gap: l.getBoundingClientRect().bottom - last.getBoundingClientRect().bottom,
      scrollTop: l.scrollTop,
    };
  });
  expect(bottom).not.toBeNull();
  expect(bottom!.scrollTop).toBeGreaterThan(0);
  expect(bottom!.gap).toBeGreaterThanOrEqual(1);
});

test('legacy scenario zero drift: 01 column hugs the viewport, column bottom does not pass the scroller bottom edge', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const probe = await page.evaluate(() => {
    const scroller = document.querySelector('[data-testid="board-scroller"]');
    const columns = [...document.querySelectorAll('[data-column]')];
    if (scroller == null || columns.length !== 4) return null;
    const s = scroller.getBoundingClientRect();
    return {
      scrollerBottom: s.bottom,
      bottoms: columns.map((c) => c.getBoundingClientRect().bottom),
      heights: columns.map((c) => c.getBoundingClientRect().height),
    };
  });
  expect(probe).not.toBeNull();
  for (const bottom of probe!.bottoms) {
    expect(bottom).toBeLessThanOrEqual(probe!.scrollerBottom + 1);
  }

  const first = probe!.heights[0]!;
  for (const h of probe!.heights) expect(Math.abs(h - first)).toBeLessThanOrEqual(1);
});
