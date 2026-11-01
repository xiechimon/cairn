import { expect, test } from '@playwright/test';

const DETAIL_ROUTE = '/app/todo/7ve0iOkQ-JBpSL98zSiGc';
const FRESH = '/app/todo/fresh-probe?scenario=23';

test('three abutting panes: 248 sidebar | fluid center | 488 right', async ({ page }) => {
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
  expect(geo.sidebar.width).toBe(248);
  expect(geo.right.width).toBe(488);
  // panes abut — no gap, no overlap (hairline borders ride inside the boxes)
  expect(Math.round(geo.center.left)).toBe(Math.round(geo.sidebar.right));
  expect(Math.round(geo.right.left)).toBe(Math.round(geo.center.right));
  expect(geo.center.width).toBe(1440 - 248 - 488);
  // the seam between center and right is a 1px hairline, not a shadow
  const seam = await page.evaluate(() => {
    const cs = getComputedStyle(document.querySelector('[data-testid="detail-right"]')!);
    return { borderLeft: cs.borderLeftWidth, shadow: cs.boxShadow };
  });
  expect(seam.borderLeft).toBe('1px');
  expect(seam.shadow).toBe('none');
});

test('no `文档|聊天` tab group survives on any phase surface', async ({ page }) => {
  for (const scenario of ['16', '17b', '23', '26', '27', '36']) {
    await page.goto(`${DETAIL_ROUTE}?scenario=${scenario}`);
    await expect(page.locator('.detail-tabs-group')).toHaveCount(0);
    await expect(page.locator('.detail-tab')).toHaveCount(0);
    await expect(page.locator('.detail-tabs')).toHaveCount(0);
  }
});

test('detail head keeps the `更多` icon only — branch/token/history icons are gone', async ({
  page,
}) => {
  await page.goto(`${DETAIL_ROUTE}?scenario=27`);
  await expect(page.getByRole('button', { name: '更多' })).toBeVisible();
  const head = page.getByTestId('detail-main').locator('header');
  for (const label of ['分支与 PR', 'Token 用量', '运行历史']) {
    await expect(head.locator(`button[aria-label="${label}"]`)).toHaveCount(0);
  }
});

test('composer stays in-flow inside the center column: card form, 16px horizontal and 24px bottom insets, scroll port ends above it', async ({
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
  expect(geo.radius).toBe('14px');
  expect(geo.border).toBe('0px');
  expect(geo.position).toBe('relative');
  expect(geo.compLeft).toBeCloseTo(geo.centerLeft + 16, 0);
  expect(geo.compRight).toBeCloseTo(geo.centerRight - 16, 0);
  expect(geo.mainBottom - geo.compBottom).toBeCloseTo(24, 0);
  expect(geo.colBottom).toBeCloseTo(geo.compTop, 0);
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
  expect(geo.stop.w).toBe(28);
  expect(geo.stop.h).toBe(28);
  expect(geo.stop.cy).toBeCloseTo(geo.send.cy, 0);
  expect(Math.abs(geo.toolCy - geo.send.cy)).toBeLessThanOrEqual(1);
  // an 8px sibling gap, not an orphaned 27px float
  expect(geo.send.l - geo.stop.r).toBeCloseTo(8, 0);
  expect(geo.sendFill).toBe(geo.stopFill);
  expect(geo.sendFill).not.toBe('rgba(0, 0, 0, 0)');
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
  expect(pane.center).toBe(1440 - 248 - 488);
  expect(pane.comp).toBeCloseTo(pane.center - 32, 0);

  await page.locator('.chief-fab').click();
  await expect(page.getByTestId('detail-right')).toBeVisible();
  const drawer = page.locator('.chief-drawer');
  await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const open = await measure();
  expect(open.center).toBeCloseTo(pane.center, 0);
  expect(open.comp).toBeCloseTo(pane.comp, 0);
});

test('right pane title switches plan and changes; usage, branch and history are sections', async ({
  page,
}) => {
  await page.goto(`${DETAIL_ROUTE}?scenario=27`);

  const right = page.getByTestId('detail-right');
  await expect(right.getByTestId('doc-pane')).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(right.getByRole('tablist')).toHaveCount(0);
  await expect(right.getByTestId('pane-title')).toHaveText('变更');

  await right.getByTestId('pane-title').click();
  await page.getByRole('menuitem', { name: '方案' }).click();
  await expect(right.getByTestId('pane-title')).toHaveText('方案');
  await expect(right.getByTestId('pane-view-plan')).toHaveAttribute('aria-pressed', 'true');

  const branch = right.getByTestId('pane-section-branch');
  const usage = right.getByTestId('pane-section-token');
  const history = right.getByTestId('pane-section-history');
  await expect(branch.getByRole('button', { name: '分支' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await branch.getByRole('button', { name: '分支' }).click();
  await expect(branch.getByText('构建分支')).toBeVisible();
  await expect(usage).toContainText('tokens');
  await expect(history.getByRole('button', { name: '历史' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(history.getByTestId('history-row')).toHaveCount(0);

  await usage.getByRole('button', { name: '用量' }).click();
  await expect(usage).not.toContainText('tokens');
  await history.getByRole('button', { name: '历史' }).click();
  await expect(history.getByTestId('history-row').first()).toBeVisible();

  await right.getByTestId('pane-view-changes').click();
  await expect(right.getByTestId('pane-title')).toHaveText('变更');
  await expect(right.getByTestId('pane-sections')).toHaveCount(0);
});

test('scenarios 30/31/32 freeze the pane view instead of popping dialogs', async ({ page }) => {
  const right = page.getByTestId('detail-right');
  await page.goto(`${DETAIL_ROUTE}?scenario=30`);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(right.getByTestId('pane-section-token')).toContainText('tokens');

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

  await expect(page.getByTestId('pane-title')).toHaveText('变更');
  await page.getByRole('button', { name: '打开方案' }).first().click();
  await expect(page.getByTestId('pane-title')).toHaveText('方案');
  await expect(page.getByTestId('doc-body').locator('p').first()).toBeVisible();
});

test('fresh phase: the brief owns the whole center column, right pane collapses', async ({
  page,
}) => {
  await page.goto(FRESH);

  await expect(page.getByTestId('detail-center').getByTestId('fresh-block')).toBeVisible();
  await expect(page.getByTestId('detail-right')).toHaveCount(0);
  await expect(page.locator('.right-empty')).toHaveCount(0);
  await expect(page.getByTestId('doc-pane')).toHaveCount(0);
  const center = await page
    .getByTestId('detail-center')
    .evaluate((el) => Math.round(el.getBoundingClientRect().width));
  expect(center).toBe(1440 - 248);

  const title = '在 README.md 末尾追加一行「r7 rebaseline probe」';
  await expect(page.getByRole('heading', { level: 1, name: title })).toHaveText(title);
  await expect(page.getByTestId('detail-title')).toHaveText(title);
  await expect(page.getByTestId('fresh-block').getByRole('heading', { name: title })).toHaveText(
    title,
  );
  const start = page
    .getByTestId('detail-center')
    .getByRole('button', { name: '开始', exact: true });
  await expect(start).toBeVisible();
  await expect(start).toHaveText('开始');
  await start.click();

  await expect(page.getByText('这张任务将交给总管重新编排。')).toHaveCount(0);
});
