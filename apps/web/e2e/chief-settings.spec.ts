import { expect, type Page, test } from '@playwright/test';
import { evidencePanelShot } from './evidence';

// Issue #182 acceptance: chief 设置面三死钮接线(#180 裁决落账)。
// 1. agent 行 → 选择总管 Agent dialog(DialogShell 家族律):搜索框 + Agent
//    列(fixture 面 canon 单默认行 r3-builder);fixture 选定 = accept 律
//    关窗。换绑二次确认(live-only 路径,fixture 恒未绑定)归 live 真机验。
// 2. 章程编辑 → DialogShell 编辑弹窗:textarea 占位 r5 102/110 canon +
//    取消/保存章程;fixture 保存 = accept 律关窗。
// 3. #1260 总管降级:chief 无模型/机器覆盖槽——Agent tab 只有绑定行 +
//    一张只读信息卡(模型与归属机跟随绑定 Agent);live 写读归
//    verify 证据(docs/verify/1260/)。

const AGENT_TAB = '/app?scenario=101';

// #811: 返回钮可点——标题覆盖层曾拦截点选（.chief-set-title 全宽绝对
// 定位盖住按钮），点返回应回到总管抽屉。Playwright 的 actionability 即回归
// 钉：覆盖重现时 click 在此超时。
// #950 载体：设置面 = heading「总管设置」（.chief-settings/.chief-set-* 类
// 退役）；返回钮 = role + aria-label。
const settingsView = (page: Page) => page.getByRole('heading', { name: '总管设置' });

test('返回按钮可用：点击回到总管抽屉 (#811)', async ({ page }) => {
  await page.goto(AGENT_TAB);
  await expect(settingsView(page)).toBeVisible();
  await page.getByRole('button', { name: '返回' }).click();
  await expect(settingsView(page)).toBeHidden();
  await expect(page.getByRole('dialog', { name: '总管' })).toBeVisible();
});
const CHARTER_TAB = '/app?scenario=102';

