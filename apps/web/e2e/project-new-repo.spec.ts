import { expect, type Page, test } from '@playwright/test';

const NEW_PROJECT = '/app/project/new?scenario=01';
const NEW_PROJECT_LIVE = '/app/project/new';

const DANGER = 'rgb(240, 154, 136)';

async function openMenu(page: Page) {
  await page.goto(NEW_PROJECT);
  await page.locator('#prj-new-repo').click();
  const menu = page.getByRole('menu', { name: '仓库' });
  await expect(menu).toBeVisible();
  return menu;
}

async function selectRow(page: Page, label: string) {
  const menu = await openMenu(page);
  await menu.getByRole('menuitemradio', { name: label }).click();
  await expect(page.getByRole('menu', { name: '仓库' })).not.toBeVisible();
}

async function revealManualRepoInput(page: Page) {
  await page.getByRole('button', { name: '切换仓库来源' }).click();
  const menu = page.getByRole('menu', { name: '仓库' });
  await menu.getByRole('menuitemradio', { name: '手动输入 owner/repo' }).click();
  await expect(menu).not.toBeVisible();
  return page.locator('#prj-new-repo');
}

async function liveGithubInputWithoutSignIn(page: Page) {
  const input = page.locator('#prj-new-repo');
  await expect(input).toHaveAttribute('placeholder', 'owner/repo');
  await expect(page.getByRole('button', { name: '认证 GitHub' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '从 GitHub 选择' })).toHaveCount(0);
  return input;
}

/** Live-face boot stub (skills-readonly.stubBoot precedent): seed team +
 *  session succeed, every other GET 500s (the shell tolerates it). Route
 *  match order = registration reverse: catch-all first, specifics after. */
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

/** POST /api/projects programmable stub; returns the request-body recorder. */
async function stubCreateProject(
  page: Page,
  handler: () => { status?: number; json: unknown },
): Promise<Record<string, unknown>[]> {
  const bodies: Record<string, unknown>[] = [];
  await page.route('**/api/projects', (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    bodies.push(JSON.parse(request.postData() ?? '{}'));
    const result = handler();
    return route.fulfill({
      status: result.status ?? 201,
      contentType: 'application/json',
      body: JSON.stringify(result.json),
    });
  });
  return bodies;
}

const okProject = { id: 'proj-1', name: 'created', teamId: 'team-1' };

async function fillLiveForm(page: Page, opts: { kind: 'local' | 'github'; value: string }) {
  await selectLiveRow(page, opts.kind === 'local' ? '本地文件夹' : 'GitHub 仓库');
  const input =
    opts.kind === 'github'
      ? await liveGithubInputWithoutSignIn(page)
      : page.locator('#prj-new-repo');
  await input.fill(opts.value);
  return input;
}

/** Open the menu from either face: none-state = click the trigger button,
 *  input face (github/local) = click the swap button. */
