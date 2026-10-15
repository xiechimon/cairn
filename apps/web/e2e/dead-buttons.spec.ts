import { expect, test } from '@playwright/test';

// Issue #149: 零散死钮处置 + feedback 页整页移除。每条断言钉一个票面项的
// 失败方式：
// 1. feedback 整页移除 — 旧路由必须重定向 /app（catch-all 口径，01 §4.1）；
//    user-menu「反馈」行随页全除；「新功能/快捷键」行同律隐去（#163 修订：
//    无 local-first 对象面），余下 帐号/API 密钥/MCP 三行接真导航。
// 2. 看板指南钮 — #363 全族撤除（? 钮 + BoardGuide 弹层 + HelpCircle 图标
//    不再渲染），topbar 右动作区恰好一钮（非存在断言，sched-empty-docs
//    同律；#445 起该钮 = 无底色类型过滤钮，「+ 任务」撤除改指侧栏行）。
// 3. project 页 — 「导出」钮不再渲染（wontfix：无导出后端面）；分支 chip
//    静态化（非 button，[设计] 注记在实现位）；文件|历史 分段真接线
//    （历史 = 提交历史行，fixture 数据源 = ProjectContent.commits）。
// 4. schedules 空态「查看文档」钮不再渲染（wontfix：local-first 无文档站）。
// 6. doc-pane 变更▾ — 接 #67 文档类型选族律：点击开 listbox（变更 ✓），
//    Esc 关；diff 模式同钮显示 方案▾ 同律。
// 7. machines 行内动作图标 — #222 出账（r8 §3.5 漂移注记）：原站在线机器行
//    右侧三行内动作图标，端点核实测 local-first 无机器管理面（注记在
//    machines-page.tsx 头部），不渲染死钮——行内零 button。
// 8. 语音输入钮 — #304（08 册 C5 裁决）：语音功能不做，composer 工具条与
//    新建任务对话框工具条两处语音钮移除不留死钮（#146 chief 面同律）；
//    与 #146 的差异 = 本票只除语音，添加附件/提及两工具原样保留。
// 9. #307 档 4 外链型四件 wontfix 出账（spec 08 二分律）：api-keys 空态
//    「查看文档」钮、resources 共享空态文档链接、create-agent-dialog 与
//    project-settings 的头像「更换」ink，四处不再渲染。
// 10-14. #306 菜单桩清零（chief 更多 wontfix / schedules 卡片菜单接真 /
//    skills 排序接真 / account-swap wontfix / transcript 折叠接真）。
// 15. #318 桩群校准（更多菜单完成·关闭 / 开始任务统一面 / 查看方案 /
//    任务行导航 / 未保存闸）。
// 16. 详情 transcript 恢复死形移除（#884）：捕获里 copy 旁的 restore 图形
//    无 build 级 rewind 对象面（checkpoint 数据源 per-step、相位机无反向
//    边、daemon restore 无 server 发起派发通道；参考站点击行为未实测
//    r3 §3.5）——#634 律形不带义即 bug，图形与数据字段一并移除，本册钉死。
// 第 5 项（skills 添加技能主钮）已随 spec 13（#367）整体退役——技能改本地
// 目录只读投影，空态主钮不再存在（出账断言并入第 9 项，导航面钉在
// skills-readonly.spec.ts；XMON-114 写面回摆后改名 skills-page.spec.ts）。

// —— 1. feedback 整页移除 ————————————————————————————————————————————————

test('feedback route is gone — old URL redirects to the board', async ({ page }) => {
  await page.goto('/app/feedback');
  await expect(page).toHaveURL('/app');
  await expect(page.locator('[data-route="feedback"]')).toHaveCount(0);
});

test('user menu drops its dead rows — 反馈 (#149), 新功能/快捷键 (#163)', async ({ page }) => {
  await page.goto('/app');
  await page.locator('.sidebar-user').click();
  const menu = page.locator('.user-menu');
  await expect(menu).toBeVisible();
  // 无 local-first 对象即隐去：反馈页已整页移除（#149）；新功能无 whats-new
  // 面、快捷键无快捷键面（#163 隐去裁定，理由随 PR）
  for (const dead of ['反馈', '新功能', '快捷键']) {
    await expect(menu).not.toContainText(dead);
  }
  // 活面齐全：外观分段 + 三条真导航行（#163 接真路由）
  for (const live of ['外观', '帐号', 'API 密钥', 'MCP']) {
    await expect(menu).toContainText(live);
  }
  await expect(menu.locator('a.user-menu-row')).toHaveCount(3);
});

// —— 2. 看板指南钮全族撤除（#363）—————————————————————————————————————————

