import { expect, type Page, test } from '@playwright/test';

// XMON-57 看板筛选面收口：顶栏左侧 = 生效筛选条（有筛选才有条），右侧
// 动作区恰好一钮 = 无底色「筛选」钮，两轴（仓库 / 类型）同住一个 anchored
// 面板——#445 的「左仓库 chip 组 + 右类型 popover」双入口撤除（逐个点选
// 的两个来源）。#636 行形照参考站（todos.dev）实测对齐：行首 16px 圆角
// checkbox（选中 indigo 实底白勾）、计数仅有命中时画在右端、全选行（三态
// checkbox + 全选，满选再点 = 清本维）居行表首、反选挂该行右端；维度标题行
// 留标题 + 已选读数；「仅此」hover 现形与计数共右端槽；选项超阈值才出搜索框。
// 命中语义未变：双轴 = 仓库 AND 类型；类型轴沿用 #403 裁决（OR 并集 +
// 无标签恒可见），仓库轴 = 精确集成员（无豁免）。筛选态进 URL
// （?projects= / ?tags=，replace 写回不刷历史，其余参保留），空结果 =
// 板级明示文案 + 摘要 + 清除钮（清双轴）。
// 数据面：fixture 命名场景 board-tags / board-tags-empty（类型轴）与
// board-repos（三项目三卡，仓库轴 + 双轴组合）。
// 每条用例钉一个失败方式：
// 1. 无 projectNames 的旧场景渲染仓库面（视觉漂移 + 死控件面）；
//    右动作区非「恰好一钮」或钮带实底材质；「+ 任务」复活
// 2. 筛选钮点开面板词表不全 / aria-expanded 不翻转
// 3. 类型单选不收窄 / 无标签卡被滤隐 / URL 不带或吞掉 scenario 参 /
//    列计数不联动
// 4. 类型多选实现成 AND 而非 OR；URL 序不规整；点选后面板即关
//    （多选必须保持开）；选中态不可见
// 5. 再点已选词不解除（切换语义丢失）
// 6. 弹层家族律破缺：Escape / 外点 / 重点触发钮三路必须都能关
// 7. 带参直达不预选（刷新/分享丢筛选态）
// 8. 词表外名在 URL 里成活选（非法态渲染）
// 9. 仓库段渲染不全（项目集 + 读数 + 计数）
// 10. 仓库单选不收窄 / 他项目卡残留（仓库轴没有「无标签恒可见」——
//     每卡必属一项目，收窄 = 精确集成员判定）
// 11. 仓库多选非并集；URL 序 = 字典序规范序（与点击序无关）
// 12. 仓库切换/清除语义丢失；带参直达不预选；未知项目 id 误配或崩溃
// 13. 双轴组合非 AND 交集收窄（同面板内两轴，不需中途收层）
// 14. 空结果渲成空白看板或误导性列空文案；清除钮不清双轴
// 15. tagged 卡不渲染标签 chip / 无标签卡留占位 / chip 挤压既有元素
//     几何（row1 高、卡高、seq 右锚漂移）
// 16. 批次键（全选行 / 反选）无效或读数不跟；「仅此」不塌成单值
// 17. 计数用了本轴自身收窄（勾一个选项后其余全变 0，失去导航意义）
// 18. 生效筛选条不显形 / 点条不清该维度 / 清除全条不清双轴
// #943/#910 重钉：选项 = 既有 [data-project]/[data-tag] 属性载体、维度段 =
// section[data-dimension]、全选 = role=checkbox（Base UI 官方件，三态走
// aria-checked=mixed，替代 toHaveJSProperty('indeterminate')）、反选/仅此/
// 清除 = role+name 一级、触发钮 = button「筛选」、弹层 = dialog「筛选」
// （Base UI Popup 自带 role）、生效条 = header 内 [data-dimension]、计数
// 徽章 = data-testid（filter-count/option-count/column-count，二级：裸数字
// 无 role）、板级空态 = 一级 text。TagChip 无 props 透传（共享件不动），
// chip 载体 = inline background-color 属性钉（tag-chip.tsx 文档契约：数据
// 色走 inline style）+ exact text。断言语义与数值不动。

