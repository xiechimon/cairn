import { expect, test } from '@playwright/test';

const PAGES = [
  '/app?scenario=home-c',
  '/app?scenario=home-c&pane=tasks',
  '/app?scenario=home-c&pane=made',
  '/app?scenario=home-c-machines&pane=machines',
  '/app?scenario=home-c&thread=home-c-review',
  '/app?scenario=chief-draft',
  '/app/usage',
];

for (const url of PAGES) {
  test(`every count, time and figure on ${url} uses tabular figures, so a changing value keeps its width`, async ({
    page,
  }) => {
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    const proportional = await page.evaluate(() => {
      const unit = /\d|[kKMsmhd%$+−\-:.,/·\s]/g;
      const found: string[] = [];
      for (const el of document.querySelectorAll<HTMLElement>('body *')) {
        if (el.children.length > 0) continue;
        const text = (el.textContent ?? '').trim();
        if (!/\d/.test(text) || text.length > 24) continue;
        if (/[A-Za-z]/.test(text.replace(unit, ''))) continue;
        const box = el.getBoundingClientRect();
        if (box.width <= 1 || box.height <= 1) continue;
        if (getComputedStyle(el).fontVariantNumeric.includes('tabular-nums')) continue;
        found.push(`${text} in ${el.closest('[data-testid]')?.getAttribute('data-testid') ?? el.tagName}`);
      }
      return found;
    });
    expect(proportional).toEqual([]);
  });
}
