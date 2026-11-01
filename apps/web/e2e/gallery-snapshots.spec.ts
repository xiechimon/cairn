import { expect, type Page, test } from '@playwright/test';

const FROZEN_AT = new Date('2026-10-31T14:00:00+08:00');
const THEMES = ['light', 'dark'] as const;

test.skip(
  process.platform !== 'linux' && process.env.GALLERY_SNAPSHOTS_LOCAL !== '1',
  'Baselines are rendered on Linux CI; pull them with scripts/gallery-snapshots-accept.mjs',
);

test.use({ viewport: { width: 1280, height: 2400 }, reducedMotion: 'reduce' });

async function openGallery(page: Page, theme: (typeof THEMES)[number]) {
  await page.clock.install({ time: FROZEN_AT });
  await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
  await page.goto('/design.html');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('figure > figcaption').first()).toBeVisible();
}

function slugOf(title: string, seen: Map<string, number>) {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  const count = (seen.get(base) ?? 0) + 1;
  seen.set(base, count);
  return count === 1 ? base : `${base}-${count}`;
}

for (const theme of THEMES) {
  test(`every gallery specimen matches its ${theme} baseline`, async ({ page }) => {
    test.setTimeout(240_000);
    await openGallery(page, theme);
    const figures = page.locator('figure:has(> figcaption)');
    const total = await figures.count();
    const seen = new Map<string, number>();
    let shot = 0;
    for (let i = 0; i < total; i += 1) {
      const figure = figures.nth(i);
      const nested = await figure.evaluate((el) => el.parentElement?.closest('figure') != null);
      const framed = (await figure.locator('iframe').count()) > 0;
      if (nested || framed) continue;
      const title = (await figure.locator('figcaption > span').first().textContent()) ?? `figure-${i}`;
      const slug = slugOf(title.trim(), seen);
      await figure.scrollIntoViewIfNeeded();
      await figure.evaluate((el: HTMLElement) => {
        const box = el.getBoundingClientRect();
        el.style.position = 'relative';
        el.style.left = `${Math.ceil(box.left) - box.left}px`;
        el.style.top = `${Math.ceil(box.top) - box.top}px`;
      });
      await expect.soft(figure).toHaveScreenshot(`${slug}-${theme}.png`, {
        animations: 'disabled',
        caret: 'hide',
        maxDiffPixelRatio: 0.001,
      });
      shot += 1;
    }
    expect(shot).toBeGreaterThan(80);
  });
}
