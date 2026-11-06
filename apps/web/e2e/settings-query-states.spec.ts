import { expect, type Page, test } from '@playwright/test';

const PANES = [
  { section: 'machines', endpoint: 'machines', empty: '[data-testid="resource-empty"]', ok: [] },
  { section: 'providers', endpoint: 'providers', empty: '[data-testid="providers-empty"]', ok: { providers: [] } },
  { section: 'routing', endpoint: 'claude-subscriptions', empty: '[data-testid="vendor-section"]', ok: [] },
  { section: 'mcp', endpoint: 'mcp-servers', empty: '[data-testid="resource-empty"]', ok: [] },
  { section: 'secrets', endpoint: 'secrets', empty: '[data-testid="resource-empty"]', ok: [] },
  { section: 'api-keys', endpoint: 'api-keys', empty: '[data-testid="keys-empty"]', ok: [] },
  { section: 'team', endpoint: 'members', empty: '[data-testid="team-agents-empty"]', ok: [] },
] as const;

async function stub(page: Page, endpoint: string, state: { fail: boolean; ok: unknown }) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) =>
    route.fulfill({
      json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
    }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } }),
  );
  await page.route(`**/api/teams/team-1/${endpoint}`, (route) =>
    state.fail
      ? route.fulfill({ status: 500, json: { error: 'boom' } })
      : route.fulfill({ json: state.ok }),
  );
}

for (const pane of PANES) {
  test(`${pane.section}: a failed list fetch shows the error with a retry, never the empty state`, async ({
    page,
  }) => {
    const state = { fail: true, ok: pane.ok as unknown };
    await stub(page, pane.endpoint, state);
    await page.goto(`/app/settings/${pane.section}`);
    const settings = page.getByRole('dialog', { name: '设置' });
    await expect(settings.getByTestId('query-error')).toBeVisible();
    await expect(settings.getByTestId('query-error')).toContainText('无法加载');
    await expect(settings.locator(pane.empty)).toHaveCount(0);
    await expect(settings.getByTestId('query-loading')).toHaveCount(0);

    state.fail = false;
    await settings.getByTestId('query-error').getByRole('button', { name: '重试' }).click();
    await expect(settings.getByTestId('query-error')).toHaveCount(0);
  });
}

test('machines: a slow list fetch shows a skeleton, not the empty state', async ({ page }) => {
  const state = { fail: false, ok: [] as unknown };
  await stub(page, 'machines', state);
  await page.route('**/api/teams/team-1/machines', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.fulfill({ json: [] });
  });
  await page.goto('/app/settings/machines');
  const settings = page.getByRole('dialog', { name: '设置' });
  await expect(settings.getByTestId('query-loading')).toBeVisible();
  await expect(settings.getByTestId('resource-empty')).toHaveCount(0);
  await expect(settings.getByTestId('resource-empty')).toBeVisible();
});
