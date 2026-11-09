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
  row(
    'm-verify',
    '验证命令',
    '推送代码前先跑受影响的测试。\n- 单测用 --changed\n- 界面改动再跑受影响的 e2e',
    null,
    NOV_8,
  ),
  row('m-review', '评审交接', '交给评审前写清验收证据。', null, NOV_8 - 2 * DAY),
  row('m-style', '代码风格', '命名表达意图，不写注释。', null, NOV_8 - 3 * DAY, 'searchable'),
  row('m-a11y', '无障碍检查', '请求评审前检查键盘导航和焦点顺序。', 'p-notes', NOV_8 - DAY),
  row(
    'm-release',
    '发布交接',
    '交付前在任务里记录验收证据。',
    'p-notes',
    NOV_8 - 6 * DAY,
    'searchable',
  ),
  row('m-api', '接口版本', '新增字段只加不改。', 'p-harbor', NOV_8 - 9 * DAY),
];

type ListReply = 'ok' | 'fail' | 'hang';

interface MockOptions {
  list?: ListReply;
  projects?: ListReply;
  archived?: boolean;
  projectRefreshFails?: boolean;
  patchGate?: Promise<void>;
  refreshFails?: boolean;
  refresh?: Promise<void>;
  deleteFails?: boolean;
  memories?: typeof MEMORIES;
}

