import { expect, test } from '@playwright/test';

test('home splits work into needs-you, running and done, and folds week-old and not-started cards', async ({
  page,
}) => {
  await page.goto('/app?scenario=board-inbox');
  const needsYou = page.getByTestId('home-needs-you');
  const running = page.getByTestId('home-running');
  const done = page.getByTestId('home-done');
  await expect(needsYou.getByTestId('home-section-count')).toHaveText('4');
  await expect(needsYou.getByTestId('needs-you-row')).toHaveCount(4);
  await expect(page.getByTestId('needs-you')).toHaveCount(0);
  await needsYou.getByTestId('needs-you-stale').getByRole('button').click();
  await expect(needsYou.getByTestId('needs-you-row')).toHaveCount(9);

  await expect(running.getByTestId('home-section-count')).toHaveText('1');
  await expect(running.getByTestId('home-running-row')).toContainText('执行中');
  await expect(running.getByTestId('home-not-started-row')).toHaveCount(0);
  await running.getByTestId('home-not-started').getByRole('button').click();
  await expect(running.getByTestId('home-not-started-row').getByRole('button', { name: '开始' })).toBeVisible();

  await expect(done.getByTestId('home-section-count')).toHaveText('4');
  await expect(done.getByTestId('home-done-row')).toHaveCount(4);
  await expect(done.getByTestId('home-done-row').filter({ hasText: '已取消' })).toHaveCount(1);
  await done.getByTestId('home-open-board').click();
  await expect(page).toHaveURL(/[?&]view=board/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('看板');
});

test('a project filter keeps home; a filter that matches nothing shows the filter-empty state', async ({
  page,
}) => {
  await page.goto('/app?scenario=board-repos&projects=r2-inventory');
  await expect(page.getByTestId('home-sections')).toBeVisible();
  await expect(page.locator('[data-column]')).toHaveCount(0);
  await expect(page.getByRole('complementary').getByRole('link', { name: /工作台/ })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.goto('/app?scenario=board-repos&projects=no-such-project');
  await expect(page.getByTestId('home-sections')).toHaveCount(0);
  await expect(page.getByText('没有匹配筛选条件的任务')).toBeVisible();
});

test('the needs-me inbox lists recent pending cards as rows and folds week-old ones', async ({
  page,
}) => {
  await page.goto('/app?scenario=board-inbox&view=board');
  await expect(page.getByTestId('needs-you-strip')).toHaveCount(0);
  const pendingColumn = page.locator('.board-column[data-column="pending"]');
  await expect(pendingColumn.getByTestId('column-count')).toHaveText('4');
  await expect(page.getByTestId('needs-you')).toHaveText('4 项等你处理');
  await expect(page.getByTestId('attention-badge')).toHaveText('4');
  await pendingColumn.getByTestId('column-stale-pending').click();
  await expect(page).toHaveURL(/[?&]column=pending/);

  const inbox = page.getByTestId('needs-you-inbox');
  const rows = inbox.getByTestId('needs-you-row');
  await expect(rows).toHaveCount(4);
  for (const row of await rows.all()) await expect(row.getByRole('button')).toHaveCount(1);
  const stale = inbox.getByTestId('needs-you-stale').getByRole('button', { name: /较早的 5 条/ });
  await expect(stale).toHaveAttribute('aria-expanded', 'false');
  await stale.click();
  await expect(rows).toHaveCount(9);
  await expect(inbox).toContainText('16 天前');

  await rows.first().getByRole('link').click();
  await expect(page).toHaveURL(/\/app\/todo\/[^/?]+/);
});

test('the needs-me inbox shares its edges with the new-task bar', async ({ page }) => {
  await page.goto('/app?scenario=board-inbox&column=pending');
  const list = await page.getByTestId('needs-you-row').first().evaluate((el) => {
    const box = el.parentElement!.getBoundingClientRect();
    return { left: box.left, right: box.right };
  });
  const bar = (await page.getByTestId('board-new-task-bar').boundingBox())!;
  expect(Math.abs(list.left - bar.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(list.right - (bar.x + bar.width))).toBeLessThanOrEqual(1);
});

test('since-last-seen counts tasks finished after the stored visit and hides when nothing changed', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('cairn.board.lastSeenAt', '0'));
  await page.goto('/app?scenario=01&view=board');
  await expect(page.getByTestId('board-since-last-seen')).toContainText(/[1-9]\d* 个完成/);

  await page.addInitScript(() =>
    localStorage.setItem('cairn.board.lastSeenAt', String(Date.now() + 60_000)),
  );
  await page.goto('/app?scenario=01&view=board');
  await expect(page.getByTestId('board-since-last-seen')).toBeHidden();
});

test('the new-task bar opens the existing new-task surface', async ({ page }) => {
  await page.goto('/app?scenario=01&view=board');
  await page.getByTestId('board-new-task-bar').click();
  await expect(page.getByRole('dialog', { name: '新建任务' })).toBeVisible();
});

test('a 390px board stacks non-empty columns tightly with no horizontal scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app?scenario=01&view=board');
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
  await page.goto('/app?scenario=board-inbox&column=pending');
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

  await page.getByTestId('needs-you-stale').getByRole('button').click();
  const lastRow = page.getByTestId('needs-you-row').last();
  await page.locator('.board-main').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  const rowBox = (await lastRow.boundingBox())!;
  const bar = (await page.getByTestId('board-new-task-bar').boundingBox())!;
  expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(bar.y);
});

test('a 390px home scrolls as one page down to its last row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app?scenario=board-inbox');
  await page.getByTestId('chief-home').evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect(page.getByTestId('home-done-row').last()).toBeInViewport();
});

test('a short phone screen scrolls the board as one page to reach the last group', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 640 });
  await page.goto('/app?scenario=board-drag-matrix&view=board');
  const lastCard = page.locator('.board-column[data-column="done"] .todo-card-title').last();
  await lastCard.scrollIntoViewIfNeeded();
  const box = await lastCard.boundingBox();
  const bar = await page.getByTestId('board-new-task-bar').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(bar!.y);
  const pageScroll = await page.locator('.board-main').evaluate((el) => el.scrollTop);
  expect(pageScroll).toBeGreaterThan(0);
});

test('the phone chief launcher clears the new-task bar on the board and sits in the corner elsewhere', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/app?scenario=01&view=board');
  const onBoard = await page.locator('.chief-fab').boundingBox();
  const bar = await page.getByTestId('board-new-task-bar').boundingBox();
  expect(onBoard!.y + onBoard!.height).toBeLessThanOrEqual(bar!.y);
  await page.goto('/app/schedules?scenario=11');
  const elsewhere = await page.locator('.chief-fab').boundingBox();
  expect(844 - (elsewhere!.y + elsewhere!.height)).toBeLessThan(16);
});
