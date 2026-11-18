import { expect, test } from '@playwright/test';

const MCP = '/app/resources/mcp-servers';

test('with no mailbox connected, QQ 邮箱, Gmail and 其他邮箱 are offered under 可接入', async ({
  page,
}) => {
  await page.goto(`${MCP}?scenario=mail-empty`);
  const catalog = page.getByTestId('mcp-catalog');
  for (const provider of ['qq', 'gmail', 'other'])
    await expect(catalog.getByTestId(`mail-card-${provider}`)).toBeVisible();
  await expect(page.getByTestId('mcp-connected').getByTestId('mail-card-qq')).toHaveCount(0);
});

test('connected mail shows once, under 已接入, and 管理 lists the accounts', async ({ page }) => {
  await page.goto(`${MCP}?scenario=mail-connected`);
  const connected = page.getByTestId('mcp-connected');
  const catalog = page.getByTestId('mcp-catalog');
  for (const provider of ['qq', 'gmail']) {
    await expect(page.getByTestId(`mail-card-${provider}`)).toHaveCount(1);
    await expect(connected.getByTestId(`mail-card-${provider}`)).toHaveCount(1);
    await expect(catalog.getByTestId(`mail-card-${provider}`)).toHaveCount(0);
  }
  await expect(connected.getByTestId('mail-card-qq')).toContainText('2 个邮箱');
  await expect(catalog.getByTestId('mail-card-other')).toBeVisible();

  await connected.getByRole('button', { name: '管理 QQ 邮箱' }).click();
  const dialog = page.getByRole('dialog', { name: 'QQ 邮箱' });
  await expect(dialog.getByTestId('mail-account-mail-qq')).toContainText('ian.xie@qq.com');
  await expect(dialog.getByTestId('mail-account-mail-qq')).toContainText('已连接');
  await expect(dialog.getByTestId('mail-account-mail-qq-work')).toContainText('仅匹配 2 条规则');
  await expect(dialog.getByTestId('mail-add')).toBeVisible();
});

test('a mailbox in error keeps its card under 已接入 with 需要处理', async ({ page }) => {
  await page.goto(`${MCP}?scenario=mail-error`);
  const card = page.getByTestId('mcp-connected').getByTestId('mail-card-qq');
  await expect(card).toContainText('需要处理');
  await card.getByRole('button', { name: '管理 QQ 邮箱' }).click();
  await expect(
    page.getByRole('dialog', { name: 'QQ 邮箱' }).getByTestId('mail-account-mail-qq'),
  ).toContainText('登录被拒绝');
});
