import { expect, type Page, test } from '@playwright/test';

const DUPLICATES = '/app/settings/machines?scenario=machines-duplicate-names';

const settings = (page: Page) => page.getByRole('dialog', { name: '设置' });

test('machines with the same name get an id suffix in the rows and the migrate picker', async ({
  page,
}) => {
  await page.goto(DUPLICATES);
  const rows = settings(page).getByTestId('machine-item');
  await expect(rows).toHaveCount(4);
  const twins = rows.filter({ hasText: 'build-box' });
  await expect(twins).toHaveCount(2);
  await expect(twins.getByTestId('machine-secondary')).toHaveText(['#dbox', '#b7q2']);
  await expect(rows.filter({ hasText: 'omarchy' }).getByTestId('machine-secondary')).toHaveCount(0);

  await twins.first().getByTestId('machine-menu').click();
  await page.getByTestId('machine-menu-evacuate').click();
  await page.locator('.machine-evacuate-select').click();
  await expect(page.locator('.machine-evacuate-row', { hasText: 'build-box' })).toContainText(
    '#b7q2',
  );
});

test('an offline machine keeps only its current status in the compact row', async ({ page }) => {
  await page.goto(DUPLICATES);
  const row = settings(page).getByTestId('machine-item').filter({ hasText: 'old-laptop' });
  await expect(row.getByTestId('machine-item-status')).toHaveText('离线');
  await expect(row.getByTestId('machine-last-seen')).toHaveCount(0);
});
