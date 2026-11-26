import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

interface Surface {
  id: string;
  url: string;
  ready: string;
  highlightedKeywords?: string[];
}

const registry = JSON.parse(readFileSync(new URL('./visual-surfaces.json', import.meta.url), 'utf8')) as {
  surfaces: Surface[];
};
const FIXED_NOW = new Date('2026-11-25T04:00:00Z');

test.use({ timezoneId: 'UTC' });
test.describe.configure({ mode: 'parallel' });

for (const surface of registry.surfaces) {
  for (const theme of ['light', 'dark'] as const) {
    test(`${surface.id} ${theme} pixels stay on baseline`, async ({ page }) => {
      await page.addInitScript((wanted) => {
        window.localStorage.setItem('cairn-theme', wanted);
      }, theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.clock.setFixedTime(FIXED_NOW);
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
      await page.goto(surface.url);
      await expect(page.locator(surface.ready).first()).toBeVisible();
      for (const keyword of surface.highlightedKeywords ?? []) {
        const code = page.getByTestId('md-code');
        const token = code.getByText(keyword, { exact: true });
        await expect(token).toBeVisible();
        const body = await code.evaluate((el) => getComputedStyle(el).color);
        await expect(token).not.toHaveCSS('color', body);
      }
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`${surface.id}-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
        threshold: 0,
        maxDiffPixels: 0,
      });
    });
  }
}
