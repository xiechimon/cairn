import { expect, type Page, type Route, test } from '@playwright/test';
import { mockLive, PROJECT, THREAD } from './chief-home-mock';
import { evidenceShot } from './evidence';

const DAY = 24 * 60 * 60 * 1000;
const NOV_8 = new Date(2026, 10, 8, 10).getTime();

const PROJECTS = [
  { ...PROJECT, id: 'p-notes', name: 'Field Notes' },
  { ...PROJECT, id: 'p-harbor', name: 'Harbor API' },
];

const row = (
  id: string,
  title: string,
  content: string,
  projectId: string | null,
  updatedAt: number,
  layer: 'core' | 'searchable' = 'core',
) => ({
  id,
  agentId: 't1',
  teamId: 't1',
  title,
  content,
  projectId,
  sourceTodoId: null,
  sourceBuildId: null,
  layer,
  createdAt: updatedAt,
  updatedAt,
});

const MEMORIES = [
  row('m-verify', '验证命令', '推送代码前先跑受影响的测试。\n- 单测用 --changed\n- 界面改动再跑受影响的 e2e', null, NOV_8),
  row('m-a11y', '无障碍检查', '请求评审前检查键盘导航和焦点顺序。', 'p-notes', NOV_8 - DAY),
  row('m-release', '发布交接', '交付前在任务里记录验收证据。', 'p-notes', NOV_8 - 6 * DAY, 'searchable'),
  row('m-api', '接口版本', '新增字段只加不改。', 'p-harbor', NOV_8 - 9 * DAY),
  row('m-review', '评审交接', '交给评审前写清验收证据。', null, NOV_8 - 2 * DAY),
];

type ListReply = 'ok' | 'fail' | 'hang';

async function openMemory(page: Page, options: { list?: ListReply; projects?: ListReply; refresh?: Promise<void>; deleteFails?: boolean; memories?: typeof MEMORIES } = {}) {
  const memories = structuredClone(options.memories ?? MEMORIES);
  const deleted: string[] = [];
  const projectPatches: unknown[] = [];
  let listReply = options.list ?? 'ok';
  let projectsReply = options.projects ?? 'ok';
  await mockLive(page, { threads: [THREAD], messages: [], projects: PROJECTS }, (p, route: Route, json) => {
    if (p.startsWith('/api/projects/') && route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as { instructions: string | null };
      projectPatches.push(body);
      return json({ ...PROJECTS.find((project) => p.endsWith(project.id)), ...body });
    }
    if (p === '/api/projects') {
      if (projectsReply === 'hang') return new Promise<void>(() => {});
      if (projectsReply === 'fail') return json({ error: 'boom' }, 500);
      return json(PROJECTS);
    }
    if (p === '/api/teams/t1/memories') {
      if (deleted.length > 0 && options.refresh !== undefined) return options.refresh.then(() => json(memories));
      if (listReply === 'hang') return new Promise<void>(() => {});
      if (listReply === 'fail') return json({ error: 'boom' }, 500);
      return json(memories);
    }
    if (p.startsWith('/api/teams/t1/memories/') && route.request().method() === 'DELETE') {
      if (options.deleteFails) return json({ error: 'boom' }, 500);
      const id = p.split('/').pop() ?? '';
      deleted.push(id);
      memories.splice(
        memories.findIndex((memory) => memory.id === id),
        1,
      );
      return route.fulfill({ status: 204, body: '' });
    }
    return undefined;
  });
  await page.goto('/app?chief=settings');
  await page.getByRole('tab', { name: '记忆' }).click();
  return {
    deleted,
    projectPatches,
    recover: () => {
      listReply = 'ok';
      projectsReply = 'ok';
    },
  };
}

const settled = (page: Page) =>
  page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== 'running' ||
          animation.effect?.getTiming().iterations === Number.POSITIVE_INFINITY,
      ),
  );

const memoryRow = (page: Page, title: string) =>
  page.getByRole('button', { name: `打开记忆：${title}` });

