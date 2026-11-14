import { expect, test } from '@playwright/test';

test('project concurrency saves serial, a limit and back to no limit', async ({ page }) => {
  let project: Record<string, unknown> = {
    id: 'cc-project',
    name: 'Concurrency',
    teamId: 'team-1',
    repoKind: 'local',
    localPath: '/fixture/repo',
    baseBranch: null,
  };
  const patches: unknown[] = [];
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
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [project] }));
  await page.route('**/api/projects/cc-project', (route, request) => {
    if (request.method() !== 'PATCH') return route.fallback();
    const body = request.postDataJSON() as { maxConcurrent: number | null };
    patches.push(body);
    const { maxConcurrent: _drop, ...rest } = project;
    project = body.maxConcurrent === null ? rest : { ...rest, maxConcurrent: body.maxConcurrent };
    return route.fulfill({ json: project });
  });
  await page.route('**/api/projects/cc-project/branches', (route) =>
    route.fulfill({ json: { defaultBranch: 'main', branches: [{ name: 'main', isDefault: true }] } }),
  );

  await page.goto('/app/project/cc-project/settings');
  const control = page.getByTestId('project-concurrency');
  await expect(control.locator('[data-slot="select-value"]')).toHaveText('不限（跟随 Runner 上限）');
  await control.click();
  await page.getByRole('option', { name: '串行，一次一个' }).click();
  await expect.poll(() => patches).toEqual([{ maxConcurrent: 1 }]);
  await page.reload();
  await expect(control.locator('[data-slot="select-value"]')).toHaveText('串行，一次一个');
  await control.click();
  await page.getByRole('option', { name: '最多 3 个' }).click();
  await control.click();
  await page.getByRole('option', { name: '不限（跟随 Runner 上限）' }).click();
  await expect.poll(() => patches).toEqual([{ maxConcurrent: 1 }, { maxConcurrent: 3 }, { maxConcurrent: null }]);
});