async function selectLiveRow(page: Page, label: string) {
  const swap = page.getByRole('button', { name: '切换仓库来源' });
  if (await swap.isVisible()) await swap.click();
  else await page.locator('#prj-new-repo').click();
  const menu = page.getByRole('menu', { name: '仓库' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitemradio', { name: label }).click();
  await expect(menu).not.toBeVisible();
}

// ——— menu face (fixture) ———

test('the `选择仓库` trigger lists exactly `GitHub 仓库`, `手动输入 owner/repo` and `本地文件夹`', async ({ page }) => {
  const menu = await openMenu(page);
  const rows = menu.getByRole('menuitemradio');
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('GitHub 仓库');
  await expect(rows.nth(1)).toContainText('手动输入 owner/repo');
  await expect(rows.nth(2)).toContainText('本地文件夹');
  await expect(menu.getByRole('menuitemradio', { name: '托管' })).toHaveCount(0);
  // untouched = no row selected (aria-checked ≡ indicator check rendering
  // mirrors the user's act; t-0070 menu radio item spelling)
  await expect(rows.first()).toHaveAttribute('aria-checked', 'false');
  await expect(rows.nth(1)).toHaveAttribute('aria-checked', 'false');
  await expect(rows.nth(2)).toHaveAttribute('aria-checked', 'false');
});

test('the GitHub row swaps the trigger for the auth face; the manual row reveals the input', async ({
  page,
}) => {
  await selectRow(page, 'GitHub 仓库');

  await expect(page.locator('#prj-new-repo')).toBeVisible();
  await expect(page.locator('#prj-new-repo')).toHaveText('认证 GitHub');
  const input = await revealManualRepoInput(page);
  await expect(input).toHaveAttribute('placeholder', 'owner/repo');
  await input.fill('xiechimon/cairn');
  await expect(input).toHaveValue('xiechimon/cairn');
});

test('the `本地文件夹` row swaps the trigger for the path input; swap reopens', async ({ page }) => {
  await selectRow(page, '本地文件夹');
  const input = page.locator('#prj-new-repo');
  await expect(input).toHaveAttribute('aria-label', '本地文件夹');
  await input.fill('/Users/me/code/my-app');
  await expect(input).toHaveValue('/Users/me/code/my-app');
  await page.getByRole('button', { name: '切换仓库来源' }).click();
  const reopened = page.getByRole('menu', { name: '仓库' });
  await expect(reopened).toBeVisible();
  await expect(
    reopened.getByRole('menuitemradio', { name: '本地文件夹' }),
  ).toHaveAttribute('aria-checked', 'true');
});

test('switching forms drops the other face input', async ({ page }) => {
  await selectRow(page, 'GitHub 仓库');
  await revealManualRepoInput(page);
  await page.getByRole('button', { name: '切换仓库来源' }).click();
  await page.getByRole('menuitemradio', { name: '本地文件夹' }).click();
  await expect(page.getByRole('textbox', { name: 'GitHub 仓库' })).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: '本地文件夹' })).toHaveCount(1);
});

test('Escape in a field keeps the half-filled form; Escape outside a field closes it to the page underneath', async ({
  page,
}) => {
  await page.goto(NEW_PROJECT);
  const dialog = page.getByRole('dialog', { name: '新建项目' });
  const name = page.locator('#prj-new-name');
  await name.fill('half typed');
  await name.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(name).toHaveValue('half typed');
  await page.getByTestId('route-dialog-head').click();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(/\/app\?scenario=01$/);
});

test('Escape closes the repo popover', async ({ page }) => {
  await openMenu(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: '仓库' })).not.toBeVisible();
});

// ——— name backfill (fixture) ———

test('local path backfills the project name with the basename', async ({ page }) => {
  await selectRow(page, '本地文件夹');
  const path = page.locator('#prj-new-repo');
  const name = page.locator('#prj-new-name');
  await path.fill('/Users/me/code/my-app');
  await expect(name).toHaveValue('my-app');
  // still the last backfill → follows the path; trailing slash tolerated
  await path.fill('/Users/me/code/other/');
  await expect(name).toHaveValue('other');
});

test('a manual name edit stops the backfill; clearing resumes it', async ({ page }) => {
  await selectRow(page, '本地文件夹');
  const path = page.locator('#prj-new-repo');
  const name = page.locator('#prj-new-name');
  await name.fill('Custom');
  await path.fill('/Users/me/code/my-app');
  await expect(name).toHaveValue('Custom');
  await path.fill('/Users/me/code/second');
  await expect(name).toHaveValue('Custom');
  await name.fill('');
  await path.fill('/Users/me/code/third');
  await expect(name).toHaveValue('third');
});

