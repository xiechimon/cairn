import { expect, type Page, test } from '@playwright/test';
// #1035 常态（chief 未停靠）看板在缩放宽视口下的四列自适应：地板按
// data-chief-open 劈开——常态 --board-col-min (200px, tokens.css)，停靠态
// --board-col-min-docked (280px, #692 语义不动，board-docked-reflow.spec
// 钉它)。病灶（main 实测 2026-10-08）：单态 280px 地板在 110% 缩放
// （1440 物理宽 → CSS 视口 1309）接管，scrollWidth 1196 > clientWidth
// 1069，第 4 列出屏——阈值 1440/1436 ≈ 100.3%，任何 >100.3% 的缩放都中招。
// 缩放模拟 = CSS 视口等价宽（浏览器缩放 z% 于 1440 物理宽 → 视口 1440/z；
// 布局几何只由 CSS 像素决定，devicePixelRatio 不参与本链路）。
// 每条用例钉一个失败方式，全部断言几何，不断言 CSS 数值：
// 1. 常态窄视口地板仍接管：110%/120%/125% 三档（125% = 200px 地板的
//    实测极限档；248 sidebar 后 (1152−248−34−42)/4 ≈ 207 ≥ 200 → 125%
//    四列也 fit，见下方专测；120% (1200) 仍 fit）scroller 横溢
//    或第 4 列不完整落窗（用户报障本体）
// 2. 页面级漏溢：任一档位 documentElement.scrollWidth > clientWidth
//    （三层 overflow 必须把一切兜在 .board-scroller 里）
// 3. 地板被整个摘掉（minmax(0,1fr) 作弊修法 / min() 反例的常态侧）：
//    1024 常态列跌破 200 下限——常态地板仍要生效，放不下走诚实横滚
// 4. 悬浮窗开窗把地板连带劈坏（票面 min() 反例：track 里写 min(...) 让
//    地板永不生效、窄视口横滚消失）：ADR 0013 D1 让位退役后窗是覆盖层，
//    窄视口开窗后列几何必须与常态逐值相同（≥200 地板 + _fit 不变）
// 5. 最小化不回归几何：同一视口内窗开合全程零内容位移（覆盖层契约）
// 6. 最坏数据在边界宽破栏：125% 档超长标题卡横向溢出列
const STRESS = '/app?scenario=board-stress';
const NATURAL_FLOOR = 200; // --board-col-min（单态）的镜像值：钉几何，不读 CSS 变量

// 1440 物理宽下的缩放 → CSS 视口宽（1440/z 取整）
const ZOOM_LEVELS = [
  { zoom: '110%', width: 1309 },
  { zoom: '120%', width: 1200 },
];

const drawer = (page: Page) => page.locator('.chief-drawer');
const scroller = (page: Page) => page.getByTestId('board-scroller');

/** scroller 可视窗 + 四列盒（board-docked-reflow.spec measure 同式）。 */
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

const pageSpill = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test.describe('natural-state board fits the zoomed-out-equivalent viewports (#1035)', () => {
  for (const { zoom, width } of ZOOM_LEVELS) {
    test(`no horizontal scroll at ${zoom} zoom (${width}px CSS viewport), all 4 columns whole`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 732 });
      await page.goto(STRESS);
      await page.waitForSelector('[data-column]');

      // 失败方式 1：常态窄视口地板接管（改前 1309 档 scrollWidth 1196 >
      // clientWidth 1069，第 4 列出屏）
      const m = await measure(page);
      expect(m.columns).toHaveLength(4);
      expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
      const last = m.columns[3]!;
      expect(last.right).toBeLessThanOrEqual(m.scroller.right + 1);
      // 常态地板仍在（列不许跌破 200——125% 档流值 ~209 贴着下限过）
      for (const c of m.columns) expect(c.width).toBeGreaterThanOrEqual(NATURAL_FLOOR - 1);
      // 失败方式 2：溢出漏给页面
      expect(await pageSpill(page)).toBeLessThanOrEqual(0);
    });
  }

  test('125% zoom (1152): 248 sidebar keeps the flow above the floor — four columns fit', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1152, height: 732 });
    await page.goto(STRESS);
    await page.waitForSelector('[data-column]');
    const m = await measure(page);
    for (const c of m.columns) expect(c.width).toBeGreaterThanOrEqual(NATURAL_FLOOR - 1);
    expect(m.scrollWidth).toBeLessThanOrEqual(m.clientWidth);
    expect(await pageSpill(page)).toBeLessThanOrEqual(0);
  });

  test('natural floor still holds at 1024: honest scroll instead of collapsed columns', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 732 });
    await page.goto(STRESS);
    await page.waitForSelector('[data-column]');

    // 失败方式 3：把地板整个摘掉的作弊修法。1024 常态可用
    // 1024−248 = 776，流值 (776−76)/4 = 175 < 200 → 下限必须接管：
    // 列守 200、溢出走 scroller 诚实横滚（#692 语义的常态延伸）。
    const m = await measure(page);
    for (const c of m.columns) expect(c.width).toBeGreaterThanOrEqual(NATURAL_FLOOR - 1);
    expect(m.scrollWidth).toBeGreaterThan(m.clientWidth);
    expect(await pageSpill(page)).toBeLessThanOrEqual(0);
  });

  test('the floating window never re-arms a docked floor (yield retired, ADR 0013 D1)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1309, height: 732 });
    await page.goto(STRESS);
    await page.waitForSelector('[data-column]');
    const natural = await measure(page);
    expect(natural.scrollWidth).toBeLessThanOrEqual(natural.clientWidth);

    // 失败方式 4（退役后形态）：悬浮窗是覆盖层——开窗后 board 几何与常态
    // 逐值相同（无 280 地板复活、无横滚回归；#1035 两态随让位退役收单态）。
    await page.keyboard.press('Meta+j');
    await expect(drawer(page)).toBeVisible();
    await drawer(page).evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const open = await measure(page);
    expect(open.scrollWidth).toBeLessThanOrEqual(open.clientWidth);
    for (const c of open.columns) expect(c.width).toBeGreaterThanOrEqual(NATURAL_FLOOR - 1);
    expect(open.columns.map((c) => Math.round(c.width))).toEqual(
      natural.columns.map((c) => Math.round(c.width)),
    );

    // 失败方式 5（退役后形态）：最小化同样零几何变化（覆盖层开合不动内容）
    await drawer(page).getByRole('button', { name: '最小化' }).click();
    await expect(drawer(page)).toBeHidden();
    const restored = await measure(page);
    expect(restored.scrollWidth).toBeLessThanOrEqual(restored.clientWidth);
    for (const c of restored.columns) expect(c.width).toBeGreaterThanOrEqual(NATURAL_FLOOR - 1);
    expect(await pageSpill(page)).toBeLessThanOrEqual(0);
  });

  test('worst-case card data stays in-column at the 125% boundary width', async ({ page }) => {
    await page.setViewportSize({ width: 1152, height: 732 });
    await page.goto(STRESS);
    await page.waitForSelector('[data-todo-id]');

    // 失败方式 6：边界宽（列 ~209px）下超长标题把卡撑出列
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
  });
});