test('board topbar drops the 看板指南 button — right actions keep exactly one button (#363, #445 改指类型钮)', async ({
  page,
}) => {
  await page.goto('/app');
  // 全族非存在四面钉死（防单面复活漏网）：? 钮、wrap、弹层、aria-label
  await expect(page.locator('.board-guide')).toHaveCount(0);
  await expect(page.locator('.board-guide-wrap')).toHaveCount(0);
  await expect(page.locator('.board-guide-pop')).toHaveCount(0);
  await expect(page.locator('[aria-label="看板指南"]')).toHaveCount(0);
  // #445：右动作区恰好一钮 = 类型过滤钮（撤「+ 任务」、上一钮，数量仍 1）
  const actions = page.locator('.board-topbar-actions');
  await expect(actions).toBeVisible();
  await expect(actions.locator('button')).toHaveCount(1);
  await expect(actions.locator('.board-type-filter')).toBeVisible();
  await expect(actions.locator('.board-new-task')).toHaveCount(0);
});

// —— 2b. #351 列收敛钉：恰 4 列 + 退役列名/收起族不再渲染 ————————————————————

test('board renders exactly the four #351 columns, retired names and collapse family gone', async ({
  page,
}) => {
  await page.goto('/app?scenario=01');
  // 顶栏标题随更名（看板 → 工作台）
  await expect(page.locator('.board-topbar-title')).toHaveText('工作台');
  // 恰 4 列，逐列钉 id ↔ 列名
  await expect(page.locator('.board-column')).toHaveCount(4);
  for (const [id, name] of [
    ['todo', '待开始'],
    ['building', '执行中'],
    ['pending', '待处理'],
    ['done', '已完成'],
  ] as const) {
    await expect(
      page.locator(`.board-column[data-column="${id}"] .board-column-name`),
    ).toHaveText(name);
  }
  // 退役列名不在任何列头（规划中 仍存活于详情 phase chip，此处只钉看板面）
  for (const retired of ['规划中', '待确认', '待验收']) {
    await expect(page.locator('.board-column-name', { hasText: retired })).toHaveCount(0);
  }
  // #147 列收起全家随收敛删除：收起钮/窄条/折叠态均无渲染位
  await expect(page.locator('.board-column-collapse')).toHaveCount(0);
  await expect(page.locator('.board-column-strip')).toHaveCount(0);
  await expect(page.locator('.board-column--collapsed')).toHaveCount(0);
});

// —— 3. project 页三件 ———————————————————————————————————————————————————

