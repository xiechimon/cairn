import { expect, type Page, test } from '@playwright/test';
import { pressAndExpect } from './helpers.js';

const searchPanel = (page: Page) => page.getByRole('dialog', { name: '搜索' });

async function openSearch(page: Page) {
  await expect(page.getByRole('complementary')).toBeVisible();
  await pressAndExpect(page, 'Meta+k', searchPanel(page));
}

test('CDS search panel: 16px edge-radius + de-boxed input', async ({ page }) => {
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

  expect(m.edgeRadius).toBe('16px');
  expect(m.radius).toBe('16px');
  expect(m.inputBorder).toBe('0px');
  expect(m.inputRadius).toBe('0px');
  // De-boxed: no filled input plate — transparent / none over the panel surface.
  expect(m.inputBg === 'rgba(0, 0, 0, 0)' || m.inputBg === 'transparent').toBeTruthy();
});

test('Paper user-menu: 18px + shadow-popover, no solid border', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=17');
  await expect(page.locator('.user-menu')).toBeVisible();

  const m = await page.locator('.user-menu').evaluate((el) => {
    const cs = getComputedStyle(el);
    const probe = document.createElement('div');
    probe.style.boxShadow = 'var(--shadow-popover)';
    document.body.appendChild(probe);
    const popShadow = getComputedStyle(probe).boxShadow;
    probe.remove();
    return {
      radius: cs.borderTopLeftRadius,
      border: cs.borderTopWidth,
      shadow: cs.boxShadow,
      popShadow,
      radiusPopover: getComputedStyle(document.documentElement)
        .getPropertyValue('--radius-popover')
        .trim(),
    };
  });
  expect(m.radiusPopover).toBe('18px');
  expect(m.radius).toBe('18px');
  expect(m.border).toBe('0px');
  expect(m.shadow).not.toBe('none');
  expect(m.shadow).toContain('0px 0px 0px 1px');
  expect(m.shadow.includes('8px 28px') || m.shadow.includes('8px 24px')).toBeTruthy();
});
