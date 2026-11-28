import { expect, type Page, test } from '@playwright/test';

const SKILLS = '/app/resources/skills';
const SHARED = '/home/you/.agents/skills/';

function candidate(id: string, extra: { alreadyImported?: boolean; problem?: string | null } = {}) {
  return {
    id,
    description: `${id} 的说明`,
    sourcePath: `${SHARED}${id}`,
    alreadyImported: extra.alreadyImported ?? false,
    problem: extra.problem ?? null,
  };
}

async function stubCandidates(page: Page, candidates: ReturnType<typeof candidate>[]) {
  await page.route('**/api/teams/*/skills/import-candidates', (route) =>
    route.fulfill({ json: { candidates, skippedSources: [] } }),
  );
}

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

interface SkillRow {
  id: string;
  teamId: string;
  name: string;
  description: string | null;
}

async function stubImport(page: Page, seed: SkillRow[] = []) {
  const store = [...seed];
  const importCalls: { url: string; body?: unknown }[] = [];
  let importStatus = 201;
  let importError = 'skill directory deploy already exists';
  const failures = new Map<string, { status: number; error: string }>();
  await page.route('**/api/skills*', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ json: store });
  });

  await page.route('**/api/teams/*/skills/import', (route, request) => {
    importCalls.push({ url: request.url(), body: request.postDataJSON() });
    const body = request.postDataJSON() as { localPath?: string; url?: string };
    const failing = failures.get(body.localPath ?? '');
    if (failing !== undefined) {
      return route.fulfill({ status: failing.status, json: { error: failing.error } });
    }
    if (importStatus === 201) {
      const name =
        body.localPath?.startsWith(SHARED) === true
          ? body.localPath.slice(SHARED.length)
          : body.localPath !== undefined
            ? 'from-path'
            : 'from-url';
      const rec: SkillRow = {
        id: name,
        teamId: 'team-1',
        name,
        description: '导入的技能',
      };
      store.push(rec);
      return route.fulfill({ status: 201, json: rec });
    }
    return route.fulfill({ status: importStatus, json: { error: importError } });
  });
  return {
    store,
    importCalls,
    setImportError: (status: number, error: string) => {
      importStatus = status;
      importError = error;
    },
    failFor: (localPath: string, status: number, error: string) =>
      failures.set(localPath, { status, error }),
  };
}

test('fixture import dialog: unified source input gates empty and closes on submit', async ({ page }) => {
  await page.goto(`${SKILLS}?scenario=01`);

  await page.getByTestId('resource-import').click();
  const dialog = page.getByRole('dialog', { name: '导入技能' });
  await expect(dialog).toHaveAccessibleName('导入技能');
  await dialog.getByTestId('skill-import-tab-source').click();
  const input = dialog.locator('#dlg-skill-import-source');
  await expect(input).toBeVisible();

  const submit = dialog.getByRole('button', { name: '导入', exact: true });
  await expect(submit).toBeDisabled();
  await input.fill('https://github.com/acme/repo');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByRole('dialog', { name: '导入技能' })).toBeHidden();
});

test('live import: dialog closes after 201, list appears immediately, request body = the trimmed local path', async ({ page }) => {
  await stubBoot(page);
  const { importCalls } = await stubImport(page);
  await page.goto(SKILLS);
  await expect(page.getByTestId('resource-empty')).toBeVisible();
  await page.getByTestId('resource-import').click();
  const dialog = page.getByRole('dialog', { name: '导入技能' });
  await dialog.getByTestId('skill-import-tab-source').click();
  await dialog.locator('#dlg-skill-import-source').fill('  /Users/you/skills/deploy-to-prod  ');
  await dialog.getByRole('button', { name: '导入', exact: true }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('resource-row')).toHaveCount(1);
  await expect(page.getByTestId('resource-row').first()).toContainText('from-path');

  expect(importCalls).toHaveLength(1);
  expect(importCalls[0].url).toContain('/api/teams/team-1/skills/import');
  expect(importCalls[0].body).toEqual({ localPath: '/Users/you/skills/deploy-to-prod' });
});

test('live import 400: dialog stays open, error row headline + server verbatim detail', async ({ page }) => {
  await stubBoot(page);
  const { setImportError } = await stubImport(page);
  setImportError(400, 'invalid source: no SKILL.md found in directory /Users/you/skills/broken');
  await page.goto(SKILLS);
  await page.getByTestId('resource-import').click();
  const dialog = page.getByRole('dialog', { name: '导入技能' });
  await dialog.getByTestId('skill-import-tab-source').click();
  await dialog.locator('#dlg-skill-import-source').fill('/Users/you/skills/broken');
  await dialog.getByRole('button', { name: '导入', exact: true }).click();

  await expect(dialog).toBeVisible();
  const error = dialog.getByRole('alert');
  await expect(error).toContainText('来源未通过校验');
  await expect(error.locator('span')).toContainText('no SKILL.md found');
  await expect(page.getByTestId('resource-row')).toHaveCount(0);
});