const TAGS = '/app?scenario=board-tags';
const EMPTY = '/app?scenario=board-tags-empty';
const REPOS = '/app?scenario=board-repos';
/** board-repos 场景的 canon 项目 id（fixtures.ts PROJECT_ID 同值字面量，
 *  dead-buttons/avatar-dicebear 同款先例）。 */
const PRJ_CANON = 'ZAQczKCu0MOAzC1ZqcFlX';

const card = (page: Page, id: string) => page.locator(`[data-todo-id="${id}"]`);
/** 两轴同住一个面板，data 属性区分轴：仓库行 data-project（素文本，
 *  项目无色彩位），类型行 data-tag（选中态渲染词表配色 TagChip）。 */
const option = (page: Page, value: string) =>
  page.locator(`[data-project="${value}"], [data-tag="${value}"]`);
const repoOption = (page: Page, id?: string) =>
  page.locator(id == null ? '[data-project]' : `[data-project="${id}"]`);
const typeOption = (page: Page, name: string) => page.locator(`[data-tag="${name}"]`);
const dim = (page: Page, key: 'repo' | 'type') =>
  page.locator(`section[data-dimension="${key}"]`);
/** 全选行（行表首）的 checkbox（Base UI 官方件 role=checkbox）：三态 =
 *  aria-checked false / mixed / true；空选点击 = 全选，满选点击 = 清本维
 *  （清除钮撤除后的清除路径之一）。 */
const dimAll = (page: Page, key: 'repo' | 'type') => dim(page, key).getByRole('checkbox');
/** 反选：全选行右端链接键，选集取词表补集。 */
const dimInvert = (page: Page, key: 'repo' | 'type') =>
  dim(page, key).getByRole('button', { name: '反选' });
const dimReadout = (page: Page, key: 'repo' | 'type') => dim(page, key).getByText(/已选 \d/);
const optionCount = (page: Page, value: string) =>
  option(page, value).getByTestId('option-count');
/** 「仅此」：静息透明（opacity-0）、hover/focus 现形——断言前先 hover。
 *  钮是选项的行内兄弟（行容器无 role），经父级 scope 走 role+name。 */
const optionOnly = (page: Page, value: string) =>
  option(page, value).locator('..').getByRole('button', { name: '仅此' });
/** 生效筛选条住在顶栏（<header>，banner role）；维度段住在弹层——同用
 *  data-dimension，故 chip 一律 header scope。 */
const filterChip = (page: Page, key: 'repo' | 'type') =>
  page.locator(`header [data-dimension="${key}"]`);
const chipsBar = (page: Page) => page.locator('header [data-dimension]');
const chipsClear = (page: Page) =>
  page.locator('header').getByRole('button', { name: '清除全部' });
// exact：生效筛选条 chip 的 aria-label（清除…筛选）含「筛选」子串，
// 子串匹配会在有 chip 时撞 strict mode（#943 实测）
const typeBtn = (page: Page) => page.getByRole('button', { name: '筛选', exact: true });
const typePopover = (page: Page) => page.getByRole('dialog', { name: '筛选' });
const count = (page: Page, column: string) =>
  page.locator(`[data-column="${column}"]`).getByTestId('column-count');
const filterEmpty = (page: Page) => page.getByText('没有匹配筛选条件的任务');
/** TagChip 载体：数据色 inline style 是 tag-chip.tsx 的文档契约（运行期
 *  记录字段进不了类名编译面）——属性钉 + exact text，不钉类名/data-slot。 */
const CHIP = '[style*="background-color"]';

async function openTypePopover(page: Page) {
  await typeBtn(page).click();
  await expect(typePopover(page)).toBeVisible();
}

test('旧场景（无 projectNames）不渲染仓库面；右动作区恰好一钮 = 无底色类型钮；+任务 不存在', async ({
  page,
}) => {
  await page.goto('/app?scenario=01');
  // 旧仓库筛选条的语义负钉：无筛选时顶栏不挂任何维度 chip
  await expect(chipsBar(page)).toHaveCount(0);
  const banner = page.getByRole('banner');
  await expect(banner.getByRole('button')).toHaveCount(1);
  await expect(typeBtn(page)).toBeVisible();
  // 「+ 任务」全族非存在（第三入口撤除，防单面复活漏网）——顶栏内不得
  // 出现任何名含「任务」的钮（侧栏 新任务 行在 banner 外，不受累）
  await expect(banner.getByRole('button', { name: /任务/ })).toHaveCount(0);
  // 无底色材质：ghost 变体，rest 态背景透明（与主操作实底材质区分）
  await expect(typeBtn(page)).toHaveAttribute('data-variant', 'ghost');
  const bg = await typeBtn(page).evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(['rgba(0, 0, 0, 0)', 'transparent']).toContain(bg);
});

