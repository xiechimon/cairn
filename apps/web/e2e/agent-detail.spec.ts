import { expect, type Locator, type Page, test } from '@playwright/test';

// Agent 详情编辑面（原版实测形态：r3-protocol-executor.md §4 —— 团队页点 Agent
// 卡进 `/app/resources/agents/<id>?name=<名>`，三 tab 概览/记忆/权限；C17 捕获 ✓）。
// 本仓此前没有任何 Agent 详情页实现，团队页的 .team-agent-card 是纯 div。
//
// 每条断言钉一个失败方式：
// 1. 团队页的 Agent 卡是死面 —— 点它不导航（当前就是 div，无 onClick）
// 2. 详情路由不存在 —— 直链落 catch-all 重定向回 /app
// 3. 三 tab 不切换 —— 点「记忆」内容区不变
// 4. 名称不可编辑 —— 行内编辑提交后回显旧值
// 5. 职责位不渲染 canon 空态「未设置职责」
// 6. 模型选择器不列选项 —— 打开后菜单为空
// 7. 思考强度行消失，或空值不再是可改的「未设置」下拉
// 7b. 概览长回了「状态」行（XMON-18 已撤；撤行留空壳同判失败）
// 8. 记忆空态文案与 shared canon 不一致
// 9. 权限面工具开关不足 6 个（r3 §4 全 list）
// 10. MCP 服务器逐个勾选行不渲染
// 11. 未知 agent id 白屏（拿不到记录时没有回退呈现）
//
// #499 续（记忆 tab 搜索/排序 + 两行的编辑图标），每条断言钉一个失败方式：
// 12. 记忆 tab 没有配额头 —— `记忆 · n / 100` 不出（或 n 取了过滤后的条数）
// 13. 搜索框缺失，或过滤是死面（打字后行数不变）
// 14. 搜索只扫 title，content 命中不出行
// 15. 搜索对 ASCII 大小写敏感（`probe` 找不到 `PROBE`）
// 16. 零命中回落「尚无记忆」canon 空态 —— 把「搜不到」说成「一条都没有」
// 17. `添加时间` 档不排序（行序停在到达序）
// 18. 排序把搜索条件吃掉（选中排序项后过滤集变回全量）
// 19. 名称沿用裸文本钮、没有编辑图标（点不出可点感）
// 20. 职责的编辑钮丢了图标（退回文字钮），或图标钮没有可访问名
//
// XMON-15 续（概览「进行中」段），每条断言钉一个失败方式：
// 21. 零在跑任务时也出计数（`进行中 · 0`），或空态不出 canon 文案
// 22. 有在跑任务时行数不对 / 行内四个位（序号、标题、chip、箭头）缺位
// 23. 等机器的一行 chip 不吃 `queued` 档（回落 todo.phase 时同值，
//     但 conditional 被删掉后行为会随 phase 漂移）
// 24. 行不是入口 —— 点了不导航到任务详情
//
// fixture 场景 = 'agent-detail'：TEAM_R7 的 r3-builder 卡 + 该 agent 的完整
// 记录（字段 = r3 §4 实测样本原样）+ resources 行集。
// 'agent-detail-memory' = 同一 agent 的 3 条记忆（记忆 tab 搜索/排序用）。
// 'agent-detail-active' = 同一 agent 的两行在跑 build（概览「进行中」段）。
const DETAIL = '/app/resources/agents/r3-builder?scenario=agent-detail';
const MEMORY_DETAIL = '/app/resources/agents/r3-builder?scenario=agent-detail-memory';
const TEAM = '/app/team?scenario=agent-detail';

async function openDetail(page: Page) {
  await page.goto(DETAIL);
  return page.locator('.agent-detail');
}

async function openMemory(page: Page) {
  await page.goto(MEMORY_DETAIL);
  const detail = page.locator('.agent-detail');
  await detail.locator('.agent-tab').nth(1).click();
  return detail;
}

/** 记忆行标题（按 DOM 序），用于钉排序。 */
async function memoryTitles(page: Page): Promise<string[]> {
  return page.locator('.agent-memory-title').allTextContents();
}

test('团队页的 Agent 卡是链接，点击落到详情路由', async ({ page }) => {
  await page.goto(TEAM);
  // #947/#910：.team-agent-card 类名钩退役 → team-agent-card testid 二级载体
  await page.getByTestId('team-agent-card').filter({ hasText: 'r3-builder' }).click();
  await expect(page).toHaveURL(DETAIL);
  await expect(page.locator('.agent-detail')).toBeVisible();
});

test('详情路由直链可打开，不落 catch-all', async ({ page }) => {
  const detail = await openDetail(page);
  await expect(detail).toBeVisible();
  // #944/#910 载体：.res-title → heading 一级（topbar h1，可及名 = 标题文案）。
  await expect(page.getByRole('heading', { level: 1, name: 'r3-builder' })).toHaveText(
    'r3-builder',
  );
});

test('三 tab 齐在，概览默认选中，点记忆切内容', async ({ page }) => {
  const detail = await openDetail(page);
  const tabs = detail.locator('.agent-tab');
  await expect(tabs).toHaveCount(3);
  await expect(tabs.nth(0)).toHaveAttribute('aria-selected', 'true');
  await expect(detail.locator('.agent-overview')).toBeVisible();

  await tabs.nth(1).click();
  await expect(detail.locator('.agent-memories')).toBeVisible();
  await expect(detail.locator('.agent-overview')).toHaveCount(0);

  await tabs.nth(2).click();
  await expect(detail.locator('.agent-perms')).toBeVisible();
});

