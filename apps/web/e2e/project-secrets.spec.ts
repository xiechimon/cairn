import { expect, test } from '@playwright/test';

test('a secret added from a project defaults to that project and is listed as project-only', async ({
  page,
}) => {
  const secrets: Record<string, unknown>[] = [
    { id: 'sec-team', teamId: 'team-1', projectId: null, name: 'NPM_TOKEN', description: null },
  ];
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
  await page.route('**/api/projects?*', (route) =>
    route.fulfill({
      json: [
        { id: 'proj-1', name: 'cairn', teamId: 'team-1', repoKind: 'hosted', repoName: 'cairn' },
        { id: 'proj-2', name: 'site', teamId: 'team-1', repoKind: 'hosted', repoName: 'site' },
      ],
    }),
  );
  await page.route('**/api/teams/team-1/secrets', (route, request) => {
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      posted.push(body);
      const record = {
        id: 'sec-new',
        teamId: 'team-1',
        projectId: body.projectId ?? null,
        name: body.name,
        description: null,
      };
      secrets.push(record);
      return route.fulfill({ status: 201, json: record });
    }
    return route.fulfill({ json: secrets });
  });

  await page.goto('/app/resources/secrets?project=proj-1');
  await expect(page.getByText('NPM_TOKEN')).toBeVisible();
  await expect(page.getByText('全团队', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加密钥' });
  await expect(dialog.getByTestId('secret-scope').locator('[data-slot="select-value"]')).toHaveText(
    'cairn',
  );
  await dialog.getByLabel('名称（环境变量名）').fill('DEPLOY_TOKEN');
  await dialog.getByLabel('值').fill('deploy-value');
  await dialog.getByRole('button', { name: '添加密钥' }).click();
  await expect.poll(() => posted).toEqual([
    { name: 'DEPLOY_TOKEN', value: 'deploy-value', projectId: 'proj-1' },
  ]);
  await expect(page.getByText('仅 cairn')).toBeVisible();
});