test('类型钮点开 anchored popover：词表 6 词全、aria-expanded 翻转', async ({ page }) => {
  await page.goto(TAGS);
  await expect(typeBtn(page)).toHaveAttribute('aria-expanded', 'false');
  await openTypePopover(page);
  await expect(typeBtn(page)).toHaveAttribute('aria-expanded', 'true');
  // 全选行恒在（行表首）+ 反选挂其右端；空选态 = 三态 checkbox 的 unchecked
  await expect(dimAll(page, 'type')).toBeVisible();
  await expect(dimAll(page, 'type')).toHaveAttribute('aria-checked', 'false');
  await expect(dimInvert(page, 'type')).toBeVisible();
  await expect(page.locator('[data-tag]')).toHaveCount(6);
  for (const name of ['bug', 'feature', 'improvement', 'refactor', 'docs', 'chore']) {
    await expect(typeOption(page, name)).toBeVisible();
    await expect(typeOption(page, name)).toHaveAttribute('aria-selected', 'false');
  }
});

test('类型单选收窄：命中卡可见、其余 tagged 隐、无标签恒可见；URL 带参保 scenario；列计数联动', async ({
  page,
}) => {
  await page.goto(TAGS);
  await openTypePopover(page);
  await typeOption(page, 'bug').click();
  await expect(page).toHaveURL(/[?&]tags=bug(&|$)/);
  expect(page.url()).toContain('scenario=board-tags');
  // 触发钮上的计数徽章 = 收起态的选中提示（弹层不开也读得出筛选在生效）
  await expect(page.getByTestId('filter-count')).toHaveText('1');
  await expect(card(page, 'tagfilter-bug')).toBeVisible();
  await expect(card(page, 'tagfilter-docs')).toHaveCount(0);
  // 无标签恒可见（裁决面）
  await expect(card(page, 'tagfilter-plain')).toBeVisible();
  await expect(count(page, 'todo')).toHaveText('1');
  await expect(count(page, 'building')).toHaveText('0');
  await expect(count(page, 'pending')).toHaveText('1');
});

test('类型多选 = OR 并集；URL 序 = 词表规范序；点选保持弹层开；选中态 chip 可见', async ({
  page,
}) => {
  await page.goto(TAGS);
  await openTypePopover(page);
  // 先点 docs 再点 bug——URL 仍按词表序 bug 在前
  await typeOption(page, 'docs').click();
  await typeOption(page, 'bug').click();
  await expect(page).toHaveURL(/[?&]tags=bug,docs(&|$)/);
  // 多选弹层保持开（点选即关会把多选取缔成单选）
  await expect(typePopover(page)).toBeVisible();
  await expect(page.getByTestId('filter-count')).toHaveText('2');
  // 选中态可见：选中行渲染词表配色 TagChip，未选行不渲染
  await expect(typeOption(page, 'bug')).toHaveAttribute('aria-selected', 'true');
  await expect(typeOption(page, 'bug').locator(CHIP)).toBeVisible();
  await expect(typeOption(page, 'bug').locator(CHIP)).toHaveText('bug');
  await expect(typeOption(page, 'chore')).toHaveAttribute('aria-selected', 'false');
  await expect(typeOption(page, 'chore').locator(CHIP)).toHaveCount(0);
  // 并集：两张 tagged 卡 + 无标签卡全在
  await expect(card(page, 'tagfilter-bug')).toBeVisible();
  await expect(card(page, 'tagfilter-docs')).toBeVisible();
  await expect(card(page, 'tagfilter-plain')).toBeVisible();
});

