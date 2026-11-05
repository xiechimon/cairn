import { expect, test } from '@playwright/test';

test('settings work-routing shows the empty state and flag-off copy', async ({ page }) => {
  await page.goto('/app/settings/work-routing?scenario=01');
  const settings = page.getByRole('dialog', { name: '设置' });
  await expect(settings.locator('[data-settings-section="work-routing"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(settings.getByTestId('routing-rules-enabled')).toHaveText('规则未启用');
  await expect(settings.getByTestId('routing-settings-empty')).toBeVisible();
  await expect(settings.getByText('还没有路由规则。')).toBeVisible();
});

test('settings work-routing renders seeded rules and policies from the fixture', async ({
  page,
}) => {
  await page.goto('/app/settings/work-routing?scenario=routing-settings');
  const settings = page.getByRole('dialog', { name: '设置' });
  await expect(settings.getByTestId('routing-rules-enabled')).toHaveText('规则未启用');
  await expect(settings.getByTestId('routing-rule-session')).toBeVisible();
  await expect(settings.getByTestId('routing-rule-review')).toBeVisible();
  await expect(settings.getByTestId('work-policy-session')).toBeVisible();
  await expect(settings.getByTestId('work-policy-review')).toBeVisible();
  await expect(settings.getByLabel('运行时').first()).toHaveValue('claude-code');
  await expect(settings.getByLabel('模型').first()).toHaveValue('claude-sonnet-5-5');
});
