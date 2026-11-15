import { expect, test } from '@playwright/test';

test('model selector with no rules offers a picker per use and no Runner or policy controls', async ({
  page,
}) => {
  await page.goto('/app/settings/work-routing?scenario=01');
  const settings = page.getByRole('dialog', { name: '设置' });
  await expect(settings.locator('[data-settings-section="work-routing"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(settings.getByTestId('settings-head')).toHaveText('模型选择');
  for (const use of ['session', 'coordinator', 'review', 'citation_check']) {
    await expect(settings.getByTestId(`routing-rule-new-${use}`)).toBeVisible();
  }
  await expect(settings.getByTestId('routing-rule-new-coordinator')).toContainText(
    '先给 Coordinator 选模型',
  );
  await expect(settings.getByText('首选 Runner')).toHaveCount(0);
  await expect(settings.getByText('工作策略')).toHaveCount(0);
  await expect(settings.getByRole('button', { name: '创建' })).toHaveCount(0);
});

test('model selector shows stored rules with their model and thinking level, never policies', async ({
  page,
}) => {
  await page.goto('/app/settings/work-routing?scenario=routing-settings');
  const settings = page.getByRole('dialog', { name: '设置' });
  const session = settings.getByTestId('routing-rule-session');
  await expect(session.locator('.routing-rule-model-select')).toContainText('claude-sonnet-5');
  await expect(session.locator('.routing-rule-level-select')).toContainText('High');
  const review = settings.getByTestId('routing-rule-review');
  await expect(review.locator('.routing-rule-model-select')).toContainText('GPT-5.2');
  await expect(review.locator('.routing-rule-level-select')).toContainText('Medium');
  await expect(settings.getByTestId('routing-rule-new-coordinator')).toBeVisible();
  await expect(settings.locator('[data-testid^="work-policy-"]')).toHaveCount(0);
});

test('the model menu groups by runtime and greys a runtime no Runner has turned on', async ({
  page,
}) => {
  await page.goto('/app/settings/work-routing?scenario=routing-settings');
  const settings = page.getByRole('dialog', { name: '设置' });
  await settings.getByTestId('routing-rule-session').locator('.routing-rule-model-select').click();
  const menu = page.locator('.routing-rule-model-menu');
  await expect(menu.getByText('Claude Code', { exact: true })).toBeVisible();
  const haiku = menu.locator('.routing-rule-model-row', { hasText: 'claude-haiku-4-5' });
  await expect(haiku).not.toHaveAttribute('data-disabled', '');
  await expect(menu.locator('.routing-rule-model-row', { hasText: 'GPT-5.2' })).toBeVisible();
  await page.keyboard.press('Escape');

  await page.goto('/app/settings/work-routing?scenario=routing-settings-pi-only');
  await page
    .getByRole('dialog', { name: '设置' })
    .getByTestId('routing-rule-review')
    .locator('.routing-rule-model-select')
    .click();
  const piOnly = page.locator('.routing-rule-model-menu');
  await expect(piOnly.getByText('Claude Code（没有 Runner 启用）')).toBeVisible();
  await expect(
    piOnly.locator('.routing-rule-model-row', { hasText: 'claude-haiku-4-5' }),
  ).toHaveAttribute('data-disabled', '');
  await expect(
    piOnly.locator('.routing-rule-model-row', { hasText: 'GPT-5.2' }),
  ).not.toHaveAttribute('data-disabled', '');
});
