import { expect, type Page, test } from '@playwright/test';

// #1102：项目页「历史」列表 → 提交详情面（点一行看该提交的 diff）。
// 数据面打桩承 project-files-tree（#1097）的 stubWorld 纪律：无 ?scenario=
// 即 live 分支，teams / user me / projects / commits / commits/{sha} 供数，
// 其余 GET 一律 500，应用既有 isError 耐受。服务端 readCommitDetail 真值面
// （根提交全新增 / merge 第一父 / 注入形 404 / local reason 降级）由 server
// vitest（git-hosting.test.ts + project-local.test.ts F6）钉住，本文件钉
// web 半边。失败方式先列（仓测试纪律）：
//   C1 点行不出 diff — 点击后必须发 GET commits/{sha} 并渲染文件级 diff
//      （文件行 + ±行），不是空占位也不是「加载失败」；
//   C2 元信息与列表行漂移 — 详情头 message / authorName / shortSha / 相对
//      时间必须与所点行同源一致（行面与头面同格式串）；
//   C3 多提交来回切换串数据 — 选 A 显示 A 的文件、切 B 显示 B 的且 A 的
//      退场、切回 A 还原（sha 进 queryKey 的分缓存纪律）；
//   C4 选中态串项目 — 选中存 (projectId, sha) 对：SPA 导航切项目后右栏
//      必须回占位，旧项目 diff 不得跟场；
//   C5 不可达降级撒谎 — 详情 404+reason 必须演「提交详情加载失败」+
//      LOCAL_ERROR_REASON_COPY 分译行，不是 500 白屏不是空树；
//   C6 选中态无载体 — 选中行必须有 aria-current=true（#910 裁定 3 载体），
//      关闭钮必须清选中回占位；
//   C7 fixture 面死钮 — fixture（无 server）行点击必须直出行上 files 槽的
//      diff（hosted r2-24 与 local prj-local-files 两形态）；根提交 =
//      全文件新增；种子空提交 = 「没有可显示的改动」定义态，不白屏。

const PROJECT_A = {
  id: 'proj-1102a',
  name: 'detail-a',
  teamId: 'team-1',
  repoKind: 'hosted',
  repoName: 'detail-a',
  githubRepo: null,
  localPath: null,
};
// B 也是 hosted：stub 世界不供 tree 面（500），local 形态会整 pane 落进
// 「本地仓库当前无法读取。」降级分支（treeQ.isError 闸），历史行无从渲染。
const PROJECT_B = {
  id: 'proj-1102b',
  name: 'detail-b',
  teamId: 'team-1',
  repoKind: 'hosted',
  repoName: 'detail-b',
  githubRepo: null,
  localPath: null,
};
const PAGE_A = `/app/project/${PROJECT_A.id}`;

const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };

// 3 小时前的固定偏移：相对时间文案在行面/头面两次渲染间稳定（'刚刚' 会随
// 秒边界翻字）。
const AT = Date.now() - 3 * 60 * 60 * 1000;
const SHA1 = 'a1'.repeat(20);
const SHA2 = 'b2'.repeat(20);
const SHA_ERR = 'e3'.repeat(20);
const SHA_B = 'c4'.repeat(20);

const COMMITS_A = [
  { sha: SHA1, shortSha: SHA1.slice(0, 7), message: 'feat: alpha', authorName: 'dev-a', at: AT },
  { sha: SHA2, shortSha: SHA2.slice(0, 7), message: 'chore: beta', authorName: 'dev-b', at: AT },
  {
    sha: SHA_ERR,
    shortSha: SHA_ERR.slice(0, 7),
    message: 'gone: unreachable',
    authorName: 'dev-c',
    at: AT,
  },
];
const COMMITS_B = [
  { sha: SHA_B, shortSha: SHA_B.slice(0, 7), message: 'init b', authorName: 'dev-b', at: AT },
];

const detail = (
  sha: string,
  message: string,
  authorName: string,
  files: { path: string; additions: number; deletions: number; lines: string[] }[],
) => ({
  sha,
  shortSha: sha.slice(0, 7),
  message,
  authorName,
  at: AT,
  files: files.map((f) => ({
    path: f.path,
    additions: f.additions,
    deletions: f.deletions,
    hunks: [{ header: '@@ -1,2 +1,3 @@', lines: f.lines }],
  })),
});

