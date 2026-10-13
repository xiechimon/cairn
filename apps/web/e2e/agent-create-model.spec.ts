import { expect, type Page, test } from '@playwright/test';

// 创建 Agent 弹窗的三级选择（t-0024 两级 + #1259 归属机级）：先选运行时
// （一级 = provider 维），再选归属机（二级 = 开了该 runtime 的团队机器），
// 再选该机上报的具体模型（三级按机过滤，候选带 machineId——同名模型两台
// 机器各报各的）。
// 原版两态的承接：无机器 = 「还没有接入机器」告警行 + 机器页外链（创建不
// 可能，归属机必填）；无 claude-code 候选 = 「尚未配置模型服务商」告警行退成
// 信息性（pi 创建不受阻，不再顶掉表单）。
// #770 起候选只剩 model-sources 非 pi 段（providers 段已除）：一级恒是
// 「内置 (pi)」清空行 + runtime 源分组（当下即 `Claude Code` 一组）。
//
// 每条断言钉一个失败方式：
// 1. 有候选时仍报「尚未配置模型服务商」（写死告警行的退形）
// 2. 有候选时没有一级运行时选择器（退回单框平铺）
// 3. 未选运行时模型选择器就能点（两级退成一级，候选又混回一列）
// 4. 选过运行时后模型菜单混进 pi 段的模型（非 pi 过滤没生效）
// 5. 模型行又带上 provider 徽标或编造上下文窗口数字（`· 128k`）
// 6. 切换运行时后旧模型残留进 POST body（跨 provider 的 modelId 是脏值）
// 7. 只选运行时提交丢 provider（半态没带上）
// 8. 选齐提交 POST body 不带 provider/modelId（选了个寂寞）
// 9. 菜单被裁掉一截 / 行够不着（几何；XMON-39 前车。#1010 重钉：弹层随
//    registry select 走 Positioner + Portal 落 body——「越出 dialog-body 裁剪盒」
//    在结构上不再可能，几何律收敛为「整块落在视口内 + 封顶后可滚达」）
//
// #1010 载体重钉：菜单/行 locator 一律页面级（Portal 落 body，不再嵌在
// dialog DOM 里——#1060 machine-popover 同律）；触发钮仍在 dialog 内，保持
// dialog 作用域。行为断言语义一字不动（#910 口径）。
//
// 有候选态用 fixture 场景 'agent-detail'（resources.providerSources 带
// claude-code 四模型）；无候选态沿用 r7 捕获场景 '12'（无 resources）；
const TEAM_WITH_SOURCES = '/app/team?scenario=agent-detail';
const TEAM_NO_SOURCES = '/app/team?scenario=12';

/** live 启动面（fixture build 下不带 scenario 参数即 live）——只放行被测面
 *  需要的几条读面，其余 GET 一律 500（skills-readonly.spec 的 stubBoot 同律；
 *  Playwright 路由匹配序 = 注册逆序，这里用单条路由内分派避免顺序陷阱）。 */
const TEAM_ID = 'team-1';
/** #1259 归属机：stub 机（双 runtime 开），cc 模型段的 machineId 指它。 */
const STUB_MACHINE_ID = 'machine-cc-stub';
const STUB_MACHINE_NAME = 'stub-mea';

const CC_MODELS = [
  { id: 'claude-opus-4-5', name: 'claude-opus-4-5', slot: 'default' },
  { id: 'claude-sonnet-5', name: 'claude-sonnet-5', slot: 'sonnet' },
  { id: 'claude-haiku-4-5', name: 'claude-haiku-4-5', slot: 'haiku' },
];