test('再点已选词 = 解除该词（切换语义）', async ({ page }) => {
  await page.goto(TAGS);
  await openTypePopover(page);
  await typeOption(page, 'bug').click();
  await typeOption(page, 'docs').click();
  await expect(page).toHaveURL(/[?&]tags=bug,docs(&|$)/);
  await typeOption(page, 'docs').click();
  await expect(page).toHaveURL(/[?&]tags=bug(&|$)/);
  await expect(typeOption(page, 'docs')).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByTestId('filter-count')).toHaveText('1');
  await expect(card(page, 'tagfilter-docs')).toHaveCount(0);
  await expect(card(page, 'tagfilter-bug')).toBeVisible();
});

test('弹层家族律：Escape / 外点 / 重点触发钮三路关闭', async ({ page }) => {
  await page.goto(TAGS);
  // Escape
  await openTypePopover(page);
  await page.keyboard.press('Escape');
  await expect(typePopover(page)).not.toBeVisible();
  // 外点：透明 click-catcher 承接
  await openTypePopover(page);
  await page.mouse.click(600, 400);
  await expect(typePopover(page)).not.toBeVisible();
  // 重点触发钮：落点被家族 click-catcher 承接——用户可见效果 = 收起
  await openTypePopover(page);
  await typeBtn(page).click({ force: true });
  await expect(typePopover(page)).not.toBeVisible();
});

test('类型带参直达 = 预选（刷新/分享不丢；弹层内选中态可见）', async ({ page }) => {
  await page.goto(`${TAGS}&tags=docs`);
  await expect(card(page, 'tagfilter-docs')).toBeVisible();
  await expect(card(page, 'tagfilter-bug')).toHaveCount(0);
  await expect(card(page, 'tagfilter-plain')).toBeVisible();
  await openTypePopover(page);
  await expect(typeOption(page, 'docs')).toHaveAttribute('aria-selected', 'true');
  await expect(typeOption(page, 'bug')).toHaveAttribute('aria-selected', 'false');
});

test('URL 里的词表外名被丢弃：无选中态、全量可见', async ({ page }) => {
  await page.goto(`${TAGS}&tags=nope`);
  await expect(card(page, 'tagfilter-bug')).toBeVisible();
  await expect(card(page, 'tagfilter-docs')).toBeVisible();
  await expect(card(page, 'tagfilter-plain')).toBeVisible();
  await openTypePopover(page);
  for (const name of ['bug', 'docs']) {
    await expect(typeOption(page, name)).toHaveAttribute('aria-selected', 'false');
  }
});

