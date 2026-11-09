import { expect, test } from '@playwright/test';

test('project instructions save, survive reload and clear back to empty', async ({ page }) => {
  let project = {
    id: 'rules-project',
    name: 'Rules',
    teamId: 'team-1',
    repoKind: 'local',
    localPath: '/fixture/repo',
    baseBranch: null as string | null,
    instructions: undefined as string | undefined,
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
  await page.route('**/api/projects/rules-project', (route, request) => {
    if (request.method() !== 'PATCH') return route.fallback();
    const body = request.postDataJSON() as { instructions: string | null };
    patches.push(body);
    project = { ...project, instructions: body.instructions ?? undefined };
    return route.fulfill({ json: project });
  });
  await page.route('**/api/projects/rules-project/branches', (route) =>
    route.fulfill({ json: { defaultBranch: 'main', branches: [{ name: 'main', isDefault: true }] } }),
  );

  const openMemoryTab = () => page.getByRole('tab', { name: '记忆' }).click();
  await page.goto('/app/project/rules-project/settings');
  await openMemoryTab();
  const input = page.getByTestId('project-instructions-input');
  const save = page.getByRole('button', { name: '保存项目说明' });
  await expect(input).toHaveValue('');
  await expect(save).toBeDisabled();
  await input.fill('  仓库内容用英文；不要 force push。  ');
  await save.click();
  await expect.poll(() => patches).toEqual([{ instructions: '仓库内容用英文；不要 force push。' }]);
  await expect(save).toBeDisabled();
  await page.reload();
  await openMemoryTab();
  await expect(input).toHaveValue('仓库内容用英文；不要 force push。');
  await input.fill('   ');
  await save.click();
  await expect.poll(() => patches.at(-1)).toEqual({ instructions: null });
  await page.reload();
  await openMemoryTab();
  await expect(input).toHaveValue('');
  expect(pageErrors).toEqual([]);
});