async function openAgentDialog(page: Page) {
  await page.goto(AGENT_TAB);
  // #950 载体：agent 行 = role button（可及名 = 绑定态文案）；dialog =
  // role + 可及名（.dlg 壳级别名重钉先行，§5.5——DOM 别名存活至 #952）。
  await page.getByRole('button', { name: '未设置' }).click();
  const dialog = page.getByRole('dialog', { name: '选择总管 Agent' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('agent row opens the 选择总管 Agent dialog with search + canon default row', async ({
  page,
}) => {
  const dialog = await openAgentDialog(page);
  await expect(dialog).toHaveAttribute('aria-label', '选择总管 Agent');
  await expect(dialog.getByPlaceholder('搜索 Agent…')).toHaveAttribute(
    'placeholder',
    '搜索 Agent…',
  );
  await expect(dialog.getByRole('option')).toHaveCount(1);
  await expect(dialog.getByRole('option')).toHaveText('r3-builder');
});

// #872 反向钉：搜索盒是共享配方（SEARCH_BOX_CLS），不自带外边距——agent
// 对话框里它贴着弹窗体的 20px 内边距（DESIGN.md 弹窗与菜单）。模型 picker 的
// 壳垫移交（盒自带 mx-3）不许漏进这一面（第一次实现就是全局加
// margin-inline: 12px —— 这一面会变 32px）。
test('agent dialog search sits on the dialog body inset (#872 blast radius)', async ({ page }) => {
  const dialog = await openAgentDialog(page);
  // .dlg 的进场是 zoom-in-95 缩放（100ms）——缩放着量到的不是落定几何。
  await dialog.evaluate((el) =>
    Promise.all(el.getAnimations().map((a) => a.finished)).then(() => undefined),
  );
  const inset = await dialog.getByPlaceholder('搜索 Agent…').evaluate((el) => {
    const box = el.parentElement as HTMLElement;
    const body = box.closest('[data-testid="dialog-body"]') as HTMLElement;
    return box.getBoundingClientRect().left - body.getBoundingClientRect().left;
  });
  expect(inset).toBeCloseTo(20, 1);
});

test('agent dialog family law: X, Escape and backdrop dismiss; panel clicks do not', async ({
  page,
}) => {
  let dialog = await openAgentDialog(page);
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toBeHidden();

  dialog = await openAgentDialog(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  dialog = await openAgentDialog(page);
  await dialog.getByText('选择总管 Agent').click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(dialog).toBeHidden();
});

test('agent dialog search filters the list; no match shows the empty row', async ({ page }) => {
  const dialog = await openAgentDialog(page);
  await dialog.getByPlaceholder('搜索 Agent…').fill('不存在');
  await expect(dialog.getByRole('option')).toHaveCount(0);
  await expect(dialog.getByText('没有匹配的 Agent')).toHaveText('没有匹配的 Agent');
  await dialog.getByPlaceholder('搜索 Agent…').fill('r3');
  await expect(dialog.getByRole('option')).toHaveCount(1);
});

test('fixture agent pick closes the dialog (accept 律)', async ({ page }) => {
  const dialog = await openAgentDialog(page);
  await dialog.getByRole('option').click();
  await expect(dialog).toBeHidden();
});

async function openCharterDialog(page: Page) {
  await page.goto(CHARTER_TAB);
  await page.getByRole('button', { name: '编辑' }).click();
  const dialog = page.getByRole('dialog', { name: '编辑章程' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('charter 编辑 opens the DialogShell editor with the r5 captured fields', async ({ page }) => {
  const dialog = await openCharterDialog(page);
  await expect(dialog).toHaveAttribute('aria-label', '编辑章程');
  // §5.3 正典：charter textarea 载体 = dialog scope getByRole('textbox')。
  await expect(dialog.getByRole('textbox')).toHaveAttribute(
    'placeholder',
    '长期指令：模型路由规则（何种任务使用何种模型）、优先级、偏好…',
  );
  await expect(dialog.getByRole('button', { name: '取消' })).toHaveText('取消');
  await expect(dialog.getByRole('button', { name: '保存章程' })).toHaveText('保存章程');
});

test('charter dialog family law: X, Escape, 取消 and backdrop dismiss', async ({ page }) => {
  let dialog = await openCharterDialog(page);
  await dialog.getByRole('button', { name: '关闭' }).click();
  await expect(dialog).toBeHidden();

  dialog = await openCharterDialog(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  dialog = await openCharterDialog(page);
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(dialog).toBeHidden();

  dialog = await openCharterDialog(page);
  await dialog.getByText('编辑章程').click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(20, 20);
  await expect(dialog).toBeHidden();
});

test('fixture charter save closes the dialog (accept 律)', async ({ page }) => {
  const dialog = await openCharterDialog(page);
  await dialog.getByRole('textbox').fill('优先派给 r3-builder。');
  await dialog.getByRole('button', { name: '保存章程' }).click();
  await expect(dialog).toBeHidden();
});

// #772 空态卡统一：memo 与 watches/charter-empty 同为居中 + 卡片随文案
// 长高（英文两行不再顶出卡片）。tab 文案与记忆页互引按票面冻结，只钉几何。
test('空态卡 centered and growth-proof: memo matches watches (#772)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pacman.locale', 'en');
    localStorage.setItem('pacman-locale', 'en');
    localStorage.setItem('pacman-theme', 'light');
  });
  // #950 载体：空态卡 = 卡内文案本身（en locale 面；.chief-memo/.chief-watches
  // 类退役，文本直挂卡 div）。
  for (const [scenario, copy] of [
    ['103', /No Agent selected yet/],
    ['104', /Nothing being watched yet/],
  ] as const) {
    await page.goto(`/app?scenario=${scenario}`);
    const card = page.getByText(copy);
    await expect(card).toBeVisible();
    const geo = await card.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        centered: cs.justifyContent === 'center',
        contained: el.scrollHeight <= Math.ceil(r.height) + 1,
      };
    });
    expect(geo.centered).toBe(true);
    expect(geo.contained).toBe(true);
  }
});

// —— #903(ADR 0014):派发设置槽已删——「派发方式」行退场,判定权归
// chief(run_builds withPlan 逐次判定 + dispatchReason 回执)。失败方式:
// 1. 僵尸控件:设置槽删了但 Agent tab 还留着「派发方式」行/触发钮(哑控件,
//    用户拨了不生效 = 比没有更坏);
// 2. 拆过头:邻座决策面(绑定 Agent 行/只读信息卡)被连带拆掉。
// chief 判定面(缺省先规划 / withPlan:false 直修 / 理由回显)是 server 缝,
// 归 chief.test.ts + live 探针(docs/verify/903/)钉,不在 fixture 面。

test('Agent tab 无「派发方式」行:设置槽已删,邻座决策面健在(#903+#1260)', async ({ page }) => {
  await page.goto(AGENT_TAB);
  await expect(page.getByRole('heading', { name: '派发方式' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '派发方式' })).toHaveCount(0);
  // #1260 邻座面:压缩模型/机器选择器随覆盖槽退役;绑定行 + 只读信息卡在位。
  await expect(page.getByRole('button', { name: '未设置' })).toHaveCount(1);
  await expect(page.getByTestId('chief-follows-agent')).toBeVisible();
  await expect(page.getByRole('button', { name: '压缩模型' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '机器', exact: true })).toHaveCount(0);
});