test('live import 409 same name: headline translated readably', async ({ page }) => {
  await stubBoot(page);
  const { setImportError } = await stubImport(page);
  setImportError(409, 'skill directory deploy already exists');
  await page.goto(SKILLS);
  await page.getByTestId('resource-import').click();
  const dialog = page.getByRole('dialog', { name: '导入技能' });
  await dialog.getByTestId('skill-import-tab-source').click();
  await dialog.locator('#dlg-skill-import-source').fill('https://github.com/acme/repo');
  await dialog.getByRole('button', { name: '导入', exact: true }).click();

  await expect(dialog).toBeVisible();
  const error = dialog.getByRole('alert');
  await expect(error).toContainText('同名技能已存在');
  await expect(error.locator('span')).toContainText('already exists');
});

test('pick from this machine: imported and unimportable rows are disabled, two picks with one id are not allowed', async ({ page }) => {
  await stubBoot(page);
  await stubImport(page, [{ id: 'review', teamId: 'team-1', name: 'review', description: '评审' }]);
  await stubCandidates(page, [
    candidate('deploy'),
    { ...candidate('deploy'), sourcePath: '/home/you/.claude/skills/deploy' },
    candidate('review', { alreadyImported: true }),
    candidate('nodesc', { problem: 'missing-description' }),
  ]);
  await page.goto(SKILLS);
  await page.getByTestId('resource-import').click();
  const dialog = page.getByRole('dialog', { name: '导入技能' });
  const rows = dialog.getByTestId('skill-candidate');
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: 'review' }).getByRole('checkbox')).toBeDisabled();
  await expect(rows.filter({ hasText: '已导入' })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'nodesc' }).getByRole('checkbox')).toBeDisabled();
  await expect(rows.filter({ hasText: 'SKILL.md 缺少描述' })).toHaveCount(1);

  const submit = dialog.getByRole('button', { name: /^导入/ });
  await expect(submit).toBeDisabled();
  await rows.nth(0).getByRole('checkbox').click();
  await expect(rows.nth(1).getByRole('checkbox')).toBeDisabled();
  await expect(rows.nth(1)).toContainText('已勾选另一个同名技能');
  await expect(submit).toHaveText('导入 1 个');

  await expect(rows.first()).not.toContainText(SHARED);

  const all = dialog.getByTestId('skill-candidate-all');
  await expect(all).toBeChecked();
  await all.click();
  await expect(submit).toHaveText('导入');
  await all.click();
  await expect(rows.nth(0).getByRole('checkbox')).toBeChecked();
  await expect(rows.nth(1).getByRole('checkbox')).not.toBeChecked();
  await expect(rows.filter({ hasText: 'review' }).getByRole('checkbox')).not.toBeChecked();
  await expect(submit).toHaveText('导入 1 个');

  await dialog.getByRole('textbox', { name: '搜索技能' }).fill('nodesc');
  await expect(rows).toHaveCount(1);
});

test('pick from this machine: three picks with one failure keep the two that worked and name the one that failed', async ({ page }) => {
  await stubBoot(page);
  const { importCalls, failFor } = await stubImport(page);
  await stubCandidates(page, [candidate('alpha'), candidate('beta'), candidate('gamma')]);
  failFor(`${SHARED}beta`, 400, 'skill file is not valid UTF-8 text: logo.png');
  await page.goto(SKILLS);
  await page.getByTestId('resource-import').click();
  const dialog = page.getByRole('dialog', { name: '导入技能' });
  const rows = dialog.getByTestId('skill-candidate');
  for (const id of ['alpha', 'beta', 'gamma']) {
    await rows.filter({ hasText: id }).getByRole('checkbox').click();
  }
  await dialog.getByRole('button', { name: '导入 3 个' }).click();

  await expect(rows.filter({ hasText: 'beta' }).getByRole('alert')).toContainText('来源未通过校验');
  await expect(rows.filter({ hasText: 'beta' }).getByRole('alert')).toContainText('logo.png');
  await expect(dialog.getByRole('button', { name: '导入 1 个' })).toBeVisible();
  expect(importCalls.map((c) => c.body)).toEqual([
    { localPath: `${SHARED}alpha` },
    { localPath: `${SHARED}beta` },
    { localPath: `${SHARED}gamma` },
  ]);
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(page.getByTestId('resource-row')).toHaveCount(2);
});

test('pick from this machine: opening the dialog asks the computer again, so a skill added meanwhile is listed', async ({ page }) => {
  await stubBoot(page);
  await stubImport(page);
  const list = [candidate('alpha')];
  let fetches = 0;
  await page.route('**/api/teams/*/skills/import-candidates', (route) => {
    fetches += 1;
    return route.fulfill({ json: { candidates: list, skippedSources: [] } });
  });
  await page.goto(SKILLS);
  const dialog = page.getByRole('dialog', { name: '导入技能' });
  await page.getByTestId('resource-import').click();
  await expect(dialog.getByTestId('skill-candidate')).toHaveCount(1);
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toBeHidden();

  list.push(candidate('beta'));

  await page.getByTestId('resource-import').click();
  await expect(dialog.getByTestId('skill-candidate')).toHaveCount(2);
  expect(fetches).toBeGreaterThanOrEqual(2);
});
