import { expect, type Page, test } from '@playwright/test';

const PAGE = '/app/settings/machines?scenario=machines-claude-login';

async function open(page: Page, name: string) {
  await page.goto(PAGE);
  const row = page.getByTestId('machine-item').filter({ hasText: name }).first();
  await row.getByTestId('machine-toggle').click();
  await expect(row).toHaveAttribute('data-expanded', 'true');
}

test('expiring and expired Claude Code logins warn with the machine name and re-login command as code', async ({
  page,
}) => {
  await open(page, 'omarchy');
  const omarchy = page.getByTestId('claude-login-warning');
  await expect(omarchy).toBeVisible();
  await expect(omarchy).toHaveAttribute('data-login', 'expiring');
  await expect(omarchy).toHaveText(
    'omarchy 上的 Claude Code 登录将在 2 天后过期。在该 Runner 上运行 claude auth login 重新登录。',
  );
  await expect(omarchy.locator('code')).toHaveText('claude auth login');

  await open(page, 'soon-box');
  const soon = page.getByTestId('claude-login-warning');
  await expect(soon).toHaveAttribute('data-login', 'expiring');
  await expect(soon).toHaveText(
    'soon-box 上的 Claude Code 登录将在不到 1 天内过期。在该 Runner 上运行 claude auth login 重新登录。',
  );

  await open(page, 'ghost');
  const ghost = page.getByTestId('claude-login-warning');
  await expect(ghost).toHaveAttribute('data-login', 'expired');
  await expect(ghost).toHaveText(
    'ghost 上的 Claude Code 登录已过期。在该 Runner 上运行 claude auth login 重新登录。',
  );
});

test('list items say the login state in the short status', async ({ page }) => {
  await page.goto(PAGE);
  const status = (name: string) =>
    page.getByTestId('machine-item').filter({ hasText: name }).getByTestId('machine-item-status');
  await expect(status('omarchy')).toHaveText('登录将过期');
  await expect(status('ghost')).toHaveText('登录已过期');
  await expect(status('steady')).toHaveText('在线');
});

test('a login beyond 3 days and an unknown probe render no warning', async ({ page }) => {
  await open(page, 'steady');
  await expect(page.getByTestId('claude-login-warning')).toHaveCount(0);
  await open(page, 'mystery');
  await expect(page.getByTestId('claude-login-warning')).toHaveCount(0);
});
