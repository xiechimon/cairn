import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { PAGES } from '../e2e/audit-pages.js';
import { settleTransitions } from '../e2e/helpers.js';
import { runRules } from './rules.js';

const OUT = process.env.PR_SCREENS_OUT ?? 'pr-screens-out';
const FROZEN_AT = new Date('2026-10-31T14:00:00+08:00');
const WCAG_22_AA = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const ONLY = process.env.PR_SCREENS_PAGES ? new Set(process.env.PR_SCREENS_PAGES.split(',')) : undefined;

const slugOf = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

mkdirSync(OUT, { recursive: true });

test.describe.configure({ mode: 'parallel' });

for (const theme of ['light', 'dark'] as const) {
  for (const p of PAGES) {
    if (ONLY && !ONLY.has(slugOf(p.name))) continue;
    const key = `${slugOf(p.name)}-${theme}`;
    test(`capture: ${p.name} (${theme})`, async ({ page }) => {
      test.setTimeout(60_000);
      try {
        await page.clock.setFixedTime(FROZEN_AT);
        await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.goto(p.url);
        if (p.open) await p.open(page);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(p.ready(page)).toBeVisible();
        await settleTransitions(page);
        await page.screenshot({ path: join(OUT, `${key}.png`), fullPage: true, animations: 'disabled', caret: 'hide' });
        const { violations } = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
        const found = violations.map((v) => ({
          rule: v.id,
          impact: v.impact,
          help: v.help,
          nodes: v.nodes.length,
          targets: v.nodes.map((n) => n.target.join(' ')),
        }));
        writeFileSync(join(OUT, `${key}.axe.json`), `${JSON.stringify(found, null, 1)}\n`);
        try {
          const rules = await runRules(page);
          writeFileSync(join(OUT, `${key}.rules.json`), `${JSON.stringify(rules, null, 1)}\n`);
        } catch (error) {
          writeFileSync(join(OUT, `${key}.rules-error.txt`), `${String(error).slice(0, 600)}\n`);
        }
      } catch (error) {
        writeFileSync(join(OUT, `${key}.error.txt`), `${String(error).slice(0, 600)}\n`);
      }
    });
  }
}