test('the tab follows the Claude Code memory page: count, sections per scope, read-every-thread and lookup rows', async ({
  page,
}) => {
  await openMemory(page);
  const list = page.getByTestId('memory-list');
  await expect(list).toBeVisible();
  await expect(page.getByText(/\d+ \/ 100\b|已存 \d+ 条/)).toHaveCount(0);
  await expect(list.getByRole('heading', { level: 2 })).toHaveText(['团队', 'Field Notes', 'Harbor API']);

  const team = list.getByRole('region', { name: '团队' });
  await expect(team.getByRole('heading', { level: 3 })).toHaveText(['每个 thread 都会读']);
  await expect(team.getByRole('button')).toHaveText([/验证命令/, /评审交接/]);
  await expect(team.getByRole('textbox')).toHaveCount(0);

  const notes = list.getByRole('region', { name: 'Field Notes' });
  await expect(notes.getByRole('heading', { level: 3 })).toHaveText([
    '项目说明',
    '自动记忆',
    '每个 thread 都会读',
    '记忆文件',
  ]);
  await expect(notes.getByRole('textbox', { name: 'Field Notes 的项目说明' })).toHaveValue('');
  await expect(notes.getByText('0 / 16,000')).toBeVisible();
  await expect(notes.getByRole('button', { name: /打开记忆/ })).toHaveText([/无障碍检查/, /发布交接/]);

  const verify = memoryRow(page, '验证命令');
  await expect(verify).toContainText('推送代码前先跑受影响的测试。');
  await expect(verify).not.toContainText('单测用');
  await expect(verify).toContainText('更新于 11月8日');
  await expect(list.getByText('可检索', { exact: true })).toHaveCount(0);
  await expect(
    page.getByTestId('chief-settings-col').locator('[data-slot="list-card"], [data-slot="card"]'),
  ).toHaveCount(0);
  await expect(page.getByPlaceholder(/告诉 Coordinator/)).toHaveCount(0);

  const geometry = await verify.evaluate((el) => {
    const item = el.parentElement?.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    return { rowWidth: box.width, itemWidth: item?.width, shadow: getComputedStyle(el).boxShadow };
  });
  expect(geometry.rowWidth).toBe(geometry.itemWidth);
  await verify.hover();
  expect(await verify.evaluate((el) => getComputedStyle(el).boxShadow)).toBe(geometry.shadow);
  await settled(page);
  await evidenceShot(page, 'memory-list-hover.png');
});

test('project instructions save from the memory tab through the project API', async ({ page }) => {
  const { projectPatches } = await openMemory(page);
  const notes = page.getByTestId('memory-list').getByRole('region', { name: 'Field Notes' });
  const input = notes.getByRole('textbox', { name: 'Field Notes 的项目说明' });
  const save = notes.getByRole('button', { name: '保存 Field Notes 的项目说明' });
  await expect(save).toBeDisabled();
  await input.fill('  仓库内容用英文。  ');
  await expect(notes.getByText('12 / 16,000')).toBeVisible();
  await save.click();
  await expect.poll(() => projectPatches).toEqual([{ instructions: '仓库内容用英文。' }]);
});

