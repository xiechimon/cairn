import { test } from '@playwright/test';
import { PAGES } from '../e2e/audit-pages.js';
import { ONLY, prepare, record, recordError, slugOf, THEMES } from './capture-core.js';

test.describe.configure({ mode: 'parallel' });

for (const theme of THEMES) {
  for (const p of PAGES) {
    if (ONLY && !ONLY.has(slugOf(p.name))) continue;
    const key = `${slugOf(p.name)}-${theme}`;
    test(`capture: ${p.name} (${theme})`, async ({ page }) => {
      test.setTimeout(60_000);
      try {
        await prepare(page, theme);
        await page.goto(p.url);
        if (p.open) await p.open(page);
        await record(page, key, theme, p.ready(page));
      } catch (error) {
        recordError(key, error);
      }
    });
  }
}
