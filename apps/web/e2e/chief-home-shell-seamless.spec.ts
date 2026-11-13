import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({
      viewport: { width: 1440, height: 900 },
      colorScheme: theme,
      reducedMotion: 'reduce',
    });

    test('sheet hairline and conversation divider remain visible at one CSS pixel', async ({ page }) => {
      await page.goto('/app?scenario=home-c&thread=home-c-review');
      await expect(page.getByTestId('side-chat')).toBeVisible();
      await page.getByTestId('sidebar-reopen').click();
      await expect(page.locator('.board-sidebar')).toBeVisible();
      const lines = await page.evaluate(() => {
        const sheet = document.querySelector('.board-sheet');
        const panel = document.querySelector('.side-panel');
        if (!sheet || !panel) throw new Error('Missing shell');
        const card = sheet.getBoundingClientRect();
        const pane = panel.getBoundingClientRect();
        const token = document.createElement('div');
        token.style.borderColor = 'var(--border)';
        document.body.append(token);
        const color = getComputedStyle(token).borderColor;
        token.remove();
        const border = getComputedStyle(sheet);
        const divider = getComputedStyle(panel);
        return {
          color,
          cardBackground: border.backgroundColor,
          panelBackground: divider.backgroundColor,
          widths: [border.borderTopWidth, border.borderRightWidth, border.borderBottomWidth, border.borderLeftWidth],
          colors: [border.borderTopColor, border.borderRightColor, border.borderBottomColor, border.borderLeftColor],
          styles: [border.borderTopStyle, border.borderRightStyle, border.borderBottomStyle, border.borderLeftStyle],
          radius: border.borderRadius,
          dividerWidth: divider.borderLeftWidth,
          dividerColor: divider.borderLeftColor,
          dividerStyle: divider.borderLeftStyle,
          dividerHeight: pane.height,
          dividerInsideSheet: pane.left > card.left && pane.right <= card.right,
          visible: divider.visibility === 'visible' && divider.display !== 'none' && divider.opacity === '1',
        };
      });
      expect.soft(lines.widths).toEqual(['0px', '0px', '0px', '1px']);
      expect.soft(lines.colors[3]).toBe(lines.color);
      expect.soft(lines.styles[3]).toBe('solid');
      expect.soft(lines.color).not.toMatch(/transparent|rgba\([^)]*, 0\)/);
      expect.soft(lines.color).not.toBe(lines.cardBackground);
      expect.soft(lines.color).not.toBe(lines.panelBackground);
      expect.soft(lines.radius).toBe('0px');
      expect.soft(lines.dividerWidth).toBe('1px');
      expect.soft(lines.dividerColor).toBe(lines.color);
      expect.soft(lines.dividerStyle).toBe('solid');
      expect.soft(lines.dividerHeight).toBeGreaterThan(800);
      expect.soft(lines.dividerInsideSheet).toBe(true);
      expect(lines.visible).toBe(true);
    });

    test('the flat sheet meets the sidebar edge to edge with no gutter', async ({ page }) => {
      await page.goto('/app?scenario=home-c&thread=home-c-review');
      await expect(page.getByTestId('side-chat')).toBeVisible();
      await page.getByTestId('sidebar-reopen').click();
      await expect(page.locator('.board-sidebar')).toBeVisible();
      const canvas = await page.evaluate(() => {
        const sidebar = document.querySelector('.board-sidebar');
        const sheet = document.querySelector('.board-sheet');
        const panel = document.querySelector('.side-panel');
        if (!sidebar || !sheet || !panel) throw new Error('Missing shell');
        const side = sidebar.getBoundingClientRect();
        const card = sheet.getBoundingClientRect();
        const x = side.right + 4;
        const y = card.top + card.height / 2;
        let gutter = document.elementFromPoint(x, y);
        while (gutter && getComputedStyle(gutter).backgroundColor === 'rgba(0, 0, 0, 0)') {
          gutter = gutter.parentElement;
        }
        return {
          sidebar: getComputedStyle(sidebar).backgroundColor,
          gutter: gutter ? getComputedStyle(gutter).backgroundColor : null,
          gap: card.left - side.right,
          top: card.top,
          bottom: innerHeight - card.bottom,
          right: innerWidth - card.right,
          shadow: getComputedStyle(sheet).boxShadow,
          panelShadow: getComputedStyle(panel).boxShadow,
          panelTop: panel.getBoundingClientRect().top,
          panelBottom: panel.getBoundingClientRect().bottom - card.bottom,
        };
      });
      expect.soft(canvas.gap).toBe(0);
      expect.soft([canvas.top, canvas.bottom, canvas.right]).toEqual([0, 0, 0]);
      expect.soft(canvas.shadow).toBe('none');
      expect.soft(canvas.panelShadow).toBe('none');
      expect([canvas.panelTop, canvas.panelBottom]).toEqual([0, 0]);
    });
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`cards and composers clear clipping ancestors at ${width} in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('/app?scenario=home-c');
      await expect(page.getByTestId('home-c').locator('.chief-composer')).toBeVisible();
      for (const thread of [false, true]) {
        if (thread) {
          await page.goto('/app?scenario=home-c&thread=home-c-review');
          await expect(page.locator('.side-panel .composer')).toBeVisible();
        }
        const clipped = await page.locator('[data-slot="thread-card"], [data-testid="chief-task-ref"], .chief-composer, .side-panel .composer, [data-testid="side-chat-action"], .side-panel [data-trace-card]').evaluateAll((nodes) => {
          const failures: string[] = [];
          for (const node of nodes) {
            const box = node.getBoundingClientRect();
            for (let parent = node.parentElement; parent; parent = parent.parentElement) {
              const style = getComputedStyle(parent);
              if (!['auto', 'scroll', 'hidden', 'clip'].includes(style.overflowX)) continue;
              const rect = parent.getBoundingClientRect();
              const left = rect.left + parent.clientLeft;
              const right = left + parent.clientWidth;
              if (box.left - 1 < left || box.right + 1 > right) {
                failures.push(`${node.getAttribute('data-slot') ?? node.className}: ${box.left}..${box.right} clipped by ${left}..${right}`);
              }
            }
          }
          return failures;
        });
        expect(clipped).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
      }
    });
  }
}
