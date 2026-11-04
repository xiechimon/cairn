import { expect, type Page, test } from '@playwright/test';

const PROVIDERS = '/app/resources/providers?scenario=01';

async function openDialog(page: Page) {
  await page.goto(PROVIDERS);
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加模型服务' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('OAuth badge rides only the wired family (GitHub Copilot); the unwired codex row has no badge, xai has no badge', async ({
  page,
}) => {
  const dialog = await openDialog(page);
  await expect(dialog.getByText('OAuth', { exact: true })).toHaveCount(1);
  await expect(
    dialog.locator('[data-preset-id]', { hasText: 'GitHub Copilot' }).getByText('OAuth', { exact: true }),
  ).toHaveCount(1);

  const codex = dialog.locator('[data-preset-id]', { hasText: 'OpenAI Codex' });
  await expect(codex.getByText('OAuth', { exact: true })).toHaveCount(0);
  await expect(codex).toBeDisabled();
  await expect(codex.getByText('暂未开通')).toHaveText('暂未开通');

  await expect(dialog.locator('[data-preset-id]', { hasText: 'xAI' }).first()).not.toContainText(
    'SuperGrok',
  );
  await expect(dialog.getByText('SuperGrok')).toHaveCount(0);
});

test('unwired codex row click does nothing: no close, no form entry', async ({ page }) => {
  const dialog = await openDialog(page);
  const codex = dialog.locator('[data-preset-id]', { hasText: 'OpenAI Codex' });
  await codex.click({ force: true });
  await expect(page.getByRole('dialog', { name: '添加模型服务' })).toBeVisible();
  await expect(dialog.locator('#dlg-provider-id')).toHaveCount(0);
  await expect(codex).toBeDisabled();
});

test('fixture face clicking a wired-badge row = accept law (closes); reopening still lists it', async ({ page }) => {
  const dialog = await openDialog(page);
  await dialog.locator('[data-preset-id]', { hasText: 'GitHub Copilot' }).click();
  await expect(page.getByRole('dialog', { name: '添加模型服务' })).toBeHidden();
  const again = await openDialog(page);
  await expect(again.getByText('OAuth', { exact: true })).toHaveCount(1);
  await expect(again.getByRole('alert')).toHaveCount(0);
});

test('landing param oauth=error&reason=denied auto-reopens the dialog + copy + param cleared', async ({ page }) => {
  await page.goto(`${PROVIDERS}&oauth=error&reason=denied`);
  const dialog = page.getByRole('dialog', { name: '添加模型服务' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveText('授权已被取消。');

  await expect(page).toHaveURL((url) => !url.searchParams.has('oauth'));
  await page.reload();
  await expect(page.getByRole('dialog', { name: '添加模型服务' })).toHaveCount(0);
});

test('landing param oauth=error&reason=exchange goes to the exchange-failure copy', async ({ page }) => {
  await page.goto(`${PROVIDERS}&oauth=error&reason=exchange`);
  const dialog = page.getByRole('dialog', { name: '添加模型服务' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveText('令牌交换失败，请稍后重试。');
});

test('landing param oauth=error&reason=state goes to the expired copy + reopens the dialog', async ({ page }) => {
  await page.goto(`${PROVIDERS}&oauth=error&reason=state`);
  const dialog = page.getByRole('dialog', { name: '添加模型服务' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toHaveText('连接已过期，请重新发起。');
});

test('landing param oauth=connected is silent: no dialog, no error row', async ({ page }) => {
  await page.goto(`${PROVIDERS}&oauth=connected&provider=github-copilot`);

  await expect(page).toHaveURL((url) => !url.searchParams.has('oauth'), { timeout: 10_000 });
  await expect(page.getByRole('dialog', { name: '添加模型服务' })).toHaveCount(0);
});