test('仓库段 = 项目选项集 + 计数 + 读数；默认全活、URL 无参、无生效筛选条', async ({
  page,
}) => {
  await page.goto(REPOS);
  // 无筛选时顶栏左侧不画任何条——「全部」不是一种筛选，不该有条可摘
  await expect(chipsBar(page)).toHaveCount(0);
  await expect(page.getByTestId('filter-count')).toHaveCount(0);
  expect(page.url()).not.toContain('projects=');
  await openTypePopover(page);
  await expect(repoOption(page)).toHaveCount(3);
  for (const id of [PRJ_CANON, 'r2-inventory', 'r4-quiet']) {
    await expect(repoOption(page, id)).toHaveAttribute('aria-selected', 'false');
  }
  await expect(dimReadout(page, 'repo')).toHaveText('已选 0/3');
  // 计数 = 另一轴（类型）收窄后该项目的卡数；两轴皆空 = 各项目全量卡数。
  // 零命中不画计数（参考站形：右端计数位仅在有命中时出现）
  await expect(optionCount(page, PRJ_CANON)).toHaveText('2');
  await expect(optionCount(page, 'r2-inventory')).toHaveText('1');
  await expect(optionCount(page, 'r4-quiet')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // 三卡各就各位：A(r3) 待开始 / B(r2) 执行中 / C(r3) 待处理
  await expect(card(page, 'repofilter-a')).toBeVisible();
  await expect(card(page, 'repofilter-b')).toBeVisible();
  await expect(card(page, 'repofilter-c')).toBeVisible();
});

test('仓库单选收窄：命中项目卡可见、他项目卡隐（无「无标签恒可见」豁免）；URL 带参；列计数联动', async ({
  page,
}) => {
  await page.goto(REPOS);
  await openTypePopover(page);
  await repoOption(page, 'r2-inventory').click();
  await expect(page).toHaveURL(new RegExp(`[?&]projects=r2-inventory(&|$)`));
  expect(page.url()).toContain('scenario=board-repos');
  await expect(repoOption(page, 'r2-inventory')).toHaveAttribute('aria-selected', 'true');
  await expect(dimReadout(page, 'repo')).toHaveText('已选 1/3');
  // 面板开着时 click-catcher 承接页面上的一切点击——先收层再看板面
  await page.keyboard.press('Escape');
  await expect(typePopover(page)).not.toBeVisible();
  await expect(card(page, 'repofilter-b')).toBeVisible();
  // C 卡无标签也隐——仓库轴是精确集成员判定
  await expect(card(page, 'repofilter-a')).toHaveCount(0);
  await expect(card(page, 'repofilter-c')).toHaveCount(0);
  await expect(count(page, 'todo')).toHaveText('0');
  await expect(count(page, 'building')).toHaveText('1');
  await expect(count(page, 'pending')).toHaveText('0');
});

test('仓库多选 = OR 并集；URL 序 = 字典序规范序（与点击序无关）；面板保持开', async ({
  page,
}) => {
  await page.goto(REPOS);
  await openTypePopover(page);
  // 先点 r2 再点 canon（字典序 canon 'Z…' < 'r…'，URL 仍 canon 在前）
  await repoOption(page, 'r2-inventory').click();
  await repoOption(page, PRJ_CANON).click();
  await expect(page).toHaveURL(
    new RegExp(`[?&]projects=${PRJ_CANON},r2-inventory(&|$)`),
  );
  // 点选即关会把多选取缔成单选——面板必须保持开
  await expect(typePopover(page)).toBeVisible();
  await expect(dimReadout(page, 'repo')).toHaveText('已选 2/3');
  await page.keyboard.press('Escape');
  await expect(card(page, 'repofilter-a')).toBeVisible();
  await expect(card(page, 'repofilter-b')).toBeVisible();
  await expect(card(page, 'repofilter-c')).toBeVisible();
});

test('仓库再点已选 = 解除；全选行满选再点 = 清本维（清除钮撤除后的清除路径）', async ({
  page,
}) => {
  await page.goto(REPOS);
  await openTypePopover(page);
  await repoOption(page, PRJ_CANON).click();
  await repoOption(page, 'r2-inventory').click();
  await repoOption(page, 'r2-inventory').click();
  await expect(page).toHaveURL(new RegExp(`[?&]projects=${PRJ_CANON}(&|$)`));
  await expect(repoOption(page, 'r2-inventory')).toHaveAttribute('aria-selected', 'false');
  // 部分选中 = 全选行三态的 mixed（#943：官方件 aria-checked 载体）
  await expect(dimAll(page, 'repo')).toHaveAttribute('aria-checked', 'mixed');
  // 满选再点全选行 = 清本维：先点满，再点一次回空集（删参）
  await dimAll(page, 'repo').click();
  await expect(dimAll(page, 'repo')).toHaveAttribute('aria-checked', 'true');
  await dimAll(page, 'repo').click();
  await expect(page).not.toHaveURL(/[?&]projects=/);
  await expect(dimReadout(page, 'repo')).toHaveText('已选 0/3');
  await expect(dimAll(page, 'repo')).toHaveAttribute('aria-checked', 'false');
  // 计数回满量：清空本轴后 canon 段读数回到全量 2（清除不残留收窄）
  await expect(optionCount(page, PRJ_CANON)).toHaveText('2');
  await page.keyboard.press('Escape');
  await expect(card(page, 'repofilter-a')).toBeVisible();
  await expect(card(page, 'repofilter-b')).toBeVisible();
  await expect(card(page, 'repofilter-c')).toBeVisible();
});

test('仓库段「全部选中」= 写满项目源（读数 N/N）；清除 = 删参', async ({ page }) => {
  await page.goto(REPOS);
  await openTypePopover(page);
  await dimAll(page, 'repo').click();
  await expect(page).toHaveURL(
    new RegExp(`[?&]projects=${PRJ_CANON},r2-inventory,r4-quiet(&|$)`),
  );
  // 读数反映按键语义（全选 = N/N，不是 0/N）——即使可见集与空选集相同
  await expect(dimReadout(page, 'repo')).toHaveText('已选 3/3');
  await page.keyboard.press('Escape');
  await expect(card(page, 'repofilter-a')).toBeVisible();
  await expect(card(page, 'repofilter-b')).toBeVisible();
  await expect(card(page, 'repofilter-c')).toBeVisible();
});

test('仓库带参直达 = 预选；未知项目 id 不误配 = 板级空态', async ({ page }) => {
  await page.goto(`${REPOS}&projects=r2-inventory`);
  await openTypePopover(page);
  await expect(repoOption(page, 'r2-inventory')).toHaveAttribute('aria-selected', 'true');
  await expect(dimReadout(page, 'repo')).toHaveText('已选 1/3');
  await page.keyboard.press('Escape');
  await expect(card(page, 'repofilter-b')).toBeVisible();
  await expect(card(page, 'repofilter-a')).toHaveCount(0);
  // 未知 id（已删项目/脏 URL）：不命中任何卡，走板级空态而非空白看板
  await page.goto(`${REPOS}&projects=p-gone`);
  await expect(filterEmpty(page)).toBeVisible();
  await expect(page.locator('[data-column]')).toHaveCount(0);
});

test('零卡项目选中 = 板级空态明示 + 摘要；清除回全量', async ({ page }) => {
  await page.goto(REPOS);
  await openTypePopover(page);
  await repoOption(page, 'r4-quiet').click();
  await page.keyboard.press('Escape');
  await expect(filterEmpty(page)).toBeVisible();
  // 空态带生效摘要——用户读得出「是谁把它清空的」
  await expect(page.getByText(/^筛选生效：/)).toBeVisible();
  await expect(page.locator('[data-column]')).toHaveCount(0);
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page).not.toHaveURL(/[?&]projects=/);
  await expect(page.locator('[data-column]')).toHaveCount(4);
  await expect(card(page, 'repofilter-a')).toBeVisible();
});

