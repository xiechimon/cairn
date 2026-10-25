import { expect, type Page, test } from '@playwright/test';

const PROJECT_ID = 'proj-1097';
const PROJ = `/app/project/${PROJECT_ID}`;

const TEAM = { id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null };
const USER = { id: 'user-1', displayName: '我', avatarUrl: null };
const PROJECT = {
  id: PROJECT_ID,
  name: 'drill-repo',
  teamId: 'team-1',
  repoKind: 'hosted',
  repoName: 'drill-repo',
  githubRepo: null,
  localPath: null,
};

interface WireEntry {
  name: string;
  path: string;
  type: 'blob' | 'tree';
  size: number | null;
}

const blob = (path: string, size = 10): WireEntry => ({
  name: path.split('/').pop() ?? path,
  path,
  type: 'blob',
  size,
});
const tree = (path: string): WireEntry => ({
  name: path.split('/').pop() ?? path,
  path,
  type: 'tree',
  size: null,
});

const DIRS: Record<string, WireEntry[]> = {
  '': [blob('zebra.md'), tree('docs'), blob('README.md'), tree('apps')],
  docs: [blob('docs/README.md'), blob('docs/setup.md'), tree('docs/guide')],
  'docs/guide': [blob('docs/guide/deep.md')],
  apps: [],
};

const FILE_CONTENTS: Record<string, string> = {
  'README.md': 'ROOT-README-CONTENT',
  'docs/README.md': 'DOCS-README-CONTENT',
  'docs/setup.md': 'SETUP-CONTENT',
  'docs/guide/deep.md': 'DEEP-CONTENT',
};

interface Wire {
  treeUrls: string[];
  fileUrls: string[];
}

async function stubWorld(page: Page, treeDelayMs = 0, treeStatus = 200): Promise<Wire> {
  const wire: Wire = { treeUrls: [], fileUrls: [] };
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) => route.fulfill({ json: [TEAM] }));
  await page.route('**/api/user/me', (route) => route.fulfill({ json: USER }));
  await page.route('**/api/projects?*', (route) => route.fulfill({ json: [PROJECT] }));
  await page.route(`**/api/projects/${PROJECT_ID}/tree*`, async (route, request) => {
    const url = new URL(request.url());
    wire.treeUrls.push(url.search);
    const path = url.searchParams.get('path') ?? '';
    if (treeDelayMs > 0) await new Promise((r) => setTimeout(r, treeDelayMs));
    if (treeStatus !== 200) {
      return route.fulfill({ status: treeStatus, json: { error: 'e2e stub: tree read failed' } });
    }
    return route.fulfill({
      json: {
        ref: 'main',
        commit: 'a'.repeat(40),
        path,
        entries: DIRS[path] ?? [],
      },
    });
  });
  await page.route(`**/api/projects/${PROJECT_ID}/file*`, (route, request) => {
    const url = new URL(request.url());
    wire.fileUrls.push(url.search);
    const path = url.searchParams.get('path') ?? '';
    const content = FILE_CONTENTS[path];
    if (content === undefined) {
      return route.fulfill({ status: 404, json: { error: `no such file: ${path}` } });
    }
    return route.fulfill({
      json: { path, ref: 'main', commit: 'a'.repeat(40), encoding: 'utf-8', content, size: content.length },
    });
  });
  return wire;
}

const folderRow = (page: Page, name: string) =>
  page.locator(`[data-tree-entry="folder"]`).filter({ hasText: name });
const fileRow = (page: Page, name: string) =>
  page.locator(`[data-tree-entry="file"]`).filter({ hasText: name });

test('W1 top level distinguishes folders from files: separate carriers + different icons', async ({ page }) => {
  await stubWorld(page);
  await page.goto(PROJ);
  await expect(fileRow(page, 'README.md')).toBeVisible();
  const docs = folderRow(page, 'docs');
  await expect(docs).toBeVisible();
  await expect(folderRow(page, 'apps')).toBeVisible();

  const folderD = await docs.locator('svg path').first().getAttribute('d');
  const fileD = await fileRow(page, 'README.md').locator('svg path').first().getAttribute('d');
  expect(folderD).toBeTruthy();
  expect(fileD).toBeTruthy();
  expect(folderD).not.toBe(fileD);
});

