import { expect, type Locator, type Page, test } from '@playwright/test';

const MATRIX = '/app?scenario=board-drag-matrix';
const card = (page: Page, id: string) => page.locator(`[data-todo-id="${id}"]`);

async function settle(locator: Locator) {
  await locator.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))),
  );
}

test('needs-you footers: state flag + action link per state, no solid buttons', async ({ page }) => {
  await page.goto(MATRIX);
  const cases = [
    { id: 'dm-failed', flag: '失败', action: '重试' },
    { id: 'dm-confirm', flag: '待确认', action: '确认计划' },
    { id: 'dm-review', flag: '待回复', action: '回复' },
  ];
  for (const c of cases) {
    const footer = card(page, c.id).locator('.todo-card-action').locator('..');
    await expect(footer).toContainText(c.flag);
    const link = card(page, c.id).getByRole('button', { name: c.action });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('data-variant', 'ghost');
    await expect(footer).toHaveCSS('border-top-style', 'dashed');
  }
  await page.goto('/app?scenario=board-tags');
  await expect(card(page, 'tagfilter-plain')).toContainText('待审阅');
  await expect(card(page, 'tagfilter-plain').getByRole('button', { name: '审阅' })).toBeVisible();
  await expect(page.locator('[data-todo-id] [data-variant="default"]')).toHaveCount(0);
});

test('queued start link: hidden at rest, shown on hover and keyboard focus, takes no height', async ({
  page,
}) => {
  await page.goto(MATRIX);
  const queued = card(page, 'dm-todo');
  await settle(queued);
  const start = queued.getByRole('button', { name: '开始' });
  await expect(start).toHaveCSS('opacity', '0');
  const meta = queued.locator('.todo-card-meta');
  const metaBox = await meta.boundingBox();
  const cardBox = await queued.boundingBox();
  if (metaBox == null || cardBox == null) throw new Error('queued card missing');
  // the meta row is the last row: card bottom = meta bottom + 12px padding
  expect(cardBox.y + cardBox.height - (metaBox.y + metaBox.height)).toBeCloseTo(12, 0);

  await queued.hover();
  await expect(start).toHaveCSS('opacity', '1');
  await page.mouse.move(0, 0);
  await expect(start).toHaveCSS('opacity', '0');

  await queued.getByRole('link').focus();
  await page.keyboard.press('Tab');
  await expect(start).toBeFocused();
  await expect(start).toHaveCSS('opacity', '1');
});

test('done card: title drops to 400 + ink-3, no footer', async ({ page }) => {
  await page.goto(MATRIX);
  const done = card(page, 'dm-done-plain');
  const title = done.locator('.todo-card-title');
  await expect(title).toHaveCSS('font-weight', '400');
  const ink3 = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.color = 'var(--text-tertiary)';
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  await expect(title).toHaveCSS('color', ink3);
  await expect(done.locator('.todo-card-action')).toHaveCount(0);
  await expect(card(page, 'dm-failed').locator('.todo-card-title')).toHaveCSS('font-weight', '500');
});

test('meta row never wraps at the 200px column floor', async ({ page }) => {
  await page.setViewportSize({ width: 1152, height: 900 });
  for (const scenario of ['board-stress', 'board-tags', 'board-drag-matrix']) {
    await page.goto(`/app?scenario=${scenario}`);
    await page.evaluate(() => document.fonts.ready);
    const heights = await page
      .getByTestId('board-scroller')
      .locator('.todo-card-meta')
      .evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().height)));
    expect(heights.length).toBeGreaterThan(0);
    for (const h of heights) expect(h).toBe(20);
  }
});

test('running footer spiral spins, and stops under reduced motion', async ({ page }) => {
  await page.goto(MATRIX);
  const running = card(page, 'dm-building');
  await expect(running).toContainText('执行中');
  const spinner = running.locator('[data-card-footer="running"] svg');
  await expect(spinner).toHaveCSS('animation-name', 'spin');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(spinner).toHaveCSS('animation-name', 'none');
});

test('column header: sans name, fixed status icon, plus only on `待开始` and it opens new task', async ({
  page,
}) => {
  await page.goto(MATRIX);
  const name = page.locator('[data-column="todo"] .board-column-name');
  const family = await name.evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toContain('inter');
  for (const id of ['todo', 'building', 'pending', 'done']) {
    await expect(page.locator(`[data-column="${id}"] header svg`).first()).toBeVisible();
  }
  const pendingIcon = page.locator('[data-column="pending"] header svg').first();
  const accent = await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.style.color = 'var(--card-button)';
    document.body.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  await expect(pendingIcon).toHaveCSS('color', accent);

  const plus = page.getByRole('button', { name: '新建任务' });
  await expect(plus).toHaveCount(1);
  await expect(plus).toHaveCSS('opacity', '0');
  await page.locator('[data-column="todo"] header').hover();
  await expect(plus).toHaveCSS('opacity', '1');
  await plus.click();
  await expect(page.getByRole('dialog', { name: '新建任务' })).toBeVisible();
});