async function stubLive(
  page: Page,
  opts: {
    hasSources: boolean;
    bodies: unknown[];
    models?: Array<{ id: string; name: string }>;
    withPiLeak?: boolean;
  },
) {
  await page.route('**/api/**', (route, request) => {
    const path = new URL(request.url()).pathname;
    if (request.method() === 'POST' && path === `/api/teams/${TEAM_ID}/agents`) {
      opts.bodies.push(JSON.parse(request.postData() ?? '{}'));
      return route.fulfill({ status: 201, json: { id: 'agent-new' } });
    }
    if (request.method() !== 'GET') return route.fallback();
    if (path === '/api/teams') {
      return route.fulfill({
        json: [{ id: TEAM_ID, name: 'Team', createdAt: 0, plan: 'free', avatarStyle: null }],
      });
    }
    if (path === '/api/user/me') {
      return route.fulfill({ json: { id: 'user-1', displayName: '我', avatarUrl: null } });
    }
    if (path === `/api/teams/${TEAM_ID}/members`) {
      return route.fulfill({ json: [] });
    }
    if (path === `/api/teams/${TEAM_ID}/providers`) {
      // #770 起创建弹窗不再读 providers 面：恒空，候选只看 model-sources。
      return route.fulfill({ json: { presets: [], providers: [] } });
    }
    if (path === `/api/teams/${TEAM_ID}/machines`) {
      return route.fulfill({
        json: [
          {
            id: STUB_MACHINE_ID,
            teamId: TEAM_ID,
            name: STUB_MACHINE_NAME,
            online: true,
            latestCliVersion: null,
            kind: 'remote',
            enabledRuntimes: ['pi', 'claude-code'],
            shellEnabled: false,
            maxConcurrent: 3,
            runningSteps: 0,
          },
        ],
      });
    }
    if (path === `/api/teams/${TEAM_ID}/model-sources`) {
      const sources = opts.hasSources
        ? [
            // pi 段恒在封套里（server 原样），投影层跳过——withPiLeak  pin
            // 的就是「它不许漏进菜单」。
            {
              runtime: 'pi',
              installed: true,
              hostname: 'test-host',
              models: opts.withPiLeak
                ? [{ id: 'pi-sneak', name: 'Pi 段模型' }]
                : [{ id: 'claude-sonnet-5', name: 'Claude Sonnet 5（R3 网关）' }],
            },
            {
              runtime: 'claude-code',
              installed: true,
              hostname: 'test-host',
              machineId: STUB_MACHINE_ID,
              models: opts.models ?? CC_MODELS,
            },
          ]
        : [];
      return route.fulfill({ json: { sources } });
    }
    return route.fulfill({ status: 500, json: { error: 'e2e stub: not the surface under test' } });
  });
}