const DETAILS: Record<string, unknown> = {
  [SHA1]: detail(SHA1, 'feat: alpha', 'dev-a', [
    { path: 'alpha.txt', additions: 2, deletions: 1, lines: [' ctx', '-ALPHA-OLD', '+ALPHA-NEW-1', '+ALPHA-NEW-2'] },
  ]),
  [SHA2]: detail(SHA2, 'chore: beta', 'dev-b', [
    { path: 'beta.txt', additions: 1, deletions: 0, lines: [' ctx', '+BETA-LINE'] },
  ]),
  [SHA_B]: detail(SHA_B, 'init b', 'dev-b', [
    { path: 'b-readme.md', additions: 1, deletions: 0, lines: ['+# b'] },
  ]),
  // SHA_ERR 无条目 → 404 + reason（不可达降级面 C5）
};

interface Wire {
  detailUrls: string[];
}

async function stubWorld(page: Page): Promise<Wire> {
  const wire: Wire = { detailUrls: [] };
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/projects?*', (route) =>
    route.fulfill({ json: [PROJECT_A, PROJECT_B] }),
  );
  // commits 列表面 + 详情面一个 handler 按路径分派（regex 路由，避免 glob
  // 的段匹配歧义）。
  await page.route(/\/api\/projects\/proj-1102[ab]\/commits(\/[0-9a-f]+)?$/, (route, request) => {
    const url = new URL(request.url());
    const sha = url.pathname.split('/')[5];
    if (sha === undefined) {
      const commits = url.pathname.includes(PROJECT_A.id) ? COMMITS_A : COMMITS_B;
      return route.fulfill({ json: { ref: 'main', commits } });
    }
    wire.detailUrls.push(`${url.pathname.split('/')[3]}/${sha}`);
    const body = DETAILS[sha];
    if (body === undefined) {
      return route.fulfill({
        status: 404,
        json: { error: 'e2e stub: commit unreachable', reason: 'not_found' },
      });
    }
    return route.fulfill({ json: body });
  });
  return wire;
}

const historyTab = (page: Page) => page.getByRole('tab', { name: '历史', exact: true });
const historyRow = (page: Page, message: string) =>
  page.locator('.prj-history-row').filter({ hasText: message });
const pane = (page: Page) => page.locator('[data-commit-detail="pane"]');

test('C1+C2 点历史行 → 发详情请求，出 diff，元信息与行一致', async ({ page }) => {
  const wire = await stubWorld(page);
  await page.goto(PAGE_A);
  await historyTab(page).click();
  const row = historyRow(page, 'feat: alpha');
  await expect(row).toBeVisible();
  await row.click();

  // C1 请求按 (projectId, sha) 发出
  await expect(pane(page)).toBeVisible();
  expect(wire.detailUrls).toContain(`${PROJECT_A.id}/${SHA1}`);
  // C1 diff 渲染：文件行 + ±行（不是空占位、不是「加载失败」）
  await expect(pane(page).locator('.doc-file-row', { hasText: 'alpha.txt' })).toBeVisible();
  await expect(pane(page).locator('[data-kind="add"]', { hasText: 'ALPHA-NEW-1' })).toBeVisible();
  await expect(pane(page).locator('[data-kind="del"]', { hasText: 'ALPHA-OLD' })).toBeVisible();
  await expect(page.getByText('提交详情加载失败')).toHaveCount(0);

  // C2 元信息与列表行一致：头面 message/meta 与行面同文本
  await expect(page.locator('[data-commit-detail="message"]')).toHaveText('feat: alpha');
  const rowMeta = await row.getByTestId('history-meta').innerText();
  await expect(page.locator('[data-commit-detail="meta"]')).toHaveText(rowMeta.trim());
});

test('C3 多提交来回切换不串数据（sha 进 queryKey）', async ({ page }) => {
  const wire = await stubWorld(page);
  await page.goto(PAGE_A);
  await historyTab(page).click();
  await historyRow(page, 'feat: alpha').click();
  await expect(pane(page).locator('.doc-file-row', { hasText: 'alpha.txt' })).toBeVisible();

  await historyRow(page, 'chore: beta').click();
  await expect(pane(page).locator('.doc-file-row', { hasText: 'beta.txt' })).toBeVisible();
  // A 的内容退场，不是叠加
  await expect(pane(page).locator('.doc-file-row', { hasText: 'alpha.txt' })).toHaveCount(0);

  await historyRow(page, 'feat: alpha').click();
  await expect(pane(page).locator('.doc-file-row', { hasText: 'alpha.txt' })).toBeVisible();
  await expect(pane(page).locator('.doc-file-row', { hasText: 'beta.txt' })).toHaveCount(0);
  // 请求只打过所选两个 sha（集合判据：切回已缓存提交时 React Query 零请求
  // 是合法行为——不串纪律钉内容归属，不钉请求次数）。
  expect(new Set(wire.detailUrls)).toEqual(
    new Set([`${PROJECT_A.id}/${SHA1}`, `${PROJECT_A.id}/${SHA2}`]),
  );
});

