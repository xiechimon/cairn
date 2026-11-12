import { expect, test } from '@playwright/test';
import { mockLive, THREAD, toolRow } from './chief-home-mock.js';
import { openReplySteps } from './helpers.js';

const command = `git diff -- ${'long-unbroken-command'.repeat(80)}`;

for (const width of [1440, 375]) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${width} ${theme}: conversation contains long inline code and isolates scrolling`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme: theme });
      await mockLive(page, {
        threads: [THREAD],
        messages: [
          { id: 'u', role: 'user', content: `Inspect \`${command}\``, createdAt: 10 },
          toolRow('tool', 'thread_report', {}, 11),
          { id: 'a', role: 'assistant', content: `Run \`${command}\`\n\n\`\`\`sh\n${command}\n\`\`\``, createdAt: 12 },
        ],
      });
      await page.goto('/app');
      const scroller = page.getByTestId('home-c').getByTestId('chief-body');
      await expect(scroller).toBeVisible();
      await page.evaluate((light) => document.documentElement.classList.toggle('light', light), theme === 'light');
      await openReplySteps(page, page.getByTestId('home-c').getByTestId('chief-msg').last());
      const summary = page.getByTestId('chief-tools-toggle').first();
      await summary.scrollIntoViewIfNeeded();
      await scroller.getByTestId('md-code').scrollIntoViewIfNeeded();
      const geometry = await scroller.evaluate((el) => ({ width: el.clientWidth, scroll: el.scrollWidth }));
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
      await expect(scroller).not.toHaveCSS('overscroll-behavior-x', 'auto');
      await expect(scroller).not.toHaveCSS('overscroll-behavior-y', 'auto');
      const ancestors = await scroller.evaluate((el) => {
        const values = [];
        for (let parent = el.parentElement; parent; parent = parent.parentElement) {
          const css = getComputedStyle(parent);
          values.push([css.overscrollBehaviorX, css.overscrollBehaviorY]);
        }
        return values;
      });
      expect(ancestors.flat()).not.toContain('auto');
      const inline = scroller.locator('code').first();
      expect(await inline.evaluate((el) => getComputedStyle(el).overflowWrap)).toBe('anywhere');
      const code = scroller.getByTestId('md-code').locator('xpath=..');
      expect(await code.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      await code.evaluate((el) => { el.scrollLeft = 100; });
      expect(await code.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
      await scroller.evaluate((el) => { el.scrollLeft = 100; });
      expect(await scroller.evaluate((el) => el.scrollLeft)).toBe(0);
      for (const button of await page.getByTestId('home-c').locator('button').all()) {
        if (!(await button.isVisible()) || !(await button.isEnabled()) || await button.getAttribute('aria-hidden') === 'true') continue;
        const block = button.locator('xpath=ancestor::*[@data-slot="reply-block"][1]');
        if ((await block.count()) > 0) await block.hover({ position: { x: 4, y: 4 } });
        await button.hover();
        await expect(button).toHaveCSS('transition-duration', '0s');
        await expect(button).toHaveCSS('box-shadow', 'none');
        await page.mouse.down();
        await expect(button).toHaveCSS('box-shadow', 'none');
        await page.mouse.move(0, 0);
        await page.mouse.up();
      }
    });
  }
}

for (const theme of ['light', 'dark']) {
  test(`gallery ${theme}: shared trace feedback stays flat and immediate`, async ({ page }) => {
    await page.goto(`/design.html?only=step-kinds&theme=${theme}&w=375`);
    const row = page.locator('[data-trace-card] button').first();
    await row.hover();
    await expect(row).toHaveCSS('transition-duration', '0s');
    await expect(row).toHaveCSS('box-shadow', 'none');
    await page.mouse.down();
    await expect(row).toHaveCSS('box-shadow', 'none');
    await page.mouse.up();
  });
}
