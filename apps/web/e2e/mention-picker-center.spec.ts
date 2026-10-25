import { expect, test } from '@playwright/test';

test('mention picker stays centered in the production bundle (#448)', async ({ page }) => {
  await page.goto('/app/todo/r8-15?scenario=chain');
  await page.getByRole('button', { name: '提及' }).click();
  const panel = page.getByRole('dialog', { name: '提及' });
  await expect(panel).toBeVisible();
  await page.waitForTimeout(300); // past the 150ms overlay-pop enter animation
  await expect(panel).toHaveCSS('transform', 'none');
  const rect = await panel.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, width: r.width };
  });
  expect(rect.width).toBe(400);

  expect(Math.abs(rect.x - (1440 - rect.width) / 2)).toBeLessThanOrEqual(1);
});
