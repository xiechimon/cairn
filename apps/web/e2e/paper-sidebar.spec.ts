import { expect, type Page, test } from '@playwright/test';

const sidebar = (page: Page) => page.getByRole('complementary');
const columns = (page: Page) => page.locator('[data-column]');

const top = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().top);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
});

test('five parts stack top to bottom in a 248px sidebar', async ({ page }) => {
  await page.goto('/app?scenario=01&view=board');
  const aside = sidebar(page);
  expect(await aside.evaluate((el) => el.getBoundingClientRect().width)).toBe(248);

  const team = page.getByTestId('team-row');
  const mark = team.getByTestId('brand-mark');
  await expect(mark).toHaveText('');
  expect(
    await mark.evaluate((el) => {
      const cs = getComputedStyle(el);
      return cs.getPropertyValue('mask-image') || cs.getPropertyValue('-webkit-mask-image');
    }),
  ).toContain('/logo-mark.svg');
  await expect(team.getByRole('link', { name: 'Cairn' })).toBeVisible();
  await expect(team.getByRole('button', { name: '收起侧边栏' })).toBeVisible();
  const nameFont = await team
    .getByText('Cairn', { exact: true })
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(nameFont).toContain('bricolageGrotesque');

  const order = [
    await top(page, '[data-testid="team-row"]'),
    await top(page, '.sidebar-new-task'),
    await aside.getByRole('button', { name: /搜索/ }).evaluate((el) => el.getBoundingClientRect().top),
    await aside.locator('[data-slot="sidebar-nav-row"]', { hasText: '工作台' }).evaluate((el) => el.getBoundingClientRect().top),
    await aside.locator('[data-slot="sidebar-nav-row"]', { hasText: '定时' }).evaluate((el) => el.getBoundingClientRect().top),
    await top(page, '[data-testid="project-group"]'),
    await aside.getByRole('button', { name: '资源' }).evaluate((el) => el.getBoundingClientRect().top),
    await top(page, '.sidebar-user'),
  ];
  expect([...order].sort((a, b) => a - b)).toEqual(order);

  const userBottom = await page
    .locator('.sidebar-user')
    .evaluate((el) => el.getBoundingClientRect().bottom);
  const asideBottom = await aside.evaluate((el) => el.getBoundingClientRect().bottom);
  expect(asideBottom - userBottom).toBeLessThanOrEqual(16);
});

