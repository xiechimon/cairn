import { expect, type Page, test } from '@playwright/test';
import { evidenceShot } from './evidence';

async function openProviderForm(page: Page) {
  await page.goto('/app/resources/providers?scenario=01');
  await page.getByTestId('routing-add-provider').click();
  const dialog = page.getByRole('dialog', { name: '添加模型服务' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '自定义端点' }).click();
  await expect(dialog.locator('#dlg-provider-id')).toBeVisible();
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  return dialog;
}

test('provider: unchecked state shows no white check (#dlg-provider-authheader id survives)', async ({ page }) => {
  const dialog = await openProviderForm(page);
  const input = dialog.locator('#dlg-provider-authheader');
  await expect(input).toBeChecked();
  await evidenceShot(page, 'provider-checked.png');
  await dialog.locator('[data-slot="checkbox"]').click();
  await expect(input).not.toBeChecked();
  await expect(dialog.locator('[data-slot="checkbox"] svg')).toHaveCount(0);
  await evidenceShot(page, 'provider-unchecked.png');
});
