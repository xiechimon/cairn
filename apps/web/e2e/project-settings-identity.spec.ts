import { expect, type Page, test } from '@playwright/test';

// #1242 项目身份可变面：设置页名称/描述编辑接 PATCH + local→github 转换卡。
// live 数据分支打桩（project-settings-local-path.spec 同律：teams / user me /
// projects 供数，其余 GET 一律 500，应用既有 isError 耐受）。钉四条：
//  · 名称/描述编辑写回：保存 → PATCH /api/projects/{id} {name} /
//    {description}（描述清空 = **显式 null**，#1169 序列化坑族同律）；
//    invalidate 重取回显新名（侧栏/卡面同源的 projects 面收敛）。
//  · 失败可见（票面验收 3）：PATCH 500 → 错误 toast 可见，不静默。
//  · local→github 转换（票面验收 1 的 UI 半）：githubRepo + localPath
//    （预填现值——local 绑定路径就地转加速位）三键上 wire；成功后
//    invalidate 重取 → 转换卡卸载、基本信息卡的加速位行上线。
//  · 形态门槛：github/hosted 项目不显示转换卡；空 owner/repo 形状 → 中性
//    提示行（预检闸，非 toast）。

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
    name: 'pacman-local',
    teamId: TEAM_ID,
    repoKind: 'local',
    localPath: '/Users/who/code/pacman',
  };
}

interface Stub {
  patches: { raw: string; body: Record<string, unknown> }[];
}

/** 启动面 + projects 读写面；PATCH 落桩态（invalidate 重取回显新真值）。
 * failNext = 下一次 PATCH 返 500（失败可见钉）。 */
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

/** 桩侧 PATCH 应用（name/description/repoKind/githubRepo/localPath 五字段）。 */
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
  await expect(nameInput).toHaveValue('pacman-local');
  const nameSave = page.getByRole('button', { name: '保存名称' });
  await expect(nameSave).toBeDisabled();

  await nameInput.fill('pacman-main');
  await expect(nameSave).toBeEnabled();
  const refetched = page.waitForResponse(
    (r) => r.url().includes('/api/projects') && r.request().method() === 'GET',
  );
  await nameSave.click();
  await refetched;
  expect(stub.patches[0]?.body).toEqual({ name: 'pacman-main' });
  // invalidate 重取回显新名（名称纯显示面——数据源即侧栏/卡面同源）
  await expect(nameInput).toHaveValue('pacman-main');

  const descInput = page.getByRole('textbox', { name: DESC_FIELD });
  await expect(descInput).toHaveValue('');
  await descInput.fill('迁移期的主项目');
  // 落定信号 = invalidate 触发的列表重取（local-path spec 同律：mutation
  // onSuccess 的草稿复位与后续 fill 同拍竞速，不等待会把清空输入覆写回
  // server 真值——草稿被复位成 null，保存钮永远禁用）。
  const descRefetched = page.waitForResponse(
    (r) => r.url().includes('/api/projects') && r.request().method() === 'GET',
  );
  await page.getByRole('button', { name: '保存描述' }).click();
  await descRefetched;
  await expect(descInput).toHaveValue('迁移期的主项目');
  await expect(stub.patches.length).toBe(2);
  expect(stub.patches[1]?.body).toEqual({ description: '迁移期的主项目' });

  // 清空保存：显式 null——键在 wire 上（#1169 同族序列化坑）
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
  // #638 同律：失败 = toast 可见（默认 toast 面带错误文案）。
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
  // localPath 预填现值（local 绑定路径就地转加速位）
  await expect(pathInput).toHaveValue('/Users/who/code/pacman');
  // 转换钮：空 repo 禁用
  const convert = page.getByRole('button', { name: '转换' });
  await expect(convert).toBeDisabled();

  // 形状预检：半截 owner/repo → 中性提示行（非 toast）
  await repoInput.fill('no-slash');
  await convert.click();
  await expect(page.getByText('GitHub 仓库格式应为 owner/repo。')).toBeVisible();
  await expect(stub.patches).toHaveLength(0);

  await repoInput.fill('xiechimon/pacman');
  const refetched = page.waitForResponse(
    (r) => r.url().includes('/api/projects') && r.request().method() === 'GET',
  );
  await convert.click();
  await refetched;
  expect(stub.patches[0]?.body).toEqual({
    repoKind: 'github',
    githubRepo: 'xiechimon/pacman',
    localPath: '/Users/who/code/pacman',
  });
  // invalidate 重取 → 形态切面：转换卡卸载，基本信息卡加速位行上线
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
