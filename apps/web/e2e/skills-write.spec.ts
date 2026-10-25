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

async function stubSkillStore(page: Page, seed: SkillRow[] = []) {
  const store = [...seed];
  const files = new Map<string, string>();
  const calls: { method: string; url: string; body?: unknown }[] = [];
  await page.route('**/api/skills*', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ json: store });
  });
  await page.route('**/api/skills?*', async (route, request) => {
    if (request.method() !== 'POST') return route.fallback();
    const body = request.postDataJSON() as {
      name: string;
      description: string;
      files: { path: string; content: string }[];
    };
    calls.push({ method: 'POST', url: request.url(), body });
    if (store.some((s) => s.id === body.name)) {
      return route.fulfill({
        status: 409,
        json: { error: `skill directory ${body.name} already exists` },
      });
    }
    const rec: SkillRow = {
      id: body.name,
      teamId: 'team-1',
      name: body.name,
      description: body.description,
    };
    store.push(rec);
    files.set(body.name, body.files[0]?.content ?? '');
    return route.fulfill({ status: 201, json: rec });
  });
  await page.route('**/api/teams/*/skills/*/file*', (route, request) => {
    const sid = decodeURIComponent(request.url().split('/skills/')[1]?.split('/')[0] ?? '');
    const content = files.get(sid);
    if (content === undefined) {
      return route.fulfill({ status: 404, json: { error: `skill ${sid} not found` } });
    }
    return route.fulfill({ json: { fileName: 'SKILL.md', content } });
  });
  await page.route('**/api/teams/*/skills/*', async (route, request) => {
    if (request.method() !== 'PUT') return route.fallback();
    const sid = decodeURIComponent(
      request.url().split('/skills/')[1]?.split('?')[0]?.replace(/\/$/, '') ?? '',
    );
    const body = request.postDataJSON() as {
      name: string;
      description: string;
      files: { path: string; content: string }[];
    };
    calls.push({ method: 'PUT', url: request.url(), body });
    const idx = store.findIndex((s) => s.id === sid);
    if (idx === -1) {
      return route.fulfill({ status: 404, json: { error: `skill ${sid} not found` } });
    }
    const rec: SkillRow = { ...store[idx], id: body.name, name: body.name, description: body.description };
    store[idx] = rec;
    files.set(body.name, body.files[0]?.content ?? '');
    return route.fulfill({ json: rec });
  });
  return { store, files, calls };
}