test('概览：名称行内编辑提交后回显新值', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-name-edit').click();
  const input = detail.locator('#agent-name-input');
  await expect(input).toBeVisible();
  await input.fill('r3-renamed');
  await input.press('Enter');
  await expect(detail.locator('.agent-name')).toHaveText('r3-renamed');
});

test('概览：职责位渲染 canon 空态并可编辑', async ({ page }) => {
  const detail = await openDetail(page);
  await expect(detail.locator('.agent-role-text')).toHaveText('未设置职责');
  await detail.locator('.agent-role-edit').click();
  const input = detail.locator('#agent-role-input');
  await input.fill('负责构建与合并');
  await detail.locator('.agent-role-save').click();
  await expect(detail.locator('.agent-role-text')).toHaveText('负责构建与合并');
});

// t-0024 两级化：运行时档（一级 = provider 维）与模型档（二级按一级过滤）。
// fixture agent = 存量 provider 绑定（r3-gw / claude-sonnet-5）；#770 起 picker
// 候选只剩 claude-code 段——本组三件事：存量值裸串回显不断（R1）、一级不再列
// providers 分组、切到 runtime 源是单向门（选不回 provider）。
// #1010 载体重钉：菜单/行 locator 一律页面级——registry select 的弹层经
// Positioner Portal 落 body，不再嵌在触发钮 wrap / detail 列里（#1060
// machine-popover 同律）；触发钮仍在概览列内，保持 detail 作用域。
// 行为断言语义一字不动（#910 口径）。
test('概览：存量 provider 绑定裸串回显，一级只列内置行与运行时源', async ({ page }) => {
  const detail = await openDetail(page);
  const runtimeTrigger = detail.locator('.agent-runtime-select');
  // 存量 provider 值命中不了候选 → 裸串 provider id 即名，不空白不崩。
  await expect(runtimeTrigger).toContainText('r3-gw');
  await runtimeTrigger.click();
  const runtimeMenu = page.locator('.agent-runtime-menu');
  await expect(runtimeMenu).toBeVisible();
  // 首行恒是「内置 (pi)」清空行（provider null 的显示形）；providers 分组已除。
  await expect(runtimeMenu.locator('.agent-runtime-row').first()).toContainText('内置 (pi)');
  await expect(runtimeMenu.locator('.agent-runtime-row', { hasText: 'r3-gw' })).toHaveCount(0);
  await expect(runtimeMenu.locator('.agent-runtime-row', { hasText: 'Claude Code' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  // 切到 Claude Code：二级换成它的模型（claude-haiku-4-5 只活在 claude-code
  // 段——它出现才证明二级真换了源）；切走后旧 provider 选不回来（单向门）。
  await detail.locator('.agent-runtime-select').click();
  await page.locator('.agent-runtime-row', { hasText: 'Claude Code' }).click();
  await expect(detail.locator('.agent-runtime-select')).toContainText('Claude Code');
  await detail.locator('.agent-model-select').click();
  const menu = page.locator('.agent-model-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.agent-model-row').first()).toHaveText(/未设置模型/);
  await expect(menu.locator('.agent-model-row', { hasText: 'claude-haiku-4-5' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await detail.locator('.agent-runtime-select').click();
  await expect(
    page.locator('.agent-runtime-menu .agent-runtime-row', { hasText: 'r3-gw' }),
  ).toHaveCount(0);
});

// 几何钉（#1010 重钉，ADR 0012 D1：registry 默认几何为正典）：弹层随
// registry select 走 Base UI Positioner——Portal 落 body、align 居中、
// alignItemWithTrigger（native-select 式：选中行骑在触发钮上）。旧钉法
// （右缘锚 + 8px 锚距 + 留在内容列内）钉的是 absolute 壳的手写锚位配方；
// 两条前车（wrap 被拉满宽 → 菜单飘离触发钮 400+px；锚错边 → 越出
// `.res-body` overflow 裁剪盒被裁一截）在 Portal 形态下换成同构的存活律：
// · 菜单必须锚在自己的触发钮上（水平相交 + 垂直重叠或 ≤8px 邻接——
//   飘走 = 相交断）；
// · 整块落在视口内（Portal 后无祖先裁剪盒，视口是唯一边界；越出 = 行画
//   不出来也点不中，XMON-39/XMON-117 的本体律）。
test('概览：两级菜单锚在触发钮上且整块在视口内（几何）', async ({ page }) => {
  const detail = await openDetail(page);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (viewport === null) return;
  // 一级运行时菜单与二级模型菜单同律。
  for (const prefix of ['agent-runtime', 'agent-model']) {
    const trigger = detail.locator(`.${prefix}-select`);
    await trigger.click();
    const menu = page.locator(`.${prefix}-menu`);
    await expect(menu).toBeVisible();
    // registry 进场（duration-100 zoom/fade）窗内量几何会吃到动画帧位移——
    // 等进场播完再量，钉的是静息几何（旧 V2 面同理：位移只存在于窗内）。
    await page.waitForTimeout(150);
    const tb = await trigger.boundingBox();
    const mb = await menu.boundingBox();
    expect(tb).not.toBeNull();
    expect(mb).not.toBeNull();
    if (tb === null || mb === null) return;
    // 锚定：水平相交（align 居中 + w-(--anchor-width)，中心近乎重合；碰撞
    // 平移最多让两盒错开一部分，相交断 = 飘走）。
    expect(mb.x).toBeLessThan(tb.x + tb.width);
    expect(mb.x + mb.width).toBeGreaterThan(tb.x);
    // 垂直：重叠（alignItemWithTrigger 骑钮）或邻接 ≤8px（无选中行可对齐时
    // 回落 side=bottom + sideOffset 4）。
    expect(mb.y).toBeLessThanOrEqual(tb.y + tb.height + 8);
    expect(mb.y + mb.height).toBeGreaterThanOrEqual(tb.y - 8);
    // 整块落在视口内。
    expect(mb.x).toBeGreaterThanOrEqual(-0.5);
    expect(mb.y).toBeGreaterThanOrEqual(-0.5);
    expect(mb.x + mb.width).toBeLessThanOrEqual(viewport.width + 0.5);
    expect(mb.y + mb.height).toBeLessThanOrEqual(viewport.height + 0.5);
    await page.keyboard.press('Escape');
  }
});

test('概览：思考强度空值是「未设置」下拉', async ({ page }) => {
  const detail = await openDetail(page);
  const thinking = detail.locator('.agent-thinking-select');
  await expect(thinking).toContainText('未设置');
  await expect(thinking).toHaveRole('combobox');
});

// XMON-18（2026-10-01 裁决）：概览不再摆「状态」行——`agentStatusSchema` 只有
// 一个取值 active，摆出来零信息量。这条钉的是「别再长回来」，同时钉住撤行没留下
// 空壳（类名与标签都不得残留）。思考强度那行留着，上面的下拉断言看住它。
test('概览：不摆「状态」行', async ({ page }) => {
  const detail = await openDetail(page);
  expect(await detail.locator('.agent-field-label').allTextContents()).not.toContain('状态');
  await expect(detail.locator('.agent-status')).toHaveCount(0);
});

// 文案逐字 = shared `MEMORY_EMPTY_COPY`（records/memory.ts:18；e2e 不跨包取
// 常量，与仓内其它 spec 硬写 canon 文案同律）。
test('记忆 tab：空态文案与 shared canon 同文', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-tab').nth(1).click();
  await expect(detail.locator('.agent-memory-empty')).toHaveText(
    '尚无记忆。Agent 会在工作中将值得沉淀的经验存入此处。',
  );
});

// XMON-84 用户拍板 B：六开关全保留（四无本体档照常摆出，本体另立规划票）；
// 其中合并分支/推送分支两档有真实执法面（XMON-77 daemon/server 闸）。
test('权限 tab：6 个工具开关全渲染（r3 §4 全 list，XMON-84 恢复）', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-tab').nth(2).click();
  await expect(detail.locator('.agent-tool-switch')).toHaveCount(6);
});

// 六档说明副文案曾经只出「远程 shell」一条（r3 §4 的清单只记了那一档）；
// 直读原版权限 tab 后补全，六档各带一条，钉住不回落成一条。
test('权限 tab：6 档各带说明副文案', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-tab').nth(2).click();
  const hints = detail.locator('.agent-perm-group').first().locator('.agent-perm-hint');
  await expect(hints).toHaveCount(6);
  await expect(hints.nth(1)).toHaveText(
    '允许该 Agent 通过合并分支进行发布（例如将 develop 合并进 main）。',
  );
  await expect(hints.nth(5)).toHaveText('允许该 Agent 修改团队技能库中已有的技能。');
});

// 运行时档（原版概览在模型之上有这一档）：wire 无独立字段，值由 provider 位
// 派生——存量 provider 值命中不了候选，走裸串回显（直接出 id）。t-0024 起这一
// 档从只读行变成一级选择器（触发钮回读同词），行序仍在模型之上。
test('概览：运行时档在模型之上，值由 provider 派生', async ({ page }) => {
  const detail = await openDetail(page);
  const runtime = detail.locator('.agent-runtime-select');
  await expect(runtime).toContainText('r3-gw');
  const labels = detail.locator('.agent-field-label');
  const texts = await labels.allTextContents();
  expect(texts.indexOf('运行时')).toBeGreaterThan(-1);
  expect(texts.indexOf('运行时')).toBeLessThan(texts.indexOf('模型'));
});

test('权限 tab：工具开关可切换', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-tab').nth(2).click();
  const first = detail.locator('.agent-tool-switch').first();
  await expect(first).toHaveAttribute('aria-checked', 'false');
  await first.click();
  await expect(first).toHaveAttribute('aria-checked', 'true');
});

test('权限 tab：MCP 服务器逐个勾选行渲染', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-tab').nth(2).click();
  await expect(detail.locator('.agent-mcp-row').first()).toBeVisible();
});

