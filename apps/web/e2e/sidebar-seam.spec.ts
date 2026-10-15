import { expect, test } from '@playwright/test';

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
// [data-route="board"] 的首个 header（banner）。.page-topbar/.res-topbar 属
// pages/resources 域，留待各自批次重钉。探针期望值不动（几何零改动）。

const SEAM_VARIANTS = ['light', 'dark'] as const;

test.describe('sidebar seam + full-width divider (dogfood 裁决 v2)', () => {
  for (const theme of SEAM_VARIANTS) {
    test(`board expanded: 1px seam replaces the floating shadow, divider aligns with the topbar border (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
      await page.goto('/app?scenario=01');

      const m = await page.evaluate(() => {
        const sidebar = document.querySelector('aside')!;
        const topbar = document.querySelector('[data-route="board"] header')!;
        const nav = document.querySelector('aside nav')!;
        const team = document.querySelector('[data-testid="team-row"]')!;
        const ss = getComputedStyle(sidebar);
        const ns = getComputedStyle(nav);
        return {
          borderRightW: ss.borderRightWidth,
          borderRightStyle: ss.borderRightStyle,
          borderRightColor: ss.borderRightColor,
          shadow: ss.boxShadow,
          sidebarW: sidebar.getBoundingClientRect().width,
          topbarBorderBColor: getComputedStyle(topbar).borderBottomColor,
          topbarH: topbar.getBoundingClientRect().height,
          navTop: nav.getBoundingClientRect().top,
          navBorderTopW: ns.borderTopWidth,
          navBorderTopColor: ns.borderTopColor,
          teamH: team.getBoundingClientRect().height,
        };
      });

      // CDS PR-3: no solid right border — tier-1 surface + soft hairline shadow
      expect(m.borderRightW).toBe('0px');
      expect(m.shadow).not.toBe('none');
      expect(m.sidebarW).toBe(288);

      // the full-width horizontal: nav border-top on the topbar border row
      expect(m.teamH).toBe(43);
      expect(m.navTop).toBe(43);
      expect(m.navBorderTopW).toBe('1px');
      expect(m.navBorderTopColor).toBe(m.topbarBorderBColor);
      expect(m.topbarH).toBe(44);
    });

    test(`team page: the r7 12 active pill geometry survives the divider row (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
      await page.goto('/app/team?scenario=12');

      const m = await page.evaluate(() => {
        const pill = document.querySelector('[data-testid="team-row"]')!;
        const nav = document.querySelector('aside nav')!;
        const r = pill.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height, navTop: nav.getBoundingClientRect().top };
      });

      // r7 12 probe: pill x8..231 y6..38 — the divider row must not drag it
      expect(m).toMatchObject({ x: 8, y: 6, w: 272, h: 32 });
      expect(m.navTop).toBe(43);
    });

    test(`rail: seam inherits, toggle divider aligns with the topbar border row (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => {
        localStorage.setItem('pacman-theme', t);
        localStorage.setItem('pacman.sidebar-collapsed', '1');
      }, theme);
      await page.goto('/app?scenario=01');

      const m = await page.evaluate(() => {
        const rail = document.querySelector('aside')!;
        const toggle = document.querySelector('button[aria-label="展开侧边栏"]')!;
        const topbar = document.querySelector('[data-route="board"] header')!;
        const ss = getComputedStyle(rail);
        return {
          borderRightW: ss.borderRightWidth,
          borderRightColor: ss.borderRightColor,
          shadow: ss.boxShadow,
          railW: rail.getBoundingClientRect().width,
          toggleBottom: toggle.getBoundingClientRect().bottom,
          toggleBorderB: getComputedStyle(toggle).borderBottomWidth,
          topbarBorderBColor: getComputedStyle(topbar).borderBottomColor,
        };
      });

      expect(m.borderRightW).toBe('0px');
      expect(m.shadow).not.toBe('none');
      expect(m.railW).toBe(40);
      // toggle 44px total = content 43 + 1px border on the y43..44 row
      expect(m.toggleBottom).toBe(44);
      expect(m.toggleBorderB).toBe('1px');
    });

    test(`pages shell: the divider runs full width on schedules too (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
      await page.goto('/app/schedules?scenario=11');

      const m = await page.evaluate(() => {
        const sidebar = document.querySelector('aside')!;
        const topbar = document.querySelector('.page-topbar')!;
        const nav = document.querySelector('aside nav')!;
        return {
          seamColor: getComputedStyle(sidebar).borderRightColor,
          topbarColor: getComputedStyle(topbar).borderBottomColor,
          navTop: nav.getBoundingClientRect().top,
          topbarH: topbar.getBoundingClientRect().height,
        };
      });

      expect(m.navTop).toBe(43);
      expect(m.topbarH).toBe(44);
    });

    test(`resources: the full-width line reads one color across the seam (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
      await page.goto('/app/resources/skills?scenario=06');

      const m = await page.evaluate(() => {
        // 并集解（#943×#944）：侧栏/nav = board 域重钉（aside 语义载体），
        // topbar = resources 域重钉（#944 的 resource-topbar testid）。
        const sidebar = document.querySelector('aside')!;
        const topbar = document.querySelector('[data-testid="resource-topbar"]')!;
        const nav = document.querySelector('aside nav')!;
        return {
          seamColor: getComputedStyle(sidebar).borderRightColor,
          topbarColor: getComputedStyle(topbar).borderBottomColor,
          navColor: getComputedStyle(nav).borderTopColor,
          navTop: nav.getBoundingClientRect().top,
        };
      });

      // horizontal divider still shares the topbar token; vertical seam retired
      expect(m.navColor).toBe(m.topbarColor);
      expect(m.navTop).toBe(43);
    });
  }
});
