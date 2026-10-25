import { expect, type Page, test } from '@playwright/test';

const TEAM_ID = 'team-1';
const LOCAL_PROJECT_ID = 'proj-ident-local';
const GITHUB_PROJECT_ID = 'proj-ident-github';

const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };

interface WireProject {
  id: string;
  name: string;
  teamId: string;
  repoKind: string;
  githubRepo?: string;
  localPath?: string;
  description?: string;
}

function localProject(): WireProject {
  return {
    id: LOCAL_PROJECT_ID,
    name: 'cairn-local',
    teamId: TEAM_ID,
    repoKind: 'local',
    localPath: '/Users/who/code/cairn',
  };
}

interface Stub {
  patches: { raw: string; body: Record<string, unknown> }[];
}

async function stubWorld(
  page: Page,
  initial: WireProject[],
  failNext = false,
): Promise<Stub> {
  const stub: Stub = { patches: [] };
  let projects = initial;
  let fail = failNext;
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: projects }));
  await page.route('**/api/projects/*', (route, request) => {
    if (request.method() !== 'PATCH') return route.fallback();
    const id = new URL(request.url()).pathname.split('/').pop() ?? '';
    const raw = request.postData() ?? '{}';
    const body = JSON.parse(raw) as Record<string, unknown>;
    stub.patches.push({ raw, body });
    if (fail) {
      fail = false;
      return route.fulfill({ status: 500, json: { error: 'stub: identity write rejected' } });
    }
    projects = projects.map((p) => (p.id === id ? applyPatch(p, body) : p));
    const updated = projects.find((p) => p.id === id) ?? projects[0]!;
    return route.fulfill({ json: updated });
  });
  return stub;
}

function applyPatch(p: WireProject, body: Record<string, unknown>): WireProject {
  const next: WireProject = { ...p };
  if (body.name !== undefined) next.name = String(body.name);
  if (body.description !== undefined) {
    next.description = body.description === null ? undefined : String(body.description);
  }
  if (body.repoKind !== undefined) next.repoKind = String(body.repoKind);
  if (body.githubRepo !== undefined) next.githubRepo = String(body.githubRepo);
  if (body.localPath !== undefined) {
    next.localPath = body.localPath === null ? undefined : String(body.localPath);
  }
  return next;
}

const NAME_FIELD = '名称';
const DESC_FIELD = '描述';

test('settings: name and description edits reach PATCH; description clear writes explicit null', async ({
  page,
}) => {
  const stub = await stubWorld(page, [localProject()]);
  await page.goto(`/app/project/${LOCAL_PROJECT_ID}/settings`);

  const nameInput = page.getByRole('textbox', { name: NAME_FIELD });
  await expect(nameInput).toHaveValue('cairn-local');
  const nameSave = page.getByRole('button', { name: '保存名称' });
  await expect(nameSave).toBeDisabled();

  await nameInput.fill('cairn-main');
  await expect(nameSave).toBeEnabled();
  const refetched = page.waitForResponse(
    (r) => r.url().includes('/api/projects') && r.request().method() === 'GET',
  );
  await nameSave.click();
  await refetched;
  expect(stub.patches[0]?.body).toEqual({ name: 'cairn-main' });

  await expect(nameInput).toHaveValue('cairn-main');

  const descInput = page.getByRole('textbox', { name: DESC_FIELD });
  await expect(descInput).toHaveValue('');
  await descInput.fill('迁移期的主项目');

  const descRefetched = page.waitForResponse(
    (r) => r.url().includes('/api/projects') && r.request().method() === 'GET',
  );
  await page.getByRole('button', { name: '保存描述' }).click();
  await descRefetched;
  await expect(descInput).toHaveValue('迁移期的主项目');
  await expect(stub.patches.length).toBe(2);
  expect(stub.patches[1]?.body).toEqual({ description: '迁移期的主项目' });

  await descInput.fill('');
  await page.getByRole('button', { name: '保存描述' }).click();
  await expect(stub.patches.length).toBe(3);
  expect(stub.patches[2]?.raw).toContain('"description":null');
});

test('settings: identity save failure is visible (toast, not silent)', async ({ page }) => {
  await stubWorld(page, [localProject()], true);
  await page.goto(`/app/project/${LOCAL_PROJECT_ID}/settings`);

  const nameInput = page.getByRole('textbox', { name: NAME_FIELD });
  await nameInput.fill('改名失败可见');
  await page.getByRole('button', { name: '保存名称' }).click();

  const toast = page.getByText('保存失败，请重试。');
  await expect(toast).toBeVisible();
});

test('settings: local project shows conversion card; submit carries repoKind/githubRepo/localPath', async ({
  page,
}) => {
  const stub = await stubWorld(page, [localProject()]);
  await page.goto(`/app/project/${LOCAL_PROJECT_ID}/settings`);

  const card = page.getByText('转换为 GitHub 形态', { exact: true });
  await expect(card).toBeVisible();
  const repoInput = page.getByRole('textbox', { name: 'GitHub 仓库（owner/repo）' });
  const pathInput = page.getByRole('textbox', { name: '本机加速路径' });

  await expect(pathInput).toHaveValue('/Users/who/code/cairn');

  const convert = page.getByRole('button', { name: '转换' });
  await expect(convert).toBeDisabled();

  await repoInput.fill('no-slash');
  await convert.click();
  await expect(page.getByText('GitHub 仓库格式应为 owner/repo。')).toBeVisible();
  await expect(stub.patches).toHaveLength(0);

  await repoInput.fill('xiechimon/cairn');
  const refetched = page.waitForResponse(
    (r) => r.url().includes('/api/projects') && r.request().method() === 'GET',
  );
  await convert.click();
  await refetched;
  expect(stub.patches[0]?.body).toEqual({
    repoKind: 'github',
    githubRepo: 'xiechimon/cairn',
    localPath: '/Users/who/code/cairn',
  });

  await expect(page.getByText('转换为 GitHub 形态', { exact: true })).toHaveCount(0);
  await expect(page.getByText('本机加速路径', { exact: true })).toBeVisible();
});

test('settings: non-local projects hide the conversion card', async ({ page }) => {
  await stubWorld(page, [
    {
      id: GITHUB_PROJECT_ID,
      name: 'already-github',
      teamId: TEAM_ID,
      repoKind: 'github',
      githubRepo: 'octo/dual',
    },
  ]);
  await page.goto(`/app/project/${GITHUB_PROJECT_ID}/settings`);
  await expect(page.getByText('名称', { exact: true })).toBeVisible();
  await expect(page.getByText('转换为 GitHub 形态', { exact: true })).toHaveCount(0);
});