// #510：密钥区粒度改回原版的「全有全无」——原版 Agent 权限 tab 是**一行**
// 「团队密钥 + 总说明 + 单个 switch」，不展开逐个密钥行（2026-09-30 直读
// 参考产品确认；密钥页的行菜单也只有编辑/删除，没有 per-Agent 矩阵）。
// 场景 agent-detail-secrets 播两个密钥：回退成 per-secret 粒度会渲染两行，
// 「恰好一行」才有牙（只播一个密钥时两种实现都过）。
const DETAIL_SECRETS = '/app/resources/agents/r3-builder?scenario=agent-detail-secrets';

test('权限 tab：有密钥时密钥区恰好一行总开关', async ({ page }) => {
  await page.goto(DETAIL_SECRETS);
  await page.locator('.agent-tab').nth(2).click();
  await expect(page.locator('.agent-secret-row')).toHaveCount(1);
  await expect(page.locator('.agent-secret-switch')).toHaveCount(1);
  await expect(page.locator('.agent-secret-name')).toHaveText('团队密钥');
  // 副文案 = shared AGENT_PERMISSION_COPY.secrets（原版权限 tab 同一句，品牌
  // 与最低 CLI 版本插值随常量走）；e2e 不跨包取常量，硬写 canon 文案。
  // XMON-15 顺手对齐：XMON-7（#508，142c6cb）把这条 canon 从「以环境变量
  // 注入 shell」改成「按需取用、不预置进 shell」，本断言没跟上，一直红着；
  // 现值抄自 packages/shared/src/records/agent.ts 的常量。
  await expect(page.locator('.agent-secret-hint')).toHaveText(
    '任务执行时，该 Agent 可在需要密钥的执行步中按需取用团队密钥，每次取用都会留下记录；密钥不预置进 shell 环境。所在机器需要 pacman CLI 0.1.28 及以上。',
  );
});

