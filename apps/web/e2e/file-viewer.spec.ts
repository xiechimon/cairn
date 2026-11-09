import { expect, test } from '@playwright/test';

const PROJ = '/app/project/ZAQczKCu0MOAzC1ZqcFlX/files?scenario=r2-24';

test('viewer opens with the placeholder and no selected row', async ({ page }) => {
  await page.goto(PROJ);
  const row = page.getByRole('button', { name: 'README.md', exact: true });
  await expect(row).toBeVisible();
  await expect(page.getByText('请选择一个文件查看')).toBeVisible();
  await expect(row).not.toHaveAttribute('aria-current', 'true');
});

test('clicking a file row selects it and renders the file content', async ({ page }) => {
  await page.goto(PROJ);
  const row = page.getByRole('button', { name: 'README.md', exact: true });
  await row.click();
  await expect(row).toHaveAttribute('aria-current', 'true');
  await expect(page.getByText('托管演示仓')).toBeVisible();
  await expect(page.getByText('请选择一个文件查看')).toHaveCount(0);
});

