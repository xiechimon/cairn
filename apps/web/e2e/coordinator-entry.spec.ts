import { expect, test } from '@playwright/test';
import { pressOpenCoordinator } from './helpers.js';

const ROUTES = [
  ['home', '/app?scenario=home-c'],
  ['pages', '/app/schedules?scenario=11'],
  ['work-routing', '/app/settings/work-routing?scenario=12'],
  ['settings', '/app/settings?scenario=01'],
  ['project', '/app/project/ZAQczKCu0MOAzC1ZqcFlX/tasks?scenario=prj-tasks'],
  ['detail with unread', '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=detail-unread'],
  ['unread at the cap', '/app/schedules?scenario=chief-unread-cap'],
] as const;

test.describe('the Coordinator lives only on the home', () => {
  for (const [name, url] of ROUTES) {
    test(`${name}: no floating launcher or Coordinator window`, async ({ page }) => {
      await page.goto(url);
      await expect(page.locator('[data-route]').first()).toBeVisible();
      await expect(page.locator('.chief-fab')).toHaveCount(0);
      await expect(page.getByRole('complementary', { name: 'Coordinator' })).toHaveCount(0);
      const pathname = new URL(page.url()).pathname;
      const onHome = pathname === '/app' || pathname.startsWith('/app/settings');
      await expect(page.getByTestId('chief-composer-input')).toHaveCount(onHome ? 1 : 0);
    });
  }

  test('off the home, Cmd/Ctrl+J navigates to the Coordinator page with the composer focused', async ({
    page,
  }) => {
    await page.goto('/app/schedules?scenario=11');
    await pressOpenCoordinator(page);
    await expect(page).toHaveURL(/\/app\?scenario=11$/);
    await expect(page.getByTestId('home-c')).toBeVisible();
    await expect(page.getByTestId('chief-composer-input')).toBeFocused();
  });

  test('the sidebar Coordinator row off the home lands on the Coordinator page', async ({ page }) => {
    await page.goto('/app/schedules?scenario=11');
    await page.getByRole('complementary').getByRole('button', { name: /Coordinator/ }).first().click();
    await expect(page).toHaveURL(/\/app(\?|$)/);
    await expect(page.getByTestId('home-c')).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Coordinator' })).toHaveCount(0);
  });

  test('the sidebar Coordinator row closes an open task and lands on the bare Coordinator page', async ({
    page,
  }) => {
    await page.goto('/app?scenario=17b&thread=7ve0iOkQ-JBpSL98zSiGc');
    await expect(page.getByTestId('side-chat')).toBeVisible();
    await expect(page.locator('.board-sidebar')).toHaveCount(0);
    await page.getByTestId('sidebar-reopen').click();
    await page.getByRole('complementary').locator('[data-slot="sidebar-nav-row"]', { hasText: 'Coordinator' }).click();
    await expect(page).toHaveURL(/\/app\?scenario=17b$/);
    await expect(page.getByTestId('side-chat')).toHaveCount(0);
    await expect(page.getByTestId('home-c')).toBeVisible();
    await expect(page.locator('.board-sidebar--collapsed')).toHaveCount(0);
  });
});