async function openDialog(page: Page, teamUrl: string) {
  await page.goto(teamUrl);
  await page.getByRole('button', { name: '创建 Agent' }).click();
  // #952/#910 重钉：壳级 .dlg → getByRole(dialog) + 可及名（dialog-shell 别名
  // 摘除，spec/22 §5.5）；带名消歧——弹窗内两级 select 的浮层同为 role=dialog。
  const dialog = page.getByRole('dialog', { name: '创建 agent' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('无机器：报机器告警行并给「接入机器」外链，选择器都不出', async ({ page }) => {
  const dialog = await openDialog(page, TEAM_NO_SOURCES);
  // #1259：归属机必填 → 无机器时创建不可能，机器告警行顶替整个表单。
  await expect(dialog.getByText('还没有接入机器')).toBeVisible();
  await expect(dialog.getByRole('link', { name: '接入机器' })).toBeVisible();
  await expect(dialog.locator('.dlg-agent-model-select')).toHaveCount(0);
  await expect(dialog.locator('.dlg-agent-runtime-select')).toHaveCount(0);
  await expect(dialog.locator('.dlg-agent-machine-select')).toHaveCount(0);
});

test('有机器无候选：服务商告警行退成信息性，运行时/归属机两槽照出（pi 创建不受阻）', async ({
  page,
}) => {
  const dialog = await openDialog(page, '/app/team?scenario=team-no-sources');
  await expect(dialog.locator('.dlg-agent-runtime-select')).toBeVisible();
  await expect(dialog.locator('.dlg-agent-machine-select')).toBeVisible();
  await expect(dialog.getByText('尚未配置模型服务商')).toBeVisible();
  await expect(dialog.getByRole('link', { name: '配置服务商' })).toBeVisible();
  // pi 路径直通：选归属机即可创建，不需模型。
  await dialog.getByLabel('名称').fill('pi-only agent');
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: 'mea-wsl' }).click();
  await expect(dialog.getByRole('button', { name: '创建', exact: true })).toBeEnabled();
});

test('有候选：不出告警行，出三级选择器且模型级先禁用', async ({ page }) => {
  const dialog = await openDialog(page, TEAM_WITH_SOURCES);
  await expect(dialog.getByText('尚未配置模型服务商')).toHaveCount(0);
  await expect(dialog.locator('.dlg-agent-runtime-select')).toBeVisible();
  await expect(dialog.locator('.dlg-agent-machine-select')).toBeVisible();
  // 未选运行时模型级不可点——级联退形就是「候选又混回一列」。
  await expect(dialog.locator('.dlg-agent-model-select')).toBeDisabled();
  // #1259：选了运行时但没选归属机，模型级仍禁用（候选按机过滤，无机无候选）。
  await dialog.locator('.dlg-agent-runtime-select').click();
  await page.locator('.dlg-agent-runtime-row', { hasText: 'Claude Code' }).click();
  await expect(dialog.locator('.dlg-agent-model-select')).toBeDisabled();
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row').first().click();
  await expect(dialog.locator('.dlg-agent-model-select')).toBeEnabled();
});

test('一级列运行时与内置清空行，且 pi 段进入候选（#1288 翻案不再跳过）', async ({
  page,
}) => {
  await stubLive(page, { hasSources: true, bodies: [], withPiLeak: true });
  const dialog = await openDialog(page, '/app/team');
  await dialog.locator('.dlg-agent-runtime-select').click();
  const runtimeMenu = page.locator('.dlg-agent-runtime-menu');
  await expect(runtimeMenu).toBeVisible();
  // 首行恒是「内置 (pi)」清空行（provider null 的显示形）。
  await expect(runtimeMenu.locator('.dlg-agent-runtime-row').first()).toContainText('内置 (pi)');
  // #1288 翻案：pi/relay 段进入候选——runtime 行 = 内置清空行 + pi 分组 + claude-code 分组。
  await expect(runtimeMenu.locator('.dlg-agent-runtime-row')).toHaveCount(3);
  // 内置清空行文本「内置 (pi)」也含 pi——含 pi 行 = 清空行 + pi 分组 = 2。
  await expect(runtimeMenu.locator('.dlg-agent-runtime-row', { hasText: 'pi' })).toHaveCount(2);
  await expect(runtimeMenu.locator('.dlg-agent-runtime-row', { hasText: 'Claude Code' })).toHaveCount(
    1,
  );
  // 选 Claude Code 后模型菜单只有它的模型——pi 段的模型不得混进 claude-code 组。
  await runtimeMenu.locator('.dlg-agent-runtime-row', { hasText: 'Claude Code' }).click();
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: STUB_MACHINE_NAME }).click();
  await dialog.locator('.dlg-agent-model-select').click();
  const modelMenu = page.locator('.dlg-agent-model-menu');
  await expect(modelMenu).toBeVisible();
  await expect(modelMenu.locator('.dlg-agent-model-row', { hasText: 'claude-sonnet-5' })).toHaveCount(
    1,
  );
  // 当选 claude-code 组时，二级按 provider 过滤——pi 段模型不出在该组下。
  await expect(modelMenu).not.toContainText('pi-sneak');
});

test('模型行只出模型名：不带 provider 徽标、不编造上下文窗口数字', async ({ page }) => {
  const dialog = await openDialog(page, TEAM_WITH_SOURCES);
  await dialog.locator('.dlg-agent-runtime-select').click();
  await page.locator('.dlg-agent-runtime-row', { hasText: 'Claude Code' }).click();
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: 'mea-wsl' }).click();
  await dialog.locator('.dlg-agent-model-select').click();
  const menu = page.locator('.dlg-agent-model-menu');
  const row = menu.locator('.dlg-agent-model-row', { hasText: 'claude-sonnet-5' });
  await expect(row).toHaveCount(1);
  // provider 已是一级，行内不再重复；原版 `· 128k` 是内置目录的窗口数，本仓无此数据源。
  await expect(row).not.toContainText('Claude Code');
  await expect(menu).not.toContainText('128k');
});

