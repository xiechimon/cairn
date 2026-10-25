import { expect, test } from '@playwright/test';

test('needs-you strip lists the pending cards, opens a task, and stays out of the needs-me view', async ({
  page,
}) => {
  await page.goto('/app?scenario=01');
  const strip = page.getByTestId('needs-you-strip');
  const pendingCards = page.locator('.board-column[data-column="pending"] .todo-card-title');
  await expect(strip).toBeVisible();
  const rows = strip.getByRole('link', { name: '打开' });
  await expect(rows).toHaveCount(await pendingCards.count());
  await expect(strip).toContainText((await pendingCards.first().textContent()) ?? '');
  await rows.first().click();
  await expect(page).toHaveURL(/\/app\/todo\/[^/?]+/);

  await page.goto('/app?scenario=01&column=pending');
  await expect(page.getByTestId('needs-you-strip')).toBeHidden();

  await page.goto('/app?scenario=board-tags-empty');
  await expect(page.getByTestId('needs-you-strip')).toBeHidden();
});

test('since-last-seen counts tasks finished after the stored visit and hides when nothing changed', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('cairn.board.lastSeenAt', '0'));
  await page.goto('/app?scenario=01');
  await expect(page.getByTestId('board-since-last-seen')).toContainText(/[1-9]\d* 个完成/);

  await page.addInitScript(() =>
    localStorage.setItem('cairn.board.lastSeenAt', String(Date.now() + 60_000)),
  );
  await page.goto('/app?scenario=01');
  await expect(page.getByTestId('board-since-last-seen')).toBeHidden();
});

test('the new-task bar opens the existing new-task surface', async ({ page }) => {
  await page.goto('/app?scenario=01');
  await page.getByTestId('board-new-task-bar').click();
  await expect(page.getByRole('dialog', { name: '新建任务' })).toBeVisible();
});

test('a 390px board stacks non-empty columns tightly with no horizontal scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app?scenario=01');
  const scroller = page.getByTestId('board-scroller');
  await expect(scroller.locator('.todo-card-title').first()).toBeVisible();
  const metrics = await scroller.evaluate((element) => {
    const shown = [...element.querySelectorAll<HTMLElement>('.board-column')].filter(
      (column) => getComputedStyle(column).display !== 'none',
    );
    const gaps = shown.slice(1).map((column, i) => {
      const above = shown[i].getBoundingClientRect();
      const lastCard = [...shown[i].querySelectorAll('.todo-card-title')].pop()?.closest('[class*="group/card"]');
      const bottom = lastCard?.getBoundingClientRect().bottom ?? above.bottom;
      return column.getBoundingClientRect().top - bottom;
    });
    return {
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      shown: shown.map((column) => column.dataset.column),
      emptyShown: shown.filter((column) => column.querySelector('.todo-card-title') == null).length,
      gaps,
    };
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.emptyShown).toBe(0);
  expect(metrics.shown.length).toBeGreaterThan(1);
  for (const gap of metrics.gaps) expect(gap).toBeLessThan(48);
  await expect(page.locator('[data-column-empty-new]')).toBeHidden();
});

test('a 390px needs-you row shows the whole title and keeps its actions on screen', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app?scenario=01');
  const row = page.getByTestId('needs-you-row').first();
  await expect(row).toBeVisible();
  const fit = await row.evaluate((element) => {
    const title = element.querySelector<HTMLElement>('.line-clamp-2')!;
    const rowBox = element.getBoundingClientRect();
    return {
      clipped: title.scrollHeight > title.clientHeight + 1 || title.scrollWidth > title.clientWidth + 1,
      buttonsInside: [...element.querySelectorAll('button, a')].every((control) => {
        const box = control.getBoundingClientRect();
        return box.left >= rowBox.left && box.right <= rowBox.right;
      }),
    };
  });
  expect(fit.clipped).toBe(false);
  expect(fit.buttonsInside).toBe(true);
});

test('a short phone screen scrolls the strip away to reach the last board group', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 640 });
  await page.goto('/app?scenario=board-drag-matrix');
  await expect(page.getByTestId('needs-you-strip')).toBeVisible();
  const lastCard = page.locator('.board-column[data-column="done"] .todo-card-title').last();
  await lastCard.scrollIntoViewIfNeeded();
  const box = await lastCard.boundingBox();
  const bar = await page.getByTestId('board-new-task-bar').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y);
  const stripTop = await page.getByTestId('needs-you-strip').evaluate((el) => el.getBoundingClientRect().top);
  expect(stripTop).toBeLessThan(0);
});

test('the phone chief launcher clears the new-task bar on the board and sits in the corner elsewhere', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app?scenario=01');
  const onBoard = await page.locator('.chief-fab').boundingBox();
  const bar = await page.getByTestId('board-new-task-bar').boundingBox();
  expect(onBoard!.y + onBoard!.height).toBeLessThanOrEqual(bar!.y);
  await page.goto('/app/schedules?scenario=11');
  const elsewhere = await page.locator('.chief-fab').boundingBox();
  expect(844 - (elsewhere!.y + elsewhere!.height)).toBeLessThan(16);
});