test('github owner/repo backfills the repo segment once valid', async ({ page }) => {
  await selectRow(page, 'GitHub 仓库');
  const repo = await revealManualRepoInput(page);
  const name = page.locator('#prj-new-name');
  await repo.fill('xiechimon');
  await expect(name).toHaveValue('');
  await repo.fill('xiechimon/cairn');
  await expect(name).toHaveValue('cairn');
  await name.fill('Renamed');
  await repo.fill('xiechimon/cairn-web');
  await expect(name).toHaveValue('Renamed');
});

test('a pasted github.com URL backfills the name and submits owner/repo', async ({ page }) => {
  await stubBoot(page);
  const bodies = await stubCreateProject(page, () => ({ json: okProject }));
  await page.goto(NEW_PROJECT_LIVE);
  await fillLiveForm(page, { kind: 'github', value: 'https://github.com/xiechimon/cairn' });
  await expect(page.locator('#prj-new-name')).toHaveValue('cairn');
  const submit = page.getByRole('button', { name: '创建项目' });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page).toHaveURL(/\/app\?project=proj-1&chat=1$/);
  expect(bodies).toEqual([
    { name: 'cairn', teamId: 'team-1', kind: 'github', githubRepo: 'xiechimon/cairn' },
  ]);
});

test('the dialog icon derives from the typed name until one is picked', async ({ page }) => {
  await page.goto(NEW_PROJECT);
  const mark = page.getByTestId('project-icon-trigger');
  await page.locator('#prj-new-name').fill('Plain');
  await expect(mark.locator('[data-project-icon-auto]')).toBeVisible();
  await page.locator('#prj-new-name').fill('Iconed');
  await expect(mark.locator('[data-project-icon-auto]')).toBeVisible();
  await mark.click();
  await page.getByTestId('project-icon-picker').getByRole('button', { name: 'rocket' }).click();
  await expect(mark.locator('[data-project-icon="rocket"]')).toBeVisible();
  await expect(mark.locator('[data-project-icon-auto]')).toHaveCount(0);
});

test('the name input focus is the field ring: one --focus-ring border, no halo, not the UA default', async ({
  page,
}) => {
  await page.goto(NEW_PROJECT);
  const name = page.locator('#prj-new-name');
  await name.click();
  const ring = await name.evaluate((el) => {
    const probe = document.createElement('div');
    probe.style.color = 'var(--focus-ring)';
    el.ownerDocument.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect.poll(() => name.evaluate((el) => getComputedStyle(el).borderTopColor)).toBe(ring);
  const cs = await name.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      outline: s.outlineStyle,
      shadow: s.boxShadow,
      visible: el.matches(':focus-visible'),
    };
  });
  expect(cs.visible).toBe(true);
  expect(cs.outline).toBe('none');
  expect(cs.shadow).toBe('none');
});

// ——— submit + error face (live build, stubbed network) ———

test('untouched submit posts a repo-less body and lands on the new project conversation on 201', async ({ page }) => {
  await stubBoot(page);
  const bodies = await stubCreateProject(page, () => ({ json: okProject }));
  await page.goto(NEW_PROJECT_LIVE);
  await page.locator('#prj-new-name').fill('Plain');
  const submit = page.getByRole('button', { name: '创建项目' });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page).toHaveURL(/\/app\?project=proj-1&chat=1$/);
  expect(bodies).toEqual([{ name: 'Plain', teamId: 'team-1' }]);
});

test('a picked icon is saved on the new project right after create', async ({ page }) => {
  await stubBoot(page);
  const bodies = await stubCreateProject(page, () => ({ json: okProject }));
  const patches: Record<string, unknown>[] = [];
  await page.route('**/api/projects/proj-1', (route, request) => {
    if (request.method() !== 'PATCH') return route.fallback();
    patches.push(JSON.parse(request.postData() ?? '{}'));
    return route.fulfill({ json: { ...okProject, icon: 'rocket' } });
  });
  await page.goto(NEW_PROJECT_LIVE);
  await expect(page.locator('#prj-new-name')).toBeFocused();
  await page.getByRole('button', { name: '更换项目图标' }).click();
  await page.getByTestId('project-icon-picker').getByRole('button', { name: 'rocket' }).click();
  await page.keyboard.press('Escape');
  await page.locator('#prj-new-name').fill('Iconed');
  await page.getByRole('button', { name: '创建项目' }).click();
  await expect(page).toHaveURL(/\/app\?project=proj-1&chat=1$/);
  expect(bodies).toEqual([{ name: 'Iconed', teamId: 'team-1' }]);
  await expect.poll(() => patches).toEqual([{ icon: 'rocket' }]);
});

