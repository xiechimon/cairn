import { expect, type Locator, type Page, test } from '@playwright/test';

async function openOnly(page: Page, id: string) {
  await page.goto(`/design.html?only=${id}&theme=light`);
  await page.evaluate(() => document.fonts.ready);
  return page.locator(`[data-gallery-only] figure[data-specimen="${id}"]`);
}

async function leadingIconInsets(chip: Locator) {
  return chip.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const icon = el.querySelector('svg');
    if (icon == null) throw new Error('chip has no leading icon');
    const glyph = icon.getBoundingClientRect();
    return {
      start: glyph.left - box.left,
      top: glyph.top - box.top,
      bottom: box.bottom - glyph.bottom,
    };
  });
}

test.describe('a leading chip icon sits as far from the start edge as from the top and bottom', () => {
  test('every status chip tone', async ({ page }) => {
    const specimen = await openOnly(page, 'status-chip');
    const chips = specimen.locator('[data-slot=badge]');
    await expect(chips).toHaveCount(5);
    for (const chip of await chips.all()) {
      const inset = await leadingIconInsets(chip);
      expect(inset.top).toBeCloseTo(inset.bottom, 1);
      expect(inset.start).toBeCloseTo(inset.top, 1);
    }
  });

  test('the taller wait pill', async ({ page }) => {
    const specimen = await openOnly(page, 'wait-pill-and-header-icon-buttons');
    const inset = await leadingIconInsets(specimen.locator('[data-slot=badge]').first());
    expect(inset.top).toBeCloseTo(inset.bottom, 1);
    expect(inset.start).toBeCloseTo(inset.top, 1);
  });
});

test('the open trace guide runs through the centre of the row icon', async ({ page }) => {
  const specimen = await openOnly(page, 'trace-lines');
  const collapsible = specimen.locator('[data-slot=trace-collapsible]');
  await expect(collapsible.locator('[data-slot=trace-collapsible-content-inner]')).toBeVisible();
  const { guideCentre, iconCentre } = await collapsible.evaluate((el) => {
    const inner = el.querySelector('[data-slot=trace-collapsible-content-inner]');
    const icon = el.querySelector('[data-slot=trace-line] > [data-slot=trace-icon]');
    if (inner == null || icon == null) throw new Error('trace collapsible is missing its parts');
    const guide = inner.getBoundingClientRect();
    const glyph = icon.getBoundingClientRect();
    return {
      guideCentre: guide.left + Number.parseFloat(getComputedStyle(inner).borderLeftWidth) / 2,
      iconCentre: glyph.left + glyph.width / 2,
    };
  });
  expect(guideCentre).toBeCloseTo(iconCentre, 1);
});
