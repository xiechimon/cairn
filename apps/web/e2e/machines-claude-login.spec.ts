import { expect, test } from '@playwright/test';

const PAGE = '/app/resources/machines?scenario=machines-claude-login';
const SHELL = '[data-route="/app/resources/machines"]';
const ROW = `${SHELL} div[data-kind]`;

function row(name: string) {
  return `${ROW}:has-text("${name}")`;
}

test('expiring and expired Claude Code logins warn with the machine name and re-login command', async ({
  page,
}) => {
  await page.goto(PAGE);
  const omarchy = page.locator(row('omarchy')).locator('[data-testid="claude-login-warning"]');
  await expect(omarchy).toBeVisible();
  await expect(omarchy).toHaveAttribute('data-login', 'expiring');
  await expect(omarchy).toHaveText(
    'omarchy 上的 Claude Code 登录将在 2 天后过期。在该机器上运行 `claude auth login` 重新登录。',
  );

  const soon = page.locator(row('soon-box')).locator('[data-testid="claude-login-warning"]');
  await expect(soon).toHaveAttribute('data-login', 'expiring');
  await expect(soon).toHaveText(
    'soon-box 上的 Claude Code 登录将在不到 1 天内过期。在该机器上运行 `claude auth login` 重新登录。',
  );

  const ghost = page.locator(row('ghost')).locator('[data-testid="claude-login-warning"]');
  await expect(ghost).toHaveAttribute('data-login', 'expired');
  await expect(ghost).toHaveText(
    'ghost 上的 Claude Code 登录已过期。在该机器上运行 `claude auth login` 重新登录。',
  );
});

test('a login beyond 3 days and an unknown probe render no warning', async ({ page }) => {
  await page.goto(PAGE);
  await expect(page.locator(ROW).first()).toBeVisible();
  await expect(
    page.locator(row('steady')).locator('[data-testid="claude-login-warning"]'),
  ).toHaveCount(0);
  await expect(
    page.locator(row('mystery')).locator('[data-testid="claude-login-warning"]'),
  ).toHaveCount(0);
});
