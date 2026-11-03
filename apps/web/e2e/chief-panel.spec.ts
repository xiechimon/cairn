import { expect, type Page, test } from '@playwright/test';
import { openChiefWindow } from './helpers.js';

const drawer = (page: Page) => page.locator('.chief-drawer');
const minimize = (page: Page) => drawer(page).getByRole('button', { name: '最小化' });

// the window enters with fade + scale (ADR 0013 D7) — measure only after the
// entrance animation settles so transforms are off the boxes
async function settled(page: Page) {
  await drawer(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

const WIN_BOX = { x: 1440 - 8 - 380, y: 732 - 8 - 600, width: 380, height: 600 };

const SHEET_W = 1440 - 248 - 8;

test.describe('chief panel floating form (ADR 0013)', () => {
  test('Esc never closes the panel on a page route (D3)', async ({ page }) => {
    await page.goto('/app/schedules?scenario=111');
    await expect(drawer(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer(page)).toBeVisible();
  });

  test('Esc never closes the panel on a wake surface', async ({ page }) => {
    await page.goto('/app/team?scenario=12');

    await expect(drawer(page)).toBeHidden();
    await expect(drawer(page)).toHaveCount(1);

    await openChiefWindow(page);
    await settled(page);
    await expect(drawer(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(drawer(page)).toBeVisible();
  });

  test('chief header and composer tools retain 24px header and 28px composer-tool targets after conversation extraction', async ({ page }, testInfo) => {
    await page.goto('/app/schedules?scenario=111');
    await settled(page);
    for (const name of ['总管设置', '最小化', '添加附件']) {
      const control = drawer(page).getByRole('button', { name, exact: true });
      await expect(control).toBeVisible();
      const box = await control.boundingBox();
      expect(box).not.toBeNull();
      const side = name === '添加附件' ? 28 : 24;
      expect(box?.width).toBe(side);
      expect(box?.height).toBe(side);
    }
    await page.screenshot({ path: testInfo.outputPath('chief-button-tiers.png') });
  });

  test('composer bar carries the attach tool and the send button', async ({ page }) => {
    await page.goto('/app/schedules?scenario=111');

    const bar = page.locator('.chief-composer');

    await expect(bar.locator('button[aria-label="语音输入"]')).toHaveCount(0);
    await expect(bar.locator('button[aria-label="添加附件"]')).toBeVisible();
    await expect(bar.locator('button')).toHaveCount(2);
    await expect(bar.locator('button[aria-label="发送"]')).toBeVisible();
  });

  test('the panel floats as a 380x600 window anchored 8px off the corner (page)', async ({
    page,
  }) => {
    await page.goto('/app/schedules?scenario=111');
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

    expect(skin.radius).toBe('18px');

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

      await openChiefWindow(page);
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

  test('hero examples: the four canon prompt cards, inert on the fixture face', async ({
    page,
  }) => {
    await page.goto('/app/schedules?scenario=111');

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

    const drafted = await measureComposer('/app/schedules?scenario=111');
    const empty = await measureComposer('/app/schedules?scenario=114');

    expect(drafted.height).toBe(120);
    expect(empty.height).toBe(36);
    expect(drafted.cssHeight).toBe('120px');
    expect(empty.cssHeight).toBe('36px');

    expect(drafted.overflowY).toBe('auto');
    expect(empty.overflowY).toBe('auto');
  });

  test('composer placeholder switches to the steer canon while a turn runs (#624)', async ({
    page,
  }) => {

    const placeholderAt = async (scenario: string) => {
      await page.goto(`/app/schedules?scenario=${scenario}`);
      const composer = page.getByTestId('chief-composer-input');
      await expect(composer).toBeVisible();
      return composer.getAttribute('placeholder');
    };

    expect(await placeholderAt('113')).toBe('发出的话会直接插进总管这一轮');
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

    await page.goto('/app/schedules');
    await expect(drawer(page)).toBeHidden();

    await openChiefWindow(page);
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