test('project files pane: no export button, static branch chip, wired 文件|历史 segment', async ({
  page,
}) => {
  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=r2-24');
  // 导出钮全除（wontfix 注记在实现位）
  await expect(page.locator('.prj-files-share')).toHaveCount(0);
  // 分支 chip 保留静态展示，但不再是可点击控件（[设计] 注记在实现位）
  const chip = page.locator('.prj-branch-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('main');
  expect(await chip.evaluate((el) => el.tagName)).toBe('SPAN');
  // 文件|历史 分段接线：历史 → 提交行渲染、文件树让位；文件 → 还原
  const segTabs = page.locator('.prj-files-seg-tab');
  await expect(segTabs).toHaveCount(2);
  await segTabs.nth(1).click();
  await expect(segTabs.nth(1)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.prj-history-row').first()).toBeVisible();
  await expect(page.locator('.prj-file-row')).toHaveCount(0);
  await segTabs.nth(0).click();
  await expect(segTabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.prj-file-row').first()).toBeVisible();
  await expect(page.locator('.prj-history-row')).toHaveCount(0);
});

// —— 4. schedules 空态 ————————————————————————————————————————————————————

test('schedules empty state drops the 查看文档 button; 新建定时 really opens and saves (#149, #1037)', async ({
  page,
}) => {
  await page.goto('/app/schedules?scenario=11');
  await expect(page.locator('.sched-empty')).toBeVisible();
  await expect(page.locator('.sched-empty-docs')).toHaveCount(0);
  const emptyNew = page.locator('.sched-empty-new');
  await expect(emptyNew).toBeVisible();
  // #1037: 可见不是判据——点下去才算。旧守卫只断言 visible，一个
  // onClick=undefined 的哑钮照样绿。fixture 面禁止哑按钮：点 = 冻结表单
  // 打开；保存 = 会话覆面落卡（deletions.ts 覆面同律，重载还原）。
  await emptyNew.click();
  const dialog = page.getByRole('dialog', { name: '新建定时' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.sched-card')).toHaveCount(1);
  await expect(page.locator('.sched-empty')).toHaveCount(0);
});

test('schedules fixture face: topbar 新建 opens the dialog, freq tabs respond, save lands a card (#1037)', async ({
  page,
}) => {
  await page.goto('/app/schedules?scenario=11');
  await page.locator('.page-new-action').click();
  const dialog = page.getByRole('dialog', { name: '新建定时' });
  await expect(dialog).toBeVisible();
  // 频率 tabs 在冻结面同样是真 tabs：点 每周 选中即跟（旧态 = 受控 value
  // 无 onValueChange，点击不动的死面）。
  await dialog.getByRole('tab', { name: '每周' }).click();
  await expect(dialog.locator('.sched-form-freq-tab[aria-selected="true"]')).toHaveText('每周');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('.sched-card')).toHaveCount(1);
  // 卡面带上了刚选的频率词——保存不是静默吞掉表单态。
  await expect(page.locator('.sched-card')).toContainText('每周运行');
});

// —— 6. doc-pane 变更▾ 型选（#306 校准：行点击 = 选中即关）——————————————————

test('doc pane 变更▾ opens the document-type listbox and closes on Escape', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27');
  const select = page.locator('.doc-select-wrap .doc-pane-select');
  await expect(select).toContainText('变更');
  await select.click();
  // #949 载体：盘 = role menu，行 = menuitemradio（类钉退役）。不钉可及名：
  // Base UI 经 aria-labelledby 把 popup 名字绑到触发钮（压过 aria-label
  // 「面板视图」），名 = 当前视图词随选择漂移；开着的 menu 恒唯一。
  const dropdown = page.getByRole('menu');
  await expect(dropdown).toBeVisible();
  // #366：listbox 首行 = 当前文档型（✓ 行），其后三行 = 右 pane 静止 section
  await expect(dropdown.getByRole('menuitemradio').first()).toContainText('变更');
  await page.keyboard.press('Escape');
  await expect(dropdown).toBeHidden();
});

test('doc pane 型选行 click re-selects the current type and closes (#306)', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27');
  await page.locator('.doc-select-wrap .doc-pane-select').click();
  const dropdown = page.getByRole('menu'); // #949 载体（上一条同注）
  await expect(dropdown).toBeVisible();
  // r5b §3.7：选择器行，非确认入口——选当前型行即关（#366 后首行 = 文档行，
  // 重选 = 留在文档面）
  await dropdown.getByRole('menuitemradio').first().click();
  await expect(dropdown).toBeHidden();
  await expect(page.locator('.detail-right .doc-pane')).toBeVisible();
});

// —— 7. machines 行内动作图标（#222 出账）——————————————————————————————

test('machines rows carry only live controls, no dead inline buttons (#222 出账 + #1108 收窄)', async ({
  page,
}) => {
  await page.goto('/app/resources/machines?scenario=06');
  // 在线机器行在（scenario=06 fixture 含一台 online 机器，行首在线点）。
  // #944/#910 载体：.res-dot → [data-on]；.res-grow → div[data-kind]。
  await expect(page.locator('[data-on]').first()).toBeVisible();
  // #222:r8 §3.5 原站在线机器行右侧三行内动作图标——死钮不渲染（行尾
  // chevron 已随 spec 11 A7 移除）。#1108 起行内唯一 button = 并发上限
  // 选择器触发钮（Popover listbox 形，aria-label 承载语义；真实写路径
  // PATCH /api/machines/{id}，有消费链不是死钮——「零 button」钉随死字段
  // 摘除理由的翻案收窄为「零死钮」）。shell 闸是 switch 不入此数；
  // #1259 fixture 双机（canon 本机 + mea-wsl 远端）各带并发位（max 3）
  // ——每行一个并发上限钮，故 = 2。
  await expect(page.locator('div[data-kind] button')).toHaveCount(2);
  await expect(page.locator('div[data-kind] button[aria-label^="并发上限"]')).toHaveCount(2);
});

// —— 8. 语音输入钮（#304 C5）——————————————————————————————————————————

test('composer toolbar drops the 语音输入 button, keeps attachment + mention', async ({ page }) => {
  // chain 面 confirm v1：composer 确定在场（reject-chain 同路由）
  await page.goto('/app/todo/r8-15?scenario=chain');
  const toolbar = page.locator('.composer-toolbar');
  await expect(toolbar).toBeVisible();
  // #304（08 册 C5）：语音输入功能不做——钮移除不渲染（wontfix 注记在
  // composer.tsx 实现位；总管面同律，附件/提及已在 #732 开闸）。本票唯一
  // 移除对象是语音，添加附件/提及两工具必须原样在场。
  await expect(toolbar.locator('button[aria-label="语音输入"]')).toHaveCount(0);
  await expect(toolbar.locator('button[aria-label="添加附件"]')).toBeVisible();
  await expect(toolbar.locator('button[aria-label="提及"]')).toBeVisible();
});

test('new-task dialog tools drop the 语音输入 button, keep two live tools', async ({ page }) => {
  await page.goto('/app?scenario=01');
  await page.locator('.sidebar-new-task').click();
  // #948/#910 载体：工具簇容器 = data-testid（结构钩子，无 role 可表达）；
  // 钮面 = role+aria-label 一级载体。断言语义逐字不动。
  const tools = page.getByTestId('new-task-tools');
  await expect(tools).toBeVisible();
  // #304（08 册 C5）：同律——语音钮不渲染，工具条收窄为附件+提及两钮
  // （wontfix 注记在 new-task-dialog.tsx 实现位）。
  await expect(tools.getByRole('button', { name: '语音输入' })).toHaveCount(0);
  await expect(tools.getByRole('button')).toHaveCount(2);
  await expect(tools.getByRole('button', { name: '添加附件' })).toBeVisible();
  await expect(tools.getByRole('button', { name: '提及' })).toBeVisible();
});

// —— 9. #307 档 4 外链型 wontfix 出账 ————————————————————————————

test('api-keys empty state drops the 查看文档 button, keeps 新建密钥 (#307)', async ({ page }) => {
  await page.goto('/app/api-keys');
  // #947/#910 载体：.keys-empty → keys-empty testid；.keys-docs 类名钩 →
  // link 文案一级（resource-empty 同款）；.keys-create → 空态内 role=button。
  const keysEmpty = page.getByTestId('keys-empty');
  await expect(keysEmpty).toBeVisible();
  await expect(page.getByRole('link', { name: '查看文档' })).toHaveCount(0);
  await expect(keysEmpty.getByRole('button', { name: '新建密钥' })).toBeVisible();
});

test('resources empty state drops the 查看文档 link (#307); skills 空态主钮 = 新建技能弹窗 (XMON-114)', async ({
  page,
}) => {
  await page.goto('/app/resources/skills?scenario=01');
  // #944/#910 载体：.res-empty → resource-empty testid；.res-doclink 类名钩
  // → link 文案一级；.res-primary → 空态内 role=button。
  const skillsEmpty = page.getByTestId('resource-empty');
  await expect(skillsEmpty).toBeVisible();
  // 共享 EmptyState 件:skills/secrets 两面空态的文档链接一并出账
  // (双面钉,防单面局部复活漏网;mcp 空态归 #368 只读面专钉,见下条)
  await expect(page.getByRole('link', { name: '查看文档' })).toHaveCount(0);
  // XMON-114（spec 13 回摆）:技能页恢复写面——空态主钮开新建弹窗
  // (空态双入口文案钉在 skills-page.spec.ts,弹窗行为钉在 skills-write.spec.ts)
  await expect(skillsEmpty.getByRole('button', { name: '新建技能' })).toHaveText('新建技能');
  await page.goto('/app/resources/secrets?scenario=01');
  const secretsEmpty = page.getByTestId('resource-empty');
  await expect(secretsEmpty).toBeVisible();
  await expect(page.getByRole('link', { name: '查看文档' })).toHaveCount(0);
  await expect(secretsEmpty.getByRole('button', { name: '添加密钥' })).toBeVisible();
});

// spec 13/#368:MCP 页翻转为本地 config 只读面——新建/编辑入口全撤,
// 空态文案即 ~/.claude.json 配置指引(添加钮的替代面)。
test('mcp page is read-only: 无新建入口、行无更多菜单 ink、空态指向 ~/.claude.json (#368)', async ({
  page,
}) => {
  // 空态(scenario 01):无新建钮、无 primary 动作、文案含配置路径。
  await page.goto('/app/resources/mcp-servers?scenario=01');
  await expect(page.getByRole('button', { name: '新建', exact: true })).toHaveCount(0);
  const empty = page.getByTestId('resource-empty');
  await expect(empty).toBeVisible();
  await expect(empty.getByRole('button')).toHaveCount(0);
  await expect(empty.locator('p')).toContainText('~/.claude.json');
  // 行态(scenario 07):只读行,无更多菜单 ink、无弹窗挂载位。
  await page.goto('/app/resources/mcp-servers?scenario=07');
  await expect(page.locator('[data-testid="resource-row"][data-mcp]')).toHaveCount(1);
  await expect(page.locator('[data-testid="resource-row"] button')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '新建', exact: true })).toHaveCount(0);
});

