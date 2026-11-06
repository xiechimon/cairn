import { expect, test } from '@playwright/test';

const URL = '/app/settings/routing?scenario=model-routing';

for (const width of [1440, 375]) {
  test(`account rows at ${width}px: flat, meta under the name, status in a right column that never wraps under it`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(URL);
    const rows = page.getByTestId('account-row');
    await expect(rows.first()).toBeVisible();
    await expect(page.getByTestId('vendor-section')).not.toContainText('—');
    await expect(rows.locator('[data-slot="status-chip"]')).toHaveCount(0);
    const count = await rows.count();
    for (let i = 0; i < count; i += 1) {
      const row = rows.nth(i);
      await expect(row.getByTestId('account-meta')).toContainText('优先级');
      const row0 = await row.boundingBox();
      const status = await row.getByTestId('account-status').boundingBox();
      const meta = await row.getByTestId('account-meta').boundingBox();
      expect(status?.x ?? 0).toBeGreaterThanOrEqual((meta?.x ?? 0) + 40);
      expect(status?.y ?? 0).toBeLessThan((row0?.y ?? 0) + (row0?.height ?? 0));
      expect((row0?.height ?? 0)).toBeLessThanOrEqual(84);
    }
  });
}

test('an account with nothing known about usage says it has not been used yet', async ({
  page,
}) => {
  await page.route('**/api/**', (route, request) =>
    request.method() === 'GET'
      ? route.fulfill({ status: 500, json: { error: 'stub' } })
      : route.fallback(),
  );
  await page.route('**/api/teams', (route) =>
    route.fulfill({
      json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
    }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: 'Owner', avatarUrl: null } }),
  );
  await page.route('**/api/teams/team-1/claude-subscriptions', (route) =>
    route.fulfill({
      json: [{ id: 's1', label: 'Fresh', expiresAt: null, createdAt: 0, plan: null }],
    }),
  );
  await page.goto('/app/settings/routing');
  const row = page.getByTestId('account-row');
  await expect(row).toHaveCount(1);
  await expect(row.getByTestId('account-meta')).toHaveText('优先级 1 · 还没用过');
  await expect(row).not.toContainText('—');
});

for (const width of [1440, 375]) {
  test(`quota section at ${width}px: flat heading, window rows with a combined bar, full account names, no chips`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(URL);
    const windows = page.getByTestId('pool-window');
    await expect(windows).toHaveCount(2);
    await expect(page.getByRole('heading', { name: '额度', exact: true })).toBeVisible();
    await expect(page.locator('[data-testid="pool-window"] [data-slot="card"]')).toHaveCount(0);
    await expect(windows.first().getByRole('progressbar')).toHaveCount(1);
    const first = windows.first();
    await expect(first).toContainText('剩余 29%');
    await expect(first.getByTestId('quota-account')).toHaveCount(3);
    await expect(first.getByTestId('quota-account').nth(2)).toContainText('未上报');
    const names = await first.getByTestId('quota-account').evaluateAll((rows) =>
      rows.map((row) => {
        const name = row.querySelector('span span');
        return name === null ? 0 : name.scrollWidth - name.clientWidth;
      }),
    );
    expect(names.every((overflow) => overflow <= 0)).toBe(true);
    for (const full of ['Personal', 'Work', 'Old laptop']) {
      await expect(first.getByTestId('quota-account').filter({ hasText: full }).first()).toBeVisible();
    }
    await expect(first.getByTestId('quota-account').first()).toContainText('优先级 1');
  });
}

for (const width of [1440, 375]) {
  test(`account meta at ${width}px uses the free width and wraps instead of ellipsizing`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(URL);
    const metas = page.getByTestId('account-meta');
    await expect(metas.first()).toBeVisible();
    const overflow = await metas.evaluateAll((els) =>
      els.map((el) => ({
        clipped: el.scrollWidth - el.clientWidth,
        ellipsis: getComputedStyle(el).textOverflow,
        wrapped: el.getBoundingClientRect().height > 20,
      })),
    );
    for (const meta of overflow) {
      expect(meta.ellipsis).toBe('clip');
      expect(meta.clipped).toBeLessThanOrEqual(0);
    }
    if (width === 1440) expect(overflow.every((meta) => !meta.wrapped)).toBe(true);
  });
}
