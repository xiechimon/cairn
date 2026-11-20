import { expect, type Page, test } from '@playwright/test';

const SKILLS = '/app/resources/skills';

test('skills page create entry (topbar `新建` button) in place, fixture row set renders as usual', async ({ page }) => {
  await page.goto(`${SKILLS}?scenario=06`);
  await expect(page.locator('[data-route="/app/resources/skills"]')).toBeVisible();

  await expect(page.getByRole('button', { name: '新建', exact: true })).toHaveCount(1);
  await expect(page.getByTestId('resource-row')).toHaveCount(1);
  await expect(page.getByTestId('resource-row').first()).toContainText('code-review');
});

test('legacy import route unreachable — catch-all redirects back to /app (#149 feedback route same law)', async ({
  page,
}) => {
  await page.goto(`${SKILLS}/import`);
  await expect(page).toHaveURL('/app');
  await expect(page.locator('[data-route="/app/resources/skills/import"]')).toHaveCount(0);
});

test('empty state points at Import and New, names no directory, and offers `新建技能`', async ({ page }) => {
  await page.goto(`${SKILLS}?scenario=01`);
  const empty = page.getByTestId('resource-empty');
  await expect(empty).toBeVisible();
  await expect(empty.getByRole('heading')).toHaveText('尚无技能');

  const desc = empty.locator('p');
  await expect(desc).toHaveText('用「导入」或「新建技能」添加。');
  await expect(empty.getByRole('button', { name: '新建技能' })).toHaveText('新建技能');

  await expect(desc).toHaveCount(1);
});

async function stubBoot(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) =>
    route.fulfill({
      json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
    }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } }),
  );
}

test('live list consumes GET /api/skills (wire shape unchanged after the server switched sources)', async ({ page }) => {
  await stubBoot(page);
  const hits: string[] = [];
  await page.route('**/api/skills*', (route) => {
    hits.push(route.request().url());
    return route.fulfill({
      json: [
        { id: 'deploy', teamId: 'team-1', name: 'deploy', description: '部署流程手册' },
        { id: 'review', teamId: 'team-1', name: 'review', description: null },
      ],
    });
  });
  await page.goto(SKILLS);

  await expect(page.getByTestId('resource-row')).toHaveCount(2);
  await expect(page.getByTestId('resource-row').nth(0)).toContainText('deploy');
  await expect(page.getByTestId('resource-row').nth(0)).toContainText('部署流程手册');
  await expect(page.getByTestId('resource-row').nth(1)).toContainText('review');

  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0]).toContain('teamId=team-1');
});

test('regression #486/#494: skills list reachable by wheel, scrollbar hugs the panel right edge, last row keeps a bottom gap, actions share the heading row', async ({ page }) => {
  await stubBoot(page);

  const rows = Array.from({ length: 20 }, (_, i) => ({
    id: `skill-${i}`,
    teamId: 'team-1',
    name: `skill-${String(i).padStart(2, '0')}`,
    description: `回归行 ${i}`,
  }));
  await page.route('**/api/skills*', (route) => route.fulfill({ json: rows }));
  await page.goto(SKILLS);
  await expect(page.getByTestId('resource-row')).toHaveCount(rows.length);

  const shellSel = '[data-route="/app/resources/skills"]';
  // Paper page shell (PR 6): page-col / page-topbar testids, .page-main-col
  // = the sheet's column (one shell for every non-board route).
  const col = page.getByTestId('page-col');
  const readScrollLayer = () =>
    page.evaluate((sel) => {
      const colEl = document.querySelector(`${sel} [data-testid="page-col"]`);
      const pane = document.querySelector(`${sel} .page-main-col`);
      let host = null;
      for (let n = colEl; n != null; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const scrolls = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
        if (scrolls && n.scrollHeight > n.clientHeight + 1) {
          host = n;
          break;
        }
      }
      const box = (el) => {
        if (el == null) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, right: r.right, width: r.width, bottom: r.bottom };
      };
      return { host: box(host), pane: box(pane), col: box(colEl) };
    }, shellSel);

  const widthBefore = (await col.boundingBox())?.width ?? 0;
  expect(widthBefore).toBeGreaterThanOrEqual(672);

  const before = await readScrollLayer();
  const topbarBefore = await page.getByTestId('page-toolbar').boundingBox();

  expect(before.host).not.toBeNull();

  expect(before.host?.right).toBeCloseTo(before.pane?.right ?? -1, 0);
  expect(before.host?.width ?? 0).toBeGreaterThan(before.col?.width ?? 0);

  await page.mouse.move(720, 400);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 400);

  const last = page.getByTestId('resource-row').last();
  await expect(last).toBeInViewport();
  const box = await last.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.y).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(733);

  const after = await readScrollLayer();
  expect((after.host?.bottom ?? 0) - ((box?.y ?? 0) + (box?.height ?? 0))).toBeGreaterThanOrEqual(
    24,
  );

  expect((await col.boundingBox())?.width).toBe(widthBefore);
  const topbar = await page.getByTestId('page-toolbar').boundingBox();
  expect(topbar?.y).toBe(topbarBefore?.y);
  expect(topbar?.height).toBe(32);
  const head = await page.getByTestId('settings-head').boundingBox();
  expect((topbar?.y ?? 0) + (topbar?.height ?? 0) / 2).toBeCloseTo(
    (head?.y ?? -1) + (head?.height ?? 0) / 2,
    0,
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});

test('a clickable resource row answers hover with a fill that stays inside the card corners', async ({
  page,
}) => {
  await page.goto(`${SKILLS}?scenario=06`);
  const row = page.getByTestId('resource-row').first();
  const before = await row.evaluate((el) => getComputedStyle(el).backgroundColor);
  await row.hover();
  await expect
    .poll(() => row.evaluate((el) => getComputedStyle(el).backgroundColor))
    .not.toBe(before);
  const corners = await row.evaluate((el) => {
    const card = el.closest('.settings-card') as HTMLElement;
    const cs = getComputedStyle(el);
    return {
      row: [cs.borderTopLeftRadius, cs.borderBottomRightRadius],
      card: getComputedStyle(card).borderTopLeftRadius,
    };
  });
  expect(corners.row).toEqual([corners.card, corners.card]);
});

test('search keeps the skills whose name or description matches, and says when none do', async ({
  page,
}) => {
  await page.goto(`${SKILLS}?scenario=skills-list`);
  const rows = page.getByTestId('resource-row');
  await expect(rows).toHaveCount(3);
  const search = page.getByRole('textbox', { name: '搜索技能' });
  await search.fill('许可证');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('repo-audit');
  await search.fill('zzzz');
  await expect(rows).toHaveCount(0);
  await expect(page.getByTestId('skill-search-empty')).toHaveText('没有匹配的技能。');
  await search.fill('');
  await expect(rows).toHaveCount(3);
});
