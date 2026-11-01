import { expect, test } from '@playwright/test';

test('a project filter keeps home; a filter that matches nothing counts nothing', async ({
  page,
}) => {
  await page.goto('/app?scenario=board-repos&project=r2-inventory');
  await expect(page.getByTestId('home-c')).toBeVisible();
  await expect(page.locator('[data-column]')).toHaveCount(0);
  await expect(page.getByRole('complementary').locator('[data-slot="sidebar-nav-row"]', { hasText: '工作台' })).toHaveAttribute(
    'aria-current',
    'page',
  );

  await page.goto('/app?scenario=board-repos&project=no-such-project');
  await expect(page.getByTestId('home-c-since')).toContainText('0 项待你处理 · 0 件在进行');
  await expect(page.getByTestId('needs-you')).toHaveCount(0);
  await expect(page.getByTestId('in-progress-pill')).toHaveCount(0);
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
  await expect(page).toHaveURL(/\/app\/todo\/[^?]+/);
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

for (const viewport of [{ width: 1440, height: 732 }, { width: 390, height: 844 }]) {
  for (const theme of ['light', 'dark']) {
    test(`home and detail share a 24px composer bottom gap at ${viewport.width}px in ${theme}`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport);
      await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
      const gaps: number[] = [];
      for (const route of [
        { name: 'home', url: '/app?scenario=board-inbox', selector: '[data-testid="home-c"] .chief-composer' },
        { name: 'detail', url: '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=17b', selector: '[data-testid="composer-card"]' },
      ]) {
        await page.goto(route.url);
        const composer = page.locator(route.selector);
        await expect(composer).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const gap = await composer.evaluate((element) => window.innerHeight - element.getBoundingClientRect().bottom);
        gaps.push(gap);
        console.log(`${viewport.width}px ${theme} ${route.name}: ${gap}px`);
        const screenshot = testInfo.outputPath(`${route.name}-${viewport.width}-${theme}.png`);
        await page.screenshot({ path: screenshot });
        await testInfo.attach(route.name, { path: screenshot, contentType: 'image/png' });
      }
      for (const gap of gaps) {
        expect.soft(gap).toBeGreaterThanOrEqual(20);
        expect.soft(gap).toBeCloseTo(24, 0);
      }
      expect(Math.abs(gaps[0] - gaps[1])).toBeLessThanOrEqual(1);
    });
  }
}
