import { expect, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

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
  for (const use of ['session', 'coordinator']) {
    await expect(settings.getByTestId(`routing-rule-new-${use}`)).toBeVisible();
  }
  for (const use of ['review', 'citation_check']) {
    await expect(settings.locator(`#route-${use}`)).toHaveCount(0);
  }
  await expect(settings.getByTestId('routing-rule-new-coordinator')).toContainText(
    '先给 Coordinator 选模型',
  );
  await expect(settings.getByText('首选执行机')).toHaveCount(0);
  await expect(settings.getByText('工作策略')).toHaveCount(0);
  await expect(settings.getByRole('button', { name: '创建' })).toHaveCount(0);
});

test('model selector shows stored rules with their model and thinking level, never review or policies', async ({
  page,
}) => {
  await page.goto('/app/settings/work-routing?scenario=routing-settings');
  const settings = page.getByRole('dialog', { name: '设置' });
  const session = settings.getByTestId('routing-rule-session');
  await expect(session.locator('.routing-rule-model-select')).toContainText('claude-sonnet-5');
  await expect(session.locator('.routing-rule-level-select')).toContainText('High');
  await expect(settings.getByTestId('routing-rule-review')).toHaveCount(0);
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
    .locator('#route-session .routing-rule-model-select')
    .click();
  const piOnly = page.locator('.routing-rule-model-menu');
  await expect(piOnly.getByText('Claude Code（没有执行机启用）')).toBeVisible();
  await expect(
    piOnly.locator('.routing-rule-model-row', { hasText: 'claude-haiku-4-5' }),
  ).toHaveAttribute('data-disabled', '');
  await expect(
    piOnly.locator('.routing-rule-model-row', { hasText: 'GPT-5.2' }),
  ).not.toHaveAttribute('data-disabled', '');
});

test('top models list stored entries in order, marks a missing provider and adds only unlisted models', async ({
  page,
}) => {
  await page.goto('/app/settings/work-routing?scenario=routing-settings');
  const card = page.getByRole('dialog', { name: '设置' }).getByTestId('top-models');
  const rows = card.getByTestId('top-model-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('data-top-model', 'claude-sonnet-5');
  await expect(rows.nth(0).locator('.top-model-level')).toContainText('High');
  await expect(rows.nth(1)).toHaveAttribute('data-top-model', 'gpt-5.2');
  await expect(rows.nth(2)).toHaveAttribute('data-unavailable', '');
  await expect(rows.nth(2).getByTestId('top-model-provider')).toHaveText('不可用');
  await card.getByTestId('top-models-add').click();
  const menu = page.locator('.top-models-add-menu');
  await expect(menu.locator('.top-models-add-row', { hasText: 'claude-haiku-4-5' })).toBeVisible();
  await expect(menu.locator('.top-models-add-row', { hasText: 'GPT-5.2' })).toHaveCount(0);
});

test('top models start from the suggestion, save every edit as a whole list and reset with DELETE', async ({
  page,
}) => {
  const calls: string[] = [];
  let stored: unknown = null;
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    const method = route.request().method();
    if (path === '/api/teams/t1/routing-settings') return json({ rules: [], policies: [] });
    if (path === '/api/teams/t1/machines') return json([]);
    if (path === '/api/teams/t1/model-sources')
      return json({
        sources: [
          {
            runtime: 'pi',
            provider: 'relay',
            providerLabel: 'domestic-proxy',
            installed: true,
            models: [
              { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' },
              { id: 'glm-5.3', name: 'GLM-5.3' },
              { id: 'gpt-6.1-sol', name: 'GPT-6.1 Sol' },
            ],
          },
        ],
      });
    if (path === '/api/teams/t1/top-models') {
      if (method === 'PUT') {
        stored = route.request().postDataJSON().models;
        calls.push(`PUT ${(stored as { modelId: string }[]).map((m) => m.modelId).join(',')}`);
        return json({ models: stored });
      }
      if (method === 'DELETE') {
        calls.push('DELETE');
        stored = null;
        return json({ models: null });
      }
      return json({ models: stored });
    }
    return undefined;
  });
  await page.goto('/app/settings/work-routing');
  const card = page.getByRole('dialog', { name: '设置' }).getByTestId('top-models');
  const rows = card.getByTestId('top-model-row');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('data-top-model', 'claude-opus-5-5');
  await expect(rows.nth(1)).toHaveAttribute('data-top-model', 'gpt-6.1-sol');
  await expect(rows.nth(2)).toHaveAttribute('data-top-model', 'glm-5.3');
  await expect(rows.nth(0).locator('.top-model-level')).toContainText('High');
  await expect(rows.nth(0)).toContainText('推荐');

  await rows.nth(1).locator('.top-model-remove').click();
  await expect.poll(() => calls).toEqual(['PUT claude-opus-5-5,glm-5.3']);
  await expect(rows).toHaveCount(2);

  const grip = await rows.nth(1).locator('.top-model-grip').boundingBox();
  const target = await rows.nth(0).boundingBox();
  if (grip === null || target === null) throw new Error('top model rows are not laid out');
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2, target.y + 4, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => calls.at(-1)).toBe('PUT glm-5.3,claude-opus-5-5');
  await expect(rows.nth(0)).toHaveAttribute('data-top-model', 'glm-5.3');

  await card.getByTestId('top-models-reset').click();
  await expect.poll(() => calls.at(-1)).toBe('DELETE');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveAttribute('data-top-model', 'claude-opus-5-5');
});
