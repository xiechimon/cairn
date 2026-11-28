import { expect, type Page, test } from '@playwright/test';
import type { ClaudeSubscriptionListEntry } from '@cairn/shared';

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

const PANES = [
  { section: 'machines', endpoint: 'machines', empty: '[data-testid="resource-empty"]', ok: [] },
  {
    section: 'routing',
    endpoint: 'providers',
    errText: '服务商未能加载',
    empty: '[data-testid="providers-empty"]',
    ok: { providers: [] },
  },
  {
    section: 'routing',
    endpoint: 'model-routing',
    errText: '路由图未能加载',
    empty: '[data-testid="routing-section"]',
    ok: { edges: [], connections: [], quota: [] },
  },
  { section: 'mcp', endpoint: 'mcp-*', empty: '[data-testid="mcp-catalog"]', ok: [] },
  { section: 'secrets', endpoint: 'secrets', empty: '[data-testid="resource-empty"]', ok: [] },
  { section: 'api-keys', endpoint: 'api-keys', empty: '[data-testid="keys-empty"]', ok: [] },
] as const;

const ROUTING_PAGE_OK: Record<string, unknown> = {
  'model-routing': { edges: [], connections: [], quota: [] },
  providers: { providers: [] },
  'claude-subscriptions': [],
  'devin-subscriptions': [],
  'antigravity-subscriptions': [],
  'doubao-subscriptions': { subscriptions: [], runnerLogins: [] },
};

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
  for (const [other, json] of Object.entries(ROUTING_PAGE_OK)) {
    if (other !== endpoint)
      await page.route(`**/api/teams/team-1/${other}`, (route) => route.fulfill({ json }));
  }
  await page.route(`**/api/teams/team-1/${endpoint}`, (route) =>
    state.fail
      ? route.fulfill({ status: 500, json: { error: 'boom' } })
      : route.fulfill({ json: state.ok }),
  );
}

for (const pane of PANES) {
  test(`${pane.section} ${pane.endpoint}: a failed list fetch shows the error with a retry, never the empty state`, async ({
    page,
  }) => {
    const state = { fail: true, ok: pane.ok as unknown };
    await stub(page, pane.endpoint, state);
    await page.goto(`/app/settings/${pane.section}`);
    const settings = page.getByRole('dialog', { name: '设置' });
    const err = 'errText' in pane
      ? settings.getByTestId('query-error').filter({ hasText: pane.errText })
      : settings.getByTestId('query-error');
    await expect(err).toBeVisible();
    await expect(err).toContainText('未能加载');
    await expect(settings.locator(pane.empty)).toHaveCount(0);
    await expect(settings.getByTestId('query-loading')).toHaveCount(0);

    state.fail = false;
    await err.getByRole('button', { name: '重试' }).click();
    await expect(err).toHaveCount(0);
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
  await page.goto('/app/settings/routing');
  const settings = page.getByRole('dialog', { name: '设置' });
  await expect(settings.getByTestId('provider-instance')).toContainText('Codex main');
  await expect(settings.getByTestId('provider-instance')).toContainText('订阅');
  await expect(settings.getByTestId('providers-partial-error')).toContainText('订阅账户未能加载');
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
      json: [
        {
          id: 's1',
          kind: 'claude-subscription',
          label: 'Fresh',
          expiresAt: null,
          createdAt: 0,
        } satisfies ClaudeSubscriptionListEntry,
      ],
    }),
  );
  await page.route('**/api/teams/team-1/model-sources', (route) =>
    route.fulfill({ json: { sources: [] } }),
  );
  await page.goto('/app/settings/routing');
  const settings = page.getByRole('dialog', { name: '设置' });
  await expect(settings.getByTestId('provider-instance')).toContainText('Fresh');
  await expect(settings.getByTestId('providers-partial-error')).toContainText('服务商未能加载');
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
  await page.goto('/app/settings/routing');
  const settings = page.getByRole('dialog', { name: '设置' });
  await expect(
    settings.getByTestId('query-error').filter({ hasText: '服务商未能加载' }),
  ).toBeVisible();
  await expect(settings.getByTestId('providers-empty')).toHaveCount(0);
});

for (const width of [768, 1024]) {
  test(`machines: at ${width}px every row stays inside the panel`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/app/settings/machines?scenario=machines-master-detail&machine=md-omarchy');
    const settings = page.getByRole('dialog', { name: '设置' });
    await expect(settings.getByTestId('machine-list')).toBeVisible();
    const clipped = await settings.getByTestId('machine-list').evaluate((root) => {
      const rootRight = root.getBoundingClientRect().right;
      return [...root.querySelectorAll('[data-testid="machine-item"]')]
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
