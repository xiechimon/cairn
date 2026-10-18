import { expect, type Page, test } from '@playwright/test';

// Paper Grouped sidebar (apps/web/DESIGN.md 侧栏, plan PR 5): five parts top
// to bottom at 248px, 需要我处理 = the board filtered to the 待处理 column
// (plan 已定问题 1), active row = sheet + hairline + accent icon, 资源 folded
// by default and persisted, user row second line = machine status.

const sidebar = (page: Page) => page.getByRole('complementary');
const columns = (page: Page) => page.locator('[data-column]');

const top = (page: Page, selector: string) =>
  page.locator(selector).first().evaluate((el) => el.getBoundingClientRect().top);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pacman-theme', 'light'));
});

test('five parts stack top to bottom in a 248px sidebar', async ({ page }) => {
  await page.goto('/app?scenario=01');
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
  ).toContain('/logo.svg');
  await expect(team.getByRole('link', { name: 'Pacman' })).toBeVisible();
  await expect(team.getByRole('button', { name: '搜索' })).toBeVisible();
  await expect(team.getByRole('button', { name: '收起侧边栏' })).toBeVisible();
  const nameFont = await team
    .getByText('Pacman', { exact: true })
    .evaluate((el) => getComputedStyle(el).fontFamily);
  expect(nameFont).toContain('sourceSerif4');

  const order = [
    await top(page, '[data-testid="team-row"]'),
    await top(page, '.sidebar-new-task'),
    await aside.getByRole('link', { name: '工作台' }).evaluate((el) => el.getBoundingClientRect().top),
    await aside
      .getByRole('link', { name: /需要我处理/ })
      .evaluate((el) => el.getBoundingClientRect().top),
    await aside.getByRole('link', { name: '定时' }).evaluate((el) => el.getBoundingClientRect().top),
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

test('新任务 button opens the new-task dialog and shows the C key', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const button = page.locator('.sidebar-new-task');
  await expect(button.locator('kbd')).toHaveText('C');
  await button.click();
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('需要我处理 badge counts the 待处理 column and filters the board to it', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const pendingCount = await page
    .locator('[data-column="pending"] [data-testid="column-count"]')
    .textContent();
  const needsMe = sidebar(page).getByRole('link', { name: /需要我处理/ });
  await expect(needsMe.getByTestId('attention-badge')).toHaveText(pendingCount ?? '');
  await expect(columns(page)).toHaveCount(4);

  await needsMe.click();
  await expect(page).toHaveURL(/[?&]column=pending/);
  await expect(page).toHaveURL(/[?&]scenario=01/);
  await expect(columns(page)).toHaveCount(1);
  await expect(columns(page)).toHaveAttribute('data-column', 'pending');
  await expect(needsMe).toHaveAttribute('aria-current', 'page');
  const board = sidebar(page).getByRole('link', { name: '工作台' });
  await expect(board).not.toHaveAttribute('aria-current', 'page');

  await page.reload();
  await expect(columns(page)).toHaveCount(1);

  await page.getByRole('button', { name: '清除待处理筛选' }).click();
  await expect(columns(page)).toHaveCount(4);
  await expect(page).not.toHaveURL(/column=/);

  await needsMe.click();
  await expect(columns(page)).toHaveCount(1);
  await board.click();
  await expect(columns(page)).toHaveCount(4);
  await expect(board).toHaveAttribute('aria-current', 'page');
  await expect(page).not.toHaveURL(/column=/);
});

test('active row = sheet fill + hairline ring + accent icon', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const m = await page.evaluate(() => {
    const row = document.querySelector('aside a[aria-current="page"]');
    const main = document.querySelector('.board-main');
    if (!row || !main) throw new Error('active row missing');
    const cs = getComputedStyle(row);
    return {
      bg: cs.backgroundColor,
      sheet: getComputedStyle(main).backgroundColor,
      ring: cs.boxShadow,
      icon: getComputedStyle(row.querySelector('svg')!).color,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--card-button').trim(),
    };
  });
  expect(m.bg).toBe(m.sheet);
  expect(m.ring).not.toBe('none');
  expect(m.accent).toBe('#b4532a');
  expect(m.icon).toBe('rgb(180, 83, 42)');
});

test('资源 folds by default, opens to an indented sub-list, survives reload', async ({ page }) => {
  await page.goto('/app?scenario=01');
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
    const board = links.find((a) => a.textContent?.trim() === '工作台');
    return (skill?.getBoundingClientRect().left ?? 0) - (board?.getBoundingClientRect().left ?? 0);
  });
  expect(indent).toBeGreaterThan(8);

  await page.reload();
  await expect(sidebar(page).getByRole('link', { name: '技能' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('pacman.sidebarResourcesCollapsed'))).toBe(
    '0',
  );
});

