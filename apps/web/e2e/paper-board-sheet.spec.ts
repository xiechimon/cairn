import { expect, type Page, test } from '@playwright/test';

// Paper board sheet (paper-redesign-plan PR 7): the board route wears the
// same inset sheet as PageShell, so hopping between the board and any other
// route keeps the main panel still. Failure modes pinned here:
//   1. the board sheet box drifts from the PageShell sheet box (expanded or rail);
//   2. the two sheets look different (radius, fill, ring);
//   3. the 10px gaps are not canvas (root left at the sheet color);
//   4. the sheet becomes <main> and the board header loses role=banner;
//   5. the 总管设置 swap renders outside the sheet, on bare canvas.

const BOARD = '/app?scenario=01';
const SCHEDULES = '/app/schedules?scenario=11';

const sheetOf = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const root = el.parentElement!;
    return {
      box: { x: r.x, y: r.y, w: r.width, h: r.height },
      radius: cs.borderRadius,
      bg: cs.backgroundColor,
      shadow: cs.boxShadow,
      canvas: getComputedStyle(root).backgroundColor,
      sidebarBg: getComputedStyle(root.querySelector('.board-sidebar')!).backgroundColor,
    };
  });

test.use({ viewport: { width: 1440, height: 900 } });

for (const theme of ['light', 'dark'] as const) {
  for (const rail of [false, true]) {
    const label = `${theme}${rail ? ', rail' : ''}`;
    test(`board sheet matches the page shell sheet (${label})`, async ({ page }) => {
      await page.addInitScript(
        ([t, r]) => {
          localStorage.setItem('pacman-theme', t);
          if (r) localStorage.setItem('pacman.sidebar-collapsed', '1');
        },
        [theme, rail] as const,
      );
      await page.goto(BOARD);
      const board = await sheetOf(page, '.board-sheet');
      await page.goto(SCHEDULES);
      const pages = await sheetOf(page, '.page-main');

      const left = rail ? 40 : 248;
      expect(board.box).toEqual({ x: left, y: 10, w: 1440 - left - 10, h: 900 - 20 });
      expect(board).toEqual(pages);
      expect(board.radius).toBe('16px');
      expect(board.shadow).not.toBe('none');
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
  expect(box).toEqual({ x: 248, y: 10, width: 1182, height: 56 });
});

test('总管设置 swaps in inside the same sheet', async ({ page }) => {
  await page.goto('/app?scenario=101');
  const heading = page.locator('.board-sheet').getByRole('heading', { name: '总管设置' });
  await expect(heading).toBeVisible();
  await expect(page.locator('.board-main')).toHaveCount(0);
  const sheet = await sheetOf(page, '.board-sheet');
  expect(sheet.box).toEqual({ x: 248, y: 10, w: 1182, h: 880 });
});
