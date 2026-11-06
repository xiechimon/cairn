import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { findLowContrast } from './contrast-probe.js';
import { PAGES } from './audit-pages.js';
import { settleTransitions } from './helpers.js';

// #1442: axe-core (WCAG 2.1 A/AA) over the main pages, light and dark. Any
// violation fails the test with its rule id, impact and first targets.
//
// Failure modes this file pins:
//  1. A control loses its accessible name (button-name, label, link-name):
//     agent detail's four settings selects and machine detail's evacuate
//     select had none before #1442.
//  2. A colour change drops text below 4.5:1 (color-contrast) in either theme.
//  3. ARIA misuse (aria-allowed-attr, aria-required-children, …) on any of
//     these pages.
//  4. A false green: the scan runs before the page renders. Each page waits
//     for its own body content (`ready`), not the shell heading, first.
//  5. A false dark run: the stored theme does not take. The test checks
//     <html data-theme> before scanning.

// Every test opens its own page, so the file runs in parallel (the config
// default is one worker per file).
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
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
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