test('a row opens the detail dialog: updated, summary, details, with Delete in the header', async ({
  page,
}) => {
  await openMemory(page);
  await memoryRow(page, '验证命令').click();
  const dialog = page.getByRole('dialog', { name: '验证命令' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText('团队 · 核心')).toBeVisible();
  await expect(dialog.locator('dt')).toHaveText(['更新于', '概要', '详情']);
  await expect(dialog.locator('dd').nth(1)).toHaveText('推送代码前先跑受影响的测试。');
  await expect(dialog.locator('dd li')).toHaveText(['单测用 --changed', '界面改动再跑受影响的 e2e']);
  const head = dialog.getByTestId('dialog-head');
  await expect(head.getByRole('button', { name: '删除…' })).toBeVisible();
  await expect(head.getByRole('button', { name: '删除…' })).not.toBeFocused();
  await settled(page);
  await evidenceShot(page, 'memory-detail.png');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(memoryRow(page, '验证命令')).toBeFocused();
});

test('a searchable memory says it is not injected automatically', async ({ page }) => {
  await openMemory(page);
  await memoryRow(page, '发布交接').click();
  const dialog = page.getByRole('dialog', { name: '发布交接' });
  await expect(dialog.getByText('Field Notes · 可检索 · 不自动注入')).toBeVisible();
  await expect(dialog.locator('dt')).toHaveText(['更新于', '概要']);
});

test('delete confirms first, then removes the row and closes both dialogs', async ({ page }) => {
  const { deleted } = await openMemory(page);
  await memoryRow(page, '无障碍检查').click();
  await page.getByRole('dialog', { name: '无障碍检查' }).getByRole('button', { name: '删除…' }).click();
  const confirm = page.getByRole('alertdialog', { name: '删除这条记忆' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('只删除这条记忆，不影响保存它的对话。');
  await settled(page);
  await evidenceShot(page, 'memory-delete-confirm.png');
  await confirm.getByRole('button', { name: '删除记忆' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(deleted).toEqual(['m-a11y']);
  await expect(memoryRow(page, '无障碍检查')).toHaveCount(0);
});

test('a failed delete keeps the row and says so in the confirmation', async ({ page }) => {
  await openMemory(page, { deleteFails: true });
  await memoryRow(page, '接口版本').click();
  await page.getByRole('dialog', { name: '接口版本' }).getByRole('button', { name: '删除…' }).click();
  const confirm = page.getByRole('alertdialog', { name: '删除这条记忆' });
  await confirm.getByRole('button', { name: '删除记忆' }).click();
  await expect(confirm.getByRole('alert')).toHaveText('没有删除成功，记忆保持原样，请重试。');
  await confirm.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('dialog', { name: '接口版本' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(memoryRow(page, '接口版本')).toBeVisible();
});

test('loading shows row-shaped skeletons, not an empty list', async ({ page }) => {
  await openMemory(page, { list: 'hang' });
  await expect(page.getByRole('status', { name: '正在加载记忆' })).toBeVisible();
  await expect(page.getByText('尚无记忆')).toHaveCount(0);
  await settled(page);
  await evidenceShot(page, 'memory-loading.png');
});

test('a failed read says so and retries, never claiming the list is empty', async ({ page }) => {
  const control = await openMemory(page, { list: 'fail' });
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('记忆没有加载出来，请重试。', { timeout: 15_000 });
  await expect(page.getByText('尚无记忆')).toHaveCount(0);
  await settled(page);
  await evidenceShot(page, 'memory-error.png');
  control.recover();
  await alert.getByRole('button', { name: '重试' }).click();
  await expect(page.getByTestId('memory-list')).toBeVisible();
});

test('with no memories each project still shows its instructions and an empty auto memory line', async ({
  page,
}) => {
  await openMemory(page, { memories: [] });
  const notes = page.getByTestId('memory-list').getByRole('region', { name: 'Field Notes' });
  await expect(notes.getByRole('textbox', { name: 'Field Notes 的项目说明' })).toBeVisible();
  await expect(notes.getByText('Coordinator 还没有在这个项目里记下笔记。')).toBeVisible();
  await expect(page.getByTestId('memory-list').getByRole('region', { name: '团队' })).toHaveCount(0);
  await settled(page);
  await evidenceShot(page, 'memory-empty.png');
});

test('with no memories and no projects the tab is one empty state', async ({ page }) => {
  await mockLive(page, { threads: [THREAD], messages: [], projects: [] }, (p, _route, json) =>
    p === '/api/teams/t1/memories' ? json([]) : undefined,
  );
  await page.goto('/app?chief=settings');
  await page.getByRole('tab', { name: '记忆' }).click();
  await expect(page.getByRole('heading', { name: '尚无记忆。' })).toBeVisible();
});

test('on a phone each row is two lines and nothing scrolls sideways', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openMemory(page);
  const verify = memoryRow(page, '验证命令');
  await expect(verify).toBeVisible();
  const lines = await verify.evaluate((el) => {
    const [title, summary, date] = ['memory-title', 'memory-summary', 'memory-date'].map((id) =>
      el.querySelector(`[data-slot="${id}"]`)?.getBoundingClientRect(),
    );
    return { titleTop: title?.top, dateTop: date?.top, summaryTop: summary?.top, titleBottom: title?.bottom };
  });
  expect(Math.abs((lines.titleTop ?? 0) - (lines.dateTop ?? 99))).toBeLessThan(4);
  expect(lines.summaryTop ?? 0).toBeGreaterThanOrEqual(lines.titleBottom ?? 99);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await settled(page);
  await evidenceShot(page, 'memory-list-phone.png');
});

test('project loading keeps memories in the loading state without claiming projects were removed', async ({ page }) => {
  await openMemory(page, { projects: 'hang' });
  await expect(page.getByRole('status', { name: '正在加载记忆' })).toBeVisible();
  await expect(page.getByTestId('memory-list')).toHaveCount(0);
  await expect(page.getByText('已移除的项目')).toHaveCount(0);
  await evidenceShot(page, 'memory-project-loading.png');
});

test('project lookup failure offers retry and recovers the list with real project names', async ({ page }) => {
  const control = await openMemory(page, { projects: 'fail' });
  const alert = page.getByRole('alert').filter({ hasText: '记忆没有加载出来，请重试。' });
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('memory-list')).toHaveCount(0);
  await expect(page.getByText('已移除的项目')).toHaveCount(0);
  await evidenceShot(page, 'memory-project-error.png');
  control.recover();
  await alert.getByRole('button', { name: '重试' }).click();
  await expect(page.getByTestId('memory-list').getByRole('heading', { name: 'Field Notes' })).toBeVisible();
  await memoryRow(page, '无障碍检查').click();
  await expect(page.getByRole('dialog').getByText('Field Notes · 核心')).toBeVisible();
});

test('a project absent from a successful lookup is still shown as removed', async ({ page }) => {
  await openMemory(page, { memories: [row('m-gone', '保留的记忆', '仍可查看。', 'removed', NOV_8)] });
  await expect(page.getByTestId('memory-list').getByRole('heading', { name: /已移除的项目/ })).toBeVisible();
});

for (const last of [false, true]) {
  test(`delete waits for the refreshed list and focuses ${last ? 'the stable summary after the last row' : 'a surviving row'}`, async ({ page }) => {
    let release = () => {};
    const refresh = new Promise<void>((resolve) => { release = resolve; });
    await openMemory(page, { memories: MEMORIES.slice(0, last ? 1 : 2), refresh });
    await memoryRow(page, '验证命令').click();
    await page.getByRole('dialog').getByRole('button', { name: '删除…' }).click();
    const confirm = page.getByRole('alertdialog');
    const refreshed = page.waitForRequest(request => request.method() === 'GET' && new URL(request.url()).pathname === '/api/teams/t1/memories');
    await confirm.getByRole('button', { name: '删除记忆' }).click();
    await refreshed;
    try {
      await expect(confirm.getByRole('button', { name: '正在删除…' })).toBeVisible();
    } finally {
      release();
    }
    await expect(confirm).toBeHidden();
    await expect(memoryRow(page, '验证命令')).toHaveCount(0);
    await settled(page);
    await expect(last ? page.getByRole('paragraph').filter({ hasText: /^记忆$/ }) : memoryRow(page, '无障碍检查')).toBeFocused();
  });
}

test('delete waits for closure and focuses the summary when no rows remain', async ({ page }) => {
  await openMemory(page, { memories: MEMORIES.slice(0, 1) });
  await memoryRow(page, '验证命令').click();
  await page.getByRole('dialog').getByRole('button', { name: '删除…' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '删除记忆' }).click();
  await expect(page.getByRole('button', { name: /打开记忆/ })).toHaveCount(0);
  await settled(page);
  await expect(page.getByRole('paragraph').filter({ hasText: /^记忆$/ })).toBeFocused();
});