// 勾选态 = `agent.secrets` 非空（wire 的 string[] 表达得了全有全无，无新字段）。
test('权限 tab：密钥总开关勾选态开→关→回', async ({ page }) => {
  await page.goto(DETAIL_SECRETS);
  await page.locator('.agent-tab').nth(2).click();
  const sw = page.locator('.agent-secret-switch');
  await expect(sw).toHaveAttribute('aria-checked', 'false'); // 空集 = 关
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true'); // 开 = 全 id 集
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false'); // 关 = []
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true'); // 回
});

// 零密钥时没有对象可授，出开关就是死控件（原版那行开关在零密钥时也渲染，
// 但它当时开关的是什么无法观测——不复刻看不出语义的控件，差异留 #510 票面）。
test('权限 tab：零密钥时是空态，无开关', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-tab').nth(2).click();
  await expect(detail.locator('.agent-perm-empty')).toHaveText('暂无团队密钥。');
  await expect(detail.locator('.agent-secret-switch')).toHaveCount(0);
  await expect(detail.locator('.agent-secret-row')).toHaveCount(0);
});

// —— XMON-80/P3：零密钥空态旁必须有出路 ——
// 钉住的失败方式：用户停在一句陈述句上，看不到「密钥在哪加」。创建入口本来
// 就在侧栏密钥页（SECRETS_HREF），本 tab 只是不链过去。
test('权限 tab：零密钥空态旁有去添加密钥的入口，点击落到密钥页', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-tab').nth(2).click();
  const entry = detail.locator('.agent-secret-add');
  await expect(entry).toBeVisible();
  await expect(entry).toHaveText('去添加密钥');
  await entry.click();
  await expect(page).toHaveURL(/\/app\/resources\/secrets/);
  await expect(page.getByRole('heading', { level: 1, name: '密钥' })).toHaveText('密钥');
});

// 有密钥时不摆这个入口：那行已经是真开关，再挂一条「去添加」就是同页两处
// 说同一件事（#510 的聚合行本身就是出口）。
test('权限 tab：有密钥时不出「去添加密钥」入口', async ({ page }) => {
  await page.goto(DETAIL_SECRETS);
  await page.locator('.agent-tab').nth(2).click();
  await expect(page.locator('.agent-secret-row')).toHaveCount(1);
  await expect(page.locator('.agent-secret-add')).toHaveCount(0);
});

// —— XMON-80/P2：保存失败必须有可见反馈 ——
// 钉住的失败方式：PATCH 返 500 时页面一声不吭（无 toast、无行内错误），用户
// 视角 = 点了没反应（XMON-78 实测）。本面无乐观更新，开关不动是对的；错的是
// 连「没保存成功」这件事都不说。
//
// live 面启动打桩（承 skills-readonly.spec 的 stubBoot 纪律）：teams / user me
// 是 teamId 来源、必须成功；其余 GET 一律 500——启动面查询失败 = 应用既有
// isError 耐受（data ?? [] 族）。page.route 匹配序 = 注册逆序：catch-all 先
// 注册，具体路由后注册才生效。URL 不带 ?scenario= 即 live 数据源（api/mode.ts
// 闸门：fixture build 里 scenario 参数缺席 = 真 API），故本 spec 能覆盖 live 面。
const LIVE_AGENT = {
  id: 'agent-1',
  displayName: 'live-builder',
  description: null,
  status: 'active',
  avatarUrl: null,
  provider: null,
  modelId: null,
  thinkingLevel: null,
  tools: [],
  secrets: [],
  defaultSkill: null,
  skillsAllowlist: null,
  mcpServers: [],
};

async function stubLiveBoot(page: Page) {
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

const PI_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const CC_THINKING_LEVELS = ['off', 'low', 'medium', 'high', 'xhigh', 'max'];

async function stubThinkingAgent(page: Page, initial: typeof LIVE_AGENT, withSources = false) {
  await stubLiveBoot(page);
  const patches: Record<string, unknown>[] = [];
  let agent: typeof LIVE_AGENT = { ...initial };
  await page.route('**/api/capabilities', (route) =>
    route.fulfill({ json: { thinkingLevels: PI_THINKING_LEVELS } }),
  );
  if (withSources) {
    await page.route('**/api/teams/team-1/model-sources', (route) =>
      route.fulfill({
        json: {
          sources: [
            {
              runtime: 'claude-code',
              installed: true,
              hostname: 'repro-host',
              machineId: 'machine-1',
              models: [{ id: 'claude-haiku-4-5', name: 'claude-haiku-4-5' }],
            },
          ],
        },
      }),
    );
  }
  await page.route('**/api/teams/team-1/agents/agent-1', (route) => {
    const req = route.request();
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON() as Record<string, unknown>;
      patches.push(body);
      agent = { ...agent, ...body } as typeof LIVE_AGENT;
      return route.fulfill({ json: agent });
    }
    return route.fulfill({ json: agent });
  });
  return patches;
}

