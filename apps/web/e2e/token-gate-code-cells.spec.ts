import { expect, test } from '@playwright/test';

test('a full 32-character pairing code fills the grid without adding a cell', async ({ page }) => {
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    (route) =>
      route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"unauthorized"}' }),
  );
  await page.goto('/app');
  const gate = page.locator('.token-gate');
  await expect(gate).toBeVisible();
  const cells = gate.locator('.grid > span');
  await expect(cells).toHaveCount(32);
  await page.locator('#cairn-pair-input').fill('Ab3dEf6hIj9lMn2pQr5tUv8xYz1bCd4f');
  await expect(cells.last()).toHaveText('f');
  await expect(cells).toHaveCount(32);
});