test('`新任务` row opens the new-task dialog without a sidebar key badge', async ({ page }) => {
  await page.goto('/app?scenario=01&view=board');
  const button = page.locator('.sidebar-new-task');
  await expect(button.locator('kbd')).toHaveCount(0);
  await button.click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('`Workbench` badge counts the `待处理` column and opens the home view', async ({ page }) => {
  await page.goto('/app?scenario=01&view=board');
  const pendingCount = await page
    .locator('[data-column="pending"] [data-testid="column-count"]')
    .textContent();
  const home = sidebar(page).locator('[data-slot="sidebar-nav-row"]', { hasText: '工作台' });
  await expect(sidebar(page).getByTestId('attention-badge')).toHaveText(pendingCount ?? '');
  await expect(columns(page)).toHaveCount(4);

  await home.click();
  await expect(page).not.toHaveURL(/view=/);
  await expect(page).toHaveURL(/[?&]scenario=01/);
  await expect(columns(page)).toHaveCount(0);
  await expect(page.getByTestId('home-c')).toBeVisible();
  await expect(home).toHaveAttribute('aria-current', 'page');

  await page.reload();
  await expect(page.getByTestId('home-c')).toBeVisible();
});

test('active row = sidebar-active fill, no ring', async ({ page }) => {
  await page.goto('/app?scenario=01&view=board');
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

test('`资源` folds by default, opens to an indented sub-list, survives reload', async ({ page }) => {
  await page.goto('/app?scenario=01&view=board');
  const toggle = sidebar(page).getByRole('button', { name: '资源' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(sidebar(page).getByRole('link', { name: '技能' })).toHaveCount(0);

  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  for (const name of ['技能', 'MCP', '密钥', '机器', '模型服务']) {
    await expect(sidebar(page).getByRole('link', { name, exact: true })).toBeVisible();
  }
  const indent = await page.evaluate(() => {
    const links = [...document.querySelectorAll('aside a')];
    const skill = links.find((a) => a.textContent?.trim() === '技能');
    const team = document.querySelector('.sidebar-team-name');
    return (skill?.getBoundingClientRect().left ?? 0) - (team?.getBoundingClientRect().left ?? 0);
  });
  expect(indent).toBeGreaterThan(8);

  await page.reload();
  await expect(sidebar(page).getByRole('link', { name: '技能' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('cairn.sidebarResourcesCollapsed'))).toBe(
    '0',
  );
});

test('a resource route lights the folded `资源` row', async ({ page }) => {
  await page.goto('/app/resources/skills?scenario=06');
  const toggle = sidebar(page).getByRole('button', { name: '资源' });
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(toggle).toHaveAttribute('data-active', 'true');
  await toggle.click();
  await expect(sidebar(page).getByRole('link', { name: '技能' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('project rows: tile letters follow --project-ink-N in order, open-task counts', async ({
  page,
}) => {
  await page.goto('/app?scenario=board-repos&view=board');
  const rows = page.locator('[data-slot="sidebar-project-row"]');
  await expect(rows).toHaveCount(3);
  const probe = await rows.evaluateAll((els) => {
    const root = getComputedStyle(document.documentElement);
    return els.map((el, i) => {
      const tile = el.querySelector('.project-avatar')!;
      const probeEl = document.createElement('span');
      probeEl.style.color = root.getPropertyValue(`--project-ink-${(i % 6) + 1}`);
      document.body.append(probeEl);
      const want = getComputedStyle(probeEl).color;
      probeEl.remove();
      return {
        tile: getComputedStyle(tile).color,
        want,
        initial: tile.textContent,
        count: el.querySelector('[data-slot="sidebar-project-count"]')?.textContent ?? null,
      };
    });
  });
  for (const row of probe) expect(row.tile).toBe(row.want);
  expect(probe.map((r) => r.initial)).toEqual(['R', 'R', 'R']);
  expect(probe.map((r) => r.count)).toEqual(['1', null, null]);

  await page.getByTestId('project-group').getByRole('link', { name: '新建项目' }).click();
  await expect(page).toHaveURL(/\/app\/project\/new\?scenario=board-repos/);
});

test('long project names truncate and keep the waiting count visible', async ({ page }) => {
  await page.goto('/app?scenario=board-repos&view=board');
  const m = await page
    .locator('[data-slot="sidebar-project-row"]')
    .first()
    .evaluate((row) => {
      const label = row.querySelector('span.truncate') as HTMLElement;
      label.textContent = '一个非常非常非常长的项目名字用来压测侧栏截断行为-with-latin-tail';
      const count = row.querySelector('[data-slot="sidebar-project-count"]')!;
      const r = row.getBoundingClientRect();
      const c = count.getBoundingClientRect();
      return {
        overflow: label.scrollWidth > label.clientWidth,
        ellipsis: getComputedStyle(label).textOverflow,
        countInside: c.right <= r.right && c.width > 0,
        rowHeight: r.height,
      };
    });
  expect(m.overflow).toBe(true);
  expect(m.ellipsis).toBe('ellipsis');
  expect(m.countInside).toBe(true);
  expect(m.rowHeight).toBe(32);
});

test('user row second line reads machines online', async ({ page }) => {
  await page.goto('/app?scenario=01&view=board');
  await expect(page.locator('[data-slot="sidebar-user"]')).toContainText(/\d+ machines? online/);
});

test('collapsed rail keeps `Workbench` with its badge dot and the expand toggle', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('cairn.sidebar-collapsed', '1'));
  await page.goto('/app?scenario=01&view=board');
  const aside = sidebar(page);
  expect(await aside.evaluate((el) => el.getBoundingClientRect().width)).toBe(40);
  const home = aside.getByRole('link', { name: /工作台/ });
  await expect(home).toBeVisible();
  await home.click();
  await expect(page.getByTestId('home-c')).toBeVisible();
  await expect(home).toHaveAttribute('aria-current', 'page');
  await aside.getByRole('button', { name: '展开侧边栏' }).click();
  expect(await aside.evaluate((el) => el.getBoundingClientRect().width)).toBe(248);
});
