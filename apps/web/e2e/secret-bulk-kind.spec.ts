import { expect, test } from '@playwright/test';

test('bulk add stores credential-looking names as secret and the rest as env', async ({ page }) => {
  const secrets: Record<string, unknown>[] = [];
  const posted: unknown[] = [];
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } }),
  );
  await page.route('**/api/teams', (route) =>
    route.fulfill({
      json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
    }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: 'Owner', avatarUrl: null } }),
  );
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/teams/team-1/secrets', (route, request) => {
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      posted.push(body);
      const record = {
        id: `sec-${posted.length}`,
        teamId: 'team-1',
        projectId: null,
        name: body.name,
        description: null,
      };
      secrets.push(record);
      return route.fulfill({ status: 201, json: record });
    }
    return route.fulfill({ json: secrets });
  });

  await page.goto('/app/resources/secrets');
  await page.getByTestId('secret-bulk').click();
  const dialog = page.getByRole('dialog', { name: '批量添加密钥和环境变量' });
  await dialog
    .getByLabel('内容', { exact: true })
    .fill('NODE_ENV=development\nLANGFUSE_SECRET_KEY=sk-live\nLANGFUSE_BASE_URL=https://cloud.langfuse.com');
  await dialog.getByRole('button', { name: '添加 3 条', exact: true }).click();
  await expect.poll(() => posted).toEqual([
    { name: 'NODE_ENV', value: 'development', kind: 'env' },
    { name: 'LANGFUSE_SECRET_KEY', value: 'sk-live', kind: 'secret' },
    { name: 'LANGFUSE_BASE_URL', value: 'https://cloud.langfuse.com', kind: 'env' },
  ]);
});
