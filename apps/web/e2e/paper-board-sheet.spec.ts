import { expect, type Page, test } from '@playwright/test';

const HOME = '/app?scenario=01';
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
      borderLeftWidth: cs.borderLeftWidth,
      borderTopWidth: cs.borderTopWidth,
    };
  });

test.use({ viewport: { width: 1440, height: 900 } });

for (const theme of ['light', 'dark'] as const) {
  for (const rail of [false, true]) {
    const label = `${theme}${rail ? ', rail' : ''}`;
    test(`home sheet is the same flat sheet as the page shell (${label})`, async ({ page }) => {
      await page.addInitScript(
        ([t, r]) => {
          localStorage.setItem('cairn-theme', t);
          if (r) localStorage.setItem('cairn.sidebar-collapsed', '1');
        },
        [theme, rail] as const,
      );
      await page.goto(HOME);
      const home = await sheetOf(page, '.board-sheet');
      await page.goto(SCHEDULES);
      const pages = await sheetOf(page, '.page-main');

      const left = rail ? 48 : 220;
      expect(home.box).toEqual({ x: left, y: 0, w: 1440 - left, h: 900 });
      expect(home).toEqual(pages);
      expect(home.radius).toBe('0px');
      expect(home.borderLeftWidth).toBe('1px');
      expect(home.borderTopWidth).toBe('0px');
      expect(home.shadow).toBe('none');
      expect(home.selfShadow).toBe('none');
      expect(home.sidebarBorderRightW).toBe('0px');
      expect(home.sidebarBg).toBe(home.bg);
      expect(home.canvas).not.toBe(home.bg);
    });
  }
}

test('chief settings swaps in inside the same sheet', async ({ page }) => {
  await page.goto('/app?scenario=101');
  const heading = page.locator('.board-sheet').getByRole('heading', { name: 'Coordinator 设置' });
  await expect(heading).toBeVisible();
  await expect(page.getByTestId('home-c')).toHaveCount(0);
  const sheet = await sheetOf(page, '.board-sheet');
  expect(sheet.box).toEqual({ x: 220, y: 0, w: 1220, h: 900 });
});

test.describe('on a 2x screen', () => {
  test.use({ deviceScaleFactor: 2 });

  test('sheet stays ringless', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
    await page.goto(HOME);
    const sheet = await page
      .locator('.board-sheet')
      .evaluate((el) => getComputedStyle(el, '::after').boxShadow);
    expect(sheet).toBe('none');
  });
});

test('the sheet isolates its stacking context and carries no ring overlay above its children', async ({ page }) => {
  await page.goto(HOME);
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
    isolated: 'isolate',
    content: 'none',
    position: 'static',
    shadow: 'none',
  });
});
