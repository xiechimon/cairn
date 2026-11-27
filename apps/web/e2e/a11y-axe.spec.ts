import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { findLowContrast } from './contrast-probe.js';
import { PAGES } from './audit-pages.js';
import { settleTransitions } from './helpers.js';

test.describe.configure({ mode: 'parallel' });

for (const theme of ['light', 'dark'] as const) {
  for (const p of PAGES) {
    test(`axe: ${p.name} (${theme})`, async ({ page }) => {
      await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
      // Reduced motion ends the dialog fade/zoom keyframes at once (motion.css),
      // so color-contrast reads final colours; settleTransitions below covers
      // the transitions it leaves alone.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(p.url);
      if (p.open) await p.open(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(p.ready(page)).toBeVisible();
      await settleTransitions(page);
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      const found = violations.map((v) => ({
        rule: v.id,
        impact: v.impact,
        targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')),
      }));
      expect(found, `axe violations on ${p.name} (${theme})`).toEqual([]);
      expect(await findLowContrast(page), `low contrast outside axe on ${p.name} (${theme})`).toEqual([]);
    });
  }
}
