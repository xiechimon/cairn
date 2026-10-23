import { expect, type Page, test } from '@playwright/test';

// Issue #441 (ADR 0003 D5/D6 应用内目录浏览器): remote/headless 形态下
// POST /api/fs/pick 422 unavailable 的兜底——浏览钮自动打开应用内目录浏览
// overlay（GET /api/fs/list 数据源）。本面全 e2e 可钉（与原生对话框相反），
// 票面验收逐条落断言（live build + stubbed network，project-new-fs-pick.spec
// stubBoot 先例）：
//
// 1. 422 unavailable → overlay 自动打开；Escape/点外部关闭后提示行仍在、输入不动（W11/W12）
// 2. 缺省起点 = server HOME（首请无 dir 参）；git 标记；dotfiles 默认隐藏（W1/W8）
// 3. 点行名下钻 + 面包屑跳任意层级含根（W6/W7）
// 4. 单击「选择」→ 回填输入框 + basename 项目名回填律联动 + 关 overlay（W5）
// 5. dotfiles toggle aria-pressed 可断言（W8）
// 6. 记住上次位置：reload 后重开 = lastDir 起点（W1，localStorage）
// 7. 空目录空态文案（W9）
// 8. 超大目录截断提示行（W10）
// 9. 列表 500 → overlay 内错误行、overlay 不关、面包屑仍在（W3）
// 10. lastDir 失效 400 not_found → 自动回落缺省 HOME 不死端（W2）
// 11. 409 busy / 未分类错（500 无 reason）→ 不开 overlay，仅提示行（W14，
//     只有 422 unavailable 才开兜底；#440 行为不动面）

const NEW_PROJECT_LIVE = '/app/project/new';
const HOME = '/Users/e2e';
const LAST_DIR_KEY = 'cairn.dirBrowser.lastDir';

/** Live-face boot stub（project-new-fs-pick.spec 同款）：seed team +
 *  session succeed，其余 GET 500（shell 容忍）。注册序 = 匹配反序。 */
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

/** POST /api/fs/pick stub：reason 缺省 = 422 unavailable（remote/headless
 *  形态，本 spec 主入口）。 */
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

/** 可编程假目录树：dir → 子目录条目；未收录 dir = 400 not_found（server
 *  真实现同 reason）。返回请求 search 串读取器（缺省起点断言用）。 */
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

// #946/#910 载体：面板 = role=dialog（aria-label 浏览本地文件夹）；目录行
// = role=listitem（行内名字钮精确名过滤）；面包屑 = nav（role=navigation）
// 内的按钮精确名；提示行 = role=status；错误行 = role=alert。
const DIALOG = { name: '浏览本地文件夹' };

async function openLocalFace(page: Page) {
  await page.goto(NEW_PROJECT_LIVE);
  await page.locator('#prj-new-repo').click();
  await page.getByRole('menuitemradio', { name: '本地文件夹' }).click();
  await expect(page.getByRole('menu', { name: '仓库' })).not.toBeVisible();
  return page.getByRole('textbox', { name: '本地文件夹' });
}

/** 422 兜底入口：点浏览钮 → overlay 打开。 */
async function openBrowser(page: Page) {
  await page.getByRole('button', { name: '浏览' }).click();
  await expect(page.getByRole('dialog', DIALOG)).toBeVisible();
}

/** 行定位器（名字精确匹配）。 */
function row(page: Page, name: string) {
  return page
    .getByRole('dialog', DIALOG)
    .getByRole('listitem')
    .filter({ has: page.getByRole('button', { name, exact: true }) });
}

/** 面包屑段定位器（精确匹配）。 */
function crumb(page: Page, label: string) {
  return page
    .getByRole('dialog', DIALOG)
    .getByRole('navigation')
    .getByRole('button', { name: label, exact: true });
}

test('422 unavailable → overlay 自动打开；Escape/点外部关闭后提示行仍在、输入不动', async ({
  page,
}) => {
  await stubBoot(page);
  await stubPick(page);
  await stubFsList(page);
  const input = await openLocalFace(page);
  await openBrowser(page);
  // 422 中性提示行与 overlay 并存（ADR 0003 D4/D6）。
  await expect(page.getByRole('status')).toContainText('请直接输入路径');
  // Escape 关（弹层家族法 #67/#127）：输入不动、提示行仍在（W11/W12）。
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', DIALOG)).not.toBeVisible();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('status')).toBeVisible();
  // 重开后点外部（ClickCatcher）关：同样不带走输入与提示。
  await openBrowser(page);
  await page.mouse.click(10, 10);
  await expect(page.getByRole('dialog', DIALOG)).not.toBeVisible();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('status')).toBeVisible();
});

test('缺省起点 = server HOME（首请无 dir 参）；git 标记；dotfiles 默认隐藏', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page);
  const searches = await stubFsList(page);
  await openLocalFace(page);
  await openBrowser(page);
  await expect(row(page, 'demo')).toBeVisible();
  // 首请无 dir 参 = server 判 HOME 起点（web 无从知道 server HOME）。
  expect(searches()[0]).toBe('');
  // git 标记：demo 有、plain 无（提示不硬过滤——两者都在列）。
  await expect(row(page, 'demo').getByRole('img', { name: 'git 仓库' })).toHaveCount(1);
  await expect(row(page, 'plain').getByRole('img', { name: 'git 仓库' })).toHaveCount(0);
  // dotfiles 默认隐藏（仿 macOS ⌘⇧. 习惯）。
  await expect(row(page, '.config')).toHaveCount(0);
  // 面包屑 = HOME 路径段。
  await expect(crumb(page, 'Users')).toBeVisible();
  await expect(crumb(page, 'e2e')).toBeVisible();
});

