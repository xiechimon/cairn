import { expect, type Page, test } from '@playwright/test';

const NEW_PROJECT_LIVE = '/app/project/new';

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

async function stubPick(
  page: Page,
  handler: () => { status?: number; json: unknown; delayMs?: number },
): Promise<() => number> {
  let posts = 0;
  await page.route('**/api/fs/pick', async (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    posts += 1;
    const result = handler();
    if (result.delayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, result.delayMs));
    }
    return route.fulfill({
      status: result.status ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(result.json),
    });
  });
  return () => posts;
}

async function openLocalFace(page: Page) {
  await page.goto(NEW_PROJECT_LIVE);
  await page.locator('#prj-new-repo').click();
  await page.getByRole('menuitemradio', { name: '本地文件夹' }).click();
  await expect(page.getByRole('menu', { name: '仓库' })).not.toBeVisible();
  return page.getByRole('textbox', { name: '本地文件夹' });
}

test('browse button present only while the local pick state is up', async ({ page }) => {
  await stubBoot(page);
  await page.goto(NEW_PROJECT_LIVE);
  await expect(page.getByRole('button', { name: '浏览' })).toHaveCount(0);
  const input = await openLocalFace(page);
  await expect(input).toBeVisible();
  await expect(page.getByRole('button', { name: '浏览' })).toHaveCount(1);
});

test('successful pick: path filled back (spaces included) + basename project-name fill-back law couples', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page, () => ({ json: { path: '/Users/e2e/demo repo' } }));
  const input = await openLocalFace(page);
  await page.getByRole('button', { name: '浏览' }).click();
  await expect(input).toHaveValue('/Users/e2e/demo repo');
  await expect(page.locator('#prj-new-name')).toHaveValue('demo repo');
});

test('cancel = silent no-op: input untouched, no error/hint row', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page, () => ({ json: { path: null } }));
  const input = await openLocalFace(page);
  await input.fill('/x/y');
  await page.getByRole('button', { name: '浏览' }).click();

  await expect(page.getByRole('button', { name: '浏览' })).toBeEnabled();
  await expect(input).toHaveValue('/x/y');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('unavailable 422: hint row + in-app browser fallback opens automatically; after closing the hint stays, editing dismisses', async ({
  page,
}) => {
  await stubBoot(page);
  await stubPick(page, () => ({
    status: 422,
    json: { error: 'folder picker unavailable: requires macOS with a GUI session', reason: 'unavailable' },
  }));
  const input = await openLocalFace(page);
  await page.getByRole('button', { name: '浏览' }).click();
  const hint = page.getByRole('status');
  await expect(hint).toBeVisible();
  await expect(hint).toContainText('请直接输入路径');

  await expect(page.getByRole('alert')).toHaveCount(0);

  await expect(page.getByRole('dialog', { name: '浏览本地文件夹' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '浏览本地文件夹' })).not.toBeVisible();
  await expect(hint).toBeVisible();

  await input.fill('/still/usable');
  await expect(input).toHaveValue('/still/usable');
  await expect(hint).toHaveCount(0);
});

test('button disabled while in flight, double click sends once', async ({ page }) => {
  await stubBoot(page);
  const postCount = await stubPick(page, () => ({ json: { path: '/tmp/one' }, delayMs: 600 }));
  const input = await openLocalFace(page);
  const browse = page.getByRole('button', { name: '浏览' });
  await browse.click();
  await expect(browse).toBeDisabled();

  await browse.click({ force: true });
  await expect(input).toHaveValue('/tmp/one');
  expect(postCount()).toBe(1);
});

test('pick result overrides a manually edited path during the dialog (last action wins)', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page, () => ({ json: { path: '/a/b' }, delayMs: 300 }));
  const input = await openLocalFace(page);
  await page.getByRole('button', { name: '浏览' }).click();

  await input.fill('/manual/edit');
  await expect(input).toHaveValue('/a/b');
});

test('local pick state stays in the single-machine form annotation and does not occupy the status live area', async ({ page }) => {
  await stubBoot(page);
  await page.goto(NEW_PROJECT_LIVE);
  await expect(page.getByText(/单机器形态/)).toHaveCount(0);
  await openLocalFace(page);
  await expect(page.getByText(/单机器形态：这台机器损坏时进度随机器走/)).toBeVisible();

  await expect(page.getByRole('status')).toHaveCount(0);
});