test('C4 选中态存 (projectId, sha)：SPA 切项目后旧 diff 不跟场', async ({ page }) => {
  await stubWorld(page);
  await page.goto(PAGE_A);
  await historyTab(page).click();
  await historyRow(page, 'feat: alpha').click();
  await expect(pane(page).locator('.doc-file-row', { hasText: 'alpha.txt' })).toBeVisible();

  // 侧栏项目行走 SPA 导航（组件不重挂载——正是 (projectId, sha) 键存在的理由）
  await page.locator('a.sidebar-subrow', { hasText: 'detail-b' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/project/${PROJECT_B.id}`));
  await historyTab(page).click();
  // 旧项目选中不串场：右栏回占位，alpha 的内容零残留
  await expect(page.getByText('请选择一个提交查看')).toBeVisible();
  await expect(page.locator('[data-commit-detail="pane"]')).toHaveCount(0);
  await expect(page.getByText('alpha.txt')).toHaveCount(0);
  // 新项目自己的行照常可点
  await historyRow(page, 'init b').click();
  await expect(pane(page).locator('.doc-file-row', { hasText: 'b-readme.md' })).toBeVisible();
});

test('C5 详情不可达 → 人话降级（reason 分译），不白屏不空树', async ({ page }) => {
  await stubWorld(page);
  await page.goto(PAGE_A);
  await historyTab(page).click();
  await historyRow(page, 'gone: unreachable').click();
  await expect(page.getByText('提交详情加载失败')).toBeVisible();
  // LOCAL_ERROR_REASON_COPY.not_found 分译行（#386 单源词表）
  await expect(page.getByText('路径不存在')).toBeVisible();
  // 诚实态不演空改动集
  await expect(page.getByText('该提交没有可显示的改动。')).toHaveCount(0);
});

test('C6 选中载体 aria-current + 关闭钮清选中回占位', async ({ page }) => {
  await stubWorld(page);
  await page.goto(PAGE_A);
  await historyTab(page).click();
  const row = historyRow(page, 'feat: alpha');
  await row.click();
  await expect(row).toHaveAttribute('aria-current', 'true');
  await expect(pane(page)).toBeVisible();
  await page.getByRole('button', { name: '关闭提交详情' }).click();
  await expect(page.locator('[data-commit-detail="pane"]')).toHaveCount(0);
  await expect(page.getByText('请选择一个提交查看')).toBeVisible();
  await expect(row).not.toHaveAttribute('aria-current', 'true');
});

// —— fixture 面（C7，禁死钮纪律：无 server 直出行上 files 槽）———————

test('C7 hosted fixture（r2-24）：docs: README 行出 diff；种子空提交出定义态；关闭还原', async ({
  page,
}) => {
  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=r2-24');
  await historyTab(page).click();
  await historyRow(page, 'docs: README').click();
  await expect(page.locator('[data-commit-detail="message"]')).toHaveText('docs: README');
  await expect(pane(page).locator('.doc-file-row', { hasText: 'README.md' })).toBeVisible();
  await expect(
    pane(page).locator('[data-kind="add"]', { hasText: '托管演示仓' }),
  ).toBeVisible();

  // 种子提交（空树）= files:[] 定义态（server S6 口径的 fixture 同形）
  await historyRow(page, 'init r3-lifecycle').click();
  await expect(page.getByText('该提交没有可显示的改动。')).toBeVisible();
  await expect(pane(page).locator('.doc-file-row')).toHaveCount(0);

  // 关闭钮清选中回占位
  await page.getByRole('button', { name: '关闭提交详情' }).click();
  await expect(page.getByText('请选择一个提交查看')).toBeVisible();
});

test('C7 local fixture（prj-local-files）：根提交 = 全文件新增', async ({ page }) => {
  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=prj-local-files');
  await historyTab(page).click();
  await historyRow(page, 'init local-repo').click();
  await expect(page.locator('[data-commit-detail="message"]')).toHaveText('init local-repo');
  await expect(pane(page).locator('.doc-file-row', { hasText: 'README.md' })).toBeVisible();
  const add = pane(page).locator('[data-kind="add"]', { hasText: '# local-repo' });
  await expect(add).toBeVisible();
  // 根提交无删行（全新增语义）
  await expect(pane(page).locator('[data-kind="del"]')).toHaveCount(0);
});
