import { expect, type Page, test } from '@playwright/test';

const PROJECT_A = {
  id: 'proj-1102a',
  name: 'detail-a',
  teamId: 'team-1',
  repoKind: 'hosted',
  repoName: 'detail-a',
  githubRepo: null,
  localPath: null,
};

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

test('C1+C2 clicking a history row → sends the detail request, shows a diff, meta consistent with the row', async ({ page }) => {
  const wire = await stubWorld(page);
  await page.goto(PAGE_A);
  await historyTab(page).click();
  const row = historyRow(page, 'feat: alpha');
  await expect(row).toBeVisible();
  await row.click();

  await expect(pane(page)).toBeVisible();
  expect(wire.detailUrls).toContain(`${PROJECT_A.id}/${SHA1}`);

  await expect(pane(page).locator('.doc-file-row', { hasText: 'alpha.txt' })).toBeVisible();
  await expect(pane(page).locator('[data-kind="add"]', { hasText: 'ALPHA-NEW-1' })).toBeVisible();
  await expect(pane(page).locator('[data-kind="del"]', { hasText: 'ALPHA-OLD' })).toBeVisible();
  await expect(page.getByText('提交详情加载失败')).toHaveCount(0);

  await expect(page.locator('[data-commit-detail="message"]')).toHaveText('feat: alpha');
  const rowMeta = await row.getByTestId('history-meta').innerText();
  await expect(page.locator('[data-commit-detail="meta"]')).toHaveText(rowMeta.trim());
});

test('C3 switching back and forth across multiple commits does not mix data (sha in queryKey)', async ({ page }) => {
  const wire = await stubWorld(page);
  await page.goto(PAGE_A);
  await historyTab(page).click();
  await historyRow(page, 'feat: alpha').click();
  await expect(pane(page).locator('.doc-file-row', { hasText: 'alpha.txt' })).toBeVisible();

  await historyRow(page, 'chore: beta').click();
  await expect(pane(page).locator('.doc-file-row', { hasText: 'beta.txt' })).toBeVisible();

  await expect(pane(page).locator('.doc-file-row', { hasText: 'alpha.txt' })).toHaveCount(0);

  await historyRow(page, 'feat: alpha').click();
  await expect(pane(page).locator('.doc-file-row', { hasText: 'alpha.txt' })).toBeVisible();
  await expect(pane(page).locator('.doc-file-row', { hasText: 'beta.txt' })).toHaveCount(0);

  expect(new Set(wire.detailUrls)).toEqual(
    new Set([`${PROJECT_A.id}/${SHA1}`, `${PROJECT_A.id}/${SHA2}`]),
  );
});

test('C4 selection state keyed by (projectId, sha): old diff does not follow after an SPA project switch', async ({ page }) => {
  await stubWorld(page);
  await page.goto(PAGE_A);
  await historyTab(page).click();
  await historyRow(page, 'feat: alpha').click();
  await expect(pane(page).locator('.doc-file-row', { hasText: 'alpha.txt' })).toBeVisible();

  await page.locator('a.sidebar-subrow', { hasText: 'detail-b' }).click();
  await expect(page).toHaveURL(new RegExp(`/app/project/${PROJECT_B.id}`));
  await historyTab(page).click();

  await expect(page.getByText('请选择一个提交查看')).toBeVisible();
  await expect(page.locator('[data-commit-detail="pane"]')).toHaveCount(0);
  await expect(page.getByText('alpha.txt')).toHaveCount(0);

  await historyRow(page, 'init b').click();
  await expect(pane(page).locator('.doc-file-row', { hasText: 'b-readme.md' })).toBeVisible();
});

test('C5 detail unreachable → human-language degradation (reason translated), no white screen, no empty tree', async ({ page }) => {
  await stubWorld(page);
  await page.goto(PAGE_A);
  await historyTab(page).click();
  await historyRow(page, 'gone: unreachable').click();
  await expect(page.getByText('提交详情加载失败')).toBeVisible();

  await expect(page.getByText('路径不存在')).toBeVisible();

  await expect(page.getByText('该提交没有可显示的改动。')).toHaveCount(0);
});

test('C6 selected carrier aria-current + close button clears selection back to placeholder', async ({ page }) => {
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

test('C7 hosted fixture (r2-24): docs: README row shows a diff; empty-commit seed shows the defined state; closing restores', async ({
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

  await historyRow(page, 'init r3-lifecycle').click();
  await expect(page.getByText('该提交没有可显示的改动。')).toBeVisible();
  await expect(pane(page).locator('.doc-file-row')).toHaveCount(0);

  await page.getByRole('button', { name: '关闭提交详情' }).click();
  await expect(page.getByText('请选择一个提交查看')).toBeVisible();
});

test('C7 local fixture (prj-local-files): root commit = all-files-added', async ({ page }) => {
  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=prj-local-files');
  await historyTab(page).click();
  await historyRow(page, 'init local-repo').click();
  await expect(page.locator('[data-commit-detail="message"]')).toHaveText('init local-repo');
  await expect(pane(page).locator('.doc-file-row', { hasText: 'README.md' })).toBeVisible();
  const add = pane(page).locator('[data-kind="add"]', { hasText: '# local-repo' });
  await expect(add).toBeVisible();

  await expect(pane(page).locator('[data-kind="del"]')).toHaveCount(0);
});
