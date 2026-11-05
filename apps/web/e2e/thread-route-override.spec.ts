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
  await expect(dialog.getByTestId('route-override-flag-hint')).toHaveAttribute(
    'data-enabled',
    'false',
  );
  await expect(dialog.getByTestId('route-override-flag-hint')).toContainText(
    'CAIRN_ROUTING_RULES 仍关闭',
  );
  await expect(dialog.getByTestId('route-override-machine')).toBeVisible();
  await dialog.getByTestId('route-override-machine').click();
  await expect(page.getByRole('option', { name: '不固定' })).toBeVisible();
  await page.keyboard.press('Escape');

  await dialog.getByRole('switch', { name: '要求 Orb' }).click();
  await expect(dialog.getByRole('switch', { name: '要求 Orb' })).toBeChecked();
  await expect(dialog.getByTestId('route-override-mcp-r3-mcp')).toBeVisible();
  await dialog.getByRole('switch', { name: '要求安装 r3-mcp' }).click();
  await expect(dialog.getByRole('switch', { name: '要求安装 r3-mcp' })).toBeChecked();
  await dialog.getByTestId('route-override-save').click();
  await expect(dialog).toBeHidden();
});