test('fixture create dialog: field set + submit gate + accept-law submit closes instantly', async ({ page }) => {
  await page.goto(`${SKILLS}?scenario=01`);
  await page.getByTestId('resource-empty').getByRole('button', { name: '新建技能' }).click();
  const dialog = page.getByRole('dialog', { name: '新建技能' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleName('新建技能');
  await expect(dialog.locator('#dlg-skill-name')).toHaveAttribute('placeholder', 'deploy-to-prod');
  await expect(dialog.locator('#dlg-skill-body')).toBeVisible();

  const submit = dialog.getByRole('button', { name: '新建技能' });
  await expect(submit).toBeDisabled();
  await dialog.locator('#dlg-skill-name').fill('my skill!');
  await expect(submit).toBeDisabled();
  await expect(dialog.getByRole('alert')).toContainText('名称须以字母或数字开头');
  await dialog.locator('#dlg-skill-name').fill('my-skill');
  await expect(submit).toBeDisabled();
  await dialog.locator('#dlg-skill-desc').fill('演示技能');
  await expect(submit).toBeEnabled();

  await submit.click();
  await expect(page.getByRole('dialog', { name: '新建技能' })).toBeHidden();
});

test('live create: dialog closes after 201, list appears immediately, frontmatter assembled from the form', async ({ page }) => {
  await stubBoot(page);
  const { store, calls } = await stubSkillStore(page);
  await page.goto(SKILLS);

  await page.getByTestId('resource-empty').getByRole('button', { name: '新建技能' }).click();
  const dialog = page.getByRole('dialog', { name: '新建技能' });
  await dialog.locator('#dlg-skill-name').fill('deploy');
  await dialog.locator('#dlg-skill-desc').fill('部署流程手册');
  await dialog.locator('#dlg-skill-body').fill('# 步骤\n\n1. 构建');
  await dialog.getByRole('button', { name: '新建技能' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('resource-row')).toHaveCount(1);
  await expect(page.getByTestId('resource-row').first()).toContainText('deploy');
  await expect(page.getByTestId('resource-row').first()).toContainText('部署流程手册');
  expect(store).toHaveLength(1);

  expect(calls).toHaveLength(1);
  const body = calls[0].body as { files: { path: string; content: string }[] };
  expect(body.files).toHaveLength(1);
  expect(body.files[0].path).toBe('SKILL.md');
  expect(body.files[0].content).toBe(
    '---\nname: deploy\ndescription: 部署流程手册\n---\n\n# 步骤\n\n1. 构建\n',
  );
});

test('live create name-collision 409: dialog stays open, error row headline + server verbatim detail', async ({ page }) => {
  await stubBoot(page);
  await stubSkillStore(page, [
    { id: 'deploy', teamId: 'team-1', name: 'deploy', description: '既有技能' },
  ]);
  await page.goto(SKILLS);
  await expect(page.getByTestId('resource-row')).toHaveCount(1);
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建技能' });
  await dialog.locator('#dlg-skill-name').fill('deploy');
  await dialog.locator('#dlg-skill-desc').fill('再来一份');
  await dialog.getByRole('button', { name: '新建技能' }).click();

  await expect(dialog).toBeVisible();
  const error = dialog.getByRole('alert');
  await expect(error).toContainText('同名技能已存在');
  await expect(error.locator('span')).toContainText('skill directory deploy already exists');
});

test('live edit: row click prefills the frontmatter split, list reads back consistent after PUT', async ({ page }) => {
  await stubBoot(page);
  const { files, calls } = await stubSkillStore(page, [
    { id: 'deploy', teamId: 'team-1', name: 'deploy', description: '旧描述' },
  ]);
  files.set('deploy', '---\nname: deploy\ndescription: 旧描述\n---\n\n旧正文\n');
  await page.goto(SKILLS);

  await page.getByTestId('resource-row').first().click();
  const dialog = page.getByRole('dialog', { name: '编辑技能' });
  await expect(dialog).toHaveAccessibleName('编辑技能');

  await expect(dialog.locator('#dlg-skill-name')).toHaveValue('deploy');
  await expect(dialog.locator('#dlg-skill-desc')).toHaveValue('旧描述');
  await expect(dialog.locator('#dlg-skill-body')).toHaveValue('旧正文\n');

  await dialog.locator('#dlg-skill-desc').fill('新描述');
  await dialog.getByRole('button', { name: '保存' }).click();

  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('resource-row').first()).toContainText('新描述');
  const put = calls.find((c) => c.method === 'PUT');
  expect(put?.url).toContain('/api/teams/team-1/skills/deploy');
  const body = put?.body as { files: { content: string }[] };
  expect(body.files[0].content).toContain('description: 新描述');
  expect(body.files[0].content).toContain('旧正文');
});

test('live edit prefetch reads 404: form yields to the error block, list invalidated and refetched', async ({ page }) => {
  await stubBoot(page);
  const lists: number[] = [];

  await stubSkillStore(page, [
    { id: 'ghost', teamId: 'team-1', name: 'ghost', description: '刚被删' },
  ]);
  await page.route('**/api/skills*', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    lists.push(1);
    return route.fulfill({
      json: [{ id: 'ghost', teamId: 'team-1', name: 'ghost', description: '刚被删' }],
    });
  });
  await page.goto(SKILLS);
  await page.getByTestId('resource-row').first().click();

  const dialog = page.getByRole('dialog', { name: '编辑技能' });
  await expect(dialog.getByRole('alert')).toContainText('该技能已不存在');
  await expect(dialog.locator('#dlg-skill-name')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: '保存' })).toBeDisabled();
  expect(lists.length).toBeGreaterThanOrEqual(2);
});

test('client-side preflight: illegal names and quoted descriptions send no request', async ({ page }) => {
  await stubBoot(page);
  const { calls } = await stubSkillStore(page);
  await page.goto(SKILLS);
  await page.getByRole('button', { name: '新建', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建技能' });

  await dialog.locator('#dlg-skill-name').fill('bad/name');
  await dialog.locator('#dlg-skill-desc').fill('正常描述');
  const submit = dialog.getByRole('button', { name: '新建技能' });
  await expect(submit).toBeDisabled();
  await expect(dialog.getByRole('alert')).toContainText('名称须以字母或数字开头');

  await dialog.locator('#dlg-skill-name').fill('ok-name');
  await dialog.locator('#dlg-skill-desc').fill('"被引号包裹"');
  await expect(dialog.getByRole('alert')).toContainText('不要用引号整体包裹');
  await expect(submit).toBeDisabled();

  expect(calls).toHaveLength(0);
});
