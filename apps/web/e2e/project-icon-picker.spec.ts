import { expect, test } from '@playwright/test';

test('the project avatar picker sets an icon that reaches the sidebar, then resets', async ({
  page,
}) => {
  let project: Record<string, unknown> = {
    id: 'icon-project',
    name: 'Atlas',
    teamId: 'team-1',
    repoKind: 'local',
    localPath: '/fixture/repo',
    baseBranch: null,
  };
  const patches: unknown[] = [];
  const pageErrors: string[] = [];
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
    route.fulfill({ json: { id: 'user-1', displayName: 'Owner', avatarUrl: null } }),
  );
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [project] }));
  await page.route('**/api/projects/icon-project', (route, request) => {
    if (request.method() !== 'PATCH') return route.fallback();
    const body = request.postDataJSON() as Record<string, unknown>;
    patches.push(body);
    project = { ...project, ...body };
    for (const key of ['icon', 'color']) if (project[key] === null) delete project[key];
    return route.fulfill({ json: project });
  });

  await page.goto('/app/project/icon-project/settings');
  const sidebarRow = page.locator('[data-slot="sidebar-project-row"]', { hasText: 'Atlas' });
  await expect(sidebarRow.locator('[data-project-icon]')).toHaveCount(0);
  await expect(sidebarRow.locator('[data-slot="project-glyph"]')).toBeVisible();

  await page.getByTestId('project-icon-trigger').click();
  const picker = page.getByTestId('project-icon-picker');
  await expect(picker.locator('[data-icon]')).toHaveCount(32);
  await picker.getByRole('textbox', { name: '搜索图标' }).fill('rock');
  await expect(picker.locator('[data-icon]')).toHaveCount(1);
  await picker.getByRole('button', { name: 'rocket' }).click();
  await expect(sidebarRow.locator('[data-project-icon="rocket"]')).toBeVisible();
  await expect(sidebarRow.locator('[data-project-icon]')).toHaveCSS('width', '20px');

  await picker.getByRole('button', { name: '重置图标' }).click();
  await expect(sidebarRow.locator('[data-project-icon]')).toHaveCount(0);
  await expect(sidebarRow.locator('[data-slot="project-glyph"]')).toBeVisible();

  expect(patches).toEqual([
    { icon: 'rocket' },
    { icon: null, color: null },
  ]);
  expect(pageErrors).toEqual([]);
});

test('the fixture sidebar shows picked icons bare and projects without one show the neutral folder', async ({
  page,
}) => {
  await page.goto('/app?scenario=sidebar-project-icons');
  const rows = page.locator('[data-slot="sidebar-project-row"]');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(0).locator('[data-project-icon="flask-conical"]')).toBeVisible();
  await expect(rows.nth(1).locator('[data-project-icon="rocket"]')).toBeVisible();
  await expect(rows.nth(2).locator('[data-project-icon="database"]')).toBeVisible();
  await expect(rows.nth(3).locator('[data-project-icon]')).toHaveCount(0);
  await expect(rows.nth(3).locator('[data-slot="project-glyph"]')).toBeVisible();
});
