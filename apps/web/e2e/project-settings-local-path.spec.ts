import { expect, type Page, test } from '@playwright/test';

const TEAM_ID = 'team-1';
const PROJECT_ID = 'proj-dual-1';
const HOSTED_PROJECT_ID = 'proj-dual-hosted';

const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };

interface WireProject {
  id: string;
  name: string;
  teamId: string;
  repoKind: string;
  githubRepo: string | null;
  localPath?: string;
}

function githubProject(localPath?: string): WireProject {
  return {
    id: PROJECT_ID,
    name: 'dual-source',
    teamId: TEAM_ID,
    repoKind: 'github',
    githubRepo: 'octo/dual',
    ...(localPath !== undefined ? { localPath } : {}),
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
    const next = githubProject(body.localPath === null ? undefined : String(body.localPath));
    if (body.localPath === null) delete next.localPath;
    projects = projects.map((p) => (p.id === PROJECT_ID ? next : p));
    return route.fulfill({ json: next });
  });
  return stub;
}

const FIELD = '本机加速路径';

test('settings: github project shows local-path field; save writes path; clear writes explicit null', async ({
  page,
}) => {
  const stub = await stubWorld(page, [githubProject()]);
  await page.goto(`/app/project/${PROJECT_ID}/settings`);

  const row = page.getByText(FIELD, { exact: true });
  await expect(row).toBeVisible();
  const input = page.getByRole('textbox', { name: FIELD });
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('');

  await input.fill('/Users/who/code/cairn');
  const refetched = page.waitForResponse(
    (r) => r.url().includes('/api/projects') && r.request().method() === 'GET',
  );
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await refetched;
  await expect(stub.patches.length).toBeGreaterThanOrEqual(1);
  expect(stub.patches[0]?.body).toEqual({ localPath: '/Users/who/code/cairn' });

  await expect(input).toHaveValue('/Users/who/code/cairn');

  await input.fill('');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await expect(stub.patches.length).toBeGreaterThanOrEqual(2);
  const clearBody = stub.patches[1]?.body;
  expect(Object.hasOwn(clearBody ?? {}, 'localPath')).toBe(true);
  expect(clearBody?.localPath).toBeNull();
  expect(stub.patches[1]?.raw).toContain('"localPath":null');
  await expect(input).toHaveValue('');
});

test('settings: hosted project hides the local-path field (github-only)', async ({ page }) => {
  await stubWorld(page, [
    {
      id: HOSTED_PROJECT_ID,
      name: 'hosted-probe',
      teamId: TEAM_ID,
      repoKind: 'hosted',
      githubRepo: null,
    },
  ]);
  await page.goto(`/app/project/${HOSTED_PROJECT_ID}/settings`);
  await expect(page.getByText('名称', { exact: true })).toBeVisible();
  await expect(page.getByText(FIELD, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: FIELD })).toHaveCount(0);
});
