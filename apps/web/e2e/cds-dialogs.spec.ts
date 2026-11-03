import { expect, type Page, test } from '@playwright/test';
import { pressAndExpect } from './helpers.js';

const searchPanel = (page: Page) => page.getByRole('dialog', { name: '搜索' });

async function openSearch(page: Page) {
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressAndExpect(page, 'Meta+k', searchPanel(page));
}

test('CDS search panel: 18px edge-radius + de-boxed input', async ({ page }) => {
  await page.goto('/app?scenario=01');
  await openSearch(page);
  const panel = searchPanel(page);

  const m = await panel.evaluate((el) => {
    const cs = getComputedStyle(el);
    const input = el.querySelector('input');
    const ics = input ? getComputedStyle(input) : null;
    return {
      radius: cs.borderTopLeftRadius,
      edgeRadius: getComputedStyle(document.documentElement)
        .getPropertyValue('--edge-radius')
        .trim(),
      inputBorder: ics?.borderTopWidth ?? null,
      inputRadius: ics?.borderTopLeftRadius ?? null,
      inputBg: ics?.backgroundColor ?? null,
    };
  });

  expect(m.edgeRadius).toBe('18px');
  expect(m.radius).toBe('18px');
  expect(m.inputBorder).toBe('0px');
  expect(m.inputRadius).toBe('0px');
  // De-boxed: no filled input plate — transparent / none over the panel surface.
  expect(m.inputBg === 'rgba(0, 0, 0, 0)' || m.inputBg === 'transparent').toBeTruthy();
});
