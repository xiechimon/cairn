import { expect, type Page, test } from '@playwright/test';

const NEW_PROJECT_LIVE = '/app/project/new';
const HOME = '/Users/e2e';
const LAST_DIR_KEY = 'cairn.dirBrowser.lastDir';

async function stubBoot(page: Page) {
  await page.route('**/api/**', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
  await page.route('**/api/teams', (route) =>
    route.fulfill({
      json: [{ id: 'team-1', name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
    }),
  );
  await page.route('**/api/user/me', (route) =>
    route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } }),
  );
}

async function stubPick(page: Page, status = 422, reason = 'unavailable') {
  await page.route('**/api/fs/pick', (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    return route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify({ error: `folder picker unavailable (${reason})`, reason }),
    });
  });
}

async function stubFsList(page: Page): Promise<() => string[]> {
  const FS: Record<string, { name: string; git: boolean }[]> = {
    '/': [{ name: 'Users', git: false }],
    '/Users': [{ name: 'e2e', git: false }],
    [HOME]: [
      { name: 'demo', git: true },
      { name: 'plain', git: false },
      { name: '.config', git: false },
      { name: 'empty', git: false },
      { name: 'big', git: false },
      { name: 'boom', git: false },
      { name: 'dotonly', git: false },
    ],
    [`${HOME}/demo`]: [{ name: 'src', git: false }],
    [`${HOME}/demo/src`]: [],
    [`${HOME}/plain`]: [],
    [`${HOME}/empty`]: [],
    [`${HOME}/dotonly`]: [{ name: '.hidden', git: false }],
    [`${HOME}/big`]: [
      { name: 'x1', git: false },
      { name: 'x2', git: false },
    ],
  };
  const searches: string[] = [];
  await page.route('**/api/fs/list*', (route, request) => {
    const url = new URL(request.url());
    searches.push(url.search);
    const dir = url.searchParams.get('dir');
    if (dir === null || dir === '') {
      return route.fulfill({
        json: { path: HOME, entries: FS[HOME] ?? [], truncated: false },
      });
    }
    if (dir === `${HOME}/boom`) {
      return route.fulfill({ status: 500, json: { error: 'e2e stub: boom' } });
    }
    const entries = FS[dir];
    if (entries === undefined) {
      return route.fulfill({
        status: 400,
        json: { error: `dir not accessible: ${dir}`, reason: 'not_found' },
      });
    }
    return route.fulfill({
      json: { path: dir, entries, truncated: dir === `${HOME}/big` },
    });
  });
  return () => [...searches];
}

const DIALOG = { name: '浏览本地文件夹' };

async function openLocalFace(page: Page) {
  await page.goto(NEW_PROJECT_LIVE);
  await page.locator('#prj-new-repo').click();
  await page.getByRole('menuitemradio', { name: '本地文件夹' }).click();
  await expect(page.getByRole('menu', { name: '仓库' })).not.toBeVisible();
  return page.getByRole('textbox', { name: '本地文件夹' });
}

async function openBrowser(page: Page) {
  await page.getByRole('button', { name: '浏览' }).click();
  await expect(page.getByRole('dialog', DIALOG)).toBeVisible();
}

function row(page: Page, name: string) {
  return page
    .getByRole('dialog', DIALOG)
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name, exact: true }) });
}

function crumb(page: Page, label: string) {
  return page
    .getByRole('dialog', DIALOG)
    .getByRole('navigation')
    .getByRole('button', { name: label, exact: true });
}

test('422 unavailable → overlay opens automatically; after Escape/outside click the hint row stays and the input is untouched', async ({
  page,
}) => {
  await stubBoot(page);
  await stubPick(page);
  await stubFsList(page);
  const input = await openLocalFace(page);
  await openBrowser(page);

  await expect(page.getByRole('status')).toContainText('请直接输入路径');

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', DIALOG)).not.toBeVisible();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('status')).toBeVisible();

  await openBrowser(page);
  await page.mouse.click(10, 10);
  await expect(page.getByRole('dialog', DIALOG)).not.toBeVisible();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('status')).toBeVisible();
});

test('default start = server HOME (first request has no dir param); git marker; dotfiles hidden by default', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page);
  const searches = await stubFsList(page);
  await openLocalFace(page);
  await openBrowser(page);
  await expect(row(page, 'demo')).toBeVisible();

  expect(searches()[0]).toBe('');

  await expect(row(page, 'demo').getByRole('img', { name: 'git 仓库' })).toHaveCount(1);
  await expect(row(page, 'plain').getByRole('img', { name: 'git 仓库' })).toHaveCount(0);

  await expect(row(page, '.config')).toHaveCount(0);

  await expect(crumb(page, 'Users')).toBeVisible();
  await expect(crumb(page, 'e2e')).toBeVisible();
});

test('clicking a row name drills down + breadcrumb jumps to any level (including root)', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page);
  const searches = await stubFsList(page);
  await openLocalFace(page);
  await openBrowser(page);

  await row(page, 'demo').getByRole('button', { name: 'demo', exact: true }).click();
  await expect(row(page, 'src')).toBeVisible();
  expect(searches().at(-1)).toContain(`dir=${encodeURIComponent(`${HOME}/demo`)}`);
  await expect(crumb(page, 'demo')).toBeVisible();

  await crumb(page, 'Users').click();
  await expect(row(page, 'e2e')).toBeVisible();

  await crumb(page, '/').click();
  await expect(row(page, 'Users')).toBeVisible();
});

