import { expect, type Page, test } from '@playwright/test';

const TEAM_ID = 'team-1';
const GITHUB_PROJECT_ID = 'proj-auto-github';
const LOCAL_PROJECT_ID = 'proj-auto-local';

const TEAM = { id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };

const PROJECTS = [
  {
    id: GITHUB_PROJECT_ID,
    name: 'cairn',
    teamId: TEAM_ID,
    repoKind: 'github',
    githubRepo: 'xiechimon/cairn',
  },
  {
    id: LOCAL_PROJECT_ID,
    name: 'scratch',
    teamId: TEAM_ID,
    repoKind: 'local',
    localPath: '/Users/who/scratch',
  },
];

type Tier = 'guarded' | 'full';

interface Autonomy {
  actionTier: Tier;
  actionTierOverride: Tier | null;
}

function initialAutonomy(): Autonomy {
  return { actionTier: 'guarded', actionTierOverride: 'guarded' };
}

interface Stub {
  patches: Record<string, unknown>[];
  teamPatches: Record<string, unknown>[];
}

async function stubWorld(page: Page, failNext = false): Promise<Stub> {
  const stub: Stub = { patches: [], teamPatches: [] };
  let autonomy = initialAutonomy();
  let teamTier: Tier = 'guarded';
  let fail = failNext;
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/teams/*/autonomy', (route, request) => {
    if (request.method() === 'GET') return route.fulfill({ json: { actionTier: teamTier } });
    if (request.method() !== 'PATCH') return route.fallback();
    const body = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
    stub.teamPatches.push(body);
    if (typeof body.actionTier === 'string') teamTier = body.actionTier as Tier;
    return route.fulfill({ json: { actionTier: teamTier } });
  });
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: PROJECTS }));
  await page.route('**/api/projects/*/autonomy', (route, request) => {
    if (request.method() === 'GET') return route.fulfill({ json: autonomy });
    if (request.method() !== 'PATCH') return route.fallback();
    const body = JSON.parse(request.postData() ?? '{}') as Record<string, unknown>;
    stub.patches.push(body);
    if (fail) {
      fail = false;
      return route.fulfill({ status: 500, json: { error: 'stub: autonomy write rejected' } });
    }
    if (body.actionTier !== undefined) {
      const override = body.actionTier as Tier | null;
      autonomy = { actionTier: override ?? teamTier, actionTierOverride: override };
    }
    return route.fulfill({ json: autonomy });
  });
  return stub;
}

test('autonomy card: github project shows only the external-actions tier', async ({ page }) => {
  await stubWorld(page);
  await page.goto(`/app/project/${GITHUB_PROJECT_ID}/settings`);
  const card = page.getByRole('region', { name: '对外动作' });
  await expect(card).toBeVisible();
  const tier = card.getByTestId('autonomy-tier');
  await expect(tier).toContainText('先问我');
  await expect(card.getByText('比如发送、发布')).toBeVisible();
});

test('autonomy card: decision tier selector shows the override and patches the tier at once', async ({
  page,
}) => {
  const stub = await stubWorld(page);
  await page.goto(`/app/project/${GITHUB_PROJECT_ID}/settings`);
  const card = page.getByRole('region', { name: '对外动作' });
  const tier = card.getByTestId('autonomy-tier');
  await expect(tier).toBeVisible();
  await expect(tier).toContainText('先问我');
  await tier.click();
  await page.getByRole('option', { name: '完全放手' }).click();
  await expect.poll(() => stub.patches.length).toBe(1);
  expect(stub.patches[0]).toEqual({ actionTier: 'full' });
  await expect(tier).toContainText('完全放手');
});

test('autonomy card: following the global tier sends actionTier null and shows the global value', async ({
  page,
}) => {
  const stub = await stubWorld(page);
  await page.goto(`/app/project/${GITHUB_PROJECT_ID}/settings`);
  const card = page.getByRole('region', { name: '对外动作' });
  const tier = card.getByTestId('autonomy-tier');
  await tier.click();
  await page.getByRole('option', { name: '跟随全局（先问我）' }).click();
  await expect.poll(() => stub.patches.length).toBe(1);
  expect(stub.patches[0]).toEqual({ actionTier: null });
  await expect(tier).toContainText('跟随全局（先问我）');
});

test('account settings: the global external-actions tier patches the team', async ({ page }) => {
  const stub = await stubWorld(page);
  await page.goto('/app/account');
  const tier = page.getByTestId('team-autonomy-tier');
  await expect(tier).toBeVisible();
  await expect(tier).toContainText('先问我');
  await tier.click();
  await page.getByRole('option', { name: '完全放手' }).click();
  await expect.poll(() => stub.teamPatches.length).toBe(1);
  expect(stub.teamPatches[0]).toEqual({ actionTier: 'full' });
  await expect(tier).toContainText('完全放手');
});

test('autonomy card: local project has no card', async ({ page }) => {
  await stubWorld(page);
  await page.goto(`/app/project/${LOCAL_PROJECT_ID}/settings`);
  await expect(page.getByText('目标分支', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '对外动作' })).toHaveCount(0);
});

test('autonomy card: save failure is visible', async ({ page }) => {
  await stubWorld(page, true);
  await page.goto(`/app/project/${GITHUB_PROJECT_ID}/settings`);
  const card = page.getByRole('region', { name: '对外动作' });
  await card.getByTestId('autonomy-tier').click();
  await page.getByRole('option', { name: '完全放手' }).click();
  await expect(page.getByText('保存失败，请重试。')).toBeVisible();
});