test('a resource route lights the folded 资源 row', async ({ page }) => {
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

test('project rows: tile colors follow --project-tile-N in order, open-task counts', async ({
  page,
}) => {
  await page.goto('/app?scenario=board-repos');
  const rows = page.locator('[data-testid="project-row"]');
  await expect(rows).toHaveCount(3);
  const probe = await rows.evaluateAll((els) => {
    const root = getComputedStyle(document.documentElement);
    return els.map((el, i) => {
      const tile = el.querySelector('.project-avatar')!;
      const probeEl = document.createElement('span');
      probeEl.style.backgroundColor = root.getPropertyValue(`--project-tile-${(i % 6) + 1}`);
      document.body.append(probeEl);
      const want = getComputedStyle(probeEl).backgroundColor;
      probeEl.remove();
      return {
        tile: getComputedStyle(tile).backgroundColor,
        want,
        initial: tile.textContent,
        count: el.querySelector('[data-testid="project-count"]')?.textContent ?? null,
      };
    });
  });
  for (const row of probe) expect(row.tile).toBe(row.want);
  expect(probe.map((r) => r.initial)).toEqual(['R', 'R', 'R']);
  expect(probe.map((r) => r.count)).toEqual(['2', '1', null]);

  await page.getByTestId('project-group').getByRole('link', { name: '新建项目' }).click();
  await expect(page).toHaveURL(/\/app\/project\/new\?scenario=board-repos/);
});

test('long project names truncate and keep the count visible', async ({ page }) => {
  await page.goto('/app?scenario=board-repos');
  const m = await page
    .locator('[data-testid="project-row"]')
    .first()
    .evaluate((row) => {
      const label = row.querySelector('[data-testid="project-name"]') as HTMLElement;
      label.textContent = '一个非常非常非常长的项目名字用来压测侧栏截断行为-with-latin-tail';
      const count = row.querySelector('[data-testid="project-count"]')!;
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

test('user row second line reads machines online and running count', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const running = await page
    .locator('[data-column="building"] [data-testid="column-count"]')
    .textContent();
  await expect(page.getByTestId('machine-status')).toHaveText(
    new RegExp(`^\\d+ 台机器在线 · 执行中 ${running}$`),
  );
});

test('collapsed rail keeps 需要我处理 with its badge and the expand toggle', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pacman.sidebar-collapsed', '1'));
  await page.goto('/app?scenario=01');
  const aside = sidebar(page);
  expect(await aside.evaluate((el) => el.getBoundingClientRect().width)).toBe(40);
  const needsMe = aside.getByRole('link', { name: /需要我处理/ });
  await expect(needsMe).toBeVisible();
  await needsMe.click();
  await expect(columns(page)).toHaveCount(1);
  await expect(needsMe).toHaveAttribute('aria-current', 'page');
  await aside.getByRole('button', { name: '展开侧边栏' }).click();
  expect(await aside.evaluate((el) => el.getBoundingClientRect().width)).toBe(248);
});
