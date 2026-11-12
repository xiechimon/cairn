import { expect, type Page, test } from '@playwright/test';

const sidebar = (page: Page) => page.getByRole('complementary');

const top = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().top);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
});

test('brand row, Coordinator, projects and footer stack top to bottom in a 220px sidebar', async ({ page }) => {
  await page.goto('/app/schedules?scenario=01');
  const aside = sidebar(page);
  expect(await aside.evaluate((el) => el.getBoundingClientRect().width)).toBe(220);

  const team = page.getByTestId('team-row');
  await expect(team.getByTestId('brand-mark')).toHaveCount(0);
  await expect(team.getByText('Cairn', { exact: true })).toBeVisible();
  await expect(team.getByRole('link')).toHaveCount(0);
  await expect(team.getByRole('button', { name: '搜索' })).toBeVisible();
  await expect(team.getByRole('button', { name: '收起侧边栏' })).toBeVisible();
  const nameFont = await team
    .getByText('Cairn', { exact: true })
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(nameFont).toContain('sourceSerif4');

  const headOrder = await team.evaluate((row) =>
    [
      row.querySelector('button[aria-label="收起侧边栏"]'),
      row.querySelector('.sidebar-team-name'),
      row.querySelector('button[aria-label="搜索"]'),
    ].map((el) => {
      if (!el) throw new Error('sidebar head part missing');
      const r = el.getBoundingClientRect();
      return { left: r.left, right: r.right };
    }),
  );
  expect(headOrder[0].right).toBeLessThanOrEqual(headOrder[1].left);
  expect(headOrder[1].right).toBeLessThanOrEqual(headOrder[2].left);

  const order = [
    await top(page, '[data-testid="team-row"]'),
    await aside.locator('[data-slot="sidebar-nav-row"]', { hasText: 'Coordinator' }).evaluate((el) => el.getBoundingClientRect().top),
    await top(page, 'aside [data-slot="sidebar-project-row"]'),
    await top(page, '[data-testid="sidebar-footer"]'),
  ];
  expect([...order].sort((a, b) => a - b)).toEqual(order);

  const userBottom = await page
    .getByTestId('sidebar-footer')
    .evaluate((el) => el.getBoundingClientRect().bottom);
  const asideBottom = await aside.evaluate((el) => el.getBoundingClientRect().bottom);
  expect(asideBottom - userBottom).toBeLessThanOrEqual(16);
});

test('`Coordinator` opens the home view and keeps the scenario', async ({ page }) => {
  await page.goto('/app/schedules?scenario=01');
  const home = sidebar(page).locator('[data-slot="sidebar-nav-row"]', { hasText: 'Coordinator' });
  await expect(page.getByTestId('home-c')).toHaveCount(0);

  await home.click();
  await expect(page).toHaveURL(/\/app\?scenario=01$/);
  await expect(page.getByTestId('home-c')).toBeVisible();
  await expect(home).toHaveAttribute('aria-current', 'page');

  await page.reload();
  await expect(page.getByTestId('home-c')).toBeVisible();
});

test('active row = sidebar-active fill, no ring', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const m = await page.evaluate(() => {
    const row = document.querySelector('aside [data-slot="sidebar-nav-row"][aria-current="page"]');
    const main = document.querySelector('.board-sheet');
    if (!row || !main) throw new Error('active row missing');
    const cs = getComputedStyle(row);
    const tokenProbe = document.createElement('span');
    tokenProbe.style.backgroundColor = 'var(--sidebar-active)';
    document.body.append(tokenProbe);
    const hover = getComputedStyle(tokenProbe).backgroundColor;
    tokenProbe.remove();
    return {
      bg: cs.backgroundColor,
      hover,
      sheet: getComputedStyle(main).backgroundColor,
      ring: cs.boxShadow,
    };
  });
  expect(m.bg).toBe(m.hover);
  expect(m.ring).toBe('none');
});

test('project rows carry a neutral glyph, no colored tile and no count', async ({ page }) => {
  await page.goto('/app/schedules?scenario=board-repos');
  const rows = page.locator('[data-slot="sidebar-project-row"]');
  await expect(rows).toHaveCount(3);
  const probe = await rows.evaluateAll((els) =>
    els.map((el) => ({
      glyphColor: getComputedStyle(el.querySelector('[data-slot="project-glyph"]')!).color,
      tile: el.querySelector('.project-avatar') !== null,
      count: el.querySelector('[data-slot="sidebar-project-count"]') !== null,
    })),
  );
  expect(new Set(probe.map((r) => r.glyphColor)).size).toBe(1);
  expect(probe.some((r) => r.tile || r.count)).toBe(false);
});

test('long project names truncate to one 34px line', async ({ page }) => {
  await page.goto('/app/schedules?scenario=board-repos');
  const m = await page
    .locator('[data-slot="sidebar-project-row"]')
    .first()
    .evaluate((row) => {
      const label = row.querySelector('span.truncate') as HTMLElement;
      label.textContent = '一个非常非常非常长的项目名字用来压测侧栏截断行为-with-latin-tail';
      const r = row.getBoundingClientRect();
      return {
        overflow: label.scrollWidth > label.clientWidth,
        ellipsis: getComputedStyle(label).textOverflow,
        rowHeight: r.height,
      };
    });
  expect(m.overflow).toBe(true);
  expect(m.ellipsis).toBe('ellipsis');
  expect(m.rowHeight).toBe(34);
});

test('collapsed rail keeps `Coordinator` with its badge dot and the expand toggle', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
  await page.goto('/app/schedules?scenario=01');
  const aside = sidebar(page);
  expect(await aside.evaluate((el) => el.getBoundingClientRect().width)).toBe(48);
  const home = aside.getByRole('link', { name: /Coordinator/ });
  await expect(home).toBeVisible();
  await home.click();
  await expect(page.getByTestId('home-c')).toBeVisible();
  await expect(home).toHaveAttribute('aria-current', 'page');
  await aside.getByRole('button', { name: '展开侧边栏' }).click();
  expect(await aside.evaluate((el) => el.getBoundingClientRect().width)).toBe(220);
});
