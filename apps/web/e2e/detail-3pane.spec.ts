import { expect, test } from '@playwright/test';

// Issue #366: the detail route drops the 文档|聊天 tab group and re-lays
// out as three abutting panes — 288 sidebar | fluid thread | 488 right
// pane (docs/design/todos.dev.md grid). The right pane owns the doc
// surface (plan/changes/diff) plus the three former head-icon overlays
// (分支与 PR / Token 用量 / 运行历史) as static pane sections picked from
// the document-type select; fresh phases render no right pane at all
// (XMON-55 P0 — the brief takes the whole center column). The composer is
// the only card in the center column. Each test pins one failure way of the
// rework:
//   1. pane widths/abutment wrong  2. tab group survives somewhere
//   3. head icon trio survives     4. composer escapes the center column,
//      loses its card form, or overlays the transcript again (#472)
//   5. section switching dead      6. frozen pane-view scenarios
//      (30/31/32) still pop dialogs  7. fresh phase keeps the empty right
//      pane or loses the brief's primary action
//
// #945/#910 重钉：detail.css 退役——本域载体换语义/二级制：壳 =
// [data-route=todo-detail]、侧栏 = 壳的直接 aside、列/主栏/右栏 =
// detail-center / detail-main / detail-right testid、线程列 =
// transcript-col、composer 卡 = composer-card、头带 = detail-main 内的
// header、标题 = detail-title、按钮走 role+文案（更多/停止/发送/总管/
// 打开方案/开始）、dialog 缺席断言走 role=dialog、overlay 缺席断言走
// rerun 文案。跨域类 locator 保留至各自批次：.doc-select-wrap/
// .doc-pane-select/.plan-dropdown*（overlays #949）、.dlg-token-total/
// .dlg-branch-box/.dlg-history-row（detail/overlays.css，detail-b）、
// .chief-drawer（chief #950）。.detail-tab* / .right-empty 是缺席钉
// （零规则死类，钉的就是「这些类名永不回来」），原样保留。

const DETAIL_ROUTE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc';
const FRESH = '/app/todo/fresh-probe?scenario=23';

test('three abutting panes: 288 sidebar | fluid center | 488 right', async ({ page }) => {
  await page.goto(`${DETAIL_ROUTE}?scenario=17b`);
  const geo = await page.evaluate(() => {
    const rect = (sel: string) => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      return { left: r.left, right: r.right, width: Math.round(r.width) };
    };
    return {
      sidebar: rect('[data-route="todo-detail"] > aside'),
      center: rect('[data-testid="detail-center"]'),
      right: rect('[data-testid="detail-right"]'),
    };
  });
  expect(geo.sidebar.width).toBe(288);
  expect(geo.right.width).toBe(488);
  // panes abut — no gap, no overlap (hairline borders ride inside the boxes)
  expect(Math.round(geo.center.left)).toBe(Math.round(geo.sidebar.right));
  expect(Math.round(geo.right.left)).toBe(Math.round(geo.center.right));
  // center takes the fluid remainder (712 at the 1440 e2e viewport)
  expect(geo.center.width).toBe(1440 - 288 - 488);
  // the seam between center and right is a 1px hairline, not a shadow
  const seam = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('[data-testid="detail-right"]')!);
    return { borderLeft: cs.borderLeftWidth, shadow: cs.boxShadow };
  });
  expect(seam.borderLeft).toBe('1px');
  expect(seam.shadow).toBe('none');
});

test('no 文档|聊天 tab group survives on any phase surface', async ({ page }) => {
  for (const scenario of ['16', '17b', '23', '26', '27', '36']) {
    await page.goto(`${DETAIL_ROUTE}?scenario=${scenario}`);
    await expect(page.locator('.detail-tabs-group')).toHaveCount(0);
    await expect(page.locator('.detail-tab')).toHaveCount(0);
    await expect(page.locator('.detail-tabs')).toHaveCount(0);
  }
});