// 几何钉（#1010 重钉，ADR 0012 D1：registry 默认几何为正典）：弹层随
// registry select 走 Base UI Positioner——Portal 落 body、碰撞自动翻转、
// 封顶吃 --available-height。旧钉法（bottom 锚 + max-h-192 保证「不与底栏
// 相交、不越出 dialog-body 裁剪盒」）钉的是 absolute 壳的手写锚位配方，随壳
// 退役；native-select 式的 alignItemWithTrigger 形态下弹层可以合法地盖住
// 底栏（盖住 ≠ 裁掉，行始终可点）。几何律收敛为 XMON-39 的本体：菜单整块
// 落在视口内（存在性断言看不出被裁；越出视口 = 行画不出来也点不中）。
test('创建弹窗：两级菜单整块落在视口内（几何）', async ({ page }) => {
  const dialog = await openDialog(page, TEAM_WITH_SOURCES);
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (viewport === null) return;

  await dialog.locator('.dlg-agent-runtime-select').click();
  const runtimeMenu = page.locator('.dlg-agent-runtime-menu');
  await expect(runtimeMenu).toBeVisible();
  const rb = await runtimeMenu.boundingBox();
  expect(rb).not.toBeNull();
  if (rb !== null) {
    expect(rb.y).toBeGreaterThanOrEqual(-0.5);
    expect(rb.x).toBeGreaterThanOrEqual(-0.5);
    expect(rb.y + rb.height).toBeLessThanOrEqual(viewport.height + 0.5);
    expect(rb.x + rb.width).toBeLessThanOrEqual(viewport.width + 0.5);
  }
  await runtimeMenu.locator('.dlg-agent-runtime-row', { hasText: 'Claude Code' }).click();

  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: 'mea-wsl' }).click();
  await dialog.locator('.dlg-agent-model-select').click();
  const modelMenu = page.locator('.dlg-agent-model-menu');
  await expect(modelMenu).toBeVisible();
  const mb = await modelMenu.boundingBox();
  expect(mb).not.toBeNull();
  if (mb === null) return;
  expect(mb.y).toBeGreaterThanOrEqual(-0.5);
  expect(mb.x).toBeGreaterThanOrEqual(-0.5);
  expect(mb.y + mb.height).toBeLessThanOrEqual(viewport.height + 0.5);
  expect(mb.x + mb.width).toBeLessThanOrEqual(viewport.width + 0.5);
});

// XMON-39 模型很多时的显示区域（#1010 重钉）：旧病灶是 absolute 菜单的
// containing block 在 `.dlg-body` overflow 滚动盒里、超高即被裁；registry
// select 的 Positioner 弹层 Portal 落 body，裁剪盒失效，封顶改吃
// --available-height（视口可用高）+ 弹层内滚。律本体不变：
//
// 每条断言钉一个失败方式：
// 1. 菜单越出视口（越出部分不可见不可点——旧「越出裁剪盒」的视口级同构）
// 2. 首行模型点不中 —— 前几个模型选不了
// 3. 用「截短列表」消灭 bug —— 行数与候选数不符（死规矩：所有模型仍须可见可选）
// 4. 菜单封顶后仍能滚到最后一行 —— 修好压住、换成「只露前几行、后面的够不着」
const MANY_MODELS = Array.from({ length: 40 }, (_, i) => {
  const id = `vendor/model-${String(i + 1).padStart(2, '0')}`;
  return { id, name: id };
});

test('模型很多：选过运行时后菜单不越出视口，首行可点，40 行一个不少', async ({ page }) => {
  await stubLive(page, { hasSources: true, bodies: [], models: MANY_MODELS });
  const dialog = await openDialog(page, '/app/team');
  const viewport = page.viewportSize();
  expect(viewport).not.toBeNull();
  if (viewport === null) return;
  await dialog.locator('.dlg-agent-runtime-select').click();
  await page.locator('.dlg-agent-runtime-row', { hasText: 'Claude Code' }).click();
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: STUB_MACHINE_NAME }).click();
  await dialog.locator('.dlg-agent-model-select').click();
  const menu = page.locator('.dlg-agent-model-menu');
  await expect(menu).toBeVisible();

  const mb = await menu.boundingBox();
  expect(mb).not.toBeNull();
  if (mb === null) return;
  expect(mb.y).toBeGreaterThanOrEqual(-0.5);
  expect(mb.y + mb.height).toBeLessThanOrEqual(viewport.height + 0.5);

  // 行数 = 候选数 + 1（首位恒是「未设置模型」清空行）——不许靠删行/截短藏 bug
  await expect(page.locator('.dlg-agent-model-row')).toHaveCount(MANY_MODELS.length + 1);

  // 被裁的那几行正是列表开头：点第一个模型，看它是否真选得上
  const firstModel = page.locator('.dlg-agent-model-row', { hasText: 'vendor/model-01' });
  await firstModel.click({ timeout: 5000 });
  await expect(dialog.locator('.dlg-agent-model-select')).toContainText('vendor/model-01');

  // 末行仍够得着（封顶后的滚动是可达性，不是摆设）
  await dialog.locator('.dlg-agent-model-select').click();
  const rows = page.locator('.dlg-agent-model-row');
  await rows.nth(MANY_MODELS.length).click({ timeout: 5000 });
  await expect(dialog.locator('.dlg-agent-model-select')).toContainText('vendor/model-40');
});

