import { expect, type Page, test } from '@playwright/test';

const MACHINES = '/app/resources/machines?scenario=06';

async function openDialog(page: Page) {
  await page.goto(MACHINES);
  await page.getByRole('button', { name: '添加机器' }).click();
  const dialog = page.getByRole('dialog', { name: '添加机器' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('`添加机器` button opens the dialog with the two-step command blocks', async ({ page }) => {
  const dialog = await openDialog(page);
  await expect(dialog).toHaveAccessibleName('添加机器');
  await expect(dialog.getByText('有条件时优先使用云主机')).toContainText('有条件时优先使用云主机');

  await expect(dialog.getByText("授权团队 Xmon Dai's team 后机器即可上线")).toContainText(
    "授权团队 Xmon Dai's team 后机器即可上线",
  );
  const commands = dialog.locator('code');
  await expect(commands).toHaveCount(2);
  await expect(commands.nth(0)).toHaveText('npm install -g @xiechimon/cairn-cli@latest');
  await expect(commands.nth(1)).toHaveText('cairn start');
  // API key disclosure collapsed by default
  await expect(
    dialog.getByRole('button', { name: '在云服务器上运行？改用 API key 注册' }),
  ).toBeVisible();
  await expect(dialog.getByRole('link', { name: '获取 API key →' })).toHaveCount(0);
});

test('family law: X, Escape and backdrop dismiss; panel clicks do not', async ({ page }) => {
  let dialog = await openDialog(page);
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(page.getByRole('dialog', { name: '添加机器' })).toBeHidden();

  dialog = await openDialog(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '添加机器' })).toBeHidden();

  dialog = await openDialog(page);
  await dialog.getByTestId('dialog-head').click();
  await expect(page.getByRole('dialog', { name: '添加机器' })).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(page.getByRole('dialog', { name: '添加机器' })).toBeHidden();
});

test('API key disclosure expands the key command and the api-keys link', async ({ page }) => {
  const dialog = await openDialog(page);
  const toggle = dialog.getByRole('button', { name: '在云服务器上运行？改用 API key 注册' });
  await toggle.click();

  await expect(dialog.locator('code').filter({ hasText: '--api-key' })).toHaveText(
    'cairn start --api-key <key> --team <teamId>',
  );
  const link = dialog.getByRole('link', { name: '获取 API key →' });
  await expect(link).toHaveText('获取 API key →');
  await expect(link).toHaveAttribute('href', '/app/api-keys?scenario=06');

  const browserLink = dialog.getByRole('link', { name: '浏览器授权注册 →' });
  await expect(browserLink).toHaveText('浏览器授权注册 →');
  await expect(browserLink).toHaveAttribute('href', '/app/machines/authorize?scenario=06');
  // toggle collapses again
  await toggle.click();
  await expect(dialog.getByRole('link', { name: '获取 API key →' })).toHaveCount(0);
});

test('copy buttons write their command to the clipboard', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const dialog = await openDialog(page);
  const copy = dialog.getByRole('button', { name: '复制' });
  await copy.first().click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('npm install -g @xiechimon/cairn-cli@latest');
  await copy.nth(1).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe('cairn start');
});
