import { expect, test } from '@playwright/test';
import { openChiefWindow } from './helpers.js';

const ROUTES = [
  ['board', '/app?scenario=01&view=board'],
  ['home', '/app?scenario=home-c'],
  ['pages', '/app/schedules?scenario=11'],
  ['team', '/app/team?scenario=12'],
  ['detail with unread', '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=detail-unread'],
  ['unread at the cap', '/app?scenario=chief-unread-cap&view=board'],
] as const;

test.describe('no floating chief launcher on any route', () => {
  for (const [name, url] of ROUTES) {
    test(`${name}: no launcher, no unread pill`, async ({ page }) => {
      await page.goto(url);
      await expect(page.locator('[data-route]').first()).toBeVisible();
      await expect(page.locator('.chief-fab')).toHaveCount(0);
      await expect(page.getByRole('button', { name: '总管', exact: true })).toHaveCount(0);
    });
  }

  test('off the home, Cmd/Ctrl+J still opens the chief window', async ({ page }) => {
    await page.goto('/app/schedules?scenario=11');
    await expect(page.locator('.chief-drawer')).toBeHidden();
    await openChiefWindow(page);
    await expect(page.locator('.chief-drawer')).toBeVisible();
  });
});
