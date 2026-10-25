import { expect, type Page, test } from '@playwright/test';

const BOARD = '/app?scenario=01';

async function openMenu(page: Page) {
  await page.goto(BOARD);
  // marker proves SPA navigation: a bare anchor would reload and drop it
  await page.evaluate(() => {
    (window as unknown as Record<string, unknown>).__spaMarker = 'alive';
  });

  await page.getByRole('complementary').getByRole('button', { name: 'Xmon Dai' }).click();
  await expect(page.locator('.user-menu')).toBeVisible();
}

const NAV_ROWS = [
  { label: '帐号', url: '/app/account?scenario=01', route: '[data-route="account"]' },
  { label: 'API 密钥', url: '/app/api-keys?scenario=01', route: '[data-route="api-keys"]' },
  {
    label: 'MCP',
    url: '/app/resources/mcp-servers?scenario=01',
    route: '[data-route="/app/resources/mcp-servers"]',
  },
] as const;

for (const row of NAV_ROWS) {
  test(`\`${row.label}\` row SPA-navigates to ${row.url}`, async ({ page }) => {
    await openMenu(page);

    const link = page.locator('.user-menu-row', { hasText: row.label });
    // rendered as a real link carrying the live search — not a dead div
    await expect(link).toHaveAttribute('href', row.url);

    await link.click();
    await expect(page).toHaveURL(row.url);
    // the target surface really rendered
    await expect(page.locator(row.route)).toBeVisible();
    // and the menu closed on the hop
    await expect(page.locator('.user-menu')).toBeHidden();
    // client-side, not through a document reload
    expect(
      await page.evaluate(() => (window as unknown as Record<string, unknown>).__spaMarker),
    ).toBe('alive');
  });
}