test('detail head keeps the 更多 icon only — branch/token/history icons are gone', async ({
  page,
}) => {
  await page.goto(`${DETAIL_ROUTE}?scenario=27`);
  await expect(page.getByRole('button', { name: '更多' })).toBeVisible();
  const head = page.getByTestId('detail-main').locator('header');
  for (const label of ['分支与 PR', 'Token 用量', '运行历史']) {
    await expect(head.locator(`button[aria-label="${label}"]`)).toHaveCount(0);
  }
});

test('composer stays in-flow inside the center column: card form, 16px insets, scroll port ends above it', async ({
  page,
}) => {
  await page.goto(`${DETAIL_ROUTE}?scenario=17b`);
  const geo = await page.evaluate(() => {
    const rect = (sel: string) => {
      const r = document.querySelector(sel)!.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    };
    const center = rect('[data-testid="detail-center"]');
    const main = rect('[data-testid="detail-main"]');
    const col = rect('[data-testid="transcript-col"]');
    const comp = document.querySelector('[data-testid="composer-card"]')!;
    const r = comp.getBoundingClientRect();
    const cs = getComputedStyle(comp);
    const colCs = getComputedStyle(document.querySelector('[data-testid="transcript-col"]')!);
    return {
      centerLeft: center.left,
      centerRight: center.right,
      mainBottom: main.bottom,
      colBottom: col.bottom,
      compLeft: r.left,
      compRight: r.right,
      compTop: r.top,
      compBottom: r.bottom,
      radius: cs.borderRadius,
      border: cs.borderTopWidth,
      position: cs.position,
      colPadBottom: Number.parseFloat(colCs.paddingBottom),
    };
  });
  // rounded composer card (--radius-composer = 20px)
  expect(geo.radius).toBe('20px');
  // CDS PR-7: 1px hairline retired; --shadow-composer carries the ring
  expect(geo.border).toBe('0px');
  // #472 in-flow law: a layout participant, never an overlay again —
  // relative (not static) because the in-card toolbar/send/stop absolutes
  // anchor to it
  expect(geo.position).toBe('relative');
  // 16px insets inside the center column — never crossing into the pane
  expect(geo.compLeft).toBeCloseTo(geo.centerLeft + 16, 0);
  expect(geo.compRight).toBeCloseTo(geo.centerRight - 16, 0);
  // the card keeps its 16px bottom inset (the old absolute-anchor visual)
  expect(geo.mainBottom - geo.compBottom).toBeCloseTo(16, 0);
  // the transcript scroll port ends exactly at the card top: text can no
  // longer pass under the opaque card…
  expect(geo.colBottom).toBeCloseTo(geo.compTop, 0);
  // …and a bottom-pinned last row keeps a real gap from the card edge
  expect(geo.colPadBottom).toBeGreaterThanOrEqual(16);
});

