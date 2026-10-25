import { expect, type Page, test } from '@playwright/test';

const BOARD = '/app?scenario=01';
const SCHEDULES = '/app/schedules?scenario=11';

const sheetOf = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const root = el.parentElement!;
    const sidebar = root.querySelector('.board-sidebar')!;
    const sidebarCs = getComputedStyle(sidebar);
    return {
      box: { x: r.x, y: r.y, w: r.width, h: r.height },
      radius: cs.borderRadius,
      bg: cs.backgroundColor,
      shadow: getComputedStyle(el, '::after').boxShadow,
      selfShadow: cs.boxShadow,
      canvas: getComputedStyle(root).backgroundColor,
      sidebarBg: sidebarCs.backgroundColor,
      sidebarBorderRightW: sidebarCs.borderRightWidth,
      sidebarBorderRightColor: sidebarCs.borderRightColor,
    };
  });

test.use({ viewport: { width: 1440, height: 900 } });

for (const theme of ['light', 'dark'] as const) {
  for (const rail of [false, true]) {
    const label = `${theme}${rail ? ', rail' : ''}`;
    test(`board sheet matches the page shell sheet (${label})`, async ({ page }) => {
      await page.addInitScript(
        ([t, r]) => {
          localStorage.setItem('cairn-theme', t);
          if (r) localStorage.setItem('cairn.sidebar-collapsed', '1');
        },
        [theme, rail] as const,
      );
      await page.goto(BOARD);
      const board = await sheetOf(page, '.board-sheet');
      await page.goto(SCHEDULES);
      const pages = await sheetOf(page, '.page-main');

      const left = rail ? 40 : 248;
      expect(board.box).toEqual({ x: left, y: 0, w: 1440 - left, h: 900 });
      expect(board).toEqual(pages);
      expect(board.radius).toBe('0px');
      expect(board.shadow).toBe('none');
      expect(board.selfShadow).toBe('none');
      expect(board.sidebarBorderRightW).toBe('1px');
      expect(board.canvas).toBe(board.sidebarBg);
      expect(board.canvas).not.toBe(board.bg);
    });
  }
}

test('board header stays the banner, at the top of the sheet', async ({ page }) => {
  await page.goto(BOARD);
  const banner = page.locator('[data-route="board"]').getByRole('banner');
  await expect(banner).toHaveCount(1);
  await expect(page.locator('.board-sheet header').first()).toHaveClass(/board-topbar/);
  const box = await banner.boundingBox();
  expect(box).toEqual({ x: 248, y: 0, width: 1192, height: 56 });
});

test('chief settings swaps in inside the same sheet', async ({ page }) => {
  await page.goto('/app?scenario=101');
  const heading = page.locator('.board-sheet').getByRole('heading', { name: '总管设置' });
  await expect(heading).toBeVisible();
  await expect(page.locator('.board-main')).toHaveCount(0);
  const sheet = await sheetOf(page, '.board-sheet');
  expect(sheet.box).toEqual({ x: 248, y: 0, w: 1192, h: 900 });
});

test.describe('on a 2x screen', () => {
  test.use({ deviceScaleFactor: 2 });

  test('sheet stays ringless and card outlines stay one CSS pixel', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
    await page.goto(BOARD);
    const sheet = await page
      .locator('.board-sheet')
      .evaluate((el) => getComputedStyle(el, '::after').boxShadow);
    const card = await page
      .locator('.todo-card')
      .first()
      .evaluate((el) => getComputedStyle(el).boxShadow);
    expect(sheet).toBe('none');
    expect(card).toContain('0px 0px 0px 1px');
    expect(card).not.toContain('0.5px');
  });
});

test('the sheet carries no ring overlay above its children', async ({ page }) => {
  await page.goto(BOARD);
  const probe = await page.locator('.board-sheet').evaluate((el) => {
    const after = getComputedStyle(el, '::after');
    return {
      isolated: getComputedStyle(el).isolation,
      content: after.content,
      position: after.position,
      shadow: after.boxShadow,
    };
  });
  expect(probe).toEqual({
    isolated: 'auto',
    content: 'none',
    position: 'static',
    shadow: 'none',
  });
});
