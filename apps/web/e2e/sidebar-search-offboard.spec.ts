import { expect, type Page, test } from '@playwright/test';

const panel = (page: Page) => page.getByRole('dialog', { name: '搜索' });

for (const [name, url] of [
  ['schedules panel', '/app?scenario=12&pane=tasks&tab=scheduled'],
] as const) {
  test(`${name}: search row opens the shared panel, Esc closes it`, async ({ page }) => {
    await page.goto(url);
    await expect(panel(page)).toBeHidden();
    await page.getByTestId('sidebar-reopen').click();
    await expect(page.getByTestId('sidebar-schedules')).toHaveAttribute('aria-current', 'page');

    await page.getByRole('complementary').getByRole('button', { name: '搜索' }).click();
    await expect(panel(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
  });
}