test("composer controls share one bottom row: stop is the send button's sibling", async ({
  page,
}) => {
  // XMON-55 P5. The stop used to be a 14x14 bare --stop block at right:72 /
  // bottom:17 — 27px adrift of the send button, 4px off its centre line, and
  // with no glyph inside. This pins the four ways it can regress.
  await page.goto(`${DETAIL_ROUTE}?scenario=26`);
  const stopBtn = page.getByRole('button', { name: '停止' });
  const sendBtn = page.getByRole('button', { name: '发送' });
  const geo = await page.evaluate(() => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { l: r.left, r: r.right, w: r.width, h: r.height, cy: (r.top + r.bottom) / 2 };
    };
    const byLabel = (label: string) =>
      document.querySelector(`[data-testid="composer-card"] button[aria-label="${label}"]`)!;
    const tool = document.querySelector(
      '[data-testid="composer-toolbar"] button[aria-label="添加附件"]',
    )!;
    const toolGlyph = tool.querySelector('svg')!.getBoundingClientRect();
    const ph = document.querySelector('[data-testid="composer-placeholder"]')!;
    const phCs = getComputedStyle(ph);
    const phBox = ph.getBoundingClientRect();
    return {
      stop: rect(byLabel('停止')),
      send: rect(byLabel('发送')),
      toolCy: (tool.getBoundingClientRect().top + tool.getBoundingClientRect().bottom) / 2,
      toolGlyphL: toolGlyph.left,
      phTextL: phBox.left + Number.parseFloat(phCs.paddingLeft),
      stopFill: getComputedStyle(byLabel('停止')).backgroundColor,
      sendFill: getComputedStyle(byLabel('发送')).backgroundColor,
      stopGlyph: byLabel('停止').querySelectorAll('span').length,
    };
  });
  // a real hit target, not a 14px smudge
  expect(geo.stop.w).toBe(32);
  expect(geo.stop.h).toBe(32);
  // one row, one axis — stop and send share the centre line the toolbar sits
  // on. The 30px tool box against the 32px buttons leaves 1px of parity, so
  // the tolerance is 1; the drift this pins was 9px (bottom 4 vs bottom 12).
  expect(geo.stop.cy).toBeCloseTo(geo.send.cy, 0);
  expect(Math.abs(geo.toolCy - geo.send.cy)).toBeLessThanOrEqual(1);
  // an 8px sibling gap, not an orphaned 27px float
  expect(geo.send.l - geo.stop.r).toBeCloseTo(8, 0);
  // the red is carried by the glyph, so the fill matches the send button's
  expect(geo.stopFill).toBe(geo.sendFill);
  expect(geo.stopGlyph).toBe(1);
  // the toolbar's ink starts on the placeholder text's own left edge
  expect(Math.abs(geo.toolGlyphL - geo.phTextL)).toBeLessThanOrEqual(2);
  // locators stay semantic (the probe above is the geometry law)
  await expect(stopBtn).toBeVisible();
  await expect(sendBtn).toBeVisible();
});

test('composer width tracks the center column; the floating window overlays without moving it (ADR 0013 D1)', async ({
  page,
}) => {
  await page.goto(`${DETAIL_ROUTE}?scenario=detail-unread`);
  const measure = () =>
    page.evaluate(() => {
      const c = document.querySelector('[data-testid="detail-center"]')!.getBoundingClientRect();
      const r = document.querySelector('[data-testid="composer-card"]')!.getBoundingClientRect();
      return { center: c.width, comp: r.width };
    });
  const pane = await measure();
  expect(pane.center).toBe(1440 - 288 - 488);
  expect(pane.comp).toBeCloseTo(pane.center - 32, 0);
  // A0（ADR 0013 D7 反转）：窗是覆盖层——开窗后右栏在位、中心列与
  // composer 宽度与关态逐值相同（418 互斥态退役，无 pane-var 重同步）
  await page.locator('.chief-fab').click();
  await expect(page.getByTestId('detail-right')).toBeVisible();
  const drawer = page.locator('.chief-drawer');
  await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const open = await measure();
  expect(open.center).toBeCloseTo(pane.center, 0);
  expect(open.comp).toBeCloseTo(pane.comp, 0);
});