test('思考强度：空值是下拉的「未设置」，选档 PATCH thinkingLevel，刷新后仍是该档', async ({
  page,
}) => {
  const patches = await stubThinkingAgent(page, {
    ...LIVE_AGENT,
    provider: null,
    thinkingLevel: null,
  });
  await page.goto('/app/resources/agents/agent-1');
  const select = page.locator('.agent-thinking-select');
  await expect(select).toContainText('未设置');
  await select.click();
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText([
    '未设置',
    ...PI_THINKING_LEVELS,
  ]);
  await page.getByRole('option', { name: 'high', exact: true }).click();
  expect(patches.at(-1)).toEqual({ thinkingLevel: 'high' });
  await expect(select).toContainText('high');
  await page.reload();
  await expect(page.locator('.agent-thinking-select')).toContainText('high');
  await page.locator('.agent-thinking-select').click();
  await page.getByRole('option', { name: '未设置', exact: true }).click();
  expect(patches.at(-1)).toEqual({ thinkingLevel: null });
});

test('思考强度：claude-code 菜单含 off，不含 minimal', async ({ page }) => {
  await stubThinkingAgent(page, {
    ...LIVE_AGENT,
    provider: 'claude-code',
    thinkingLevel: null,
  });
  await page.goto('/app/resources/agents/agent-1');
  await page.locator('.agent-thinking-select').click();
  await expect(page.getByRole('listbox').getByRole('option')).toHaveText([
    '未设置',
    ...CC_THINKING_LEVELS,
  ]);
});

test('思考强度：切到 claude-code 时非法档随模型清空，合法档保留', async ({ page }) => {
  const illegal = await stubThinkingAgent(
    page,
    { ...LIVE_AGENT, provider: null, thinkingLevel: 'minimal' },
    true,
  );
  await page.goto('/app/resources/agents/agent-1');
  await page.locator('.agent-runtime-select').click();
  await page.locator('.agent-runtime-row', { hasText: 'Claude Code' }).click();
  expect(illegal.at(-1)).toEqual({
    provider: 'claude-code',
    modelId: null,
    thinkingLevel: null,
  });

  const legal = await stubThinkingAgent(
    page,
    { ...LIVE_AGENT, provider: null, thinkingLevel: 'high' },
    true,
  );
  await page.goto('/app/resources/agents/agent-1');
  await page.locator('.agent-runtime-select').click();
  await page.locator('.agent-runtime-row', { hasText: 'Claude Code' }).click();
  expect(legal.at(-1)).toEqual({ provider: 'claude-code', modelId: null });
});

test('权限 tab：保存失败出可见错误反馈，开关不回弹', async ({ page }) => {
  await stubLiveBoot(page);
  let patches = 0;
  await page.route('**/api/teams/team-1/agents/agent-1', (route) => {
    if (route.request().method() === 'PATCH') {
      patches += 1;
      return route.fulfill({ status: 500, json: { error: 'boom' } });
    }
    return route.fulfill({ json: LIVE_AGENT });
  });

  await page.goto('/app/resources/agents/agent-1');
  await page.locator('.agent-tab').nth(2).click();
  const sw = page.locator('.agent-tool-switch').first();
  await expect(sw).toHaveAttribute('aria-checked', 'false');

  await sw.click();
  // 前提守卫：请求真发出去了（否则「有反馈」测的是别的东西）。
  await expect.poll(() => patches).toBe(1);
  const error = page.locator('.agent-perm-error');
  await expect(error).toBeVisible();
  await expect(error).toHaveText('保存失败，请重试。');
  // 无乐观更新：失败后控件不停在开态（否则用户以为存上了）。
  await expect(sw).toHaveAttribute('aria-checked', 'false');
});

// 反向：保存成功不应留错误行——否则「有反馈」退化成一条永远挂着的红字。
test('权限 tab：保存成功不出错误行', async ({ page }) => {
  await stubLiveBoot(page);
  await page.route('**/api/teams/team-1/agents/agent-1', (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ json: LIVE_AGENT });
    return route.fulfill({ json: LIVE_AGENT });
  });

  await page.goto('/app/resources/agents/agent-1');
  await page.locator('.agent-tab').nth(2).click();
  await page.locator('.agent-tool-switch').first().click();
  await expect(page.locator('.agent-perm-error')).toHaveCount(0);
});