test('点行名下钻 + 面包屑跳任意层级（含根）', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page);
  const searches = await stubFsList(page);
  await openLocalFace(page);
  await openBrowser(page);
  // 下钻 demo：请求带 canonical dir，列其子目录，面包屑长出 demo 段。
  await row(page, 'demo').getByRole('button', { name: 'demo', exact: true }).click();
  await expect(row(page, 'src')).toBeVisible();
  expect(searches().at(-1)).toContain(`dir=${encodeURIComponent(`${HOME}/demo`)}`);
  await expect(crumb(page, 'demo')).toBeVisible();
  // 面包屑跳中间层。
  await crumb(page, 'Users').click();
  await expect(row(page, 'e2e')).toBeVisible();
  // 面包屑跳根（F21 单段路径面）。
  await crumb(page, '/').click();
  await expect(row(page, 'Users')).toBeVisible();
});

test('单击「选择」→ 回填输入框 + basename 项目名联动 + 关 overlay', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page);
  await stubFsList(page);
  const input = await openLocalFace(page);
  await openBrowser(page);
  await row(page, 'demo').getByRole('button', { name: '选择' }).click();
  await expect(input).toHaveValue(`${HOME}/demo`);
  await expect(page.locator('#prj-new-name')).toHaveValue('demo');
  await expect(page.getByRole('dialog', DIALOG)).not.toBeVisible();
  // 选中即撤提示（编辑即撤律同族，W5）。
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('dotfiles toggle：默认隐藏，toggle 后显示，aria-pressed 可断言', async ({ page }) => {
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

test('记住上次位置：reload 后重开 = lastDir 起点', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page);
  const searches = await stubFsList(page);
  await openLocalFace(page);
  await openBrowser(page);
  // 下钻 demo（列表成功即写 lastDir）。
  await row(page, 'demo').getByRole('button', { name: 'demo', exact: true }).click();
  await expect(row(page, 'src')).toBeVisible();
  // 整页重载模拟新会话：localStorage 是唯一记忆载体。
  await page.reload();
  await openLocalFace(page);
  await openBrowser(page);
  await expect(row(page, 'src')).toBeVisible();
  expect(searches().at(-1)).toContain(`dir=${encodeURIComponent(`${HOME}/demo`)}`);
});

test('空目录 = 空态文案，非白屏', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page);
  await stubFsList(page);
  await openLocalFace(page);
  await openBrowser(page);
  await row(page, 'empty').getByRole('button', { name: 'empty', exact: true }).click();
  await expect(page.getByText('没有子目录')).toBeVisible();
});

test('子目录全被 dotfiles 隐藏 = 空态不谎称「没有子目录」，toggle 后现身', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page);
  await stubFsList(page);
  await openLocalFace(page);
  await openBrowser(page);
  await row(page, 'dotonly').getByRole('button', { name: 'dotonly', exact: true }).click();
  // 有子目录但全是 dotfiles：空态分译，不对「有但隐藏」谎称「没有」。
  await expect(page.getByText('子目录均已隐藏')).toBeVisible();
  // toggle 显示隐藏文件 → .hidden 现身，空态撤。
  await page.getByRole('button', { name: '显示隐藏文件' }).click();
  await expect(row(page, '.hidden')).toBeVisible();
  await expect(page.getByText('子目录均已隐藏')).toHaveCount(0);
});

test('超大目录 = 截断提示行', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page);
  await stubFsList(page);
  await openLocalFace(page);
  await openBrowser(page);
  await row(page, 'big').getByRole('button', { name: 'big', exact: true }).click();
  await expect(page.getByText('只列出前')).toBeVisible();
});

test('列表 500 → overlay 内错误行，overlay 不关，面包屑仍可导航', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page);
  await stubFsList(page);
  await openLocalFace(page);
  await openBrowser(page);
  await row(page, 'boom').getByRole('button', { name: 'boom', exact: true }).click();
  const error = page.getByRole('alert');
  await expect(error).toBeVisible();
  await expect(error).toContainText('boom');
  // overlay 不关，面包屑仍在（上一好数据承 W3）——点面包屑即可离开错误面。
  await expect(page.getByRole('dialog', DIALOG)).toBeVisible();
  await expect(crumb(page, 'e2e')).toBeVisible();
  await crumb(page, 'e2e').click();
  await expect(row(page, 'demo')).toBeVisible();
  await expect(error).toHaveCount(0);
});

test('lastDir 失效 400 → 自动回落缺省 HOME，不死端', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page);
  const searches = await stubFsList(page);
  // 预置失效 lastDir（被删目录）：首请 400 not_found → 回落缺省。
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => window.localStorage.setItem(key, value),
    { key: LAST_DIR_KEY, value: `${HOME}/gone` },
  );
  await openLocalFace(page);
  await openBrowser(page);
  await expect(row(page, 'demo')).toBeVisible();
  // 回落后的请求不带 dir 参（server HOME 语义）。
  expect(searches().at(-1)).toBe('');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('409 busy → 不开 overlay，仅提示行（#440 行为不动面）', async ({ page }) => {
  await stubBoot(page);
  await stubPick(page, 409, 'busy');
  await stubFsList(page);
  await openLocalFace(page);
  await page.getByRole('button', { name: '浏览' }).click();
  await expect(page.getByRole('status')).toContainText('已有一个选取对话框在进行中');
  await expect(page.getByRole('dialog', DIALOG)).toHaveCount(0);
});

test('pick 未分类错（500 无 reason）→ 不开 overlay，原文直透提示行', async ({ page }) => {
  await stubBoot(page);
  // 未分类失败：无 reason code（只有 422 unavailable 才开兜底 overlay，W14）。
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
