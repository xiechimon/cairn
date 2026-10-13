import { expect, test } from '@playwright/test';

// 2026-10-13 状态点动效 + 侧栏 wide-in（用户 review 钉「3和5 都要，6 也模仿
// 一下，只是不换 spinner」的 5/6 两项；3 = TurnNavigator 另案）。配方源 =
// dsh StateDot / SidebarRoot / WorkspaceBrowser 源码实测。
//
// 失败方式（先固化）：
//   S1 在飞卡零徽标（badgeFor 对 planning/building 返 null）——看板上
//     「正在跑」不可见；修复后 building 卡头像角挂状态弧。
//   S2 同屏多枚弧错相——CSS 动画随挂载各自起跑；pinStateArc 把 startTime
//     钉 0（dsh syncSpinner 同律），钉住「已钉」这件事本身。
//   S3 reduced-motion 下弧仍转——降级 = 静止弧（dsh dasharray 18 150
//     offset -3 形），motion/run 两件 animation none。
//   S4 实心徽标面被误伤——done/failed/attention/idle 卡照旧出实心徽标，
//     且不挂弧。
//   S5 wide-in 缺席——展开侧栏与看板卡格挂载时 200ms 淡入（dsh SidebarRoot
//     / WorkspaceBrowser 的 .wide 同律）。
//   S6 折叠 rail 误播——rail 形不挂 wide-in（dsh：cold collapsed render
//     stays static）。

const DRAG_MATRIX = '/app?scenario=board-drag-matrix';

test.describe('状态弧（dsh StateDot ongoing 对齐）', () => {
  test('S1/S4: building 卡挂状态弧，实心徽标各相照旧且不挂弧', async ({ page }) => {
    await page.goto(DRAG_MATRIX);
    await page.waitForSelector('[data-todo-id="dm-building"]');

    const arc = page.locator('[data-todo-id="dm-building"] [data-testid="todo-state-arc"]');
    await expect(arc).toHaveCount(1);
    // 实心徽标面零回归：done/failed/attention 卡各有徽标、零弧。
    for (const id of ['dm-done-plain', 'dm-failed', 'dm-review', 'dm-confirm']) {
      const card = page.locator(`[data-todo-id="${id}"]`);
      await expect(card.locator('[data-testid="todo-state-arc"]')).toHaveCount(0);
      await expect(card.locator('[class*="todo-agent-badge--"]')).toHaveCount(1);
    }
  });

  test('S2: 弧的动画 startTime 钉 0（同屏同相的前提）', async ({ page }) => {
    await page.goto(DRAG_MATRIX);
    const arc = page.locator('[data-todo-id="dm-building"] [data-testid="todo-state-arc"]');
    await arc.waitFor();
    const starts = await arc.evaluate((el) =>
      el.getAnimations({ subtree: true }).map((a) => a.startTime),
    );
    expect(starts.length).toBeGreaterThanOrEqual(2); // spin + dash 双动画
    for (const s of starts) expect(s).toBe(0);
  });

  test('S3: reduced-motion 下弧静止', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(DRAG_MATRIX);
    const arc = page.locator('[data-todo-id="dm-building"] [data-testid="todo-state-arc"]');
    await arc.waitFor();
    const motion = await arc
      .locator('.state-arc-motion')
      .evaluate((el) => getComputedStyle(el).animationName);
    const run = await arc
      .locator('.state-arc-run')
      .evaluate((el) => getComputedStyle(el).animationName);
    expect(motion).toBe('none');
    expect(run).toBe('none');
    await ctx.close();
  });
});

test.describe('wide-in 挂载淡入（dsh SidebarRoot / WorkspaceBrowser 对齐）', () => {
  test('S5: 展开侧栏与看板卡格挂载播 wide-in 200ms', async ({ page }) => {
    await page.goto(DRAG_MATRIX);
    await page.waitForSelector('[data-todo-id="dm-building"]');
    const sidebar = page.locator('aside.board-sidebar').first();
    const scroller = page.locator('[data-testid="board-scroller"]');
    for (const el of [sidebar, scroller]) {
      const anim = await el.evaluate((e) => getComputedStyle(e).animationName);
      const dur = await el.evaluate((e) => getComputedStyle(e).animationDuration);
      expect(anim).toBe('wide-in');
      expect(dur).toBe('0.2s');
    }
  });

  test('S6: 折叠 rail 不播 wide-in', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('pacman.sidebar-collapsed', '1');
    });
    await page.goto(DRAG_MATRIX);
    await page.waitForSelector('aside.board-sidebar--collapsed');
    const rail = page.locator('aside.board-sidebar--collapsed');
    await expect(rail).toBeVisible();
    const anim = await rail.evaluate((e) => getComputedStyle(e).animationName);
    expect(anim).toBe('none');
  });
});
