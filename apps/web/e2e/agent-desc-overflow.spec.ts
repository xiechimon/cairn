import { expect, test } from '@playwright/test';
import { stubNotification } from './helpers.js';

// #1243 agent.description 长文本在两处渲染面溢出：团队卡固定高溢卡盒、
// 详情页值槽 flex-none 撑破行宽（#1243 票面四失败方式 + 三面定位 + 两
// e2e 断言 + account 回归各钉一条）。
//
// 失败方式（先于实现固化）：
// 1. 团队卡 76px 固定高下 610 字多行职责文字画在卡外 → 卡 scrollHeight > clientHeight
// 2. 详情页单行长文撑破行宽出屏 → 值槽 scrollWidth > clientWidth
// 3. 详情页左 label 列被挤成单字宽竖排 → label 列宽度 < 双字符宽
// 4. whitespace-pre-line 把编辑态草稿的多余空行带进显示态 → 3+ 换行折成 2 个
// 5. 值槽改可收缩后 account 页模板行（推送通知 Switch）无回归 → 现有断言全绿

const TEAM_LONG = '/app/team?scenario=team-long-role';
const DETAIL_LONG = '/app/resources/agents/r3-builder?scenario=agent-detail-long-role';

test('团队卡：line-clamp-2生效，卡 scrollHeight = clientHeight（无溢出）', async ({ page }) => {
  await page.goto(TEAM_LONG);
  const card = page.getByTestId('team-agent-card');
  await expect(card).toBeVisible();
  const geom = await card.evaluate((el) => ({
    scrollH: el.scrollHeight,
    clientH: el.clientHeight,
    scrollW: el.scrollWidth,
    clientW: el.clientWidth,
  }));
  expect(geom.scrollH).toBeLessThanOrEqual(geom.clientH);
  expect(geom.scrollW).toBeLessThanOrEqual(geom.clientW);
});

// 职责行的文本在卡上有 title 属性（全文 tooltip）。
test('团队卡：长职责 span 有 title 属性带全文', async ({ page }) => {
  await page.goto(TEAM_LONG);
  const card = page.getByTestId('team-agent-card');
  // team-agent-card 下的第三个 span = 职责行（名 → 模型行 → 职责行）
  const roleSpan = card.locator('span.line-clamp-2');
  await expect(roleSpan).toBeVisible();
  const title = await roleSpan.getAttribute('title');
  expect(title).not.toBeNull();
  expect(title!.length).toBeGreaterThan(100); // 长文 title
});

// 详情页：值槽不破行宽（scrollWidth <= clientWidth）、label 列不竖排
// （label 列宽度 ≥ 两个 14px 中文字符宽）。
test('详情页：长职责不撑破行宽，label 列不竖排', async ({ page }) => {
  await page.goto(DETAIL_LONG);
  const detail = page.locator('.agent-detail');
  await expect(detail).toBeVisible();
  // 职责行 = .agent-role-text 所在行
  const roleText = detail.locator('.agent-role-text');
  await expect(roleText).toBeVisible();
  // 值槽 scrollWidth ≤ clientWidth（无横向溢出）
  const textGeom = await roleText.evaluate((el) => ({
    scrollW: el.scrollWidth,
    clientW: el.clientWidth,
  }));
  expect(textGeom.scrollW).toBeLessThanOrEqual(textGeom.clientW + 1); // 允许 1px 取整

  // label 列不竖排：宽度 ≥ 28px（两个 14px 中文单字宽，「职责」= 2 字）
  const label = detail.locator('.agent-field-label').filter({ hasText: '职责' });
  const labelGeom = await label.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return { w: rect.width };
  });
  expect(labelGeom.w).toBeGreaterThanOrEqual(28);
});

// 显示态 trim + 连续空行折叠：3+ 换行 → 2 个换行（显示态保留段落间一个空行）。
test('详情页：显示态 trim + 折叠连续空行（3+ 换行 → 2 个）', async ({ page }) => {
  await page.goto(DETAIL_LONG);
  const roleText = page.locator('.agent-role-text');
  const text = await roleText.textContent();
  expect(text).not.toBeNull();
  // 原串含 3 个连续空行（位置在倒数第三段前），显示态应折叠为 1 个空行（即不会出现
  // 三个连续换行符）。
  expect(text!).not.toMatch(/\n{3,}/);
  // trim 后不以空行开头
  expect(text!).not.toMatch(/^\s/);
  // trim 后不以空白结尾
  expect(text!).not.toMatch(/\s$/);
});

// 作者换行保留（多行段落间单换行 ≠ 段落间空行）。
test('详情页：显示态保留作者换行（段落间单换行仍在）', async ({ page }) => {
  await page.goto(DETAIL_LONG);
  const roleText = page.locator('.agent-role-text');
  const text = await roleText.textContent();
  // 原文 7 段（6 个段落分隔：4 个单换行 + 2 个折叠后的双换行）。
  // 四个段落间应为单换行分隔（非全挤一行）。
  expect(text!).toContain('\n');
  // 整段文本 > 200 字（不是被截断或塌缩）
  expect(text!.length).toBeGreaterThan(200);
});

// account 页的推送通知行（denied 态走 auto 档 + Switch）：值槽改 min-w-0
// flex-[1_1_auto] 后 Switch 不应被挤压或换行。
test('account 页：推送通知行（auto 档）值槽改可收缩后无回归', async ({ page }) => {
  // denied 态 = notifyBlocked = true → hint 存在（auto 档）。
  // stubNotification 必须在 goto 前 addInitScript（account-controls.spec 同律）。
  await stubNotification(page, 'denied', 'denied');
  await page.goto('/app/account?scenario=13-notify-denied');
  const card = page.locator('.account-card');
  await expect(card).toBeVisible();
  // 推送通知 Switch 可找到
  const notifSwitch = page.getByRole('switch', { name: '推送通知' });
  await expect(notifSwitch).toBeVisible();
  // 点开 Switch 触发 hint 出现（denied 态 = auto 档激活）
  await notifSwitch.click();
  const hint = card.locator('.account-notify-blocked');
  await expect(hint).toBeVisible();
  // 行盒几何无溢出
  const row = card.locator('.settings-row').last();
  const geom = await row.evaluate((el) => ({
    scrollH: el.scrollHeight,
    clientH: el.clientHeight,
    scrollW: el.scrollWidth,
    clientW: el.clientWidth,
  }));
  expect(geom.scrollH).toBeLessThanOrEqual(geom.clientH);
  expect(geom.scrollW).toBeLessThanOrEqual(geom.clientW);
});