test('W2 clicking a folder → re-fetches tree?path= and lists contents; no file-read request sent', async ({ page }) => {
  const wire = await stubWorld(page);
  await page.goto(PROJ);
  await folderRow(page, 'docs').click();
  await expect(fileRow(page, 'setup.md')).toBeVisible();
  await expect(folderRow(page, 'guide')).toBeVisible();

  await expect(folderRow(page, 'apps')).toHaveCount(0);

  expect(wire.treeUrls.some((q) => q.includes('path=docs'))).toBe(true);
  expect(wire.fileUrls).toEqual([]);
});

test('W3 breadcrumb: root segment back to top, middle segments back to middle levels, current segment echoes', async ({ page }) => {
  await stubWorld(page);
  await page.goto(PROJ);
  await folderRow(page, 'docs').click();
  await expect(fileRow(page, 'setup.md')).toBeVisible();
  const nav = page.getByRole('navigation', { name: '目录导航' });
  await expect(nav).toBeVisible();

  await expect(nav.getByText('docs', { exact: true })).toHaveAttribute(
    'aria-current',
    'location',
  );

  await folderRow(page, 'guide').click();
  await expect(fileRow(page, 'deep.md')).toBeVisible();
  await nav.getByRole('button', { name: 'docs', exact: true }).click();
  await expect(fileRow(page, 'setup.md')).toBeVisible();

  await nav.getByRole('button', { name: '根目录' }).click();
  await expect(fileRow(page, 'README.md')).toBeVisible();
  await expect(folderRow(page, 'docs')).toBeVisible();

  await expect(page.getByRole('navigation', { name: '目录导航' })).toHaveCount(0);
});

test('W4 same-name files across directories: selection and preview split by full path, no cross-talk', async ({ page }) => {
  const wire = await stubWorld(page);
  await page.goto(PROJ);

  const rootReadme = page.getByRole('button', { name: 'README.md', exact: true });
  await rootReadme.click();
  await expect(rootReadme).toHaveAttribute('aria-current', 'true');
  await expect(page.getByText('ROOT-README-CONTENT')).toBeVisible();

  await folderRow(page, 'docs').click();
  const docsReadme = page.getByRole('button', { name: 'README.md', exact: true });
  await docsReadme.click();
  await expect(page.getByText('DOCS-README-CONTENT')).toBeVisible();
  await expect(page.getByText('ROOT-README-CONTENT')).toHaveCount(0);
  expect(wire.fileUrls.at(-1)).toContain(`path=${encodeURIComponent('docs/README.md')}`);

  await page.getByRole('navigation', { name: '目录导航' }).getByRole('button', { name: '根目录' }).click();
  await expect(rootReadme).not.toHaveAttribute('aria-current', 'true');
  await expect(page.getByText('DOCS-README-CONTENT')).toBeVisible();
});

test('W5 empty directory → empty-state copy (not white screen / permanent loading)', async ({ page }) => {
  await stubWorld(page);
  await page.goto(PROJ);
  await folderRow(page, 'apps').click();
  await expect(page.getByText('此目录为空。')).toBeVisible();
});

test('W6 switching directories shows a loading state until settled, only then judges empty', async ({ page }) => {
  await stubWorld(page, 600);
  await page.goto(PROJ);

  await expect(fileRow(page, 'README.md')).toBeVisible();
  await folderRow(page, 'apps').click();

  await expect(page.getByText('加载中…')).toBeVisible();
  await expect(page.getByText('此目录为空。')).toHaveCount(0);

  await expect(page.getByText('此目录为空。')).toBeVisible({ timeout: 5_000 });
});

test('W9 display order: folder group on top, alphabetical within a group', async ({ page }) => {
  await stubWorld(page);
  await page.goto(PROJ);
  await expect(fileRow(page, 'README.md')).toBeVisible();
  const names = (await page.locator('.prj-file-row').allTextContents()).map((s) => s.trim());
  expect(names).toEqual(['apps', 'docs', 'README.md', 'zebra.md']);
});

test('W8 tree read failure → honest-state copy, does not fake an empty directory', async ({ page }) => {
  await stubWorld(page, 0, 500);
  await page.goto(PROJ);
  await expect(page.getByText('文件树读取失败。')).toBeVisible();
  await expect(page.getByText('此目录为空。')).toHaveCount(0);
});

test('W7 file rows zero regression: clicking a blob → selected state + viewer content', async ({ page }) => {
  await stubWorld(page);
  await page.goto(PROJ);
  const row = page.getByRole('button', { name: 'README.md', exact: true });
  await row.click();
  await expect(row).toHaveAttribute('aria-current', 'true');
  await expect(page.getByText('ROOT-README-CONTENT')).toBeVisible();
  await expect(page.getByText('请选择一个文件查看')).toHaveCount(0);
});
