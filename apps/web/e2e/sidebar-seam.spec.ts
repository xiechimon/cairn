import { expect, type Page, test } from '@playwright/test';

// Issue #135 acceptance (dogfood 裁决 v2, revising #123's 柔边不画缝):
// CDS PR-3: vertical seam retires to surface-1 + soft hairline shadow; the
// top divider still runs the FULL viewport width:
// the sidebar's team-row divider sits on the same pixel row (y43..44) as
// every shell's topbar border-bottom, crossing at the seam. Geometry law:
// expanded team-row 43px + .sidebar-nav border-top 1px; the r7 12 active
// pill (y6..38, 32px) survives via the --active margin, untouched; the
// rail toggle grows to 44px so its divider aligns with the topbar border
// too (r7 03's y42..43 divider realigned by the 裁决, registered in
// 01 §8). Viewport is the e2e canon 1440×732.
// #943/#910 重钉：本域载体换语义钩子——侧栏 = aside（complementary）、
// nav 段 = aside nav、团队头行 = data-testid="team-row"（二级：无 role 的
// 结构探针位）、rail 展开钮 = button[aria-label="展开侧边栏"]、board 顶栏 =
// [data-route="board"] 的首个 header（banner）。.res-topbar 属
// pages/resources 域，留待各自批次重钉。探针期望值不动（几何零改动）。
//
// Paper Grouped sidebar (DESIGN.md 侧栏) retires the full-width divider law:
// the sidebar sits on canvas with no internal rule (the mockup has none),
// so nothing inside it aligns to the topbar border any more. What stays is
// the soft seam (no solid border, hairline shadow) and a route-invariant
// workspace row: the /app/team active face repaints, it does not move.

const SEAM_VARIANTS = ['light', 'dark'] as const;

const teamRowBox = (page: Page) =>
  page.evaluate(() => {
    const r = document.querySelector('[data-testid="team-row"]')!.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });

test.describe('sidebar seam (Paper Grouped)', () => {
  for (const theme of SEAM_VARIANTS) {
    test(`board expanded: soft seam, no internal divider (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
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
      expect(m.shadow).not.toBe('none');
      expect(m.sidebarW).toBe(248);
      expect(m.navBorderTopW).toBe('0px');
      // workspace row: 40px tall inside the 12px sidebar padding
      expect(await teamRowBox(page)).toEqual({ x: 12, y: 12, w: 224, h: 40 });
    });

    test(`team page: the active workspace row keeps the board geometry (${theme})`, async ({
      page,
    }) => {
      await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
      await page.goto('/app/team?scenario=12');
      await expect(page.getByRole('link', { name: 'Pacman' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(await teamRowBox(page)).toEqual({ x: 12, y: 12, w: 224, h: 40 });
    });

    test(`rail: the seam inherits (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => {
        localStorage.setItem('pacman-theme', t);
        localStorage.setItem('pacman.sidebar-collapsed', '1');
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
      expect(m.shadow).not.toBe('none');
      expect(m.railW).toBe(40);
    });

    for (const [name, url] of [
      ['pages', '/app/schedules?scenario=11'],
      ['resources', '/app/resources/skills?scenario=06'],
    ] as const) {
      test(`${name} shell carries the same seam and workspace row (${theme})`, async ({
        page,
      }) => {
        await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
        await page.goto(url);
        const m = await page.evaluate(() => {
          const ss = getComputedStyle(document.querySelector('aside')!);
          return { borderRightW: ss.borderRightWidth, shadow: ss.boxShadow };
        });
        expect(m.borderRightW).toBe('0px');
        expect(m.shadow).not.toBe('none');
        expect(await teamRowBox(page)).toEqual({ x: 12, y: 12, w: 224, h: 40 });
      });
    }
  }
});