test('create-agent dialog drops the avatar 更换 ink (#307)', async ({ page }) => {
  await page.goto('/app/team?scenario=12');
  await page.getByRole('button', { name: '创建 Agent' }).click();
  // #952/#910 重钉：壳级 .dlg → getByRole(dialog) + 可及名（§5.5）。
  const dialog = page.getByRole('dialog', { name: '创建 agent' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.dlg-agent-swap')).toHaveCount(0);
  // 头像行仍在（静态机器人资产），名称输入与创建主钮不受影响
  // #951/#910 重钉：.dlg-agent-avatar img → agent-avatar testid（img 在
  // loaded 前 aria-hidden，role 钉不到——二级载体；overlays.css 清零）。
  await expect(dialog.getByTestId('agent-avatar').locator('img')).toBeVisible();
  await expect(dialog.getByLabel('名称')).toBeVisible();
});

test('project settings drops the avatar 更换 ink (#307, supersedes the #177 chrome verdict)', async ({
  page,
}) => {
  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c');
  await expect(page.locator('.prj-set-change')).toHaveCount(0);
  // 头像圆标仍在；#177 存续裁决（分支 chip 静态化）不受影响
  await expect(page.locator('.prj-set-avatar')).toBeVisible();
  await expect(page.locator('span.prj-set-branch')).toBeVisible();
});

// —— 10. chief 抽屉「更多」钮（#306 wontfix 出账）———————————————————————

test('chief drawer drops the ⋮ 更多 button — thread view keeps three head actions (#306)', async ({
  page,
}) => {
  await page.goto('/app?scenario=114');
  const drawer = page.locator('.chief-drawer');
  // #950 载体：.chief-head-actions 容器类随 chief.css 退役——动作簇 = 新主题钮
  // 的父行（header 内与 chip 钮平级的 ml-auto 行），计数与三钮顺序语义原样。
  const actions = drawer
    .getByRole('button', { name: '新主题', exact: true })
    .locator('xpath=..')
    .getByRole('button');
  // #306：r8 随拍线程视图五钮中的 ⋮——菜单内容无正典 + server 无线程管理
  // mutation，wontfix 移除（注记在 chief-drawer.tsx 头部）
  await expect(drawer.getByRole('button', { name: '更多', exact: true })).toHaveCount(0);
  // #447：全屏钮随 is-fullscreen 契约作废——头部余三钮（与新线程视图同律）。
  // #1009 A0（ADR 0013 D3）：第三钮 关闭(X) → 最小化(Minus)——悬浮窗律下
  // Esc/X 永不关窗，Minimize + ⌘J 是唯一收起；钮数与顺序语义原样。
  await expect(drawer.getByRole('button', { name: '全屏', exact: true })).toHaveCount(0);
  await expect(actions).toHaveCount(3);
  await expect(actions.nth(0)).toHaveAttribute('aria-label', '新主题');
  await expect(actions.nth(1)).toHaveAttribute('aria-label', '总管设置');
  await expect(actions.nth(2)).toHaveAttribute('aria-label', '最小化');
});

// —— 11. schedules 卡片「更多」菜单（#306 接真）———————————————————————————

test('sched card 更多 opens a menu and deletes the row through the confirm (#306)', async ({
  page,
}) => {
  await page.goto('/app/schedules?scenario=r3-93');
  const card = page.locator('.sched-card');
  await expect(card).toHaveCount(1);
  const more = page.locator('.sched-card-more');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  const menu = page.locator('.sched-card-menu');
  await expect(menu).toBeVisible();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  // 家族律：Esc 关
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  // 删除链：菜单行 → 确认弹层 → 确认 → 卡出列（fixture 覆面）
  await more.click();
  await expect(menu).toBeVisible();
  await menu.locator('.sched-card-menu-row').click();
  // #948/#910 载体：确认层 = role alertdialog（AlertDialogShell 自带
  // role+aria-label）；删除钮 = role+文案一级。
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText('确定删除该定时？此操作不可撤销。');
  await expect(confirm).toContainText('#1');
  await confirm.getByRole('button', { name: '删除' }).click();
  await expect(confirm).toBeHidden();
  await expect(page.locator('.sched-card')).toHaveCount(0);
  // 空态浮现（r7 11 面）
  await expect(page.locator('.sched-empty')).toBeVisible();
});

// —— 12. skills 排序钮（#306 接真）———————————————————————————————————————

test('skills 排序 opens the single-select listbox, picking an option closes it (#306)', async ({
  page,
}) => {
  await page.goto('/app/resources/skills?scenario=08');
  // #944/#910 载体：.res-sort → role=button+文案；.res-sort-menu → role=menu；
  // .res-sort-row → role=menuitemradio（Base UI RadioItem 原生语义）。
  const sort = page.getByRole('button', { name: '排序' });
  await expect(sort).toHaveAttribute('aria-expanded', 'false');
  await sort.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(sort).toHaveAttribute('aria-expanded', 'true');
  // 两行默认/名称，当前项默认 ✓（#854 收编 RadioItem：选中态走原生
  // aria-checked，不再是手搓 aria-selected）
  await expect(menu.getByRole('menuitemradio')).toHaveCount(2);
  await expect(menu.locator('[role="menuitemradio"][aria-checked="true"]')).toHaveText(/默认/);
  // 行点击 = 选中即关（lang-dropdown 律）
  await menu.getByRole('menuitemradio', { name: '名称' }).click();
  await expect(menu).toBeHidden();
  await expect(page.getByTestId('resource-row')).toHaveCount(1);
  // Esc 关（家族律）与重开
  await sort.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

// —— 13. account-swap（#306 wontfix 出账）—————————————————————————————————

test('account drops the 更换 button, keeps the avatar head (#306 wontfix 出账)', async ({
  page,
}) => {
  await page.goto('/app/account?scenario=13');
  await expect(page.locator('.account-swap')).toHaveCount(0);
  await expect(page.locator('.account-avatar img')).toBeVisible();
});

// —— 14. transcript 工具组折叠（#306 接真）———————————————————————————————

test('transcript tool group: 收起 collapses, the footer row re-expands (#306)', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=28');
  // r7 28 展开态：pills + 收起 在
  await expect(page.locator('.chat-tool-pill')).toHaveCount(2);
  const collapse = page.locator('.chat-collapse');
  await expect(collapse).toBeVisible();
  const footer = page.locator('button.chat-row-icons--toggle');
  await expect(footer).toHaveAttribute('aria-expanded', 'true');
  // 收起 → pills 隐、行钮收起态
  await collapse.click();
  await expect(page.locator('.chat-tool-pill')).toHaveCount(0);
  await expect(collapse).toHaveCount(0);
  await expect(footer).toHaveAttribute('aria-expanded', 'false');
  // 收起态 footer 行再点 → 复原（r7 27 ↔ 28 双态互达）
  await footer.click();
  await expect(page.locator('.chat-tool-pill')).toHaveCount(2);
  await expect(collapse).toBeVisible();
});

// —— 15. #318 M7-W2 桩群校准新增 —————————————————————————————————————————

const REVIEW_DETAIL = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27';

test('more menu 完成 opens the accept dialog on the review surface (#318)', async ({ page }) => {
  await page.goto(REVIEW_DETAIL);
  await page.locator('.detail-head-icon--more').click();
  // #948/#910 载体：菜单 = role+name（aria-label 更多），行 = menuitem+文案。
  const menu = page.getByRole('menu', { name: '更多' });
  await expect(menu).toBeVisible();
  const complete = menu.getByRole('menuitem', { name: '完成' });
  await expect(complete).toBeEnabled();
  await complete.click();
  // 完成 = 相位适配动作:review 走既有 accept→merge 链(弹层开、菜单收)
  await expect(menu).toBeHidden();
  await expect(page.getByRole('dialog', { name: '完成任务' })).toBeVisible();
});

test('more menu 关闭 is phase-gated by the server funnel edges (#318)', async ({ page }) => {
  // review 面:review→closed 漏斗无边(归 W3 server 票)→ disabled
  await page.goto(REVIEW_DETAIL);
  await page.locator('.detail-head-icon--more').click();
  await expect(page.getByRole('menuitem', { name: '关闭' })).toBeDisabled();
  // failed 面:failed→closed 现有边 → 放行,点毕回看板(卡片立即隐藏语义)
  await page.goto('/app/todo/r8-12?scenario=54');
  await page.locator('.detail-head-icon--more').click();
  const closeRow = page.getByRole('menuitem', { name: '关闭' });
  await expect(closeRow).toBeEnabled();
  // failed 无完成语义(confirm-and-merge 仅 confirm/review)→ disabled
  await expect(page.getByRole('menuitem', { name: '完成' })).toBeDisabled();
  await closeRow.click();
  await expect(page).toHaveURL('/app');
});

test('todo-phase 开始 fires orchestration directly — no start dialog (#640)', async ({ page }) => {
  // #640 / r14 §5.7：卡片级开始入口 = 单出口直发总管编排回合——#318 的
  // 「先做规划/立即执行 + 指派」选择 dialog 已撤销。fixture 面 inert（无
  // 后端可发），故点 开始 不再弹任何 dialog（选择面消失的回归钉）。
  await page.goto('/app/todo/fresh-probe?scenario=23');
  await page.locator('.detail-head-action').click();
  await expect(page.locator('.overlay-title')).toHaveCount(0);
});

test('failed rerun dialog is the slim single-exit face — no agent selector, no split switch, no plan/run branch (#640)', async ({
  page,
}) => {
  // #640：failed 重跑仍开 dialog，但只剩单出口——#318 的 agent 行选择器、
  // 分用 role=switch、先做规划/立即执行 双分支全部撤销；重跑 = 直发编排回合。
  await page.goto('/app/todo/r8-12?scenario=56');
  await expect(page.locator('.overlay-title')).toHaveText('开始任务');
  await expect(page.locator('.rerun-agent-row')).toHaveCount(0);
  await expect(page.locator('.rerun-switch')).toHaveCount(0);
  await expect(page.locator('.overlay-actions button', { hasText: '先做规划' })).toHaveCount(0);
  await expect(page.locator('.overlay-actions button', { hasText: '立即执行' })).toHaveCount(0);
  // 单出口 = 重跑（scenario 56 无 plan doc → 无 复用方案 第三钮）。
  await expect(page.locator('.overlay-actions button', { hasText: '重跑' })).toBeVisible();
  await expect(page.locator('.overlay-actions button', { hasText: '复用方案' })).toHaveCount(0);
});

test('reuse panel 查看方案 flips the doc pane to the plan face (#318)', async ({ page }) => {
  await page.goto('/app/todo/r8-15?scenario=75');
  await expect(page.locator('.overlay-title')).toHaveText('复用方案');
  // 点击前:failed 面 = changes 表面(型选钮取 wrap 内限定,版本 chip 同类名)
  await expect(page.locator('.doc-select-wrap .doc-pane-select')).toContainText('变更');
  // XMON-24：老 .btn--overlay 类随 ui/Button 退役——改取 actions 行内按钮。
  await page.locator('.overlay-actions button', { hasText: '查看方案' }).click();
  // 查看方案 = 关弹层 + docpane 切 plan 面;fixture 75 无 plan doc →
  // 「暂无方案」占位即模式切换证据(live plan 内容归 verify-pacman)
  await expect(page.locator('.overlay')).toBeHidden();
  await expect(page.locator('.doc-empty')).toContainText('暂无方案');
});

test('project task rows and cards are real links to the todo detail (#318)', async ({ page }) => {
  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=prj-tasks&tab=tasks');
  const row = page.locator('.prj-task-row').first();
  await expect(row).toBeVisible();
  // 行标题 = 真 <a>(::after 拉伸盖满整行,todo-card #58 同律)
  await expect(row.locator('a.prj-task-link')).toHaveCount(1);
  await row.click();
  await expect(page).toHaveURL(/\/app\/todo\/[^?]+\?scenario=prj-tasks&tab=tasks/);
  // 网格卡同律
  await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX?scenario=prj-tasks&tab=tasks');
  await page.locator('.prj-tasks-view-btn').nth(1).click();
  const card = page.locator('.prj-task-card').first();
  await expect(card).toBeVisible();
  await expect(card.locator('a.prj-task-link')).toHaveCount(1);
  await card.click();
  await expect(page).toHaveURL(/\/app\/todo\//);
});

test('new-task dialog: the close control anchors to the head’s right edge (#574 re-key debt)', async ({
  page,
}) => {
  await page.goto('/app?scenario=01');
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  await page.locator('.sidebar-new-task').click();
  await expect(dialog).toBeVisible();
  // #656: settle the dialog enter animation (tw-animate-css zoom-in-95) before the
  // head/close right-edge geometry is measured off the laid-out box.
  await dialog.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const hb = await dialog.getByTestId('new-task-head').boundingBox();
  const cb = await dialog.getByRole('button', { name: '关闭' }).boundingBox();
  if (hb === null || cb === null) throw new Error('head / close not laid out');
  // head 的右内垫是 4px（padding: 0 4px 0 12px），叉号靠 margin-left:auto 贴右缘。
  // #574 把 Button 换到 components/ui/Button 时没重钉选择器（那条写的是
  // `.btn.new-task-close`，而新原语不吐 btn 类），于是 margin-left:auto 与 28×28
  // 一起失效，叉号落回居中标题的紧右边——这条断言就是那段欠账的回归钉。
  expect(Math.abs(hb.x + hb.width - (cb.x + cb.width) - 4)).toBeLessThan(1.5);
  expect(cb.width).toBeCloseTo(28, 0);
  expect(cb.height).toBeCloseTo(28, 0);
});

test('new-task dialog gates unsaved closes and resets on discard (#318)', async ({ page }) => {
  await page.goto('/app?scenario=01');
  const dialog = page.getByRole('dialog', { name: '新建任务' });
  const discard = page.getByRole('alertdialog', { name: '放弃新建任务？未保存的内容将丢失。' });
  // 净表单:X 直关不闸
  await page.locator('.sidebar-new-task').click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toBeHidden();
  await expect(discard).toHaveCount(0);
  // 正文非空 → X 先过「放弃新建任务？」确认(r9 §3.4 copy 逐字)
  // (#394：标题位移除,dirty = 正文单字段)
  await page.locator('.sidebar-new-task').click();
  await dialog.getByRole('textbox').fill('未保存探针');
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(discard).toBeVisible();
  await expect(discard).toContainText('放弃新建任务？未保存的内容将丢失。');
  // 继续编辑 = 只收确认层,草稿保留
  await discard.getByRole('button', { name: '继续编辑' }).click();
  await expect(discard).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('textbox')).toHaveValue('未保存探针');
  // Esc 关闸同律;确认层上 Esc = 内层优先(只收确认层)。#656 起确认层 =
  // FloatingShell sibling root:入焦是异步的(Base UI initialFocus 缺省送焦点
  // 入层内首个 tabbable = 继续编辑钮),而 sibling root 的 Esc 路由依赖焦点在
  // 本层内——先等焦落定再按键,否则 Esc 被 modal dialog 吃掉(requestClose
  // 重开本层,确认层关不掉;CI 分片 runner 上该竞态实测咬人,本地串行恒赢)。
  await page.keyboard.press('Escape');
  await expect(discard).toBeVisible();
  await expect(discard.getByRole('button', { name: '继续编辑' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(discard).toBeHidden();
  await expect(dialog).toBeVisible();
  // 放弃并关闭 = 关 dialog + 表单重置(重开净面)
  await dialog.getByRole('button', { name: '关闭' }).click();
  await discard.getByRole('button', { name: '放弃并关闭' }).click();
  await expect(dialog).toBeHidden();
  await page.locator('.sidebar-new-task').click();
  await expect(dialog.getByRole('textbox')).toHaveValue('');
});

// —— 16. 详情 transcript 恢复死形移除（#884）————————————————————————

// The captures (r7 17/28, r8 63/65) show a restore glyph beside the footer
// copy. This product has no build-level rewind object surface to hang it
// on: the checkpoint data source is per-step (step.checkpointCommit, the
// merge step's landing key), the phase machine carries no reverse edge,
// the daemon's reset --hard + clean -fd restore has no server-initiated
// dispatch path, and the reference's own click behavior was never observed
// (r3 §3.5 / 02 §4.2 both mark it [推断]). #634 law: a shape without
// semantics is the bug — the glyph and its data field are gone. The chief
// drawer's 恢复到此处 keeps its wired chat-rewind semantics (pinned in
// chief-drawer-model.spec.ts).
test('detail transcript action rows carry no restore glyph (#884)', async ({ page }) => {
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=36');
  // Positive control: the action-row family still renders and the copy is
  // still the real button (#634) — the absence assertions below must not
  // pass vacuously on a page that failed to render.
  await expect(page.locator('.chat-row-icons .chat-copy').first()).toBeVisible();
  // The dead shape is gone from every action row of the transcript column,
  // identified by the Restore glyph's own outline (icons/Restore.tsx).
  await expect(page.locator('.chat-col path[d^="M3 12a9"]')).toHaveCount(0);
  // The user row's action row is exactly the copy button: one glyph, and
  // it sits inside its button (the task-start bubble row carries a
  // taskline between the bubble and the action row).
  const userRow = page.locator('.chat-row:has(.chat-bubble) ~ .chat-row-icons').first();
  await expect(userRow.locator('svg')).toHaveCount(1);
  await expect(userRow.locator('button svg')).toHaveCount(1);
});

// —— 17. 失败行链接位接线（#1258）————————————————————————————————————

// r8 54/73 canon captured the fail row's link line as 查看原始错误 /
// 排查指南 — rendered here as inert spans, zero onClick: the exact
// shape-without-semantics bug #634 names. #1258 wires what has content and
// removes what has no target:
//   17a 查看原始错误 is a real button that opens the dialog family shell
//       (DialogShell) whose body carries the row title verbatim — the
//       title IS the error text's only carrier (build.errorMessage; no
//       rawError field exists), so the full text must survive the hop
//       into the dialog. Closes via the family's X (#68 three-path law).
//   17b 排查指南 is gone: the repo has no failed-build troubleshooting
//       doc section to point at (docs/ = engineering specs / research /
//       verify evidence, not user docs) and no doc site to link — the
//       #136 「查看文档」wontfix law. A dead link is the bug, not a state
//       to preserve, so it does not render at all (#884: the shape and
//       its data field leave together — `links` is gone from the type).
//   No-content law: the fail row itself is mapper-gated on non-empty
//   build.errorMessage, so the raw-error button never renders
//   contentless — 17a's positive control pins the row exists.

test('fail row 查看原始错误 opens the raw-error dialog with the full text (#1258)', async ({
  page,
}) => {
  await page.goto('/app/todo/r8-12?scenario=54');
  // 正控制：失败行在场（标题即错误文本载体），下面的断言不空转。
  await expect(page.locator('.chat-para--fail')).toHaveText('运行该任务的机器已离线');
  await page.getByRole('button', { name: '查看原始错误' }).click();
  const dialog = page.getByRole('dialog', { name: '原始错误' });
  await expect(dialog).toBeVisible();
  // 全文律：弹窗正文 = 行 title 逐字（errorMessage 是唯一错误载体，
  // 弹窗不是摘要面）。
  await expect(dialog.locator('[data-testid="fail-raw-error"]')).toHaveText(
    '运行该任务的机器已离线',
  );
  // 家族关闭律（#68 三路）：X 关闭收层。
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toBeHidden();
});

test('fail row drops the 排查指南 dead link — no doc target, no shape (#1258)', async ({
  page,
}) => {
  await page.goto('/app/todo/r8-12?scenario=54');
  // 正控制：失败行在场，缺失断言不空转。
  await expect(page.locator('.chat-para--fail')).toBeVisible();
  // 无落点的文档链接不渲染（#136「查看文档」wontfix 同律）：任何形态
  // （span/按钮/置灰）都不许再出现这个死形。
  await expect(page.getByText('排查指南')).toHaveCount(0);
  // 留下的那个是真按钮（button 语义，非 inert span）。
  await expect(page.getByRole('button', { name: '查看原始错误' })).toBeVisible();
});
