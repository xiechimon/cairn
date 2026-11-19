import { expect, test } from '@playwright/test';

test('without a Composio key only a More apps card offers it, with the cost up front', async ({
  page,
}) => {
  await page.goto('/app/resources/mcp-servers?scenario=mcp-composio-no-key');
  await expect(page.getByTestId('mcp-composio')).toHaveCount(0);
  const card = page.getByTestId('mcp-catalog').getByTestId('composio-setup-card');
  await expect(card).toContainText('更多应用');
  await card.getByTestId('composio-setup-open').click();
  const dialog = page.getByRole('dialog', { name: '用 Composio 接入更多应用' });
  await expect(dialog).toContainText('要另注册一个 Composio 账号');
  await expect(dialog.getByTestId('composio-key-save')).toBeDisabled();
});

test('with a key, Composio apps join the same grids and the key is one card', async ({ page }) => {
  await page.goto('/app/resources/mcp-servers?scenario=mcp-composio');
  const connected = page.getByTestId('mcp-connected');
  const catalog = page.getByTestId('mcp-catalog');
  await expect(catalog.getByTestId('composio-app-slack')).toBeVisible();
  await expect(connected.getByTestId('composio-app-slack')).toHaveCount(0);
  await expect(connected.getByTestId('composio-app-gmail')).toBeVisible();
  await expect(connected.getByTestId('mcp-composio')).toContainText('Composio');
  await expect(catalog.getByTestId('composio-setup-card')).toHaveCount(0);
  await connected.getByTestId('composio-key-change').click();
  await expect(page.getByRole('dialog', { name: 'Composio' }).getByTestId('composio-key-remove')).toBeVisible();
});