test('选齐运行时与模型后提交，POST body 带 provider 与 modelId', async ({ page }) => {
  const bodies: unknown[] = [];
  await stubLive(page, { hasSources: true, bodies });
  const dialog = await openDialog(page, '/app/team');
  await dialog.getByLabel('名称').fill('带模型的 agent');
  await dialog.locator('.dlg-agent-runtime-select').click();
  await page.locator('.dlg-agent-runtime-row', { hasText: 'Claude Code' }).click();
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: STUB_MACHINE_NAME }).click();
  await dialog.locator('.dlg-agent-model-select').click();
  await page.locator('.dlg-agent-model-row', { hasText: 'claude-sonnet-5' }).click();
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '创建 agent' })).toBeHidden();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({
    displayName: '带模型的 agent',
    provider: 'claude-code',
    modelId: 'claude-sonnet-5',
    machineId: STUB_MACHINE_ID,
  });
});

test('只选运行时与归属机提交：body 带 provider、machineId、modelId 为 null（半态不丢字段）', async ({
  page,
}) => {
  const bodies: unknown[] = [];
  await stubLive(page, { hasSources: true, bodies });
  const dialog = await openDialog(page, '/app/team');
  await dialog.getByLabel('名称').fill('半态 agent');
  await dialog.locator('.dlg-agent-runtime-select').click();
  await page.locator('.dlg-agent-runtime-row', { hasText: 'Claude Code' }).click();
  // 归属机未选 = 创建钮保持禁用（#1259 必填闸）。
  await expect(dialog.getByRole('button', { name: '创建', exact: true })).toBeDisabled();
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: STUB_MACHINE_NAME }).click();
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '创建 agent' })).toBeHidden();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({
    displayName: '半态 agent',
    provider: 'claude-code',
    modelId: null,
    machineId: STUB_MACHINE_ID,
  });
});

test('切换运行时清掉旧模型：body 不带跨 provider 的脏 modelId', async ({ page }) => {
  const bodies: unknown[] = [];
  await stubLive(page, { hasSources: true, bodies });
  const dialog = await openDialog(page, '/app/team');
  await dialog.getByLabel('名称').fill('换运行时 agent');
  await dialog.locator('.dlg-agent-runtime-select').click();
  await page.locator('.dlg-agent-runtime-row', { hasText: 'Claude Code' }).click();
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: STUB_MACHINE_NAME }).click();
  await dialog.locator('.dlg-agent-model-select').click();
  await page.locator('.dlg-agent-model-row', { hasText: 'claude-sonnet-5' }).click();
  // 切回内置 (pi)：Claude Code 名下的 claude-sonnet-5 必须被清掉（modelId 只在
  // provider 内有意义，带过去就是脏值）；归属机随运行时切换一并清（#1259
  // 级联），需重选才能提交。
  await dialog.locator('.dlg-agent-runtime-select').click();
  await page.locator('.dlg-agent-runtime-row', { hasText: '内置 (pi)' }).click();
  await expect(dialog.locator('.dlg-agent-model-select')).not.toContainText('claude-sonnet-5');
  await expect(dialog.getByRole('button', { name: '创建', exact: true })).toBeDisabled();
  await dialog.locator('.dlg-agent-machine-select').click();
  await page.locator('.dlg-agent-machine-row', { hasText: STUB_MACHINE_NAME }).click();
  await dialog.getByRole('button', { name: '创建', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '创建 agent' })).toBeHidden();
  expect(bodies).toHaveLength(1);
  expect(bodies[0]).toMatchObject({ provider: null, modelId: null, machineId: STUB_MACHINE_ID });
});