// —— #1169 授权技能（权限 tab）+ 默认 skill（概览）——
// 失败方式（先于实现固化）：
// 1. 「不限制」（null）被序列化成省键（undefined = 不动）→ 开关关不掉，
//    或关掉后回不来——显式 null 与省键必须两态。
// 2. 「勾空」（[] = 显式全拒）被写成 null → 两概念塌回一个。
// 3. defaultSkill 单值进了数组位（旧 skills[0] 形复活）或带上了授权面键。
test('授权技能：不限制 ↔ 勾空互转发显式 null/[]；勾选只进数组槽', async ({ page }) => {
  await stubLiveBoot(page);
  const patches: Record<string, unknown>[] = [];
  let agent: typeof LIVE_AGENT = { ...LIVE_AGENT };
  await page.route('**/api/skills**', (route) =>
    route.fulfill({
      json: [
        { id: 'skill-a', teamId: 'team-1', name: 'skill-a', description: null },
        { id: 'skill-b', teamId: 'team-1', name: 'skill-b', description: null },
      ],
    }),
  );
  await page.route('**/api/teams/team-1/agents/agent-1', (route) => {
    const req = route.request();
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON() as Record<string, unknown>;
      patches.push(body);
      agent = { ...agent, ...body } as typeof LIVE_AGENT;
      return route.fulfill({ json: agent });
    }
    return route.fulfill({ json: agent });
  });

  await page.goto('/app/resources/agents/agent-1');
  await page.locator('.agent-tab').nth(2).click();
  // 不限制（null）态：主开关开、逐技能行不渲染（全量已可读，逐项开关无语义）。
  const master = page.locator('.agent-allowlist-switch');
  await expect(master).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.agent-allowlist-row')).toHaveCount(0);
  // 关「不限制」= 显式 []（勾空全拒——不是 null 的伪装）。
  await master.click();
  expect(patches.at(-1)).toEqual({ skillsAllowlist: [] });
  await expect(master).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.agent-allowlist-row')).toHaveCount(2);
  // 逐技能勾选：单值只进数组槽（不重排、不重复）。
  await page.locator('.agent-allowlist-skill-switch').first().click();
  expect(patches.at(-1)).toEqual({ skillsAllowlist: ['skill-a'] });
  // 重开「不限制」= 显式 null（省键 = 不动，两态不塌缩——序列化坑主钉位）。
  await master.click();
  expect(patches.at(-1)).toEqual({ skillsAllowlist: null });
  await expect(page.locator('.agent-allowlist-row')).toHaveCount(0);
});

test('默认 skill：单值 Select 只写 defaultSkill 槽，不带授权面键（两控件互不影响）', async ({ page }) => {
  await stubLiveBoot(page);
  const patches: Record<string, unknown>[] = [];
  let agent: typeof LIVE_AGENT = { ...LIVE_AGENT };
  await page.route('**/api/skills**', (route) =>
    route.fulfill({
      json: [
        { id: 'skill-a', teamId: 'team-1', name: 'skill-a', description: null },
      ],
    }),
  );
  await page.route('**/api/teams/team-1/agents/agent-1', (route) => {
    const req = route.request();
    if (req.method() === 'PATCH') {
      const body = req.postDataJSON() as Record<string, unknown>;
      patches.push(body);
      agent = { ...agent, ...body } as typeof LIVE_AGENT;
      return route.fulfill({ json: agent });
    }
    return route.fulfill({ json: agent });
  });

  await page.goto('/app/resources/agents/agent-1');
  // 概览「默认 skill」行：单值槽（清空行「未设置」= null）。句柄类定位
  // （.agent-skill-select）——页上另有运行时/模型两个 combobox，getByRole
  // 会撞 strict mode。
  const select = page.locator('.agent-skill-select');
  await expect(select).toContainText('未设置');
  await select.click();
  await page.getByRole('option', { name: 'skill-a' }).click();
  expect(patches.at(-1)).toEqual({ defaultSkill: 'skill-a' });
  await expect(select).toContainText('skill-a');
  // 清空回 null（显式 null——单值槽不是数组位）。
  await select.click();
  await page.getByRole('option', { name: '未设置' }).click();
  expect(patches.at(-1)).toEqual({ defaultSkill: null });
});

test('未知 agent id 不白屏，走回退呈现', async ({ page }) => {
  await page.goto('/app/resources/agents/no-such-agent?scenario=agent-detail');
  await expect(page.locator('.agent-missing')).toBeVisible();
});

// —— #499：记忆 tab 的配额头、搜索与排序 ——

// 配额 = shared MEMORY_QUOTA_PER_AGENT（records/memory.ts:11），n = 该 Agent
// 的全部记忆条数（不是过滤后的条数——配额记的是存量，不是眼前的列表长度）。
test('记忆 tab：配额头 `记忆 · n / 100` 与搜索/排序控件齐在', async ({ page }) => {
  const detail = await openMemory(page);
  await expect(detail.locator('.agent-memory-head')).toHaveText('记忆 · 3 / 100');
  await expect(detail.locator('.agent-memory-search input')).toHaveAttribute(
    'placeholder',
    '搜索记忆…',
  );
  await expect(detail.locator('.agent-memory-sort')).toContainText('排序');
  await expect(detail.locator('.agent-memory-row')).toHaveCount(3);
});

test('记忆 tab：搜索按标题过滤，只留命中行', async ({ page }) => {
  const detail = await openMemory(page);
  await detail.locator('.agent-memory-search input').fill('历史轮次');
  await expect(detail.locator('.agent-memory-row')).toHaveCount(1);
  await expect(detail.locator('.agent-memory-title')).toHaveText('PROBE 探针的历史轮次');
});

// 一行一条失败方式：`probe` 只写在第 2 条的 content 里（标题没有），而第 3 条
// 的标题是 `PROBE`（全大写）——两条都命中才说明扫了 content 且大小写不敏感。
test('记忆 tab：搜索扫 content 且 ASCII 大小写不敏感', async ({ page }) => {
  const detail = await openMemory(page);
  await detail.locator('.agent-memory-search input').fill('probe');
  await expect(detail.locator('.agent-memory-row')).toHaveCount(2);
  expect(await memoryTitles(page)).toEqual(['验收只看真机跑通', 'PROBE 探针的历史轮次']);
});

