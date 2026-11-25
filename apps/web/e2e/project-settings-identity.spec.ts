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
  if (body.repoKind === 'github') delete next.localPath;
  return next;
}

const NAME_FIELD = '项目名称';
const GOAL_FIELD = '想做什么';

test('settings: name and goal edits reach PATCH; clearing the goal writes explicit null', async ({
  page,
}) => {
  const stub = await stubWorld(page, [localProject()]);
  await page.goto(`/app/project/${LOCAL_PROJECT_ID}/settings`);

  const nameInput = page.getByRole('textbox', { name: NAME_FIELD });
  await expect(nameInput).toHaveValue('cairn-local');
  await nameInput.fill('cairn-main');
  const refetched = page.waitForResponse(
    (r) => r.url().includes('/api/projects') && r.request().method() === 'GET',
  );
  await nameInput.press('Enter');
  await refetched;
  expect(stub.patches[0]?.body).toEqual({ name: 'cairn-main' });
  await expect(nameInput).toHaveValue('cairn-main');

  const goalInput = page.getByRole('textbox', { name: GOAL_FIELD });
  await expect(goalInput).toHaveValue('');
  await goalInput.fill('迁移期的主项目');
  const goalRefetched = page.waitForResponse(
    (r) => r.url().includes('/api/projects') && r.request().method() === 'GET',
  );
  await page.getByRole('button', { name: '保存想做什么' }).click();
  await goalRefetched;
  await expect(goalInput).toHaveValue('迁移期的主项目');
  await expect.poll(() => stub.patches.length).toBe(2);
  expect(stub.patches[1]?.body).toEqual({ description: '迁移期的主项目' });

  await goalInput.fill('');
  await page.getByRole('button', { name: '保存想做什么' }).click();
  await expect.poll(() => stub.patches.length).toBe(3);
  expect(stub.patches[2]?.raw).toContain('"description":null');
});

test('settings: Escape in the name field drops the edit and keeps the dialog open', async ({
  page,
}) => {
  const stub = await stubWorld(page, [localProject()]);
  await page.goto(`/app/project/${LOCAL_PROJECT_ID}/settings`);
  const input = page.getByRole('textbox', { name: NAME_FIELD });
  await input.fill('half-typed');
  await input.press('Escape');
  await expect(input).toHaveValue('cairn-local');
  await expect(page.getByRole('dialog', { name: '项目设置' })).toBeVisible();
  await input.blur();
  expect(stub.patches).toHaveLength(0);
});

test('settings: identity save failure is visible (toast, not silent)', async ({ page }) => {
  await stubWorld(page, [localProject()], true);
  await page.goto(`/app/project/${LOCAL_PROJECT_ID}/settings`);

  const input = page.getByRole('textbox', { name: NAME_FIELD });
  await input.fill('改名失败可见');
  await input.press('Enter');

  const toast = page.getByText('保存失败，请重试。');
  await expect(toast).toBeVisible();
});

test('settings: local project shows conversion card; submit carries repoKind/githubRepo only', async ({
  page,
}) => {
  const stub = await stubWorld(page, [localProject()]);
  await page.goto(`/app/project/${LOCAL_PROJECT_ID}/settings`);

  const card = page.getByText('转换为 GitHub 形态', { exact: true });
  await expect(card).toBeVisible();
  const repoInput = page.getByRole('textbox', { name: 'GitHub 仓库（owner/repo）' });

  const convert = page.getByRole('button', { name: '转换', exact: true });
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
  await page.getByRole('alertdialog').getByRole('button', { name: '确认转换' }).click();
  await refetched;
  expect(stub.patches[0]?.body).toEqual({
    repoKind: 'github',
    githubRepo: 'xiechimon/cairn',
  });

  await expect(page.getByText('转换为 GitHub 形态', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'GitHub 仓库（owner/repo）' })).toHaveValue(
    'xiechimon/cairn',
  );
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
  await expect(page.getByText('想做什么', { exact: true })).toBeVisible();
  await expect(page.getByText('转换为 GitHub 形态', { exact: true })).toHaveCount(0);
});

test('settings: the per-project task model row is gone; only the Coordinator override remains', async ({
  page,
}) => {
  await stubWorld(page, [localProject()]);
  await page.goto(`/app/project/${LOCAL_PROJECT_ID}/settings`);
  await expect(page.getByTestId('project-model-coordinator')).toBeVisible();
  await expect(page.getByTestId('project-model-session')).toHaveCount(0);
  await expect(page.getByText('跟随团队默认')).toHaveCount(1);
});

test('settings: the project Coordinator picker lists models of every runtime the Coordinator can run on', async ({
  page,
}) => {
  const stub = await stubWorld(page, [localProject()]);
  await page.route('**/api/teams/team-1/routing-settings', (route) =>
    route.fulfill({
      json: {
        rules: [
          {
            id: 'r-coord',
            teamId: TEAM_ID,
            use: 'coordinator',
            provider: 'claude-code',
            modelId: 'sonnet',
            thinkingLevel: null,
            fallbackModels: null,
            machineId: null,
            requiredCapabilities: null,
            seededFromAgentId: null,
            createdAt: 0,
            updatedAt: 0,
          },
        ],
        policies: [],
      },
    }),
  );
  await page.route('**/api/teams/team-1/model-sources', (route) =>
    route.fulfill({
      json: {
        sources: [
          {
            runtime: 'pi',
            provider: 'anthropic',
            providerLabel: 'Anthropic',
            installed: true,
            models: [{ id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' }],
          },
          {
            runtime: 'claude-code',
            provider: 'claude-code',
            installed: true,
            models: [
              { id: 'sonnet', name: 'sonnet' },
              { id: 'opus', name: 'opus' },
            ],
          },
        ],
      },
    }),
  );
  await page.goto(`/app/project/${LOCAL_PROJECT_ID}/settings`);
  await page.getByTestId('project-model-coordinator').locator('.routing-rule-model-select').click();
  const menu = page.locator('.routing-rule-model-menu');
  await expect(menu.getByText('opus', { exact: true })).toBeVisible();
  await expect(menu.getByText('follow-default')).toHaveCount(0);
  await menu.getByText('Claude Haiku 5.5').click();
  await expect.poll(() => stub.patches.length).toBe(1);
  expect(stub.patches[0]?.body).toEqual({
    modelOverrides: {
      coordinator: { provider: 'anthropic', modelId: 'claude-haiku-5-5', thinkingLevel: null },
    },
  });
});
