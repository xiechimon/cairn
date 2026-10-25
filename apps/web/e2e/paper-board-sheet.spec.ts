import { expect, type Page, test } from '@playwright/test';

const BOARD = '/app?scenario=01';
const SCHEDULES = '/app/schedules?scenario=11';

const sheetOf = (page: Page, selector: string) =>
  page.locator(selector).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const root = el.parentElement!;
    const probe = document.createElement('div');
    probe.style.boxShadow = 'var(--sheet-ring)';
    root.append(probe);
    const ring = getComputedStyle(probe).boxShadow;
    probe.remove();
    return {
      box: { x: r.x, y: r.y, w: r.width, h: r.height },
      radius: cs.borderRadius,
      bg: cs.backgroundColor,
      shadow: getComputedStyle(el, '::after').boxShadow,
      selfShadow: cs.boxShadow,
      ring,
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
      expect(board.box).toEqual({ x: left, y: 10, w: 1440 - left - 10, h: 900 - 20 });
      expect(board).toEqual(pages);
      expect(board.radius).toBe('16px');
      expect(board.ring).toContain('inset');
      expect(board.shadow).toBe(board.ring);
      expect(board.selfShadow).toBe('none');
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

test('chief settings swaps in inside the same sheet', async ({ page }) => {
  await page.goto('/app?scenario=101');
  const heading = page.locator('.board-sheet').getByRole('heading', { name: '总管设置' });
  await expect(heading).toBeVisible();
  await expect(page.locator('.board-main')).toHaveCount(0);
  const sheet = await sheetOf(page, '.board-sheet');
  expect(sheet.box).toEqual({ x: 248, y: 10, w: 1182, h: 880 });
});

test.describe('on a 2x screen', () => {
  test.use({ deviceScaleFactor: 2 });

  test('sheet and card outlines stay one CSS pixel', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
    await page.goto(BOARD);
    const sheet = await page
      .locator('.board-sheet')
      .evaluate((el) => getComputedStyle(el, '::after').boxShadow);
    const card = await page
      .locator('.todo-card')
      .first()
      .evaluate((el) => getComputedStyle(el).boxShadow);
    expect(sheet).toContain('0px 0px 0px 1px inset');
    expect(card).toContain('0px 0px 0px 1px');
    expect(card).not.toContain('0.5px');
  });
});

test('the sheet ring sits above every child of the sheet', async ({ page }) => {
  await page.goto(BOARD);
  const ring = await page.locator('.board-sheet').evaluate((el) => {
    const after = getComputedStyle(el, '::after');
    return {
      isolated: getComputedStyle(el).isolation,
      position: after.position,
      zIndex: after.zIndex,
      pointerEvents: after.pointerEvents,
      inset: [after.top, after.right, after.bottom, after.left],
    };
  });
  expect(ring).toEqual({
    isolated: 'isolate',
    position: 'absolute',
    zIndex: '10',
    pointerEvents: 'none',
    inset: ['0px', '0px', '0px', '0px'],
  });
});
