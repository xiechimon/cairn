import { expect, type Page, test } from '@playwright/test';
// ADR 0013 D1 (#1009 A0, superseding the #692 docked-reflow face): 悬浮窗是
// 覆盖层——board 列不再随窗开合变轨。本 spec 的原停靠面（--board-col-min-docked
// 280 地板 + data-chief-open 两态 + 让位横滚）随 0004 D2/D8 整体退役；常态
// 地板（200px）与缩放档自适应由 board-zoom-fit.spec 钉。本 spec 的新契约 =
// **窗开合全程零 board 几何变化**（覆盖层律），在原停靠应力面上逐条对拍：
// 1440 静止、1024 窄窗诚实横滚、RTL 镜像、最坏数据、卡宽、滚动条披露。
// 病灶记忆（#692，2026-10-03 实测）：旧 240px 开态护栏在 1440 停靠态恰好
// 排满三列、第四列只剩 ~3px 残边且滚动条被隐藏——「让位」族病灶的通用形态
// 是内容几何随面板态跳变；覆盖层的对立面即「开合零跳变」，本 spec 钉它。
// 每条用例钉一个失败方式，全部断言几何（bounding box / scroll 行为），
// 不断言 CSS 数值（数值断言会被「改了但没用」骗过；scrollbar-width 是
// 披露机制本体，单独一条钉它）：
// 1. 开窗把列压扁/撑变：开态列宽与关态逐值不等（或跌破 200 下限）
// 2. 开窗改变横滚态：关态无横滚的面开窗长出横滚（或反之）
// 3. 开窗后溢出不可达：横滚不动，或滚到底末列不完整（覆盖层不得挡滚动）
// 4. 开窗后披露机制失效：scrollbar-width 不再是 auto
// 5. 开窗把卡挤瘪：开态卡宽与关态差超过 1px
// 6. 开窗下最坏数据塌版：超长标题卡横向溢出列、120 计数撑破列头、空列消失
// 7. 窄窗（1024）开窗：地板失守或页面自身横向溢出
// 8. RTL 镜像开窗塌版：dir=rtl 下首列不在滚动起点缘完整可见
// 9. 静止面回归：1440 关态列宽/无横滚与改前逐值一致（≥1440 流值 281 >
//    200 下限，token 不介入）
// #943/#910 载体：scroller = data-testid（二级：无 role 滚动容器）、列 =
// 既有 [data-column]、卡 = [data-todo-id]、卡标题 = h3、列头 = header 标签、
// 空态 = 一级 text（r2 §4.1 正典文案）。窗开态 = .chief-drawer 可见
// （data-chief-open 标记随让位退役）。
const STRESS = '/app?scenario=board-stress';
const FLOOR = 200; // --board-col-min（单态地板，#1035 两态退役后）的镜像值

const drawer = (page: Page) => page.locator('.chief-drawer');
const scroller = (page: Page) => page.getByTestId('board-scroller');

/** ⌘J 开窗并等入场动画落定（chief-panel.spec settled 同式：fade+scale 的
 *  animation finished 后才可量几何，ADR 0013 D7）。 */
