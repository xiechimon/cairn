import { expect, test } from '@playwright/test';

const DETAIL = '/app/todo/r3-legacy-1?scenario=routing-settings';

test('thread more menu opens the per-todo route override dialog', async ({ page }) => {
  await page.goto(DETAIL);
  await page.getByTestId('side-chat').getByRole('button', { name: '更多操作…' }).click();
  const menu = page.getByRole('menu', { name: '更多' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: '路由覆盖' }).click();

  const dialog = page.getByRole('dialog', { name: '路由覆盖' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('route-override-machine')).toBeVisible();
  await dialog.getByTestId('route-override-machine').click();
  await expect(page.getByRole('option', { name: '不固定' })).toHaveCount(0);
  await expect(page.getByRole('option').first()).toBeVisible();
  await page.keyboard.press('Escape');

  await expect(dialog.getByTestId('route-override-mcp-r3-mcp')).toBeVisible();
  await dialog.getByRole('switch', { name: '要求安装 r3-mcp' }).click();
  await expect(dialog.getByRole('switch', { name: '要求安装 r3-mcp' })).toBeChecked();
  await dialog.getByTestId('route-override-save').click();
  await expect(dialog).toBeHidden();
});