test('类型轴空结果态沿用：板级明示 + 清除（board-tags-empty）', async ({ page }) => {
  await page.goto(EMPTY);
  await expect(card(page, 'tagfilter-e-bug')).toBeVisible();
  await openTypePopover(page);
  await typeOption(page, 'chore').click();
  await expect(page).toHaveURL(/[?&]tags=chore(&|$)/);
  // 多选弹层保持开——板级空态在层后成形；收层（家族律 Escape）再操作清除钮
  await page.keyboard.press('Escape');
  await expect(typePopover(page)).not.toBeVisible();
  await expect(filterEmpty(page)).toBeVisible();
  await expect(page.locator('[data-column]')).toHaveCount(0);
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page).not.toHaveURL(/[?&]tags=/);
  await expect(page.locator('[data-column]')).toHaveCount(4);
  await expect(card(page, 'tagfilter-e-bug')).toBeVisible();
  await expect(card(page, 'tagfilter-e-docs')).toBeVisible();
});

test('双轴组合 = AND 收窄；组合见底 = 空态；清除钮清双轴', async ({ page }) => {
  await page.goto(REPOS);
  // 两轴同住一个面板——一个开合周期内点完两轴，中途不收层
  await openTypePopover(page);
  // r3 + bug：A(r3·bug) 命中；C(r3·无标签) 类型轴恒可见；B(r2) 仓库轴隐
  await repoOption(page, PRJ_CANON).click();
  await typeOption(page, 'bug').click();
  await expect(page).toHaveURL(new RegExp(`[?&]projects=${PRJ_CANON}`));
  await expect(page).toHaveURL(/[?&]tags=bug(&|$)/);
  // 计数口径 = **另一轴**收窄后，本轴自身不参与：canon 已选中但读数仍是 2
  //（本轴参与就会归零）；r2 因类型轴 bug 收窄而落 0（另一轴确实生效）——
  // 零命中不画计数，故后两者断言计数位缺席而非文本 0
  await expect(optionCount(page, PRJ_CANON)).toHaveText('2');
  await expect(optionCount(page, 'r2-inventory')).toHaveCount(0);
  await expect(optionCount(page, 'r4-quiet')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(typePopover(page)).not.toBeVisible();
  await expect(card(page, 'repofilter-a')).toBeVisible();
  await expect(card(page, 'repofilter-c')).toBeVisible();
  await expect(card(page, 'repofilter-b')).toHaveCount(0);
  // 换成 r2 + bug 组合见底（B 是 docs）：板级空态
  await openTypePopover(page);
  await repoOption(page, PRJ_CANON).click(); // 解除 canon
  await repoOption(page, 'r2-inventory').click();
  await page.keyboard.press('Escape');
  await expect(filterEmpty(page)).toBeVisible();
  // 清除钮一次清双轴
  await page.getByRole('button', { name: '清除筛选' }).click();
  await expect(page).not.toHaveURL(/[?&]projects=/);
  await expect(page).not.toHaveURL(/[?&]tags=/);
  await expect(page.locator('[data-column]')).toHaveCount(4);
  await expect(card(page, 'repofilter-a')).toBeVisible();
  await expect(card(page, 'repofilter-b')).toBeVisible();
  await expect(card(page, 'repofilter-c')).toBeVisible();
});

test('类型段批次键：全部选中 = 写满词表（读数 N/N，非 0/N）；「仅此」塌成单值', async ({
  page,
}) => {
  await page.goto(TAGS);
  await openTypePopover(page);
  await expect(dimReadout(page, 'type')).toHaveText('已选 0/6');
  // 短词表不出搜索框（阈值 8）——固定 6 词下搜索是纯噪音
  await expect(dim(page, 'type').getByRole('textbox')).toHaveCount(0);
  await dimAll(page, 'type').click();
  // 全选与「无筛选」在命中上等价（无标签恒可见），但按键语义要读得出：
  // 用户按的是「全选」，读数就该是 6/6。URL 序 = 字典序规范序。
  await expect(page).toHaveURL(/[?&]tags=bug,chore,docs,feature,improvement,refactor(&|$)/);
  await expect(dimReadout(page, 'type')).toHaveText('已选 6/6');
  await page.keyboard.press('Escape');
  await expect(card(page, 'tagfilter-bug')).toBeVisible();
  await expect(card(page, 'tagfilter-plain')).toBeVisible();
  // 「仅此」= 把选集塌成单值（多选轴的逆向操作；静息透明，hover 现形）
  await openTypePopover(page);
  await optionOnly(page, 'chore').hover();
  await optionOnly(page, 'chore').click();
  await expect(page).toHaveURL(/[?&]tags=chore(&|$)/);
  await expect(dimReadout(page, 'type')).toHaveText('已选 1/6');
  // 反选 = 选集取词表补集（1/6 → 5/6，URL 序 = 字典序规范序）
  await dimInvert(page, 'type').click();
  await expect(page).toHaveURL(/[?&]tags=bug,docs,feature,improvement,refactor(&|$)/);
  await expect(dimReadout(page, 'type')).toHaveText('已选 5/6');
  await expect(dimAll(page, 'type')).toHaveAttribute('aria-checked', 'mixed');
});

test('生效筛选条：只列生效维度、点条清该维度、两轴齐时出「清除全部」', async ({ page }) => {
  await page.goto(REPOS);
  await expect(chipsBar(page)).toHaveCount(0);
  await openTypePopover(page);
  await repoOption(page, PRJ_CANON).click();
  await page.keyboard.press('Escape');
  await expect(filterChip(page, 'repo')).toBeVisible();
  await expect(filterChip(page, 'repo')).toContainText('仓库');
  await expect(filterChip(page, 'type')).toHaveCount(0);
  await expect(page.getByTestId('filter-count')).toHaveText('1');
  // 单条时不出「清除全部」——没有第二条可清
  await expect(chipsClear(page)).toHaveCount(0);
  await openTypePopover(page);
  await typeOption(page, 'bug').click();
  await page.keyboard.press('Escape');
  await expect(filterChip(page, 'type')).toBeVisible();
  await expect(chipsClear(page)).toBeVisible();
  await expect(page.getByTestId('filter-count')).toHaveText('2');
  // 点条 = 只清该维度，另一维度不动
  await filterChip(page, 'repo').click();
  await expect(page).not.toHaveURL(/[?&]projects=/);
  await expect(page).toHaveURL(/[?&]tags=bug(&|$)/);
  await expect(filterChip(page, 'repo')).toHaveCount(0);
  // 「清除全部」= 双轴齐清
  await openTypePopover(page);
  await repoOption(page, PRJ_CANON).click();
  await page.keyboard.press('Escape');
  await chipsClear(page).click();
  await expect(page).not.toHaveURL(/[?&]tags=/);
  await expect(page).not.toHaveURL(/[?&]projects=/);
  await expect(chipsBar(page)).toHaveCount(0);
  await expect(page.getByTestId('filter-count')).toHaveCount(0);
});

test('任务卡渲染标签 chip：词表配色、无标签零占位、卡面 chip 20px 默认档', async ({ page }) => {
  await page.goto(TAGS);
  // tagged 卡：chip 在场、文本 = 词表名、底色 = 词表色（bug #ef4444）
  const bugChip = card(page, 'tagfilter-bug').locator(CHIP);
  await expect(bugChip).toBeVisible();
  await expect(bugChip).toHaveText('bug');
  await expect(bugChip).toHaveCSS('background-color', 'rgb(239, 68, 68)');
  await expect(card(page, 'tagfilter-docs').locator(CHIP)).toHaveText('docs');
  // 无标签卡：零占位（chip 不渲染，不是隐藏空盒）——任何词表名都不成 chip
  await expect(card(page, 'tagfilter-plain').locator(CHIP)).toHaveCount(0);
  await expect(
    card(page, 'tagfilter-plain').getByText(/^(bug|feature|improvement|refactor|docs|chore)$/),
  ).toHaveCount(0);
  // 几何护栏（#1006 R5 实审裁决重钉，用户 2026-10-08，与 L1 裁决①一致）：
  // row-flush 16px 消费点覆写收编 registry Badge 默认 20px——两尺寸不并存。
  // 回流契约：tagged 卡 row1 随 chip 长到 20（min-h-4 行盒），卡高比无标签
  // 卡高 4px；无标签卡 row1 保持 16 节奏；seq 右锚跨卡一致（不挤压既有元素）
  const geo = await page.evaluate(() => {
    const probe = (id: string) => {
      const el = document.querySelector(`[data-todo-id="${id}"]`)!;
      // 身份行 = 卡根首个子元素；序号 = 「#数字」文本徽标；chip = inline
      // 数据色件（类名载体退役，#943/#910）
      const row1 = el.firstElementChild!;
      const seq = [...el.querySelectorAll('span')].find((sp) =>
        /^#\d+$/.test(sp.textContent?.trim() ?? ''),
      )!;
      const chip = el.querySelector('[style*="background-color"]');
      return {
        cardH: el.getBoundingClientRect().height,
        row1H: row1.getBoundingClientRect().height,
        seqRight: seq.getBoundingClientRect().right,
        cardRight: el.getBoundingClientRect().right,
        chipH: chip?.getBoundingClientRect().height ?? null,
      };
    };
    return { tagged: probe('tagfilter-bug'), plain: probe('tagfilter-plain') };
  });
  // 亚像素口径：getBoundingClientRect 返回浮点布局值，CI 量 20px 档会得
  // 19.99999237060547（#1281 实测）。护栏钉的是像素档位（20 挡 19/16），
  // 不是 float 末位——对齐 chief-panel.spec 的 toBeCloseTo(…, 0)（±0.5px）。
  expect(geo.tagged.row1H).toBeCloseTo(20, 0);
  expect(geo.plain.row1H).toBeCloseTo(16, 0);
  expect(geo.tagged.chipH).toBeCloseTo(20, 0);
  // R5 回流：tagged 卡随 20px chip 长高 4px（旧「卡高一致」契约由裁决作废）
  expect(geo.tagged.cardH - geo.plain.cardH).toBeCloseTo(4, 0);
  // seq 保持右锚（同一列宽网格下两卡右缘差一致）
  expect(geo.tagged.cardRight - geo.tagged.seqRight).toBeCloseTo(
    geo.plain.cardRight - geo.plain.seqRight,
    0,
  );
});
