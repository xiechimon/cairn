import { expect, type Page, test } from '@playwright/test';

const SKILLS = '/app/resources/skills';

interface SkillRow {
  id: string;
  teamId: string;
  name: string;
  description: string | null;
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

async function stubSkills(page: Page, seed: SkillRow[] = []) {
  const store = [...seed];
  const deletes: string[] = [];
  let gate: Promise<void> | null = null;
  let failDelete: number | null = null;
  let alreadyGone = false;
  let systemTrash = true;
  await page.route('**/api/skills*', (route, request) => {
    if (request.method() !== 'GET') return route.fallback();
    return route.fulfill({ json: store });
  });
  await page.route('**/api/teams/*/skills/*', async (route, request) => {
    if (request.method() !== 'DELETE') return route.fallback();
    const id = decodeURIComponent(request.url().split('/skills/')[1]?.split('?')[0] ?? '');
    deletes.push(id);
    if (gate !== null) {
      const waiting = gate;
      gate = null;
      await waiting;
    }
    const idx = store.findIndex((row) => row.id === id);
    if (alreadyGone && idx !== -1) {
      store.splice(idx, 1);
      return route.fulfill({ status: 404, json: { error: `skill ${id} not found` } });
    }
    if (failDelete !== null) {
      return route.fulfill({
        status: failDelete,
        json: {
          error:
            failDelete === 409
              ? `refusing to delete ${id}: it lives in a skills directory that other agent tools share`
              : 'permission denied: SKILL.md',
        },
      });
    }
    if (idx === -1) return route.fulfill({ status: 404, json: { error: `skill ${id} not found` } });
    store.splice(idx, 1);
    return route.fulfill({
      json: { id, trashedTo: `/Users/me/cairn/trash/${id}`, systemTrash },
    });
  });
  return {
    store,
    deletes,
    hold: () => {
      let release: () => void = () => {};
      gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    fail: (status: number) => {
      failDelete = status;
    },
    goneElsewhere: () => {
      alreadyGone = true;
    },
    trashRefused: () => {
      systemTrash = false;
    },
  };
}

async function openDelete(page: Page, name = 'deploy') {
  await page.getByTestId('skill-row-menu').first().click();
  await page.getByTestId('skill-row-menu-delete').click();
  return page.getByRole('alertdialog', { name: '删除技能' });
}

test('row menu: 删除 opens one confirm naming the skill; 取消 keeps the row and sends nothing', async ({
  page,
}) => {
  await stubBoot(page);
  const stub = await stubSkills(page, [
    { id: 'deploy', teamId: 'team-1', name: 'deploy', description: '部署流程手册' },
  ]);
  await page.goto(SKILLS);
  await expect(page.getByTestId('resource-row')).toHaveCount(1);

  const dialog = await openDelete(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.delete-confirm-title')).toHaveText('删除技能「deploy」？');
  await expect(dialog).toContainText('技能从 Cairn 移除，文件移到废纸篓；你自己的文件夹不动。');
  const primary = dialog.getByRole('button', { name: '删除' });
  await expect(primary).toBeVisible();
  await expect(dialog.getByRole('button', { name: '取消' })).toBeVisible();

  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('resource-row')).toHaveCount(1);
  expect(stub.deletes).toHaveLength(0);
});

test('confirm drops the row before the server answers, then sends one DELETE for that skill', async ({
  page,
}) => {
  await stubBoot(page);
  const stub = await stubSkills(page, [
    { id: 'deploy', teamId: 'team-1', name: 'deploy', description: '部署流程手册' },
    { id: 'review', teamId: 'team-1', name: 'review', description: '代码审查' },
  ]);
  await page.goto(SKILLS);
  await expect(page.getByTestId('resource-row')).toHaveCount(2);

  const dialog = await openDelete(page);
  const release = stub.hold();
  await dialog.getByRole('button', { name: '删除' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('resource-row')).toHaveCount(1);
  await expect(page.getByTestId('resource-row').first()).toContainText('review');

  release();
  await expect(page.getByTestId('resource-row')).toHaveCount(1);
  expect(stub.deletes).toEqual(['deploy']);
});

test('a failed delete puts the row back and says why', async ({ page }) => {
  await stubBoot(page);
  const stub = await stubSkills(page, [
    { id: 'deploy', teamId: 'team-1', name: 'deploy', description: '部署流程手册' },
  ]);
  stub.fail(500);
  await page.goto(SKILLS);
  const dialog = await openDelete(page);
  await dialog.getByRole('button', { name: '删除' }).click();

  await expect(page.getByTestId('resource-row')).toHaveCount(1);
  await expect(page.getByTestId('resource-row').first()).toContainText('deploy');
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: '删除技能失败，请重试。' }),
  ).toBeVisible();
});

