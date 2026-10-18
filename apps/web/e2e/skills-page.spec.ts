import { expect, type Page, test } from '@playwright/test';

// 技能页读面（spec 13 #367 现扫投影 + XMON-114 S3 回摆：页面恢复写面——
// 新建入口 + 空态主钮开 SkillDialog，写路径 e2e 钉在 skills-write.spec.ts）。
// 本 spec 前身 = skills-readonly.spec.ts（stubBoot 打桩纪律的首出位；它 spec
// 注释里「承 skills-readonly」= 指这里，XMON-114 随写面回摆改名）。
// 技能 = server 本地目录现扫投影（不入库），旧导入路由走 SPA catch-all
// 回落 /app，空态文案 = 目录 + 界面新建双入口（SKILL_PAGE_COPY 单源）。
// 钉住的失败方式：新建入口丢失 / 旧路由仍可达导入表单 / 空态缺双入口文案或
// 主钮 / live 列表不消费 GET /api/skills。

const SKILLS = '/app/resources/skills';

test('技能页新建入口（topbar 新建钮）在位，fixture 行集照常渲染', async ({ page }) => {
  await page.goto(`${SKILLS}?scenario=06`);
  await expect(page.locator('[data-route="/app/resources/skills"]')).toBeVisible();
  // #944/#910 载体：.res-new → role+文案一级；.res-rowcard → resource-row
  // 二级结构 testid（行卡无 role）。
  await expect(page.getByRole('button', { name: '新建', exact: true })).toHaveCount(1);
  await expect(page.getByTestId('resource-row')).toHaveCount(1);
  await expect(page.getByTestId('resource-row').first()).toContainText('r3-probe-skill');
});

test('旧导入路由不可达——catch-all 重定向回 /app（#149 feedback 路由同律）', async ({
  page,
}) => {
  await page.goto(`${SKILLS}/import`);
  await expect(page).toHaveURL('/app');
  await expect(page.locator('[data-route="/app/resources/skills/import"]')).toHaveCount(0);
});

test('空态双入口——目录指引文案 + 新建技能主钮，无总管提示行', async ({ page }) => {
  await page.goto(`${SKILLS}?scenario=01`);
  const empty = page.getByTestId('resource-empty');
  await expect(empty).toBeVisible();
  await expect(empty.getByRole('heading')).toHaveText('尚无技能。');
  // 目录指引 = SKILLS_DIR_DEFAULT 单源（{dir} 插值渲染进文案）+ 界面新建口径。
  // desc = 空态里唯一的 p（hint 缺席时）——描述断言语义与原 .res-empty-desc 同。
  const desc = empty.locator('p');
  await expect(desc).toContainText('~/.agents/skills');
  await expect(desc).toContainText('SKILL.md');
  await expect(desc).toContainText('新建一个技能');
  await expect(empty.getByRole('button', { name: '新建技能' })).toHaveText('新建技能');
  // 无总管提示行：hint 是第二个 p，缺席 = p 恰一个（原 .res-empty-hint 计数 0）。
  await expect(desc).toHaveCount(1);
});

/** live 启动面打桩（承 skills-github-scan 的 stubBoot 纪律）：teams/user me
 * 是 teamId 来源必须成功；其余 GET 一律 500——启动面查询失败 = 应用既有
 * isError 耐受（data ?? [] 族）。page.route 匹配序 = 注册逆序：catch-all
 * 先注册，具体路由后注册才生效。 */
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

test('live 列表消费 GET /api/skills（server 换源后 wire 形状不变）', async ({ page }) => {
  await stubBoot(page);
  const hits: string[] = [];
  await page.route('**/api/skills*', (route) => {
    hits.push(route.request().url());
    return route.fulfill({
      json: [
        { id: 'deploy', teamId: 'team-1', name: 'deploy', description: '部署流程手册' },
        { id: 'review', teamId: 'team-1', name: 'review', description: null },
      ],
    });
  });
  await page.goto(SKILLS);

  await expect(page.getByTestId('resource-row')).toHaveCount(2);
  await expect(page.getByTestId('resource-row').nth(0)).toContainText('deploy');
  await expect(page.getByTestId('resource-row').nth(0)).toContainText('部署流程手册');
  await expect(page.getByTestId('resource-row').nth(1)).toContainText('review');
  // 请求带 teamId（hooks 族律）；id = frontmatter name（server 现扫语义）
  expect(hits.length).toBeGreaterThan(0);
  expect(hits[0]).toContain('teamId=team-1');
});

