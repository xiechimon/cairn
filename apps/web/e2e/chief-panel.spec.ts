import { expect, type Page, test } from '@playwright/test';

const drawer = (page: Page) => page.locator('.chief-drawer');
const fab = (page: Page) => page.locator('.chief-fab');
const minimize = (page: Page) => drawer(page).getByRole('button', { name: '最小化' });

// the window enters with fade + scale (ADR 0013 D7) — measure only after the
// entrance animation settles so transforms are off the boxes
async function settled(page: Page) {
  await drawer(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

const WIN_BOX = { x: 1440 - 8 - 380, y: 732 - 8 - 600, width: 380, height: 600 };

// Paper sheet (PR 6 pages, PR 7 board): every route's main panel sits 10px
// off the right viewport edge, so the column is 1440 - 248 - 10.
const SHEET_W = 1440 - 248 - 10;

test.describe('chief panel floating form (ADR 0013)', () => {
  test('Esc never closes the panel on the board route (D3)', async ({ page }) => {
    await page.goto('/app?scenario=111');
    await expect(drawer(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer(page)).toBeVisible();
  });

  test('Esc never closes the panel on a wake surface', async ({ page }) => {
    await page.goto('/app/team?scenario=12');

    await expect(drawer(page)).toBeHidden();
    await expect(drawer(page)).toHaveCount(1);

    await fab(page).click();
    await settled(page);
    await expect(drawer(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer(page)).toBeVisible();
  });

  test('Esc layers: the open thread switcher closes first, the panel survives both', async ({
    page,
  }) => {
    await page.goto('/app?scenario=116');
    await expect(drawer(page)).toBeVisible();

    await expect(page.getByRole('menu')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(drawer(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer(page)).toBeVisible();
  });

  test('composer bar carries the attach + mention tools and the send button', async ({ page }) => {
    await page.goto('/app?scenario=111');

    const bar = page.locator('.chief-composer');

    await expect(bar.locator('button[aria-label="语音输入"]')).toHaveCount(0);
    await expect(bar.locator('button[aria-label="添加附件"]')).toBeVisible();
    await expect(bar.locator('button[aria-label="提及"]')).toBeVisible();
    await expect(bar.locator('button')).toHaveCount(3);
    await expect(bar.locator('button[aria-label="发送"]')).toBeVisible();
  });

  test('the panel floats as a 380x600 window anchored 8px off the corner (board)', async ({
    page,
  }) => {
    await page.goto('/app?scenario=111');
    await settled(page);
    const box = await drawer(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeCloseTo(WIN_BOX.x, 0);
    expect(box!.y).toBeCloseTo(WIN_BOX.y, 0);
    expect(box!.width).toBeCloseTo(WIN_BOX.width, 0);
    expect(box!.height).toBeCloseTo(WIN_BOX.height, 0);

    const skin = await drawer(page).evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        position: cs.position,
        radius: cs.borderRadius,
        shadow: cs.boxShadow,
        z: cs.zIndex,
        bg: cs.backgroundColor,
        backdrop: cs.backdropFilter,
        sidebarRight: document.querySelector('.board-sidebar')!.getBoundingClientRect().right,
        left: el.getBoundingClientRect().left,
      };
    });
    // an overlay anchored to the corner, not an in-flow column (D10)
    expect(skin.position).toBe('fixed');

    expect(skin.radius).toBe('20px');

    expect(skin.shadow).not.toBe('none');
    expect(skin.shadow).toContain('inset');

    expect(skin.z).toBe('15');

    expect(skin.bg).toMatch(/^rgb\(/);
    expect(skin.backdrop === 'none' || skin.backdrop === '').toBe(true);

    expect(skin.left).toBeGreaterThanOrEqual(skin.sidebarRight);

    // D1: the form toggle is retired — neither label exists anywhere
    await expect(page.locator('button[aria-label="全屏"]')).toHaveCount(0);
    await expect(page.locator('button[aria-label="退出全屏"]')).toHaveCount(0);
  });

  test('board content never yields to the window (D1 overlay, no yield)', async ({ page }) => {
    await page.goto('/app?scenario=111');
    await settled(page);
    const main = await page.locator('.board-main').boundingBox();
    expect(main).not.toBeNull();

    expect(main!.width).toBeCloseTo(SHEET_W, 0);

    const open = await page.locator('.board-scroller').evaluate((el) => ({
      scrollable: el.scrollWidth > el.clientWidth,
      columns: [...el.querySelectorAll('.board-column')].map((c) => c.getBoundingClientRect().width),
    }));

    expect(open.scrollable).toBe(false);
    expect(open.columns).toHaveLength(4);
    const first = open.columns[0] ?? 0;
    for (const w of open.columns) expect(Math.abs(w - first)).toBeLessThanOrEqual(1);
  });

  test('minimizing leaves the board grid at the same geometry (nothing to restore)', async ({
    page,
  }) => {
    await page.goto('/app?scenario=111');
    await settled(page);
    const openMain = await page.locator('.board-main').boundingBox();

    await minimize(page).click();
    await expect(drawer(page)).toBeHidden();

    const main = await page.locator('.board-main').boundingBox();
    expect(main!.width).toBeCloseTo(openMain!.width, 0);
    const rest = await page.locator('.board-scroller').evaluate((el) => ({
      scrollable: el.scrollWidth > el.clientWidth,
      columns: [...el.querySelectorAll('.board-column')].map((c) => c.getBoundingClientRect().width),
    }));
    expect(rest.scrollable).toBe(false);
    const first = rest.columns[0] ?? 0;
    expect(first).toBeGreaterThan(0);
    for (const w of rest.columns) expect(Math.abs(w - first)).toBeLessThanOrEqual(1);
  });

  for (const { name, route } of [
    { name: 'pages', route: '/app/schedules?scenario=11' },
    { name: 'resources', route: '/app/resources/skills?scenario=06' },
    { name: 'secondary', route: '/app/team?scenario=12' },
  ] as const) {
    test(`${name}: the main column never narrows while the window is open`, async ({ page }) => {
      await page.goto(route);

      const content = page.locator('.page-main-col');
      await expect(content).toBeVisible();
      const closed = await content.boundingBox();
      expect(closed!.width).toBeCloseTo(SHEET_W, 0);

      await fab(page).click();
      await settled(page);
      const floating = await drawer(page).boundingBox();
      expect(floating!.x).toBeCloseTo(WIN_BOX.x, 0);
      expect(floating!.y).toBeCloseTo(WIN_BOX.y, 0);
      expect(floating!.width).toBeCloseTo(WIN_BOX.width, 0);
      expect(floating!.height).toBeCloseTo(WIN_BOX.height, 0);
      const open = await content.boundingBox();
      expect(open!.width).toBeCloseTo(SHEET_W, 0);

      await minimize(page).click();
      await expect(drawer(page)).toBeHidden();
      const restored = await content.boundingBox();
      expect(restored!.width).toBeCloseTo(SHEET_W, 0);
      expect(restored!.x).toBeCloseTo(closed!.x, 0);
    });
  }

  test('detail: the right pane coexists with the floating window (D7 reversed)', async ({
    page,
  }) => {
    await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=detail-unread');
    await expect(page.locator('.detail-right')).toBeVisible();
    const restingCenter = await page.locator('.detail-center').boundingBox();

    await fab(page).click();
    await settled(page);

    await expect(page.locator('.detail-right')).toBeVisible();
    const box = await drawer(page).boundingBox();
    expect(box!.x).toBeCloseTo(WIN_BOX.x, 0);
    expect(box!.y).toBeCloseTo(WIN_BOX.y, 0);
    expect(box!.width).toBeCloseTo(WIN_BOX.width, 0);
    expect(box!.height).toBeCloseTo(WIN_BOX.height, 0);

    // the center column stays fluid and unchanged by the overlay
    const center = await page.locator('.detail-center').boundingBox();
    expect(center!.width).toBeCloseTo(restingCenter!.width, 0);
    expect(center!.width).toBeCloseTo(SHEET_W - 488, 0);

    await minimize(page).click();
    await expect(drawer(page)).toBeHidden();
    await expect(page.locator('.detail-right')).toBeVisible();
    const restored = await page.locator('.detail-center').boundingBox();
    expect(restored!.width).toBe(SHEET_W - 488);
  });

  test('hero examples: the four canon prompt cards, inert on the fixture face', async ({
    page,
  }) => {
    await page.goto('/app?scenario=111');

    const examples = page.getByTestId('chief-examples');
    const cards = examples.getByRole('button');
    await expect(cards).toHaveCount(4);
    await expect(cards.nth(0)).toContainText('帮我组建 Agent 团队');
    await expect(cards.nth(1)).toContainText('帮我创建一个新项目');
    await expect(cards.nth(2)).toContainText('总结一下我所有项目现在的进展');
    await expect(cards.nth(3)).toContainText('查一下这个月的 token 用量');

    // the fixture face has no send callback (#129): clicking a card must
    // not swap the hero for a thread view or crash the surface
    await cards.nth(0).click();
    await expect(drawer(page)).toBeVisible();
    await expect(examples).toBeVisible();

    await expect(page.getByTestId('chief-stream')).toHaveCount(1);
    await expect(page.locator('[data-slot="message-scroller-item"]')).toHaveCount(0);
    await expect(page.locator('.chief-msg, [data-testid="chief-msg"]')).toHaveCount(0);
  });

  test('composer grows with a restored draft to the six-line cap, empty face keeps the base track (#860 supersedes XMON-102)', async ({
    page,
  }) => {

    const measureComposer = async (url: string) => {
      await page.goto(url);
      await settled(page);
      const composer = page.getByTestId('chief-composer-input');
      await expect(composer).toBeVisible();
      const box = await composer.boundingBox();
      if (box === null) throw new Error(`composer box missing at ${url}`);
      return {
        height: Math.round(box.height),
        cssHeight: await composer.evaluate((el) => getComputedStyle(el).height),
        overflowY: await composer.evaluate((el) => getComputedStyle(el).overflowY),
      };
    };

    const drafted = await measureComposer('/app?scenario=111');
    const empty = await measureComposer('/app?scenario=114');

    expect(drafted.height).toBe(120);
    expect(empty.height).toBe(60);
    expect(drafted.cssHeight).toBe('120px');
    expect(empty.cssHeight).toBe('60px');

    expect(drafted.overflowY).toBe('auto');
    expect(empty.overflowY).toBe('auto');
  });

  test('composer placeholder switches to the steer canon while a turn runs (#624)', async ({
    page,
  }) => {

    const placeholderAt = async (scenario: string) => {
      await page.goto(`/app?scenario=${scenario}`);
      const composer = page.getByTestId('chief-composer-input');
      await expect(composer).toBeVisible();
      return composer.getAttribute('placeholder');
    };

    expect(await placeholderAt('113')).toBe('向 Agent 补充说明，执行过程中即可送达');
    expect(await placeholderAt('111')).toBe('有什么可以帮你的？');
    expect(await placeholderAt('114')).toBe('有什么可以帮你的？');
  });

  test('the open state persists across a reload (D5, reversing 0004 D9)', async ({ page }) => {
    const TEAM_ID = 'team-1';
    await page.route('**/api/**', (route, request) => {
      if (request.method() !== 'GET') return route.fallback();
      return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
    });
    await page.route('**/api/teams', (route) =>
      route.fulfill({
        json: [{ id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
      }),
    );
    await page.route('**/api/user/me', (route) =>
      route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } }),
    );
    await page.route(`**/api/teams/${TEAM_ID}/notifications`, (route) =>
      route.fulfill({ json: { unreadThreadIds: [] } }),
    );
    await page.route(`**/api/teams/${TEAM_ID}/chief/threads`, (route) =>
      route.fulfill({ json: [] }),
    );
    await page.route(`**/api/teams/${TEAM_ID}/chief`, (route) =>
      route.fulfill({
        json: {
          chief: {
            id: `chief-user-1-${TEAM_ID}`,
            userId: 'user-1',
            teamId: TEAM_ID,
            agent: null,
            charter: '',
            lastTurnAt: null,
            createdAt: 0,
            tz: null,
          },
          agentActor: null,
          context: null,
          watches: [],
          wakes: [],
        },
      }),
    );
    await page.route(`**/api/teams/${TEAM_ID}/model-sources`, (route) =>
      route.fulfill({ json: { sources: [] } }),
    );

    await page.goto('/app');
    await expect(drawer(page)).toBeHidden();

    await fab(page).click();
    await settled(page);
    await expect(drawer(page)).toBeVisible();
    await page.reload();
    await settled(page);
    await expect(drawer(page)).toBeVisible();

    await minimize(page).click();
    await expect(drawer(page)).toBeHidden();
    await page.reload();
    await expect(drawer(page)).toBeHidden();
  });
});
