import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  test.describe(theme, () => {
    test.use({
      viewport: { width: 1440, height: 900 },
      colorScheme: theme,
      reducedMotion: 'reduce',
    });

    test('sidebar and inset sheet share one unpainted canvas gutter', async ({ page }) => {
      await page.goto('/app?scenario=home-c&thread=home-c-review');
      await expect(page.getByTestId('side-chat')).toBeVisible();
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
      expect.soft(canvas.gutter).toBe(canvas.sidebar);
      expect.soft(canvas.gap).toBe(8);
      expect.soft([canvas.top, canvas.bottom, canvas.right]).toEqual([8, 8, 8]);
      expect.soft(canvas.shadow).toBe('none');
      expect.soft(canvas.panelShadow).toBe('none');
      expect([canvas.panelTop, canvas.panelBottom]).toEqual([8, 0]);
    });

    test('needs-you borders have symmetric room inside their scrollport', async ({ page }) => {
      await page.goto('/app?scenario=home-c&thread=home-c-review');
      const tray = page.getByTestId('needs-you');
      await expect(tray.locator('[data-slot="thread-card"]')).toHaveCount(3);
      const edges = await tray.evaluate((node) => {
        const rect = node.getBoundingClientRect();
        const left = rect.left + node.clientLeft;
        const right = left + node.clientWidth;
        return Array.from(node.querySelectorAll('[data-slot="thread-card"]'), (row) => {
          const box = row.getBoundingClientRect();
          return {
            left: box.left - left,
            right: right - box.right,
            top: box.top - rect.top,
            bottom: rect.top + node.clientHeight - box.bottom,
            width: box.width,
          };
        });
      });
      for (const edge of edges) {
        expect.soft(edge.left).toBeGreaterThanOrEqual(8);
        expect.soft(edge.right).toBeGreaterThanOrEqual(8);
        expect.soft(Math.abs(edge.left - edge.right)).toBeLessThanOrEqual(1);
        expect.soft(edge.top).toBeGreaterThanOrEqual(1);
        expect.soft(edge.bottom).toBeGreaterThanOrEqual(1);
        expect(edge.width).toBeGreaterThan(0);
      }
    });
  });
}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`cards and composers clear clipping ancestors at ${width} in ${theme}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await page.goto('/app?scenario=home-c');
      await expect(page.getByTestId('needs-you')).toBeVisible();
      for (const thread of [false, true]) {
        if (thread) {
          await page.goto('/app?scenario=home-c&thread=home-c-review');
          await expect(page.getByTestId('side-chat-action')).toBeVisible();
        }
        const clipped = await page.locator('[data-slot="thread-card"], .chief-composer, .side-panel .composer, [data-testid="side-chat-action"], .side-panel [data-trace-card]').evaluateAll((nodes) => {
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
