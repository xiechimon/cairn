import { expect, test } from '@playwright/test';
import { stubNotification } from './helpers.js';

// Issue #148 acceptance (台账 #136 account/team 行, local-first 裁决):
// - account: 退出登录 / 删除 (the SaaS account-deletion face) no longer
//   render; 更换 removed by #306 (M7 二分律出账: no avatar upload face,
//   the asset is static — supersedes #148's keep-as-chrome ruling).
// - account 推送通知 switch：#1031 起开关 = 用户偏好档（本地持久化），不再
//   单向镜像 Notification.permission——「关」在 granted 态也落地，「开」在
//   denied 态是偏好表达 + 拦截解释；非 granted 态的开仍驱动 #114 banner 同
//   一条 requestPermission() 路径（shared useNotificationPermission）。双向
//   持久面与 fixture 三态表达面的完整验收在 account-controls.spec.ts。
//   Live mode only — no ?scenario= — because the fixture rows freeze the
//   switch granted for the r7 13 baseline (the headless chromium reports
//   the real API 'denied').
// - team: 设置 routes to the account surface (the app's only settings
//   face); the grid|chart tablist is a real toggle persisted to
//   cairn.teamMembersLayout — chart drops the stats bar + grid's 创建
//   Agent slot and renders the org chart instead (#490；此前它恒渲染
//   暂无成员，与同数据下的 grid 自相矛盾。chart 的完整验收面在
//   team-org-chart.spec.ts，此处只留 tablist 往返本身).
// #947/#910 载体重钉：.account-switch → getByRole('switch')（aria-label
// 推送通知）；.secondary-link → getByRole('link', {name:'设置'})；
// .team-layout-tab → getByRole('tab')；.team-agent-card/.team-chart-node →
// data-testid 二级；.team-members → 文案一级；.team-create-agent（grid 槽）
// → team-agent-grid 容器（chart 布局整格退场）。.account-card/.account-avatar/
// .settings-row = settings-list 共享模板家族锚，规则不住 secondary.css，保留。
// 行为断言语义一字不动。

test('account: 退出登录 / 删除 / 更换 removed (avatar stays)', async ({ page }) => {
  await page.goto('/app/account?scenario=13');
  await expect(page.locator('.account-card')).toBeVisible();
  await expect(page.locator('.account-logout')).toHaveCount(0);
  await expect(page.locator('.account-delete')).toHaveCount(0);
  await expect(page.locator('.account-swap')).toHaveCount(0);
  await expect(page.locator('.account-avatar img')).toBeVisible();
  // XMON-107：邮箱字段位面已删（本地单用户无邮箱账位面）——卡片只剩
  // 语言 / 密度 / 推送通知三行（名称在卡上方的头部），且不再出现「邮箱」文案。
  await expect(page.locator('.account-card .settings-row')).toHaveCount(3);
  await expect(page.locator('.account-card')).not.toContainText('邮箱');
});

test('account switch: default permission renders off; click requests and grants', async ({
  page,
}) => {
  await stubNotification(page, 'default', 'granted');
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => window.__permCalls)).toBe(1);
});

test('account switch: granted permission renders checked without a click', async ({ page }) => {
  await stubNotification(page, 'granted', 'granted');
  await page.goto('/app/account');
  await expect(page.getByRole('switch', { name: '推送通知' })).toHaveAttribute(
    'aria-checked',
    'true',
  );
  expect(await page.evaluate(() => window.__permCalls)).toBe(0);
});

test('account switch: denied 态点击落偏好开档 + 拦截解释（#1031 语义改写）', async ({ page }) => {
  await stubNotification(page, 'denied', 'denied');
  await page.goto('/app/account');
  const sw = page.getByRole('switch', { name: '推送通知' });
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await sw.click();
  // 旧面（#148 钉）在此断言恒 false——那是 #1031 的缺陷现场：处理器只在
  // checked===true 时动作，granted/denied 两态点「关/开」都是结构性空操作。
  // 新语义：开关是偏好档，denied 态点开 = 偏好落地（持久），权限拦截由
  // hint 解释（不能「显示开、实际不弹」裸奔）。
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(await page.evaluate(() => window.__permCalls)).toBe(1);
  await expect(page.locator('.account-notify-blocked')).toContainText('重新允许');
});

test('team: 设置 routes to the account surface', async ({ page }) => {
  await page.goto('/app/team?scenario=12');
  await page.getByRole('link', { name: '设置', exact: true }).click();
  await expect(page).toHaveURL(/\/app\/account/);
  await expect(page.locator('.account-card')).toBeVisible();
});

test('team: chart tab swaps to the org chart, persists, and returns', async ({ page }) => {
  await page.goto('/app/team?scenario=12');
  const gridTab = page.getByRole('tab', { name: 'grid' });
  const chartTab = page.getByRole('tab', { name: 'chart' });
  await expect(page.getByTestId('team-agent-card').first()).toBeVisible();

  // scenario 12 的团队有 1 个成员 —— chart 渲染组织图，不是 暂无成员
  await chartTab.click();
  await expect(page.getByTestId('team-chart-node')).toHaveCount(1);
  await expect(page.getByText('暂无成员')).toHaveCount(0);
  await expect(page.getByTestId('team-agent-card')).toHaveCount(0);
  await expect(page.getByTestId('team-agent-grid')).toHaveCount(0);
  await expect(page.getByText(/个成员/)).toHaveCount(0);
  await expect(chartTab).toHaveAttribute('aria-selected', 'true');
  await expect(gridTab).toHaveAttribute('aria-selected', 'false');

  // the choice survives a reload (cairn.teamMembersLayout)
  await page.reload();
  await expect(page.getByTestId('team-chart-node')).toBeVisible();

  // and the tablist is the way back — no trap in chart layout
  await page.getByRole('tab', { name: 'grid' }).click();
  await expect(page.getByTestId('team-agent-card').first()).toBeVisible();
  await expect(page.getByText(/个成员/)).toBeVisible();
});
