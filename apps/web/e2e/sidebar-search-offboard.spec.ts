import { expect, type Page, test } from '@playwright/test';

const panel = (page: Page) => page.getByRole('dialog', { name: '搜索' });

for (const [name, url] of [
  ['secondary', '/app/team?scenario=12'],
  ['resources', '/app/resources/skills?scenario=06'],
] as const) {
  test(`${name} page: search row opens the shared panel, Esc closes it`, async ({ page }) => {
    await page.goto(url);
    await expect(panel(page)).toBeHidden();

    await page.getByRole('complementary').getByRole('button', { name: '搜索' }).click();
    await expect(panel(page)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(panel(page)).toBeHidden();
  });
}