async function mockMemory(page: Page, options: MockOptions = {}) {
  const memories = structuredClone(options.memories ?? MEMORIES);
  const deleted: string[] = [];
  const projectPatches: unknown[] = [];
  let listReply = options.list ?? 'ok';
  let projectsReply = options.projects ?? 'ok';
  const projects = PROJECTS.map(project => ({ ...project, instructions: '保留已保存的项目说明。' as string | null, archivedAt: options.archived ? NOV_8 : null }));
  await mockLive(
    page,
    { threads: [THREAD], messages: [], projects: PROJECTS },
    (p, route: Route, json) => {
      if (p === '/api/projects') {
        if (projectsReply === 'hang') return new Promise<void>(() => {});
        if (projectsReply === 'fail' || (options.projectRefreshFails && projectPatches.length > 0)) return json({ error: 'boom' }, 500);
        return json(projects);
      }
      if (p.startsWith('/api/projects/') && route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON() as { instructions: string | null };
        projectPatches.push(body);
        const index = projects.findIndex((project) => p.endsWith(project.id));
        const project = projects[index];
        if (project === undefined) return json({ error: 'missing project' }, 404);
        const result = { ...project, ...body };
        projects[index] = result;
        return options.patchGate === undefined ? json(result) : options.patchGate.then(() => json(result));
      }
      if (p.endsWith('/branches')) {
        return json({ defaultBranch: 'main', branches: [{ name: 'main', isDefault: true }] });
      }
      if (p === '/api/teams/t1/memories') {
        if (deleted.length > 0 && options.refreshFails) return json({ error: 'boom' }, 500);
        if (deleted.length > 0 && options.refresh !== undefined)
          return options.refresh.then(() => json(memories));
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
    },
  );
  return {
    deleted,
    projectPatches,
    recover: () => {
      listReply = 'ok';
      projectsReply = 'ok';
    },
  };
}

async function openMemory(page: Page, options: MockOptions = {}) {
  const control = await mockMemory(page, options);
  await page.goto('/app?chief=settings');
  await page.getByRole('tab', { name: '记忆' }).click();
  return control;
}

async function openProjectMemory(page: Page, options: MockOptions = {}) {
  const control = await mockMemory(page, options);
  await page.goto('/app/project/p-notes/settings');
  await page.getByRole('tab', { name: '记忆' }).click();
  return control;
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

test('Coordinator settings lists team memory only, with no scope headings or count', async ({
  page,
}) => {
  await openMemory(page);
  const list = page.getByTestId('memory-list');
  await expect(list).toBeVisible();
  await expect(list.getByRole('heading')).toHaveText(['自动记忆', '可自动注入', '记忆文件']);
  await expect(page.getByRole('heading', { name: /团队|Field Notes|Harbor API/ })).toHaveCount(0);
  await expect(page.getByText('记忆', { exact: true })).toHaveCount(1);
  await expect(page.getByText(/\d+ \/ \d+/)).toHaveCount(0);
  await expect(list.getByRole('button', { name: /打开记忆/ })).toHaveText([
    /验证命令/,
    /评审交接/,
    /代码风格/,
  ]);
  await expect(list.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByPlaceholder(/告诉 Coordinator/)).toHaveCount(0);

  const verify = memoryRow(page, '验证命令');
  await expect(verify).toContainText('推送代码前先跑受影响的测试。');
  await expect(verify).not.toContainText('单测用');
  await expect(verify).toContainText('更新于 11月8日');
  await expect(
    page.getByTestId('chief-settings-col').locator('[data-slot="list-card"], [data-slot="card"]'),
  ).toHaveCount(0);

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

test('project settings has a 记忆 tab laid out like the Claude Code project memory page', async ({
  page,
}) => {
  await openProjectMemory(page);
  const list = page.getByTestId('memory-list');
  await expect(list.getByRole('heading')).toHaveText([
    '项目说明',
    '自动记忆',
    '可自动注入',
    '记忆文件',
  ]);
  await expect(list.getByRole('heading', { name: 'Field Notes' })).toHaveCount(0);
  await expect(list.getByRole('textbox', { name: '项目说明' })).toHaveValue('保留已保存的项目说明。');
  await expect(list.getByText('11 / 16,000')).toBeVisible();
  await expect(list.getByRole('button', { name: /打开记忆/ })).toHaveText([/无障碍检查/, /发布交接/]);
  await expect(page.getByTestId('project-instructions-input')).toHaveCount(1);
  await settled(page);
  await evidenceShot(page, 'project-memory.png');
});

test('the project settings basic tab no longer carries the instructions editor', async ({ page }) => {
  await mockMemory(page);
  await page.goto('/app/project/p-notes/settings');
  await expect(page.getByRole('tab', { name: '基本信息' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('project-instructions-input')).toHaveCount(0);
  await expect(page.getByTestId('memory-list')).toHaveCount(0);
});

test('project instructions save from the project memory tab', async ({ page }) => {
  const { projectPatches } = await openProjectMemory(page);
  const list = page.getByTestId('memory-list');
  const input = list.getByRole('textbox', { name: '项目说明' });
  const save = list.getByRole('button', { name: '保存项目说明' });
  await expect(save).toBeDisabled();
  await input.fill('  仓库内容用英文。  ');
  await expect(list.getByText('12 / 16,000')).toBeVisible();
  await save.click();
  await expect.poll(() => projectPatches).toEqual([{ instructions: '仓库内容用英文。' }]);
});

test('a project memory opens the same detail dialog with the project as scope', async ({
  page,
}) => {
  await openProjectMemory(page);
  await memoryRow(page, '发布交接').click();
  const dialog = page.getByRole('dialog', { name: '发布交接' });
  await expect(dialog.getByText('Field Notes · 可检索 · 不自动注入')).toBeVisible();
  await expect(dialog.getByTestId('dialog-head').getByRole('button', { name: '删除…' })).toBeVisible();
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
  await memoryRow(page, '代码风格').click();
  const dialog = page.getByRole('dialog', { name: '代码风格' });
  await expect(dialog.getByText('团队 · 可检索 · 不自动注入')).toBeVisible();
  await expect(dialog.locator('dt')).toHaveText(['更新于', '概要']);
});

test('delete confirms first, then removes the row and closes both dialogs', async ({ page }) => {
  const { deleted } = await openMemory(page);
  await memoryRow(page, '评审交接').click();
  await page.getByRole('dialog', { name: '评审交接' }).getByRole('button', { name: '删除…' }).click();
  const confirm = page.getByRole('alertdialog', { name: '删除这条记忆' });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('只删除这条记忆，不影响保存它的对话。');
  await settled(page);
  await evidenceShot(page, 'memory-delete-confirm.png');
  await confirm.getByRole('button', { name: '删除记忆' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(deleted).toEqual(['m-review']);
  await expect(memoryRow(page, '评审交接')).toHaveCount(0);
});

test('a failed delete keeps the row and says so in the confirmation', async ({ page }) => {
  await openMemory(page, { deleteFails: true });
  await memoryRow(page, '代码风格').click();
  await page.getByRole('dialog', { name: '代码风格' }).getByRole('button', { name: '删除…' }).click();
  const confirm = page.getByRole('alertdialog', { name: '删除这条记忆' });
  await confirm.getByRole('button', { name: '删除记忆' }).click();
  await expect(confirm.getByRole('alert')).toHaveText('没有删除成功，记忆保持原样，请重试。');
  await confirm.getByRole('button', { name: '取消' }).click();
  await expect(page.getByRole('dialog', { name: '代码风格' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(memoryRow(page, '代码风格')).toBeVisible();
});

test('loading shows row-shaped skeletons, not an empty list', async ({ page }) => {
  await openMemory(page, { list: 'hang' });
  await expect(page.getByRole('status', { name: '正在加载记忆' })).toBeVisible();
  await expect(page.getByText(/还没有/)).toHaveCount(0);
  await settled(page);
  await evidenceShot(page, 'memory-loading.png');
});

test('a failed read says so and retries, never claiming the list is empty', async ({ page }) => {
  const control = await openMemory(page, { list: 'fail' });
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('记忆没有加载出来，请重试。', { timeout: 15_000 });
  await expect(page.getByText(/还没有/)).toHaveCount(0);
  await settled(page);
  await evidenceShot(page, 'memory-error.png');
  control.recover();
  await alert.getByRole('button', { name: '重试' }).click();
  await expect(page.getByTestId('memory-list')).toBeVisible();
});

test('with no team memory the Coordinator tab says so in one line', async ({ page }) => {
  await openMemory(page, { memories: MEMORIES.filter((memory) => memory.projectId !== null) });
  await expect(page.getByText('Coordinator 还没有记下团队笔记。')).toBeVisible();
  await expect(page.getByRole('button', { name: /打开记忆/ })).toHaveCount(0);
  await settled(page);
  await evidenceShot(page, 'memory-empty.png');
});

test('a project with no memory still shows its instructions and one empty line', async ({
  page,
}) => {
  await openProjectMemory(page, { memories: [] });
  const list = page.getByTestId('memory-list');
  await expect(list.getByRole('textbox', { name: '项目说明' })).toBeVisible();
  await expect(list.getByText('Coordinator 还没有在这个项目里记下笔记。')).toBeVisible();
  await expect(list.getByRole('heading')).toHaveText(['项目说明', '自动记忆']);
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
    return {
      titleTop: title?.top,
      dateTop: date?.top,
      summaryTop: summary?.top,
      titleBottom: title?.bottom,
    };
  });
  expect(Math.abs((lines.titleTop ?? 0) - (lines.dateTop ?? 99))).toBeLessThan(4);
  expect(lines.summaryTop ?? 0).toBeGreaterThanOrEqual(lines.titleBottom ?? 99);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await settled(page);
  await evidenceShot(page, 'memory-list-phone.png');
});

for (const last of [false, true]) {
  test(`successful deletion settles despite a hanging refresh, last=${last}`, async ({ page }) => {
    let release = () => {};
    const refresh = new Promise<void>(resolve => { release = resolve; });
    await openMemory(page, { memories: MEMORIES.slice(0, last ? 1 : 2), refresh });
    await memoryRow(page, '验证命令').click();
    await page.getByRole('dialog').getByRole('button', { name: '删除…' }).click();
    const refreshed = page.waitForRequest(request => request.method() === 'GET' && new URL(request.url()).pathname === '/api/teams/t1/memories');
    await page.getByRole('alertdialog').getByRole('button', { name: '删除记忆' }).click();
    await refreshed;
    try {
      await expect(page.getByRole('alertdialog')).toBeHidden();
      await expect(memoryRow(page, '验证命令')).toHaveCount(0);
      await settled(page);
      await expect(last ? page.getByRole('heading', { name: '自动记忆' }) : memoryRow(page, '评审交接')).toBeFocused();
    } finally { release(); }
  });

  test(`a failed post-delete refresh cannot restore a deleted row, last=${last}`, async ({ page }) => {
    const { deleted } = await openMemory(page, { memories: MEMORIES.slice(0, last ? 1 : 2), refreshFails: true });
    await memoryRow(page, '验证命令').click();
    await page.getByRole('dialog').getByRole('button', { name: '删除…' }).click();
    const failed = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/teams/t1/memories' && response.status() === 500);
    await page.getByRole('alertdialog').getByRole('button', { name: '删除记忆' }).click();
    await failed;
    await expect(page.getByRole('alertdialog')).toBeHidden();
    await expect(memoryRow(page, '验证命令')).toHaveCount(0);
    await settled(page);
    await expect(last ? page.getByRole('heading', { name: '自动记忆' }) : memoryRow(page, '评审交接')).toBeFocused();
    expect(deleted).toEqual(['m-verify']);
  });
}

for (const projects of ['hang', 'fail'] as const) {
  test(`project instructions wait for the real project when lookup is ${projects}`, async ({ page }) => {
    const control = await openProjectMemory(page, { projects });
    if (projects === 'fail') await expect(page.getByRole('heading', { name: '项目没能加载' })).toBeVisible({ timeout: 15000 });
    else await expect(page.getByLabel('正在加载项目').last()).toBeVisible();
    await expect(page.getByRole('textbox', { name: '项目说明' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '保存项目说明' })).toHaveCount(0);
    if (projects === 'fail') {
      control.recover();
      await page.getByTestId('project-load-error').getByRole('button', { name: '重试' }).click();
      await expect(page.getByRole('textbox', { name: '项目说明' })).toHaveValue('保留已保存的项目说明。');
    }
  });
}

test('team memory does not depend on project lookup or claim a removed project', async ({ page }) => {
  await openMemory(page, { projects: 'hang' });
  await expect(memoryRow(page, '验证命令')).toBeVisible();
  await expect(page.getByText('已移除的项目')).toHaveCount(0);
});

test('an archived project keeps its instructions, memory and scope name', async ({ page }) => {
  await openProjectMemory(page, { archived: true });
  await expect(page.getByRole('textbox', { name: '项目说明' })).toHaveValue('保留已保存的项目说明。');
  await memoryRow(page, '无障碍检查').click();
  await expect(page.getByRole('dialog').getByText('Field Notes · 核心')).toBeVisible();
  await expect(page.getByText('已移除的项目')).toHaveCount(0);
});

test('saved instructions survive a failed projects refresh and a tab remount', async ({ page }) => {
  await openProjectMemory(page, { projectRefreshFails: true });
  const input = page.getByRole('textbox', { name: '项目说明' });
  await input.fill('  保存后仍然显示。  ');
  const failed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/projects' && response.status() === 500);
  await page.getByRole('button', { name: '保存项目说明' }).click();
  await failed;
  await expect(input).toHaveValue('保存后仍然显示。');
  await expect(page.getByRole('button', { name: '保存项目说明' })).toBeDisabled();
  await page.getByRole('tab', { name: '基本信息' }).click();
  await page.getByRole('tab', { name: '记忆' }).click();
  await expect(input).toHaveValue('保存后仍然显示。');
});


test('edits made while instructions are saving remain a draft', async ({ page }) => {
  let release = () => {};
  const patchGate = new Promise<void>(resolve => { release = resolve; });
  await openProjectMemory(page, { patchGate });
  const input = page.getByRole('textbox', { name: '项目说明' });
  await input.fill('本次保存的内容。');
  const pending = page.waitForRequest(request => request.method() === 'PATCH');
  await page.getByRole('button', { name: '保存项目说明' }).click();
  await pending;
  await input.fill('保存期间补充的草稿。');
  release();
  await expect(page.getByRole('button', { name: '保存项目说明' })).toBeEnabled();
  await expect(input).toHaveValue('保存期间补充的草稿。');
});
