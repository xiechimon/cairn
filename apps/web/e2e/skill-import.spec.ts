import { expect, type Page, test } from '@playwright/test';

const SKILLS = '/app/resources/skills';

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
  await page.route('**/api/skills*', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ json: store });
  });

  await page.route('**/api/teams/*/skills/import', (route, request) => {
    importCalls.push({ url: request.url(), body: request.postDataJSON() });
    if (importStatus === 201) {
      const body = request.postDataJSON() as { localPath?: string; url?: string };
      const name = body.localPath !== undefined ? 'from-path' : 'from-url';
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
  };
}

test('fixture import dialog: field set + xor submit gate + accept-law submit closes instantly', async ({ page }) => {
  await page.goto(`${SKILLS}?scenario=01`);

  await page.getByTestId('resource-import').click();
  const dialog = page.getByRole('dialog', { name: '导入技能' });
  await expect(dialog).toHaveAccessibleName('导入技能');
  await expect(dialog.locator('#dlg-skill-import-path')).toBeVisible();
  await expect(dialog.locator('#dlg-skill-import-url')).toBeVisible();

  const submit = dialog.getByRole('button', { name: '导入', exact: true });
  await expect(submit).toBeDisabled();
  await dialog.locator('#dlg-skill-import-path').fill('/tmp/some-skill');
  await expect(submit).toBeEnabled();
  await dialog.locator('#dlg-skill-import-url').fill('https://github.com/acme/repo');
  await expect(submit).toBeDisabled();
  await expect(dialog.getByRole('alert')).toContainText('二选一');

  await dialog.locator('#dlg-skill-import-path').fill('');
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByRole('dialog', { name: '导入技能' })).toBeHidden();
});

test('live import: dialog closes after 201, list appears immediately, request body = the single filled field verbatim', async ({ page }) => {
  await stubBoot(page);
  const { importCalls } = await stubImport(page);
  await page.goto(SKILLS);
  await expect(page.getByTestId('resource-empty')).toBeVisible();
  await page.getByTestId('resource-import').click();
  const dialog = page.getByRole('dialog', { name: '导入技能' });
  await dialog.locator('#dlg-skill-import-path').fill('  /Users/you/skills/deploy-to-prod  ');
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
  await dialog.locator('#dlg-skill-import-path').fill('/Users/you/skills/broken');
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
  await dialog.locator('#dlg-skill-import-url').fill('https://github.com/acme/repo');
  await dialog.getByRole('button', { name: '导入', exact: true }).click();

  await expect(dialog).toBeVisible();
  const error = dialog.getByRole('alert');
  await expect(error).toContainText('同名技能已存在');
  await expect(error.locator('span')).toContainText('already exists');
});
