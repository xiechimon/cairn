import { expect, type Page, test } from '@playwright/test';

const SEAM_VARIANTS = ['light', 'dark'] as const;

const teamRowBox = (page: Page) =>
  page.evaluate(() => {
    const r = document.querySelector('[data-testid="team-row"]')!.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

test.describe('sidebar seam (Paper Grouped)', () => {
  for (const theme of SEAM_VARIANTS) {
    test(`board expanded: no seam, no internal divider (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
      await page.goto('/app?scenario=01');

      const m = await page.evaluate(() => {
        const sidebar = document.querySelector('aside')!;
        const nav = document.querySelector('aside nav')!;
        const ss = getComputedStyle(sidebar);
        return {
          borderRightW: ss.borderRightWidth,
          shadow: ss.boxShadow,
          sidebarW: sidebar.getBoundingClientRect().width,
          navBorderTopW: getComputedStyle(nav).borderTopWidth,
        };
      });

      expect(m.borderRightW).toBe('0px');
      expect(m.shadow).toBe('none');
      expect(m.sidebarW).toBe(220);
      expect(m.navBorderTopW).toBe('0px');
      expect(await teamRowBox(page)).toEqual({ x: 8, y: 0, w: 204, h: 48 });
    });

    test(`schedules page: the workspace row keeps the board geometry (${theme})`, async ({
      page,
    }) => {
      await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
      await page.goto('/app/schedules?scenario=12');
      await expect(page.locator('[data-route="schedules"]')).toBeVisible();
      expect(await teamRowBox(page)).toEqual({ x: 8, y: 0, w: 204, h: 48 });
    });

    test(`rail: no seam either (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => {
        localStorage.setItem('cairn-theme', t);
        localStorage.setItem('cairn.sidebar-collapsed', '1');
      }, theme);
      await page.goto('/app?scenario=01');

      const m = await page.evaluate(() => {
        const rail = document.querySelector('aside')!;
        const ss = getComputedStyle(rail);
        return {
          borderRightW: ss.borderRightWidth,
          shadow: ss.boxShadow,
          railW: rail.getBoundingClientRect().width,
        };
      });

      expect(m.borderRightW).toBe('0px');
      expect(m.shadow).toBe('none');
      expect(m.railW).toBe(48);
    });

    for (const [name, url] of [
      ['pages', '/app/schedules?scenario=11'],
    ] as const) {
      test(`${name} shell: no seam, same workspace row (${theme})`, async ({
        page,
      }) => {
        await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
        await page.goto(url);
        const m = await page.evaluate(() => {
          const ss = getComputedStyle(document.querySelector('aside')!);
          return { borderRightW: ss.borderRightWidth, shadow: ss.boxShadow };
        });
        expect(m.borderRightW).toBe('0px');
        expect(m.shadow).toBe('none');
        expect(await teamRowBox(page)).toEqual({ x: 8, y: 0, w: 204, h: 48 });
      });
    }
  }
});
