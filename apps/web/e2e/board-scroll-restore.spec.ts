import { expect, type Page, test } from '@playwright/test';

// #1255: opening a card and coming back drops the column list to the top.
// The scrolling element is [data-column-list] (overflow-y: auto). The
// board scroller is overflow-y: hidden and does not carry this offset.
// Leaving the board unmounts it, so the offset has to be restored on the
// way back. Esc, back, and forward must all land on the scrollTop the
// click left behind, and the card that was open stays inside the list
// viewport. The click itself can clamp scrollTop by a pixel when the
// list's scrollHeight shrinks, so the expected offset is read after the
// click, not before it.
const OVERFLOW = '/app?scenario=board-overflow';
const list = (page: Page) => page.locator('[data-column-list="todo"]');

test('detail round trip keeps the column scroll position', async ({ page }) => {
  await page.goto(OVERFLOW);
  const column = list(page);
  await column.waitFor();
  const scrolled = await column.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
    return el.scrollTop;
  });
  expect(scrolled).toBeGreaterThan(200);

  const card = page.locator('[data-column-list="todo"] [data-todo-id]').last();
  const id = await card.getAttribute('data-todo-id');
  if (id == null) throw new Error('overflow card missing');
  // DOM click, not locator.click(): Playwright scrolls the target into view
  // and that nudge is not the offset the user left. Read scrollTop in the
  // same turn as the click — navigation unmounts the list immediately after.
  const leftAt = await card.locator('a.todo-card-link').evaluate((el: HTMLAnchorElement) => {
    const listEl = el.closest('[data-column-list]');
    el.click();
    return listEl instanceof HTMLElement ? listEl.scrollTop : 0;
  });
  expect(leftAt).toBeGreaterThan(200);
  await page.waitForSelector('[data-route="todo-detail"]');

  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-route="board"]');
  await expect.poll(async () => column.evaluate((el) => el.scrollTop)).toBe(leftAt);
  expect(await cardInList(page, id)).toBe(true);

  await page.goBack();
  await page.waitForSelector('[data-route="todo-detail"]');
  await page.goBack();
  await page.waitForSelector('[data-route="board"]');
  await expect.poll(async () => column.evaluate((el) => el.scrollTop)).toBe(leftAt);

  await page.goForward();
  await page.waitForSelector('[data-route="todo-detail"]');
  await page.goForward();
  await page.waitForSelector('[data-route="board"]');
  await expect.poll(async () => column.evaluate((el) => el.scrollTop)).toBe(leftAt);
  expect(await cardInList(page, id)).toBe(true);
});

async function cardInList(page: Page, todoId: string): Promise<boolean> {
  return page.evaluate((id) => {
    const cardEl = document.querySelector(`[data-todo-id="${id}"]`);
    const listEl = document.querySelector('[data-column-list="todo"]');
    if (cardEl == null || listEl == null) return false;
    const c = cardEl.getBoundingClientRect();
    const l = listEl.getBoundingClientRect();
    return c.bottom > l.top + 1 && c.top < l.bottom - 1;
  }, todoId);
}