test('local and github submits carry kind + their wire field', async ({ page }) => {
  await stubBoot(page);
  const bodies = await stubCreateProject(page, () => ({ json: okProject }));
  await page.goto(NEW_PROJECT_LIVE);
  await fillLiveForm(page, { kind: 'local', value: '/tmp/my-repo' });
  await page.getByRole('button', { name: '创建项目' }).click();
  await expect(page).toHaveURL(/\/app\?project=proj-1&chat=1$/);

  await page.goto(NEW_PROJECT_LIVE);
  await fillLiveForm(page, { kind: 'github', value: 'xiechimon/cairn' });
  await page.getByRole('button', { name: '创建项目' }).click();
  await expect(page).toHaveURL(/\/app\?project=proj-1&chat=1$/);

  expect(bodies).toEqual([
    { name: 'my-repo', teamId: 'team-1', kind: 'local', localPath: '/tmp/my-repo' },
    { name: 'cairn', teamId: 'team-1', kind: 'github', githubRepo: 'xiechimon/cairn' },
  ]);
});

test('empty local path / invalid github ref keep `创建项目` disabled', async ({ page }) => {
  await stubBoot(page);
  await stubCreateProject(page, () => ({ json: okProject }));
  await page.goto(NEW_PROJECT_LIVE);
  const submit = page.getByRole('button', { name: '创建项目' });
  await expect(submit).toBeDisabled();
  await page.locator('#prj-new-name').fill('Gated');
  await selectLiveRow(page, '本地文件夹');
  await expect(submit).toBeDisabled();
  await page.locator('#prj-new-repo').fill('/tmp/ok');
  await expect(submit).toBeEnabled();
  await selectLiveRow(page, 'GitHub 仓库');
  await expect(submit).toBeDisabled();
  await liveGithubInputWithoutSignIn(page);
  await page.locator('#prj-new-repo').fill('xiechimon/cairn');
  await expect(submit).toBeEnabled();
});

for (const [reason, copy] of [
  ['not_found', '路径不存在'],
  ['not_git', '不是 git 仓库'],
  ['not_absolute', '需要绝对路径'],
  [undefined, 'invalid body at localPath: case none'],
] as const) {
  test(`a 400 localPath reason renders the error row: ${copy}`, async ({ page }) => {
    await stubBoot(page);
    // #386: the error row classifies by the structured reason code (shared
    // PROJECT_LOCAL_ERROR_REASONS vocabulary); reasonless / unclassified 400s
    // show the server message verbatim.
    await stubCreateProject(page, () => ({
      status: 400,
      json: { error: `invalid body at localPath: case ${reason ?? 'none'}`, ...(reason !== undefined ? { reason } : {}) },
    }));
    await page.goto(NEW_PROJECT_LIVE);
    await fillLiveForm(page, { kind: 'local', value: '/nope' });
    await page.getByRole('button', { name: '创建项目' }).click();
    const error = page.getByRole('alert');
    await expect(error).toBeVisible();
    await expect(error).toHaveText(copy);
    expect(await error.evaluate((el) => getComputedStyle(el).color)).toBe(DANGER);
    await expect(page).toHaveURL(/\/app\/project\/new/);
    // editing the path clears the stale error
    await page.locator('#prj-new-repo').fill('/nope2');
    await expect(error).toHaveCount(0);
  });
}
