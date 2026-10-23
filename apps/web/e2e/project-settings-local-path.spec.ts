import { expect, type Page, test } from '@playwright/test';

// #1213 / ADR 0017：项目设置页「本机加速路径」字段（仅 github 形态显示）。
// live 数据分支打桩（board-dnd-live stubBoot 纪律：teams / user me / projects
// 供数，其余 GET 一律 500，应用既有 isError 耐受）。钉两条：
//  · 字段可见性与写回：输入绝对路径保存 → PATCH /api/projects/{id}
//    {localPath:'<path>'}；清空保存 → **显式 null**（#1169 序列化坑族：
//    'localPath' 键必须在 wire 上，不是被 JSON.stringify 丢掉的 undefined）。
//  · 形态门槛：非 github 项目（hosted）不显示该字段。

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

/** 启动面 + projects 读写面；PATCH 落桩态（invalidate 重取回显新真值）。 */
async function stubWorld(page: Page, initial: WireProject[]): Promise<Stub> {
  const stub: Stub = { patches: [] };
  let projects = initial;
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  // 列表 GET 带 teamId query——glob 须 `?*` 才匹配带 query 的 URL（board-dnd-live
  // 的 `**/api/todos?*` 同律）。
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

  // 保存：绝对路径上 wire。落定信号 = invalidate 触发的列表重取（先于后续
  // 清空动作——mutation onSuccess 的草稿复位与 fill('') 同拍竞速，不等待
  // 会把清空输入覆写回 server 真值）。钮位 exact 钉名：#1242 起设置页有
  // 三个保存钮（名称/描述带 aria-label，加速位钮保裸文本「保存」）——
  // substring 匹配会撞名，exact 钉本钮。
  await input.fill('/Users/who/code/cairn');
  const refetched = page.waitForResponse(
    (r) => r.url().includes('/api/projects') && r.request().method() === 'GET',
  );
  await page.getByRole('button', { name: '保存', exact: true }).click();
  await refetched;
  await expect(stub.patches.length).toBeGreaterThanOrEqual(1);
  expect(stub.patches[0]?.body).toEqual({ localPath: '/Users/who/code/cairn' });
  // invalidate 重取后回显 server 真值
  await expect(input).toHaveValue('/Users/who/code/cairn');

  // 清空保存：显式 null——键在 wire 上（#1169 同族序列化坑）
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
