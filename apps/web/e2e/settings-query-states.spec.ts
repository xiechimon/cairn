import { expect, type Page, test } from '@playwright/test';

const PANES = [
  { section: 'machines', endpoint: 'machines', empty: '[data-testid="resource-empty"]', ok: [] },
  { section: 'providers', endpoint: 'providers', empty: '[data-testid="providers-empty"]', ok: { providers: [] } },
  {
    section: 'routing',
    endpoint: 'model-routing',
    empty: '[data-testid="routing-section"]',
    ok: { edges: [], connections: [], quota: [], settings: { claudeUsage: 'subscription-only' } },
  },
  { section: 'mcp', endpoint: 'mcp-servers', empty: '[data-testid="resource-empty"]', ok: [] },
  { section: 'secrets', endpoint: 'secrets', empty: '[data-testid="resource-empty"]', ok: [] },
  { section: 'api-keys', endpoint: 'api-keys', empty: '[data-testid="keys-empty"]', ok: [] },
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
    await expect(settings.getByTestId('query-error')).toContainText('没能加载');
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

test('providers: a failed Claude subscriptions fetch still lists the API providers', async ({
  page,
}) => {
  const state = { fail: true, ok: [] as unknown };
  await stub(page, 'claude-subscriptions', state);
  await page.route('**/api/teams/team-1/providers', (route) =>
    route.fulfill({
      json: {
        providers: [
          {
            id: 'p-codex',
            kind: 'preset',
            providerId: 'openai-codex',
            label: 'Codex main',
            baseUrl: 'https://example.invalid',
            api: 'openai-responses',
            models: [],
            createdAt: 0,
          },
        ],
      },
    }),
  );
  await page.route('**/api/teams/team-1/model-sources', (route) =>
    route.fulfill({ json: { sources: [] } }),
  );
  await page.goto('/app/settings/providers');
  const settings = page.getByRole('dialog', { name: '设置' });
  await expect(settings.getByTestId('provider-instance')).toContainText('Codex main');
  await expect(settings.getByTestId('provider-instance')).toContainText('订阅');
  await expect(settings.getByTestId('providers-partial-error')).toContainText('订阅账户没能加载');
  state.fail = false;
  await settings.getByTestId('providers-partial-error').getByRole('button', { name: '重试' }).click();
  await expect(settings.getByTestId('providers-partial-error')).toHaveCount(0);
});

test('providers: a failed API providers fetch next to a loaded subscription still shows an error and retries', async ({
  page,
}) => {
  const state = { fail: true, ok: { providers: [] } as unknown };
  await stub(page, 'providers', state);
  await page.route('**/api/teams/team-1/claude-subscriptions', (route) =>
    route.fulfill({
      json: [{ id: 's1', label: 'Fresh', expiresAt: null, createdAt: 0, plan: null }],
    }),
  );
  await page.route('**/api/teams/team-1/model-sources', (route) =>
    route.fulfill({ json: { sources: [] } }),
  );
  await page.goto('/app/settings/providers');
  const settings = page.getByRole('dialog', { name: '设置' });
  await expect(settings.getByTestId('provider-instance')).toContainText('Fresh');
  await expect(settings.getByTestId('providers-partial-error')).toContainText('模型服务没能加载');
  state.fail = false;
  await settings.getByTestId('providers-partial-error').getByRole('button', { name: '重试' }).click();
  await expect(settings.getByTestId('providers-partial-error')).toHaveCount(0);
});

test('providers: a team whose only data is a failed subscriptions fetch sees an error, not the empty state', async ({
  page,
}) => {
  const state = { fail: true, ok: [] as unknown };
  await stub(page, 'claude-subscriptions', state);
  await page.route('**/api/teams/team-1/providers', (route) =>
    route.fulfill({ json: { providers: [] } }),
  );
  await page.route('**/api/teams/team-1/model-sources', (route) =>
    route.fulfill({ json: { sources: [] } }),
  );
  await page.goto('/app/settings/providers');
  const settings = page.getByRole('dialog', { name: '设置' });
  await expect(settings.getByTestId('query-error')).toBeVisible();
  await expect(settings.getByTestId('providers-empty')).toHaveCount(0);
});

test('providers: a failed team providers fetch does not hide the machine scope editors', async ({
  page,
}) => {
  const state = { fail: true, ok: { providers: [] } as unknown };
  await stub(page, 'providers', state);
  await page.route('**/api/teams/team-1/machines', (route) =>
    route.fulfill({
      json: [
        {
          id: 'm-1',
          name: 'alpha',
          teamId: 'team-1',
          online: true,
          latestCliVersion: null,
          kind: 'remote',
          enabledRuntimes: ['pi'],
        },
      ],
    }),
  );
  await page.route('**/api/teams/team-1/model-sources', (route) =>
    route.fulfill({ json: { sources: [] } }),
  );
  await page.goto('/app/settings/providers');
  const settings = page.getByRole('dialog', { name: '设置' });
  await expect(settings.getByTestId('query-error')).toBeVisible();
  await settings.getByRole('combobox', { name: '设置作用于' }).click();
  await page.getByRole('option', { name: /alpha/ }).click();
  await expect(settings.getByTestId('query-error')).toHaveCount(0);
  await expect(settings.getByTestId('provider-instance').first()).toBeVisible();
});

for (const width of [768, 1024]) {
  test(`machines: at ${width}px the expanded row keeps every value column inside it`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/app/settings/machines?scenario=machines-master-detail&machine=md-omarchy');
    const settings = page.getByRole('dialog', { name: '设置' });
    await expect(settings.getByTestId('machine-detail')).toBeVisible();
    const clipped = await settings.getByTestId('machine-detail').evaluate((root) => {
      const rootRight = root.getBoundingClientRect().right;
      return [...root.querySelectorAll('.settings-row')]
        .filter((row) => {
          const box = row.getBoundingClientRect();
          return (
            box.right > rootRight + 1 ||
            [...row.children].some((child) => child.getBoundingClientRect().right > box.right + 1)
          );
        })
        .map((row) => row.textContent?.slice(0, 30));
    });
    expect(clipped).toEqual([]);
  });
}

test('machines: a row spans the whole panel and its detail opens underneath it', async ({
  page,
}) => {
  await page.goto('/app/settings/machines?scenario=machines-master-detail&machine=md-omarchy');
  const settings = page.getByRole('dialog', { name: '设置' });
  const row = await settings.getByTestId('machine-item').first().boundingBox();
  const detail = await settings.getByTestId('machine-detail').boundingBox();
  expect((detail?.y ?? 0) >= (row?.y ?? 0)).toBe(true);
  expect(Math.abs((detail?.width ?? 0) - (row?.width ?? 1))).toBeLessThanOrEqual(1);
});
