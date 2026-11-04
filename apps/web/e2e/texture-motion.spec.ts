import { expect, type Page, test } from '@playwright/test';

const drift = (page: Page) =>
  page.locator('[data-slot="drift-field"] canvas[data-slot="texture"]').first();

async function pixels(page: Page): Promise<string> {
  return drift(page).evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
}

async function openTexture(page: Page) {
  await page.goto('/design.html#texture');
  await drift(page).scrollIntoViewIfNeeded();
  await expect(drift(page)).toBeVisible();
  await page.waitForTimeout(400);
}

test('the drift field moves while agents run and freezes when they stop', async ({ page }) => {
  await openTexture(page);
  const first = await pixels(page);
  await page.waitForTimeout(700);
  expect(await pixels(page)).not.toBe(first);

  await page.getByRole('switch', { name: 'Agents running' }).click();
  await page.waitForTimeout(200);
  const stopped = await pixels(page);
  await page.waitForTimeout(700);
  expect(await pixels(page)).toBe(stopped);
});

test('reduced motion holds the drift field on one frame', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openTexture(page);
  const first = await pixels(page);
  await page.waitForTimeout(800);
  expect(await pixels(page)).toBe(first);
});

test('switching theme redraws the texture in the other ink', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openTexture(page);
  const dark = await pixels(page);
  await page.getByRole('radio', { name: 'Light' }).first().click();
  await page.waitForTimeout(300);
  expect(await pixels(page)).not.toBe(dark);
});
