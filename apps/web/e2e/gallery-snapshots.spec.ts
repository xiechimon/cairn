import { expect, type Page, test } from '@playwright/test';

const FROZEN_AT = new Date('2026-10-31T14:00:00+08:00');
const THEMES = ['light', 'dark'] as const;

test.use({ viewport: { width: 1280, height: 2400 }, reducedMotion: 'reduce' });

async function openGallery(page: Page, theme: (typeof THEMES)[number]) {
  await page.clock.install({ time: FROZEN_AT });
  await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
  await page.goto('/design.html');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('figure > figcaption').first()).toBeVisible();
}

test.describe('baselines', () => {
  test.skip(
    process.platform !== 'linux' && process.env.GALLERY_SNAPSHOTS_LOCAL !== '1',
    'Baselines are rendered on Linux CI; pull them with scripts/gallery-snapshots-accept.mjs',
  );

  for (const theme of THEMES) {
    test(`every gallery specimen matches its ${theme} baseline`, async ({ page }) => {
      test.setTimeout(240_000);
      await openGallery(page, theme);
      const figures = page.locator('figure:has(> figcaption)');
      const total = await figures.count();
      const seen = new Set<string>();
      let shot = 0;
      for (let i = 0; i < total; i += 1) {
        const figure = figures.nth(i);
        const nested = await figure.evaluate((el) => el.parentElement?.closest('figure') != null);
        const framed = (await figure.locator('iframe').count()) > 0;
        if (nested || framed) continue;
        const id = await figure.getAttribute('data-specimen');
        if (id == null || id === '') throw new Error(`figure ${i} has no data-specimen id`);
        if (seen.has(id)) throw new Error(`two gallery specimens share the id ${id}`);
        seen.add(id);
        await figure.scrollIntoViewIfNeeded();
        await figure.evaluate((el: HTMLElement) => {
          const box = el.getBoundingClientRect();
          el.style.position = 'relative';
          el.style.left = `${Math.ceil(box.left) - box.left}px`;
          el.style.top = `${Math.ceil(box.top) - box.top}px`;
        });
        await expect.soft(figure).toHaveScreenshot(`${id}-${theme}.png`, {
          animations: 'disabled',
          caret: 'hide',
          maxDiffPixelRatio: 0.001,
        });
        shot += 1;
      }
      expect(shot).toBeGreaterThan(80);
    });
  }
});

async function openOnly(page: Page, query: string) {
  await page.clock.install({ time: FROZEN_AT });
  await page.goto(`/design.html?${query}`);
  await page.evaluate(() => document.fonts.ready);
  return page.locator('[data-gallery-only]');
}

test.describe('?only= addresses one specimen', () => {
  test('renders just that specimen in the requested theme and width', async ({ page }) => {
    const root = await openOnly(page, 'only=pr-card&theme=light&w=375');
    await expect(root.locator('figure[data-specimen]')).toHaveCount(1);
    await expect(root.locator('figure[data-specimen]').first()).toHaveAttribute('data-specimen', 'pr-card');
    await expect(page.locator('html')).toHaveClass(/\blight\b/);
    await expect(page.locator('figure')).toHaveCount(1);
    const outside = await root.evaluate((el) => {
      const text = (node: Element | null) => node?.textContent?.trim() ?? '';
      return text(el).replace(text(el.querySelector('figure')), '').trim();
    });
    expect(outside).toBe('');
    const width = await root.locator('figure[data-specimen]').evaluate((el) => el.getBoundingClientRect().width);
    expect(width).toBe(375);
  });

  test('takes the theme from the URL over the stored one', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('cairn-theme', 'light'));
    await openOnly(page, 'only=sizes-2&theme=dark');
    await expect(page.locator('figure[data-specimen="sizes-2"]')).toBeVisible();
    await expect(page.locator('html')).not.toHaveClass(/\blight\b/);
  });

  test('renders nothing outside specimens when the id is unknown', async ({ page }) => {
    const root = await openOnly(page, 'only=no-such-specimen');
    await expect(root).toBeAttached();
    expect(await root.evaluate((el) => el.textContent?.trim() ?? '')).toBe('');
    await expect(page.locator('figure')).toHaveCount(0);
  });
});