/** 回归 #486 + #494：资源页的面板体必须自持滚动，且滚动条落在面板右缘。
 *  本应用是固定高度外壳（body overflow:hidden），滚动归各面板体自持，形制
 *  同 secondary 的分段——全宽 body 承接滚动、窄列在里面居中。
 *
 * 钉住的失败方式：
 *  ① 面板无滚动容器（overflow:hidden 裁掉溢出）→ 滚轮后末行仍在视口外（#486）；
 *  ② 滚动容器是窄列而非面板体 → 滚动条悬在版心右缘、不在面板右缘（#494）；
 *  ③ 滚动被上移到 document/外壳 → window.scrollY 非 0 或 topbar 被推走；
 *  ④ 修法破几何 → 768 列宽 / topbar 56 高漂移；
 *  ⑤ 前置守卫：若内容本就不高于容器，本测会假绿——先断言确有溢出。
 *
 *  手势用真滚轮而非 scrollTop 赋值：overflow:hidden 下 scrollTop 赋值照样
 *  生效（程序化滚动不受 hidden 限制），只有滚轮能分辨「能滚」与「被裁」。
 *  滚动层靠「从窄列往上找第一个真在滚的祖先」定位，不钉类名——钉的是用户
 *  可见性质（滚动条贴面板右缘），不是某次实现的分层写法。 */
test('回归 #486/#494：技能列表可由滚轮到达，且滚动条贴面板右缘', async ({ page }) => {
  await stubBoot(page);
  // 20 行 × 80px（64 行盒 + 16 上外边距）+ 搜索行 → 逾 1600px，稳超 688 容器
  const rows = Array.from({ length: 20 }, (_, i) => ({
    id: `skill-${i}`,
    teamId: 'team-1',
    name: `skill-${String(i).padStart(2, '0')}`,
    description: `回归行 ${i}`,
  }));
  await page.route('**/api/skills*', (route) => route.fulfill({ json: rows }));
  await page.goto(SKILLS);
  await expect(page.getByTestId('resource-row')).toHaveCount(rows.length);

  const shellSel = '[data-route="/app/resources/skills"]';
  // Paper page shell (PR 6): page-col / page-topbar testids, .page-main-col
  // = the sheet's column (one shell for every non-board route).
  const col = page.getByTestId('page-col');
  const readScrollLayer = () =>
    page.evaluate((sel) => {
      const colEl = document.querySelector(`${sel} [data-testid="page-col"]`);
      const pane = document.querySelector(`${sel} .page-main-col`);
      let host = null;
      for (let n = colEl; n != null; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const scrolls = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
        if (scrolls && n.scrollHeight > n.clientHeight + 1) {
          host = n;
          break;
        }
      }
      const box = (el) => {
        if (el == null) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, right: r.right, width: r.width };
      };
      return { host: box(host), pane: box(pane), col: box(colEl) };
    }, shellSel);

  const widthBefore = (await col.boundingBox())?.width ?? 0;
  expect(widthBefore).toBe(768);

  const before = await readScrollLayer();
  // ⑤ 守卫：走链找得到「真在滚」的祖先才算确有溢出——找不到即 ① 复现
  expect(before.host).not.toBeNull();

  // ② 滚动层是面板体而非窄列：右缘对齐面板右缘，且比窄列宽
  expect(before.host?.right).toBeCloseTo(before.pane?.right ?? -1, 0);
  expect(before.host?.width ?? 0).toBeGreaterThan(before.col?.width ?? 0);

  await page.mouse.move(720, 400);
  for (let i = 0; i < 12; i++) await page.mouse.wheel(0, 400);

  const last = page.getByTestId('resource-row').last();
  await expect(last).toBeInViewport();
  const box = await last.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.y).toBeGreaterThanOrEqual(0);
  expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(733);

  // 几何未漂移 + 滚动没跑到外层
  expect((await col.boundingBox())?.width).toBe(widthBefore);
  // the sheet sits 10px below the viewport top; the Paper top bar is 56px
  const topbar = await page.getByTestId('page-topbar').boundingBox();
  expect(topbar?.y).toBe(10);
  expect(topbar?.height).toBe(56);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
