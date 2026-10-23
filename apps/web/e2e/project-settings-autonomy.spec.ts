import { expect, type Page, test } from '@playwright/test';

// #1491 项目设置页「后台自动任务」卡：issue 进料 / 园丁 / 自治合并开一轮前
// 过的闸。live 数据分支打桩（project-settings-identity.spec 同律：teams /
// user me / projects 供数，其余 GET 一律 500）。钉四条：
//  · github 项目才有这张卡；local 项目不渲染。
//  · 读面：阈值回显 GET /api/projects/{id}/autonomy；每种任务最近一次判定——
//    放行 / 被拦带原因；没判过的园丁、自治合并不出行。
//  · 写面：改数字 → 保存 → PATCH 只带改过的键；开关即时 PATCH {enabled}。
//    非法数（负数、分钟带小数）保存钮禁用。
//  · 失败可见：PATCH 500 → toast。

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

interface Autonomy {
  settings: {
    enabled: boolean;
    quietMinutes: number;
    cooldownMinutes: number;
    dailyBudgetUsd: number;
  };
  spentTodayUsd: number | null;
  kinds: Array<{
    kind: string;
    lastStartedAt: number | null;
    lastBlockedReason: string | null;
    lastEvaluatedAt: number | null;
  }>;
}

function initialAutonomy(): Autonomy {
  return {
    settings: { enabled: true, quietMinutes: 10, cooldownMinutes: 15, dailyBudgetUsd: 10 },
    spentTodayUsd: 3.5,
    kinds: [
      {
        kind: 'issue-intake',
        lastStartedAt: 1,
        lastBlockedReason: 'member-active',
        lastEvaluatedAt: 2,
      },
      { kind: 'gardener', lastStartedAt: null, lastBlockedReason: null, lastEvaluatedAt: null },
      { kind: 'auto-merge', lastStartedAt: 1, lastBlockedReason: null, lastEvaluatedAt: 2 },
    ],
  };
}

interface Stub {
  patches: Record<string, unknown>[];
}

async function stubWorld(page: Page, failNext = false): Promise<Stub> {
  const stub: Stub = { patches: [] };
  let autonomy = initialAutonomy();
  let fail = failNext;
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
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
    autonomy = { ...autonomy, settings: { ...autonomy.settings, ...body } };
    return route.fulfill({ json: autonomy });
  });
  return stub;
}

test('autonomy card: github project shows thresholds and the last verdict per kind', async ({
  page,
}) => {
  await stubWorld(page);
  await page.goto(`/app/project/${GITHUB_PROJECT_ID}/settings`);
  const card = page.getByRole('region', { name: '后台自动任务' });
  await expect(card).toBeVisible();
  await expect(card.getByRole('switch', { name: '允许后台自动开跑' })).toBeChecked();
  await expect(card.getByRole('spinbutton', { name: '有人在用时让路（分钟）' })).toHaveValue('10');
  await expect(card.getByRole('spinbutton', { name: '同类任务冷却（分钟）' })).toHaveValue('15');
  await expect(card.getByRole('spinbutton', { name: '每日预算（USD）' })).toHaveValue('10');
  await expect(card.getByText('$3.50')).toBeVisible();
  await expect(card.getByTestId('autonomy-state-issue-intake')).toHaveText(
    '最近一次被拦：有人正在用，让路',
  );
  // 园丁还没接上闸（没判过）：不出行；进料恒显示。
  await expect(card.getByTestId('autonomy-state-gardener')).toHaveCount(0);
  await expect(card.getByTestId('autonomy-state-auto-merge')).toHaveText('最近一次放行');
});

test('autonomy card: local project has no card', async ({ page }) => {
  await stubWorld(page);
  await page.goto(`/app/project/${LOCAL_PROJECT_ID}/settings`);
  await expect(page.getByText('删除项目', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '后台自动任务' })).toHaveCount(0);
});

test('autonomy card: save sends only changed keys; the switch patches enabled at once', async ({
  page,
}) => {
  const stub = await stubWorld(page);
  await page.goto(`/app/project/${GITHUB_PROJECT_ID}/settings`);
  const card = page.getByRole('region', { name: '后台自动任务' });
  const save = card.getByRole('button', { name: '保存后台自动任务设置' });
  await expect(save).toBeDisabled();

  const quiet = card.getByRole('spinbutton', { name: '有人在用时让路（分钟）' });
  await quiet.fill('-1');
  await expect(save).toBeDisabled();
  await quiet.fill('2.5');
  await expect(save).toBeDisabled();
  await quiet.fill('0');
  await card.getByRole('spinbutton', { name: '每日预算（USD）' }).fill('2.5');
  await expect(save).toBeEnabled();
  const refetched = page.waitForResponse(
    (r) => r.url().includes('/autonomy') && r.request().method() === 'GET',
  );
  await save.click();
  await refetched;
  expect(stub.patches[0]).toEqual({ quietMinutes: 0, dailyBudgetUsd: 2.5 });
  await expect(quiet).toHaveValue('0');
  await expect(save).toBeDisabled();

  await card.getByRole('switch', { name: '允许后台自动开跑' }).click();
  await expect.poll(() => stub.patches.length).toBe(2);
  expect(stub.patches[1]).toEqual({ enabled: false });
  await expect(card.getByRole('switch', { name: '允许后台自动开跑' })).not.toBeChecked();
});

test('autonomy card: save failure is visible', async ({ page }) => {
  await stubWorld(page, true);
  await page.goto(`/app/project/${GITHUB_PROJECT_ID}/settings`);
  const card = page.getByRole('region', { name: '后台自动任务' });
  await card.getByRole('spinbutton', { name: '同类任务冷却（分钟）' }).fill('30');
  await card.getByRole('button', { name: '保存后台自动任务设置' }).click();
  await expect(page.getByText('保存失败，请重试。')).toBeVisible();
});
