import { expect, type Page, test } from '@playwright/test';

const TEAM_ID = 'team-1';
const PROJECT_ID = 'proj-repo-1';
const HOSTED_PROJECT_ID = 'proj-repo-hosted';

const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };

interface WireProject {
  id: string;
  name: string;
  teamId: string;
  repoKind: string;
  repoName?: string;
  githubRepo: string | null;
}

function githubProject(githubRepo: string | null): WireProject {
  return {
    id: PROJECT_ID,
    name: 'repo-source',
    teamId: TEAM_ID,
    repoKind: 'github',
    githubRepo,
  };
}

interface Stub {
  patches: { raw: string; body: Record<string, unknown> }[];
}

async function stubWorld(page: Page, initial: WireProject[]): Promise<Stub> {
  const stub: Stub = { patches: [] };
  let projects = initial;
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));

  await page.route('**/api/projects?*', (route) => route.fulfill({ json: projects }));
  await page.route('**/api/projects/*', (route, request) => {
    if (request.method() !== 'PATCH') return route.fallback();
    const raw = request.postData() ?? '{}';
    const body = JSON.parse(raw) as Record<string, unknown>;
    stub.patches.push({ raw, body });
    const next = githubProject(typeof body.githubRepo === 'string' ? body.githubRepo : null);
    projects = projects.map((p) => (p.id === PROJECT_ID ? next : p));
    return route.fulfill({ json: next });
  });
  return stub;
}

const FIELD = 'GitHub 仓库（owner/repo）';

test('settings: github project can retarget its repo; save writes githubRepo and the row shows the new value', async ({
  page,
}) => {
  const stub = await stubWorld(page, [githubProject('octo/pacman')]);
  await page.goto(`/app/project/${PROJECT_ID}/settings`);

  const input = page.getByRole('textbox', { name: FIELD });
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('octo/pacman');

  await input.fill('octo/cairn');
  const refetched = page.waitForResponse(
    (r) => r.url().includes('/api/projects') && r.request().method() === 'GET',
  );
  await page.getByRole('button', { name: '保存仓库' }).click();
  await refetched;
  await expect(stub.patches.length).toBeGreaterThanOrEqual(1);
  expect(stub.patches[0]?.body).toEqual({ githubRepo: 'octo/cairn' });

  await expect(input).toHaveValue('octo/cairn');
});

test('settings: a malformed repo shows an inline error and sends no PATCH', async ({ page }) => {
  const stub = await stubWorld(page, [githubProject('octo/pacman')]);
  await page.goto(`/app/project/${PROJECT_ID}/settings`);

  const input = page.getByRole('textbox', { name: FIELD });
  await input.fill('no-slash');
  await page.getByRole('button', { name: '保存仓库' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(stub.patches).toHaveLength(0);
});

test('settings: hosted project keeps the read-only repo row (github-only edit)', async ({ page }) => {
  await stubWorld(page, [
    {
      id: HOSTED_PROJECT_ID,
      name: 'hosted-probe',
      teamId: TEAM_ID,
      repoKind: 'hosted',
      repoName: 'hosted-probe',
      githubRepo: null,
    },
  ]);
  await page.goto(`/app/project/${HOSTED_PROJECT_ID}/settings`);
  await expect(page.getByText('名称', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: FIELD })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存仓库' })).toHaveCount(0);
});
