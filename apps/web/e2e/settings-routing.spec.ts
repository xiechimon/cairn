import { expect, test } from '@playwright/test';
import { mockLive } from './chief-home-mock';

test('model selector with no rules offers a picker per use and no Runner or policy controls', async ({
  page,
}) => {
  await page.goto('/app/settings/routing?scenario=01');
  const settings = page.getByRole('dialog', { name: '设置' });
  await expect(settings.locator('[data-settings-section="routing"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(settings.getByTestId('settings-head')).toHaveText('模型');
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
  await page.goto('/app/settings/routing?scenario=routing-settings');
  const settings = page.getByRole('dialog', { name: '设置' });
  const session = settings.getByTestId('routing-rule-session');
  await expect(session.locator('.routing-rule-model-select')).toContainText('claude-sonnet-5');
  await expect(session.locator('.routing-rule-level-select')).toContainText('High');
  await expect(settings.getByTestId('routing-rule-review')).toHaveCount(0);
  await expect(settings.getByTestId('routing-rule-new-coordinator')).toBeVisible();
  await expect(settings.locator('[data-testid^="work-policy-"]')).toHaveCount(0);
});

test('the model menu groups by runtime and greys nothing, not for the Coordinator and not for a runtime no Runner has turned on', async ({
  page,
}) => {
  await page.goto('/app/settings/routing?scenario=routing-settings');
  const settings = page.getByRole('dialog', { name: '设置' });
  await settings.getByTestId('routing-rule-session').locator('.routing-rule-model-select').click();
  const menu = page.locator('.routing-rule-model-menu');
  await expect(menu.getByText('Claude Code', { exact: true })).toBeVisible();
  const haiku = menu.locator('.routing-rule-model-row', { hasText: 'claude-haiku-4-5' });
  await expect(haiku).not.toHaveAttribute('data-disabled', '');
  await expect(menu.locator('.routing-rule-model-row', { hasText: 'GPT-5.2' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await settings
    .getByTestId('routing-rule-new-coordinator')
    .locator('.routing-rule-model-select')
    .click();
  const coordinatorMenu = page.locator('.routing-rule-model-menu:visible');
  await expect(coordinatorMenu.getByText('Claude Code', { exact: true })).toBeVisible();
  await expect(coordinatorMenu.getByText('Claude Code（Coordinator 用不了）')).toHaveCount(0);
  await expect(
    coordinatorMenu.locator('.routing-rule-model-row', { hasText: 'claude-haiku-4-5' }),
  ).not.toHaveAttribute('data-disabled', '');
  await expect(
    coordinatorMenu.locator('.routing-rule-model-row', { hasText: 'GPT-5.2' }),
  ).not.toHaveAttribute(
    'data-disabled',
    '',
  );
  await page.keyboard.press('Escape');

  await page.goto('/app/settings/routing?scenario=routing-settings-pi-only');
  await page
    .getByRole('dialog', { name: '设置' })
    .locator('#route-session .routing-rule-model-select')
    .click();
  const piOnly = page.locator('.routing-rule-model-menu');
  await expect(piOnly.getByText('Claude Code', { exact: true })).toBeVisible();
  await expect(
    piOnly.locator('.routing-rule-model-row', { hasText: 'claude-haiku-4-5' }),
  ).not.toHaveAttribute('data-disabled', '');
  await expect(
    piOnly.locator('.routing-rule-model-row', { hasText: 'GPT-5.2' }),
  ).not.toHaveAttribute('data-disabled', '');
});

test('rules that cannot run say why, preview what the fix changes, and offer no fix without a default', async ({
  page,
}) => {
  await page.goto('/app/settings/routing?scenario=routing-rule-issues');
  const issues = page.getByRole('dialog', { name: '设置' }).getByTestId('routing-rule-issues');
  const session = issues.getByTestId('routing-rule-issue-session');
  await expect(session).toContainText('任务：没有执行机启用 Claude Code');
  await expect(session).toContainText('修复后改用 GPT-5.2');
  await expect(session).toContainText('并清空首选执行机、思考强度。');
  await expect(session.getByTestId('routing-rule-fix-session')).toBeVisible();
  const review = issues.getByTestId('routing-rule-issue-review');
  await expect(review).toContainText('评审：');
  await expect(review).toContainText('这个用途没有能自动换上的模型。');
  await expect(review.getByRole('button')).toHaveCount(0);
});

const FIX = {
  provider: 'relay',
  modelId: 'glm-5.3',
  thinkingLevel: null,
  machineId: null,
  expectedUpdatedAt: 1700,
};

async function mockIssue(
  page: import('@playwright/test').Page,
  patch: (body: unknown) => { status: number; body: unknown },
) {
  const seen = { gets: 0, patches: [] as unknown[] };
  await mockLive(page, { threads: [], messages: [] }, (path, route, json) => {
    const method = route.request().method();
    if (path === '/api/teams/t1/routing-settings') {
      seen.gets += 1;
      const fixed = seen.patches.length > 0 && seen.gets > 1;
      return json({
        rules: [],
        policies: [],
        ruleIssues: fixed
          ? []
          : [{ use: 'session', reason: 'provider-no-key', provider: 'relay', suggested: FIX }],
      });
    }
    if (path === '/api/teams/t1/routing-rules/session' && method === 'PATCH') {
      const body = route.request().postDataJSON();
      seen.patches.push(body);
      const reply = patch(body);
      return json(reply.body, reply.status);
    }
    if (path === '/api/teams/t1/machines') return json([]);
    if (path === '/api/teams/t1/model-sources')
      return json({
        sources: [
          {
            runtime: 'pi',
            provider: 'relay',
            providerLabel: 'domestic-proxy',
            installed: true,
            models: [{ id: 'glm-5.3', name: 'GLM-5.3' }],
          },
        ],
      });
    return undefined;
  });
  return seen;
}

test('the fix sends the suggested change as is and the warning leaves once the rule is fixed', async ({
  page,
}) => {
  const seen = await mockIssue(page, () => ({ status: 200, body: {} }));
  await page.goto('/app/settings/routing');
  const row = page.getByRole('dialog', { name: '设置' }).getByTestId('routing-rule-issue-session');
  await expect(row).toContainText('任务：服务商 domestic-proxy 没有 API key');
  await expect(row).toContainText('修复后改用 GLM-5.3 · domestic-proxy，并清空首选执行机、思考强度。');
  await row.getByTestId('routing-rule-fix-session').click();
  await expect.poll(() => seen.patches).toEqual([FIX]);
  await expect(row).toHaveCount(0);
});

test('a rule changed since it was read reloads the settings and says so', async ({ page }) => {
  const seen = await mockIssue(page, () => ({
    status: 409,
    body: { error: 'routing rule changed since it was read' },
  }));
  await page.goto('/app/settings/routing');
  const row = page.getByRole('dialog', { name: '设置' }).getByTestId('routing-rule-issue-session');
  await row.getByTestId('routing-rule-fix-session').click();
  await expect(page.locator('[data-sonner-toast]').first()).toContainText(
    '这条规则刚被改过，已重新读取，请再看一眼。',
  );
  await expect.poll(() => seen.gets).toBeGreaterThan(1);
});
