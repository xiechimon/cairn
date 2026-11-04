import { expect, test } from '@playwright/test';

test('the base branch select loads project branches and persists across reload', async ({ page }, testInfo) => {
  let project = {
    id: 'base-branch-project',
    name: 'Branches',
    teamId: 'team-1',
    repoKind: 'local',
    localPath: '/fixture/repo',
    baseBranch: null as string | null,
  };
  const patches: unknown[] = [];
  const pageErrors: string[] = [];
  let branchRequests = 0;
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } }),
  );
  await page.route('**/api/teams', (route) =>
    route.fulfill({
      json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
    }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({
      json: { id: 'user-1', displayName: 'Owner', avatarUrl: null },
    }),
  );
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [project] }));
  await page.route('**/api/projects/base-branch-project', (route, request) => {
    if (request.method() !== 'PATCH') return route.fallback();
    const body = request.postDataJSON() as { baseBranch: string | null };
    patches.push(body);
    project = { ...project, ...body };
    return route.fulfill({ json: project });
  });
  await page.route('**/api/projects/base-branch-project/branches', (route) => {
    branchRequests += 1;
    return route.fulfill({
      json: {
        defaultBranch: 'main',
        branches: [
          { name: 'main', isDefault: true },
          { name: 'dev', isDefault: false },
          { name: 'release/next', isDefault: false },
        ],
      },
    });
  });
  await page.goto('/app/project/base-branch-project/settings');
  const control = page.getByTestId('project-base-branch');
  await expect(control).toBeEnabled();
  await expect(control).toHaveAttribute('data-slot', 'select-trigger');
  await expect(control).toHaveAttribute('role', 'combobox');
  await page.screenshot({ path: testInfo.outputPath('base-branch-default.png') });
  await control.click();
  expect(branchRequests).toBeGreaterThan(0);
  await expect(page.getByRole('option')).toHaveText([
    'main（默认）',
    'main',
    'dev',
    'release/next',
  ]);
  await expect(control.locator('[data-slot="select-value"]')).toHaveText('main（默认）');
  const saved = page.waitForResponse(
    (response) =>
      response.request().method() === 'PATCH' &&
      response.url().endsWith('/api/projects/base-branch-project'),
  );
  await page.getByRole('option', { name: 'dev', exact: true }).click();
  await saved;
  await expect(control.locator('[data-slot="select-value"]')).toHaveText('dev');
  expect(patches).toEqual([{ baseBranch: 'dev' }]);
  const beforeDevReload = branchRequests;
  await page.reload();
  await expect(control.locator('[data-slot="select-value"]')).toHaveText('dev');
  await expect.poll(() => branchRequests).toBeGreaterThan(beforeDevReload);
  await page.screenshot({ path: testInfo.outputPath('base-branch-dev-reloaded.png') });
  await expect(control).toBeEnabled();
  await control.click();
  await page.getByRole('option', { name: 'main（默认）', exact: true }).click();
  await expect.poll(() => project.baseBranch).toBeNull();
  const beforeDefaultReload = branchRequests;
  await page.reload();
  await expect(control.locator('[data-slot="select-value"]')).toHaveText('main（默认）');
  await expect(control).toBeEnabled();
  await expect.poll(() => branchRequests).toBeGreaterThan(beforeDefaultReload);
  expect(patches).toEqual([{ baseBranch: 'dev' }, { baseBranch: null }]);
  expect(pageErrors).toEqual([]);
});