test('right pane type select switches between the doc surface and the three sections', async ({
  page,
}) => {
  await page.goto(`${DETAIL_ROUTE}?scenario=27`);
  // review phase opens on the doc view (变更 surface)
  const right = page.getByTestId('detail-right');
  await expect(right.getByTestId('doc-pane')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  // .doc-select-wrap/.doc-pane-select = overlays 域（#949 批次），保留类载体
  const select = page.locator('.doc-select-wrap .doc-pane-select');
  await select.click();
  // #949 载体：盘 = role menu，行 = menuitemradio + 文案（.plan-dropdown/
  // .plan-dropdown-row 类钉随 overlays.css 清零退役）。不钉可及名：Base UI
  // 把 popup 的名字经 aria-labelledby 绑到触发钮（压过 aria-label
  // 「面板视图」），名 = 当前视图词，随选择漂移；测试上下文里开着的 menu
  // 恒唯一，裸 role 即够。
  const dropdown = page.getByRole('menu');
  await expect(dropdown).toBeVisible();
  await expect(dropdown.getByRole('menuitemradio')).toHaveCount(4);
  await expect(dropdown.getByRole('menuitemradio').first()).toContainText('变更');

  // pick Token 用量 → static section in the pane, no dialog anywhere
  await dropdown.getByRole('menuitemradio', { name: 'Token 用量' }).click();
  await expect(dropdown).toBeHidden();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(right.getByTestId('doc-pane')).toHaveCount(0);
  await expect(right.getByText('tokens', { exact: true })).toBeVisible();

  // the section head carries the same select — switch back to the doc view
  await page.locator('.doc-select-wrap .doc-pane-select').click();
  await page.getByRole('menuitemradio', { name: '变更' }).click();
  await expect(right.getByTestId('doc-pane')).toBeVisible();
  await expect(right.getByText('tokens', { exact: true })).toHaveCount(0);
});

test('scenarios 30/31/32 freeze the pane view instead of popping dialogs', async ({ page }) => {
  const right = page.getByTestId('detail-right');
  await page.goto(`${DETAIL_ROUTE}?scenario=30`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(right.getByText('tokens', { exact: true })).toBeVisible();

  await page.goto(`${DETAIL_ROUTE}?scenario=31`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(right.getByText('构建分支')).toBeVisible();

  await page.goto(`${DETAIL_ROUTE}?scenario=32`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(right.getByTestId('history-row')).toHaveCount(1);
});

test('plan card activation in the thread opens the plan doc in the right pane', async ({
  page,
}) => {
  await page.goto(`${DETAIL_ROUTE}?scenario=plan-open`);
  // review phase opens on the changes surface
  // （.doc-select-wrap/.doc-pane-select = overlays 域类载体，#949 批次）
  await expect(page.locator('.doc-select-wrap .doc-pane-select')).toContainText('变更');
  // the build-open round carries its own plan card; the frozen row is first
  await page.getByRole('button', { name: '打开方案' }).first().click();
  // activation flips the pane to the doc view's plan surface
  await expect(page.locator('.doc-select-wrap .doc-pane-select')).toContainText('方案');
  await expect(page.getByTestId('doc-body').locator('p').first()).toBeVisible();
});

test('fresh phase: the brief owns the whole center column, right pane collapses', async ({
  page,
}) => {
  await page.goto(FRESH);
  // XMON-55 P0 (reverses #366 修订裁决 3): a fresh todo has no run content, so
  // the 488px pane that existed only to say 「尚无运行内容」 is gone and the
  // fresh block takes the full fluid remainder instead.
  await expect(page.getByTestId('detail-center').getByTestId('fresh-block')).toBeVisible();
  await expect(page.getByTestId('detail-right')).toHaveCount(0);
  await expect(page.locator('.right-empty')).toHaveCount(0);
  await expect(page.getByTestId('doc-pane')).toHaveCount(0);
  const center = await page
    .getByTestId('detail-center')
    .evaluate((el) => Math.round(el.getBoundingClientRect().width));
  expect(center).toBe(1440 - 288);

  // the task title now names the page twice: in the 44px head (XMON-55 P1, so
  // the reader knows which task they are on while scrolled into the thread)
  // and on the brief itself
  const title = '在 README.md 末尾追加一行「r7 rebaseline probe」';
  await expect(page.getByRole('heading', { name: title })).toHaveText(title);
  await expect(page.getByTestId('detail-title')).toHaveText(title);
  const start = page
    .getByTestId('detail-center')
    .getByRole('button', { name: '开始', exact: true });
  await expect(start).toBeVisible();
  await expect(start).toHaveText('开始');
  await start.click();
  // #640：todo 相位 开始 = 单出口直发编排回合，不再弹选择 dialog（fixture
  // inert）。缺席断言走 rerun 面唯一文案（.overlay-title 类载体退役）。
  await expect(page.getByText('这张任务将交给总管重新编排。')).toHaveCount(0);
});