async function openWindow(page: Page) {
  await page.keyboard.press('Meta+j');
  await expect(drawer(page)).toBeVisible();
  await drawer(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

/** scroller 可视窗 + 四列盒（几何单源，所有用例共用同一量法）。 */
function measure(page: Page) {
  return scroller(page).evaluate((el) => {
    const s = el.getBoundingClientRect();
    return {
      scroller: { left: s.left, right: s.right, width: s.width },
      clientWidth: el.clientWidth,
      scrollWidth: el.scrollWidth,
      scrollLeft: el.scrollLeft,
      columns: [...el.querySelectorAll('[data-column]')].map((c) => {
        const r = c.getBoundingClientRect();
        return {
          id: c.getAttribute('data-column'),
          left: r.left,
          right: r.right,
          width: r.width,
        };
      }),
    };
  });
}

const roundCols = (m: Awaited<ReturnType<typeof measure>>) =>
  m.columns.map((c) => ({ id: c.id, left: Math.round(c.left), width: Math.round(c.width) }));

test.describe('board never reflows under the floating chief window (ADR 0013 D1)', () => {
  test('window open leaves the 1440 columns at their closed geometry', async ({ page }) => {
    await page.goto(STRESS);
    await page.waitForSelector('[data-column]');
    const closed = await measure(page);
    expect(closed.columns).toHaveLength(4);
    expect(closed.scrollWidth).toBeLessThanOrEqual(closed.clientWidth);

    await openWindow(page);
    const open = await measure(page);
    // 失败方式 1+2：覆盖层开合零列几何/横滚态跳变
    expect(roundCols(open)).toEqual(roundCols(closed));
    expect(open.scrollWidth).toBeLessThanOrEqual(open.clientWidth);
    for (const c of open.columns) expect(c.width).toBeGreaterThanOrEqual(FLOOR - 1);
  });

  test('narrowest usable viewport (1024): honest scroll identical open and closed', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 732 });
    await page.goto(STRESS);
    await page.waitForSelector('[data-column]');
    const closed = await measure(page);
    // 窄窗常态地板接管：诚实横滚（#692 语义的常态延伸，board-zoom-fit 同钉）
    expect(closed.scrollWidth).toBeGreaterThan(closed.clientWidth);
    for (const c of closed.columns) expect(c.width).toBeGreaterThanOrEqual(FLOOR - 1);

    await openWindow(page);
    const open = await measure(page);
    // 失败方式 7 的对拍面：开窗不改变地板与横滚态
    expect(roundCols(open)).toEqual(roundCols(closed));
    expect(open.scrollWidth).toBeGreaterThan(open.clientWidth);
    const pageSpill = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(pageSpill).toBeLessThanOrEqual(0);
  });

  test('overflow stays reachable while the window is open', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 732 });
    await page.goto(STRESS);
    await page.waitForSelector('[data-column]');
    await openWindow(page);

    // 失败方式 3：覆盖层不得挡横滚（wheel 时序坑照 board-overflow.spec：
    // 合成器帧上 poll 到离开 0 再断言）。
    const box = await scroller(page).boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + 40);
    await page.mouse.wheel(300, 0);
    await expect
      .poll(async () => (await measure(page)).scrollLeft, { timeout: 2000 })
      .toBeGreaterThan(0);

    await scroller(page).evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
    const end = await measure(page);
    const last = end.columns[3]!;
    // 滚到底：末列完整落窗（右缘不外溢、左缘在窗内）
    expect(last.right).toBeLessThanOrEqual(end.scroller.right + 1);
    expect(last.left).toBeGreaterThanOrEqual(end.scroller.left - 1);
    expect(last.width).toBeGreaterThanOrEqual(FLOOR - 1);
  });

  test('overflow discloses itself while the window is open: scrollbar stays native', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 732 });
    await page.goto(STRESS);
    await page.waitForSelector('[data-column]');
    await openWindow(page);
    // 失败方式 4：披露机制本体（参考站 scrollbar-width: auto 同值；
    // auto 只在真溢出时画轨道，静止 1440 无溢出即无滚动条）
    await expect(scroller(page)).toHaveCSS('scrollbar-width', 'auto');
  });

  test('cards keep their exact width across window open/close', async ({ page }) => {
    await page.goto(STRESS);
    await page.waitForSelector('[data-todo-id]');
    const resting = await page
      .locator('[data-column="todo"] [data-todo-id]')
      .first()
      .boundingBox();
    expect(resting).not.toBeNull();
    await openWindow(page);
    const open = await page
      .locator('[data-column="todo"] [data-todo-id]')
      .first()
      .boundingBox();
    expect(open).not.toBeNull();
    // 失败方式 5：覆盖层零挤瘪——开合卡宽逐值同（容差 1px 吃亚像素）
    expect(Math.abs(open!.width - resting!.width)).toBeLessThanOrEqual(1);
  });

  test('worst-case data holds while the window is open', async ({ page }) => {
    await page.goto(STRESS);
    await page.waitForSelector('[data-todo-id]');
    await openWindow(page);

    // 失败方式 6a：超长不可断行标题把卡撑出列（横向溢出）
    const card = page.locator('[data-column="todo"] [data-todo-id]').first();
    const overflow = await card.evaluate((el) => ({
      spill: el.scrollWidth - el.clientWidth,
      titleSpill: (() => {
        const t = el.querySelector('h3');
        return t == null ? 0 : t.scrollWidth - t.clientWidth;
      })(),
    }));
    expect(overflow.spill).toBeLessThanOrEqual(1);
    expect(overflow.titleSpill).toBeLessThanOrEqual(1);

    // 失败方式 6b：三位数列头计数撑破列头
    const header = page.locator('[data-column="building"] header');
    await expect(header).toContainText('120');
    const headSpill = await header.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(headSpill).toBeLessThanOrEqual(1);

    // 失败方式 6c：空列在下限宽下消失或塌窄
    const m = await measure(page);
    const pending = m.columns.find((c) => c.id === 'pending');
    expect(pending).toBeDefined();
    expect(pending!.width).toBeGreaterThanOrEqual(FLOOR - 1);
    await expect(
      page.locator('[data-column="pending"]').getByText('暂无', { exact: true }),
    ).toBeVisible();
  });

  test('RTL mirror: the first column stays whole at the scroll-start edge while open', async ({
    page,
  }) => {
    await page.goto(STRESS);
    await page.waitForSelector('[data-column]');
    // 应用尚未出 RTL 词表；本条钉的是布局原语的方向无关性（grid +
    // overflow 随 dir 镜像），dir 由文档根注入。
    await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    await openWindow(page);

    const m = await measure(page);
    const byId = Object.fromEntries(m.columns.map((c) => [c.id, c]));
    // 失败方式 8：镜像后首列跑到裁切缘。RTL 滚动起点 = 右缘：todo 列
    // 必须完整贴右窗缘，列序整体反转。
    expect(byId.todo!.right).toBeLessThanOrEqual(m.scroller.right + 1);
    expect(byId.todo!.right - byId.todo!.left).toBeGreaterThanOrEqual(FLOOR - 1);
    expect(byId.todo!.left).toBeGreaterThan(byId.building!.left);
    expect(byId.building!.left).toBeGreaterThan(byId.pending!.left);
    expect(byId.pending!.left).toBeGreaterThan(byId.done!.left);
  });

  test('resting geometry at 1440 is untouched by the floor token', async ({ page }) => {
    await page.goto('/app?scenario=01');
    await page.waitForSelector('[data-column]');
    // 失败方式 9：静止面回归——1440 流值 (1166−42)/4 = 281 > 200，
    // token 不介入：四列等宽 ~281、无横滚（与改前实测逐值一致）。
    const m = await measure(page);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
    expect(m.columns).toHaveLength(4);
    const first = m.columns[0]!.width;
    expect(first).toBeGreaterThan(FLOOR);
    expect(first).toBeLessThan(282);
    for (const c of m.columns) expect(Math.abs(c.width - first)).toBeLessThanOrEqual(1);
  });
});
