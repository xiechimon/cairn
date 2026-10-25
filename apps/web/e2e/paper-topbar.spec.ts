import { expect, type Page, test } from '@playwright/test';

const topbar = (page: Page) => page.locator('[data-route="board"] header').first();
const summary = (page: Page) => topbar(page).getByTestId('needs-you');
const pendingCount = (page: Page) =>
  page.locator('.board-column[data-column="pending"]').getByTestId('column-count');
const filterBtn = (page: Page) => topbar(page).getByRole('button', { name: '筛选', exact: true });
const schedulesLink = (page: Page) => topbar(page).getByRole('link', { name: '定时' });
const newTaskButton = (page: Page) => topbar(page).getByRole('button', { name: '新任务' });

test('bar geometry: 56px, serif page title, summary N = the `待处理` column count', async ({
  page,
}) => {
  await page.goto('/app?scenario=01');
  const box = await topbar(page).boundingBox();
  expect(box?.height).toBe(56);

  const title = topbar(page).getByRole('heading', { level: 1 });
  await expect(title).toHaveText('工作台');
  const titleStyle = await title.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { family: cs.fontFamily, weight: cs.fontWeight };
  });
  expect(titleStyle.family).toContain('sourceSerif4');
  expect(titleStyle.weight).toBe('500');

  const n = Number(await pendingCount(page).textContent());
  expect(n).toBeGreaterThan(0);
  await expect(summary(page)).toHaveText(`${n} 项等你处理`);
  const countWeight = await summary(page)
    .getByText(String(n), { exact: true })
    .evaluate((el) => getComputedStyle(el).fontWeight);
  expect(countWeight).toBe('600');
});

test('N = 0 reads the quiet line, no accent icon', async ({ page }) => {
  await page.goto('/app?scenario=board-tags-empty');
  await expect(pendingCount(page)).toHaveText('0');
  await expect(summary(page)).toHaveText('没有等你处理的事');
  await expect(summary(page).locator('svg')).toHaveCount(0);
});

test('active filter: summary follows the narrowed column, badge + chip stay, popover anchors under `筛选`', async ({
  page,
}) => {
  await page.goto('/app?scenario=board-repos');
  await expect(summary(page)).toHaveText('1 项等你处理');

  await page.goto('/app?scenario=board-repos&projects=r2-inventory');
  await expect(pendingCount(page)).toHaveText('0');
  await expect(summary(page)).toHaveText('没有等你处理的事');
  await expect(page.getByTestId('filter-count')).toHaveText('1');
  await expect(topbar(page).locator('[data-dimension="repo"]')).toBeVisible();

  await filterBtn(page).click();
  const popover = page.getByRole('dialog', { name: '筛选' });
  await expect(popover).toBeVisible();
  const trigger = await filterBtn(page).boundingBox();
  const panel = await popover.boundingBox();
  if (trigger == null || panel == null) throw new Error('missing boxes');
  // align="end": the panel's right edge sits on the trigger's right edge
  expect(Math.abs(panel.x + panel.width - (trigger.x + trigger.width))).toBeLessThanOrEqual(1);
  expect(panel.y).toBeGreaterThan(trigger.y + trigger.height);
});

test('`定时` is a client-side link to the schedules page, scenario kept', async ({ page }) => {
  await page.goto('/app?scenario=01');
  await page.evaluate(() => {
    (window as unknown as { __spaCanary: string }).__spaCanary = 'alive';
  });
  await schedulesLink(page).click();
  await expect(page).toHaveURL('/app/schedules?scenario=01');
  expect(
    await page.evaluate(() => (window as unknown as { __spaCanary?: string }).__spaCanary),
  ).toBe('alive');
});

test('`新任务` is the shadcn default Button (ink, 32px, 8px corners) and opens the same new-task dialog as C', async ({
  page,
}) => {
  await page.goto('/app?scenario=01');
  await expect(newTaskButton(page)).toHaveAttribute('data-variant', 'default');
  await expect(newTaskButton(page)).toHaveAttribute('data-size', 'default');
  await expect(newTaskButton(page)).toHaveCSS('height', '32px');
  await expect(newTaskButton(page)).toHaveCSS('border-top-left-radius', '8px');
  await newTaskButton(page).click();
  await expect(page.getByRole('dialog', { name: '新建任务' })).toBeVisible();
});

test('keyboard: Tab reaches all three controls with a visible focus ring; Enter on `新任务` opens the dialog', async ({
  page,
}) => {
  await page.goto('/app?scenario=01');
  const targets = [filterBtn(page), schedulesLink(page), newTaskButton(page)];
  for (const target of targets) {
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await target.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    const ring = await target.evaluate((el) => ({
      visible: el.matches(':focus-visible'),
      shadow: getComputedStyle(el).boxShadow,
    }));
    expect(ring.visible).toBe(true);
    expect(ring.shadow).not.toBe('none');
  }
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '新建任务' })).toBeVisible();
});

test('narrow window: the summary truncates, the controls stay on one row inside the bar', async ({
  page,
}) => {
  // 680 = 432px of main beside the 248px Paper sidebar, the width the
  // summary is meant to clip at
  await page.setViewportSize({ width: 680, height: 732 });
  await page.goto('/app?scenario=01');
  const bar = await topbar(page).boundingBox();
  if (bar == null) throw new Error('missing bar');
  expect(bar.height).toBe(56);
  const boxes = await Promise.all(
    [filterBtn(page), schedulesLink(page), newTaskButton(page)].map((l) => l.boundingBox()),
  );
  for (const b of boxes) {
    if (b == null) throw new Error('missing control');
    expect(b.height).toBe(32);
    expect(b.y).toBe(boxes[0]?.y);
    expect(b.x + b.width).toBeLessThanOrEqual(bar.x + bar.width);
  }
  const clipped = await summary(page)
    .locator('.truncate')
    .evaluate((el) => el.scrollWidth > el.clientWidth);
  expect(clipped).toBe(true);
});
