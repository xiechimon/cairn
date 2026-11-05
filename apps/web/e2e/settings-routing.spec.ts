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
  const session = settings.getByTestId('routing-rule-session');
  await expect(session.locator('.routing-rule-runtime-select')).toContainText('Claude Code');
  await expect(session.locator('.routing-rule-model-select')).toContainText('claude-sonnet-5');
});

test('settings work-routing rule pickers list catalog runtimes and models', async ({ page }) => {
  await page.goto('/app/settings/work-routing?scenario=routing-settings');
  const settings = page.getByRole('dialog', { name: '设置' });
  const session = settings.getByTestId('routing-rule-session');

  await session.locator('.routing-rule-runtime-select').click();
  const runtimeMenu = page.locator('.routing-rule-runtime-menu');
  await expect(runtimeMenu).toBeVisible();
  await expect(runtimeMenu.locator('.routing-rule-runtime-row', { hasText: 'Claude Code' })).toBeVisible();
  await expect(runtimeMenu.locator('.routing-rule-runtime-row', { hasText: 'pi' })).toBeVisible();
  await page.keyboard.press('Escape');

  await session.locator('.routing-rule-model-select').click();
  const modelMenu = page.locator('.routing-rule-model-menu');
  await expect(modelMenu).toBeVisible();
  await expect(modelMenu.locator('.routing-rule-model-row', { hasText: 'claude-sonnet-5' })).toBeVisible();
  await expect(modelMenu.locator('.routing-rule-model-row', { hasText: 'claude-opus-4-5' })).toBeVisible();
  await modelMenu.locator('.routing-rule-model-row', { hasText: 'claude-haiku-4-5' }).click();
  await expect(session.locator('.routing-rule-model-select')).toContainText('claude-haiku-4-5');
});
