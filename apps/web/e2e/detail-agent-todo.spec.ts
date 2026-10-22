import { expect, test } from '@playwright/test';

const ROUTE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=agent-todo';

test('A1: the live todo card renders with all four items as card rows', async ({ page }) => {
  await page.goto(ROUTE);
  const card = page.getByTestId('agent-todo');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('md-tasks')).toHaveCount(1);
  const rows = card.getByTestId('md-task');
  await expect(rows).toHaveCount(4);
  await expect(rows.first()).toContainText('通读 poteto 的推文观点');
  await expect(card).not.toContainText('[ ]');
});

test('A2: rows carry the wire state verbatim', async ({ page }) => {
  await page.goto(ROUTE);
  const rows = page.getByTestId('agent-todo').getByTestId('md-task');
  await expect(rows.nth(0)).toHaveAttribute('data-state', 'todo');
  await expect(rows.nth(1)).toHaveAttribute('data-state', 'doing');
  await expect(rows.nth(2)).toHaveAttribute('data-state', 'done');
  await expect(rows.nth(3)).toHaveAttribute('data-state', 'todo');
});

test('A3: state glyphs differ per row (dashed circle / spinning ring / check)', async ({
  page,
}) => {
  await page.goto(ROUTE);
  const rows = page.getByTestId('agent-todo').getByTestId('md-task');
  const todoRow = rows.nth(0);
  const doingRow = rows.nth(1);
  const doneRow = rows.nth(2);

  await expect(todoRow.locator('span').first()).toHaveClass(/border-dashed/);
  await expect(doingRow.locator('span').first()).toHaveClass(/animate-spin/);
  await expect(doneRow.locator('svg')).toHaveCount(1);

  const doneInk = await doneRow.locator('span').nth(1).evaluate((el) => getComputedStyle(el).color);
  const todoInk = await todoRow.locator('span').nth(1).evaluate((el) => getComputedStyle(el).color);
  expect(doneInk).not.toBe(todoInk);
  const doneDecoration = await doneRow
    .locator('span')
    .nth(1)
    .evaluate((el) => getComputedStyle(el).textDecorationLine);
  expect(doneDecoration).toContain('line-through');
});

test('A4: the live card sits above the streaming row in the live tail', async ({ page }) => {
  await page.goto(ROUTE);
  const card = page.getByTestId('agent-todo');
  const live = page.getByTestId('live-row');
  await expect(card).toBeVisible();
  await expect(live).toBeVisible();
  await expect(live).toContainText('模型思考中...');
  const cardBox = await card.boundingBox();
  const liveBox = await live.boundingBox();
  expect(cardBox).not.toBeNull();
  expect(liveBox).not.toBeNull();
  expect(cardBox!.y).toBeLessThan(liveBox!.y);
});

test('A5: the inline markdown card surface is unchanged without an agent-todo item', async ({
  page,
}) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=md-toolout');
  await expect(page.getByTestId('agent-todo')).toHaveCount(0);
  await expect(page.getByTestId('md-tasks')).toHaveCount(1);
});