test('a 404 keeps the row gone and says nothing, because nothing failed for the user', async ({
  page,
}) => {
  await stubBoot(page);
  const stub = await stubSkills(page, [
    { id: 'deploy', teamId: 'team-1', name: 'deploy', description: '部署流程手册' },
  ]);
  stub.goneElsewhere();
  await page.goto(SKILLS);
  const dialog = await openDelete(page);
  await dialog.getByRole('button', { name: '删除' }).click();

  await expect(page.getByTestId('resource-row')).toHaveCount(0);
  await expect(page.getByTestId('resource-empty')).toBeVisible();
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: '删除技能失败，请重试。' }),
  ).toHaveCount(0);
});

test('a 409 from the server puts the row back and shows the failure', async ({ page }) => {
  await stubBoot(page);
  const stub = await stubSkills(page, [
    { id: 'deploy', teamId: 'team-1', name: 'deploy', description: '部署流程手册' },
  ]);
  stub.fail(409);
  await page.goto(SKILLS);
  const dialog = await openDelete(page);
  await dialog.getByRole('button', { name: '删除' }).click();

  await expect(page.getByTestId('resource-row')).toHaveCount(1);
  await expect(page.getByTestId('resource-row').first()).toContainText('deploy');
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: '删除技能失败，请重试。' }),
  ).toBeVisible();
});

test('when the system Trash refuses the copy, the user is told where it actually went', async ({
  page,
}) => {
  await stubBoot(page);
  const stub = await stubSkills(page, [
    { id: 'deploy', teamId: 'team-1', name: 'deploy', description: '部署流程手册' },
  ]);
  stub.trashRefused();
  await page.goto(SKILLS);
  const dialog = await openDelete(page);
  await dialog.getByRole('button', { name: '删除' }).click();

  await expect(page.getByTestId('resource-row')).toHaveCount(0);
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: '副本不在废纸篓，已移到' }),
  ).toBeVisible();
  await expect(
    page.locator('[data-sonner-toast]').filter({ hasText: '/Users/me/cairn/trash/deploy' }),
  ).toBeVisible();
});

test('390px dark: the row menu, the confirm and both of its buttons stay usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await stubBoot(page);
  const longName = 'deploy-pipeline-with-a-very-long-name-indeed';
  await stubSkills(page, [
    { id: longName, teamId: 'team-1', name: longName, description: '部署流程手册和一段较长的说明文字' },
  ]);
  await page.goto(SKILLS);

  const trigger = page.getByTestId('skill-row-menu').first();
  await expect(trigger).toBeInViewport();

  const dialog = await openDelete(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.delete-confirm-title')).toHaveText(`删除技能「${longName}」？`);
  const cancel = dialog.getByRole('button', { name: '取消' });
  const confirm = dialog.getByRole('button', { name: '删除' });
  await expect(confirm).toBeInViewport();
  await expect(cancel).toBeInViewport();
  const cancelBox = await cancel.boundingBox();
  const confirmBox = await confirm.boundingBox();
  expect(Math.abs((cancelBox?.y ?? 0) - (confirmBox?.y ?? 1))).toBeLessThan(8);
  const dialogBox = await dialog.boundingBox();
  expect(dialogBox?.width ?? 0).toBeLessThanOrEqual(390);
  const summary = dialog.locator('.delete-confirm-summary');
  await expect(summary).toContainText('你自己的文件夹不动。');
  const clipped = await summary.evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(clipped).toBeLessThanOrEqual(1);
});