// 零命中不是「这个 Agent 没有记忆」——回落 canon 空态等于篡改事实。
test('记忆 tab：零命中出「没有匹配的记忆。」，不回落 canon 空态', async ({ page }) => {
  const detail = await openMemory(page);
  await detail.locator('.agent-memory-search input').fill('不存在的词');
  await expect(detail.locator('.agent-memory-row')).toHaveCount(0);
  await expect(detail.locator('.agent-memory-no-match')).toHaveText('没有匹配的记忆。');
  await expect(detail.locator('.agent-memory-empty')).toHaveCount(0);
  // 配额头仍报存量 3（不是 0）。
  await expect(detail.locator('.agent-memory-head')).toHaveText('记忆 · 3 / 100');
});

// fixture 的列序是旧 → 新，`添加时间` 必须把它翻成新 → 旧；否则这一档是死面
// （选中后行序与 `默认` 一模一样）。
test('记忆 tab：`添加时间` 档按新 → 旧重排', async ({ page }) => {
  const detail = await openMemory(page);
  expect(await memoryTitles(page)).toEqual([
    '构建分支的命名规律',
    '验收只看真机跑通',
    'PROBE 探针的历史轮次',
  ]);
  await detail.locator('.agent-memory-sort').click();
  // #854 收编 dropdown-menu：面板 portal 到 body（不再挂 wrap 包含块），
  // 作用域收在 .agent-detail 里就找不到它了。
  await page
    .locator('.agent-memory-sort-menu')
    .getByRole('menuitemradio', { name: '添加时间' })
    .click();
  expect(await memoryTitles(page)).toEqual([
    'PROBE 探针的历史轮次',
    '验收只看真机跑通',
    '构建分支的命名规律',
  ]);
});

// 排序不得把搜索条件吃掉：过滤集留在原地，只在集合内重排。
test('记忆 tab：搜索与排序叠加——排序只在命中集内生效', async ({ page }) => {
  const detail = await openMemory(page);
  await detail.locator('.agent-memory-search input').fill('probe');
  await detail.locator('.agent-memory-sort').click();
  // #854 收编 dropdown-menu：面板 portal 到 body（不再挂 wrap 包含块），
  // 作用域收在 .agent-detail 里就找不到它了。
  await page
    .locator('.agent-memory-sort-menu')
    .getByRole('menuitemradio', { name: '添加时间' })
    .click();
  await expect(detail.locator('.agent-memory-row')).toHaveCount(2);
  expect(await memoryTitles(page)).toEqual(['PROBE 探针的历史轮次', '验收只看真机跑通']);
});

// 空列表（一条记忆都没有）时不摆搜索/排序控件——照 skills-page 的先例，空态
// 顶掉工具行（对着空集搜索没有意义）。
test('记忆 tab：零记忆时不出搜索行，保留 canon 空态', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-tab').nth(1).click();
  await expect(detail.locator('.agent-memory-empty')).toBeVisible();
  await expect(detail.locator('.agent-memory-search')).toHaveCount(0);
  await expect(detail.locator('.agent-memory-head')).toHaveText('记忆 · 0 / 100');
});

// —— #499：名称 / 职责两行的编辑图标 ——

test('概览：头部「编辑名称」进编辑态，取消回到原名', async ({ page }) => {
  const detail = await openDetail(page);
  const edit = detail.locator('.agent-name-edit');
  await expect(edit).toHaveText('编辑名称');
  await edit.click();
  const input = detail.locator('#agent-name-input');
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('r3-builder');
  await input.fill('不保存');
  await detail.getByRole('button', { name: '取消' }).click();
  await expect(input).toHaveCount(0);
  await expect(detail.locator('.agent-name')).toHaveText('r3-builder');
});

test('概览：职责的编辑钮是图标钮，带可访问名', async ({ page }) => {
  const detail = await openDetail(page);
  const edit = detail.locator('.agent-role-edit');
  await expect(edit).toHaveAttribute('aria-label', '编辑');
  await expect(edit.locator('svg')).toHaveCount(1);
  await edit.click();
  await expect(detail.locator('#agent-role-input')).toBeVisible();
});

// —— XMON-15：概览「进行中」段 ——
// 形状正典 = shared agentTaskSchema 的注释（逐个字段的原件出处）；服务端过滤
// 判据的失败方式钉在 apps/server/test/m5-face.test.ts 的同名 describe。
// 段头与空态文案逐字 = 参考产品 web 包的 agent_modal.in_progress /
// no_active_tasks（后者经 i18n en.ts 映射为 'No active tasks'）。
// 两档：agent-detail 不带 agentTasks（canon 空态），agent-detail-active 带
// 两行 build（等机器 + 跑起来）。

test('概览：零在跑任务时段头不带计数，出 canon 空态', async ({ page }) => {
  const detail = await openDetail(page);
  await expect(detail.locator('.agent-tasks-head')).toHaveText('进行中');
  await expect(detail.locator('.agent-tasks-empty')).toHaveText('暂无进行中的任务');
  await expect(detail.locator('.agent-task-row')).toHaveCount(0);
});

test('概览：有在跑任务时列出行，段头带计数', async ({ page }) => {
  await page.goto(`${DETAIL.replace('agent-detail', 'agent-detail-active')}`);
  const detail = page.locator('.agent-detail');
  await expect(detail.locator('.agent-tasks-head')).toHaveText('进行中 · 2');
  await expect(detail.locator('.agent-tasks-empty')).toHaveCount(0);

  const rows = detail.locator('.agent-task-row');
  await expect(rows).toHaveCount(2);
  // 行 = #序号 + 标题 + 状态 chip + 右箭头（原件 TaskRow 的四个位）
  await expect(rows.nth(0).locator('.agent-task-seq')).toHaveText('#12');
  await expect(rows.nth(0).locator('.agent-task-title')).toHaveText(
    'README 文档目录 + 新建 CHANGELOG.md + scripts/',
  );
  // 等机器的一行 chip = `queued` 档的文案（待处理）。载体 = StatusChip 的
  // data-tone 状态属性（spec/22 §5.2，#910 裁定 3 状态类归行为的 data-* 载体）
  await expect(rows.nth(0).locator('[data-tone="idle"]')).toHaveText('待处理');
  // 跑起来的一行 chip 吃 todo.phase（building → 执行中）
  await expect(rows.nth(1).locator('.agent-task-seq')).toHaveText('#13');
  await expect(rows.nth(1).locator('[data-tone="plan"]')).toHaveText('执行中');
  await expect(rows.nth(1).locator('.agent-task-go svg')).toHaveCount(1);
});