test('single click `选择` → fills the input back + basename project-name coupling + closes overlay', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page);
  await stubFsList(page);
  const input = await openLocalFace(page);
  await openBrowser(page);
  await row(page, 'demo').getByRole('button', { name: '选择' }).click();
  await expect(input).toHaveValue(`${HOME}/demo`);
  await expect(page.locator('#prj-new-name')).toHaveValue('demo');
  await expect(page.getByRole('dialog', DIALOG)).not.toBeVisible();

  await expect(page.getByRole('status')).toHaveCount(0);
});

test('dotfiles toggle: hidden by default, shown after toggle, aria-pressed assertable', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page);
  await stubFsList(page);
  await openLocalFace(page);
  await openBrowser(page);
  const dots = page.getByRole('button', { name: '显示隐藏文件' });
  await expect(dots).toHaveAttribute('aria-pressed', 'false');
  await expect(row(page, '.config')).toHaveCount(0);
  await dots.click();
  await expect(dots).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, '.config')).toBeVisible();
});

test('remembers last location: reopening after reload starts at lastDir', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page);
  const searches = await stubFsList(page);
  await openLocalFace(page);
  await openBrowser(page);

  await row(page, 'demo').getByRole('button', { name: 'demo', exact: true }).click();
  await expect(row(page, 'src')).toBeVisible();

  await page.reload();
  await openLocalFace(page);
  await openBrowser(page);
  await expect(row(page, 'src')).toBeVisible();
  expect(searches().at(-1)).toContain(`dir=${encodeURIComponent(`${HOME}/demo`)}`);
});

test('empty directory = empty-state copy, not white screen', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page);
  await stubFsList(page);
  await openLocalFace(page);
  await openBrowser(page);
  await row(page, 'empty').getByRole('button', { name: 'empty', exact: true }).click();
  await expect(page.getByText('没有子目录')).toBeVisible();
});

test('all children hidden by dotfiles = empty state does not lie about `没有子目录`, toggle reveals them', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page);
  await stubFsList(page);
  await openLocalFace(page);
  await openBrowser(page);
  await row(page, 'dotonly').getByRole('button', { name: 'dotonly', exact: true }).click();

  await expect(page.getByText('子目录均已隐藏')).toBeVisible();

  await page.getByRole('button', { name: '显示隐藏文件' }).click();
  await expect(row(page, '.hidden')).toBeVisible();
  await expect(page.getByText('子目录均已隐藏')).toHaveCount(0);
});

test('oversized directory = truncation hint row', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page);
  await stubFsList(page);
  await openLocalFace(page);
  await openBrowser(page);
  await row(page, 'big').getByRole('button', { name: 'big', exact: true }).click();
  await expect(page.getByText('只列出前')).toBeVisible();
});

test('list 500 → error row inside the overlay, overlay stays open, breadcrumb still navigates', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page);
  await stubFsList(page);
  await openLocalFace(page);
  await openBrowser(page);
  await row(page, 'boom').getByRole('button', { name: 'boom', exact: true }).click();
  const error = page.getByRole('alert');
  await expect(error).toBeVisible();
  await expect(error).toContainText('boom');

  await expect(page.getByRole('dialog', DIALOG)).toBeVisible();
  await expect(crumb(page, 'e2e')).toBeVisible();
  await crumb(page, 'e2e').click();
  await expect(row(page, 'demo')).toBeVisible();
  await expect(error).toHaveCount(0);
});

test('lastDir invalid 400 → automatically falls back to the default HOME, no dead end', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page);
  const searches = await stubFsList(page);

  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => window.localStorage.setItem(key, value),
    { key: LAST_DIR_KEY, value: `${HOME}/gone` },
  );
  await openLocalFace(page);
  await openBrowser(page);
  await expect(row(page, 'demo')).toBeVisible();

  expect(searches().at(-1)).toBe('');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('409 busy → overlay does not open, only the hint row (#440 behavior untouched)', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page, 409, 'busy');
  await stubFsList(page);
  await openLocalFace(page);
  await page.getByRole('button', { name: '浏览' }).click();
  await expect(page.getByRole('status')).toContainText('已有一个选取对话框在进行中');
  await expect(page.getByRole('dialog', DIALOG)).toHaveCount(0);
});

test('pick misclassified error (500 with no reason) → overlay does not open, raw text passes through to the hint row', async ({ page }) => {
  await stubBoot(page);

  await page.route('**/api/fs/pick', (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    return route.fulfill({ status: 500, json: { error: 'e2e stub: pick exploded' } });
  });
  await stubFsList(page);
  await openLocalFace(page);
  await page.getByRole('button', { name: '浏览' }).click();
  await expect(page.getByRole('status')).toContainText('pick exploded');
  await expect(page.getByRole('dialog', DIALOG)).toHaveCount(0);
});
