import { expect, type Page, test } from '@playwright/test';

const stripBox = (page: Page) =>
  page.getByTestId('settings-tabs').evaluate((el) => {
    const current = el.querySelector('[aria-current="page"]');
    if (current === null) return null;
    const item = current.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return {
      itemLeft: item.left,
      itemRight: item.right,
      stripLeft: box.left,
      stripRight: box.right,
      overflows: el.scrollWidth > el.clientWidth,
    };
  });

test.describe('settings tab strip at phone width', () => {
  test('the last section tab is in view on a direct load (#5042)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/settings/im?scenario=providers-fleet');
    const strip = page.getByTestId('settings-tabs');
    await expect(strip).toBeVisible();
    await expect
      .poll(() => stripBox(page))
      .toMatchObject({ overflows: true });
    const box = await stripBox(page);
    expect(box).not.toBeNull();
    expect(box!.itemLeft).toBeGreaterThanOrEqual(box!.stripLeft);
    expect(box!.itemRight).toBeLessThanOrEqual(box!.stripRight);
  });

  test('switching to a mid-list section keeps its tab in view (#5042)', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/app/settings?scenario=providers-fleet');
    const strip = page.getByTestId('settings-tabs');
    await expect(strip).toBeVisible();
    await strip.locator('[data-settings-section="remote"]').click();
    await expect(strip.locator('[data-settings-section="remote"]')).toHaveAttribute(
      'aria-current',
      'page',
    );
    const box = await stripBox(page);
    expect(box).not.toBeNull();
    expect(box!.itemLeft).toBeGreaterThanOrEqual(box!.stripLeft);
    expect(box!.itemRight).toBeLessThanOrEqual(box!.stripRight);
  });
});