test('概览：点行进任务详情', async ({ page }) => {
  await page.goto(`${DETAIL.replace('agent-detail', 'agent-detail-active')}`);
  await page.locator('.agent-task-row').first().click();
  await expect(page).toHaveURL(/\/app\/todo\/r3-legacy-12$/);
});

// —— XMON-117：本页按 `/app/account` 的设置列表复刻 ——
// 模板 = 卡上方的头像与名称头部 + 一张行式字段卡，三 tab 的内容都住在卡里。
// 钉住的失败方式：概览退回散块字段列（每个字段各自带 label，没有行盒与
// 分隔线）、名称又回到卡内成一行、记忆/权限两 tab 回到一张卡一行的散卡布局。
const OVERVIEW_LABELS = ['职责', '默认 skill', '运行时', '模型', '思考强度'];

test('概览：五个字段行长在同一张模板卡里，头像与名称在卡上方', async ({ page }) => {
  const detail = await openDetail(page);
  const card = detail.locator('.agent-overview .profile-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.profile-avatar')).toHaveCount(0);
  const avatarImg = detail.locator('.agent-overview .profile-header .profile-avatar img');
  await expect(avatarImg).toHaveCount(1);
  // #1156：存在断言对尺寸缺陷是瞎的——SeededAvatar 漏传 className 时回落
  // registry 默认 size-8（32px），塞进 56px 头像圆被裁。这里
  // 钉 img 的真实几何：56px 是头部头像圆的设计值。度量用
  // offsetWidth/offsetHeight（布局整数、transform 不变）；不用
  // getBoundingClientRect——它读被 transform 影响的值，进场动画期间会得
  // 0.95 倍假值（#1113 flake 成因）。
  const avatarGeom = await avatarImg.evaluate((el) => ({
    w: el.offsetWidth,
    h: el.offsetHeight,
  }));
  expect(avatarGeom.w).toBe(56);
  expect(avatarGeom.h).toBe(56);
  await expect(card.locator('.profile-row')).toHaveCount(OVERVIEW_LABELS.length);
  // 行序即字段序。取 `.profile-label-text`（模板自己的 label 类）而非面内
  // 别名：别名在、模板类不在，就是「只挂了句柄没吃模板」——正是要钉的退形。
  expect(await card.locator('.profile-label-text').allTextContents()).toEqual(OVERVIEW_LABELS);
});

test('记忆 tab：记忆行住在模板卡里', async ({ page }) => {
  const detail = await openMemory(page);
  const card = detail.locator('.agent-memories .profile-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.profile-row.agent-memory-row')).toHaveCount(3);
});

test('权限 tab：五组开关各自住在模板卡里（#1251 起新增机器匹配段）', async ({ page }) => {
  const detail = await openDetail(page);
  await detail.locator('.agent-tab').nth(2).click();
  const cards = detail.locator('.agent-perms .profile-card');
  // 工具 / 授权技能(#1169) / 密钥 / MCP 服务器 / 机器匹配(#1251——执行要求
  // 写面卡；机器匹配读面卡是 live 专属读面，fixture 面缺席)。
  await expect(cards).toHaveCount(5);
  // 六档工具开关全在工具组的卡里（不靠散行的 .agent-perm-row 撑）
  await expect(cards.first().locator('.profile-row')).toHaveCount(6);
  await expect(cards.first().locator('.agent-tool-switch')).toHaveCount(6);
});

// 卡的首件直接是行。失败方式：行自带底色，方角把底色顶出卡的圆角外（卡片
// overflow: visible 裁不掉，肉眼是圆角处多一块方角）；或行带上边线，与卡的
// 描边叠成 2px 的顶边。
test('记忆/权限卡：首行无底色、无上边线（无方角外溢、无 2px 顶边）', async ({
  page,
}) => {
  const detail = await openMemory(page);
  // tab 是条件渲染，两面的首行要各读一次（切走就没了）
  const memoryFirst = detail.locator('.agent-memories .profile-card > .profile-row:first-child');
  await expect(memoryFirst).toHaveCount(1);
  await assertTopCorner(memoryFirst);

  await detail.locator('.agent-tab').nth(2).click();
  // 5 张权限卡：工具 / 授权技能(#1169) / 密钥（零密钥时空态也是模板行）/
  // MCP 服务器 / 机器匹配(#1251，fixture 面 = 执行要求写面卡)。
  const permFirst = detail.locator('.agent-perms .profile-card > .profile-row:first-child');
  await expect(permFirst).toHaveCount(5);
  await assertTopCorner(permFirst);
});

async function assertTopCorner(rows: Locator) {
  for (const row of await rows.all()) {
    const { background, topBorder } = await row.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { background: cs.backgroundColor, topBorder: cs.borderTopWidth };
    });
    expect(background).toBe('rgba(0, 0, 0, 0)');
    expect(topBorder).toBe('0px');
  }
}
