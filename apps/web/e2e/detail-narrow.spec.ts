import { expect, test } from '@playwright/test';

// Issue #932: the detail route's fixed 3-pane shell (240 sidebar | fluid
// thread | 488 right pane) had no narrow-viewport strategy at all — at 320px
// the sidebar kept 240px, the right pane kept 488px off-screen behind the
// shell's overflow:hidden, and the thread column swallowed 133px of content
// in a 35px box (#885 recorded it). Below 768px — the reference's own
// breakpoint (todos.dev ships `not all and (width >= 768px)`, measured live
// 2026-10-05) — the shell now degrades: both side panes drop, the thread
// owns the full width, and the head's back chevron stays the way out. Each
// test pins one failure way:
//   N1 320px: nothing clips, nothing swallows a horizontal scroll
//   N2 360/390: same law at the common phone widths
//   N3 the degradation is bounded — 768px keeps the full 3-pane shell
//   N4 the chief dock cannot re-introduce the clip at 320px
//   N5 head and composer stay inside the viewport at 320px
//
// #945/#910 重钉：detail.css 退役——载体换壳属性 + 二级 testid：
// [data-route=todo-detail] > aside（侧栏）、detail-center / detail-right /
// transcript-col / detail-head-actions / composer-card；返回箭头 =
// role=link+文案，FAB = role=button 总管。.chief-drawer 属 chief 域
// （#950 批次），类载体保留。

const DETAIL = '/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=26';

async function overflowProbe(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const doc = document.scrollingElement!;
    const col = document.querySelector('[data-testid="transcript-col"]')!;
    const center = document
      .querySelector('[data-testid="detail-center"]')!
      .getBoundingClientRect();
    const sidebar = document.querySelector('[data-route="todo-detail"] > aside');
    const right = document.querySelector('[data-testid="detail-right"]');
    const visible = (el: Element | null) =>
      el !== null && el.getBoundingClientRect().width > 0 && getComputedStyle(el).display !== 'none';
    return {
      docScroll: doc.scrollWidth,
      docClient: doc.clientWidth,
      colScroll: col.scrollWidth,
      colClient: col.clientWidth,
      centerWidth: Math.round(center.width),
      sidebarVisible: visible(sidebar),
      rightVisible: visible(right),
    };
  });
}

test('N1: 320px degrades instead of clipping — no page overflow, no swallowed column scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 732 });
  await page.goto(DETAIL);
  await page.waitForSelector('[data-testid="transcript-col"]');
  const probe = await overflowProbe(page);
  // the shell no longer hides a horizontal overflow behind overflow:hidden
  expect(probe.docScroll).toBeLessThanOrEqual(probe.docClient);
  // the thread column reads at the full viewport width — the #885 35px box
  // is gone, and with it the 133px of content it scrolled sideways
  expect(probe.colScroll).toBeLessThanOrEqual(probe.colClient + 1);
  expect(probe.centerWidth).toBe(320);
  // both fixed panes dropped; the back chevron in the head is the way out
  expect(probe.sidebarVisible).toBe(false);
  expect(probe.rightVisible).toBe(false);
});

test('N2: 360 and 390 keep the same law', async ({ page }) => {
  for (const width of [360, 390]) {
    await page.setViewportSize({ width, height: 732 });
    await page.goto(DETAIL);
    await page.waitForSelector('[data-testid="transcript-col"]');
    const probe = await overflowProbe(page);
    expect(probe.docScroll).toBeLessThanOrEqual(probe.docClient);
    expect(probe.colScroll).toBeLessThanOrEqual(probe.colClient + 1);
    expect(probe.centerWidth).toBe(width);
    expect(probe.sidebarVisible).toBe(false);
    expect(probe.rightVisible).toBe(false);
  }
});

test('N3: the degradation stops at 768px — the 3-pane shell survives above it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 767, height: 732 });
  await page.goto(DETAIL);
  await page.waitForSelector('[data-testid="transcript-col"]');
  expect((await overflowProbe(page)).sidebarVisible).toBe(false);

  await page.setViewportSize({ width: 768, height: 732 });
  await page.waitForSelector('[data-route="todo-detail"] > aside');
  const probe = await overflowProbe(page);
  expect(probe.sidebarVisible).toBe(true);
  expect(probe.rightVisible).toBe(true);
  const widths = await page.evaluate(() => ({
    sidebar: Math.round(
      document.querySelector('[data-route="todo-detail"] > aside')!.getBoundingClientRect().width,
    ),
    right: Math.round(
      document.querySelector('[data-testid="detail-right"]')!.getBoundingClientRect().width,
    ),
  }));
  expect(widths.sidebar).toBe(288);
  expect(widths.right).toBe(488);
});

test('N4: the docked chief panel cannot re-overflow the 320px shell', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 732 });
  await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=detail-unread');
  await page.getByRole('button', { name: '总管' }).click();
  const drawer = page.locator('.chief-drawer');
  await drawer.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
  const geo = await page.evaluate(() => {
    const doc = document.scrollingElement!;
    const panel = document.querySelector('.chief-drawer')!.getBoundingClientRect();
    return {
      docScroll: doc.scrollWidth,
      docClient: doc.clientWidth,
      panelRight: Math.round(panel.right),
      panelWidth: Math.round(panel.width),
    };
  });
  expect(geo.docScroll).toBeLessThanOrEqual(geo.docClient);
  expect(geo.panelWidth).toBeLessThanOrEqual(320);
  expect(geo.panelRight).toBeLessThanOrEqual(320);
});

test('N5: head actions and the composer stay inside the 320px viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 732 });
  await page.goto(DETAIL);
  await page.waitForSelector('[data-testid="composer-card"]');
  const geo = await page.evaluate(() => {
    const right = (sel: string) =>
      Math.round(document.querySelector(sel)!.getBoundingClientRect().right);
    const left = (sel: string) =>
      Math.round(document.querySelector(sel)!.getBoundingClientRect().left);
    return {
      // the actions cluster (更多 + the phase's primary when it has one) is
      // the head's trailing edge — scenario 26's phase carries no primary
      actionsRight: right('[data-testid="detail-head-actions"]'),
      compLeft: left('[data-testid="composer-card"]'),
      compRight: right('[data-testid="composer-card"]'),
      backLeft: left('[data-testid="detail-main"] header a[aria-label="返回"]'),
    };
  });
  expect(geo.backLeft).toBeGreaterThanOrEqual(0);
  expect(geo.actionsRight).toBeLessThanOrEqual(320);
  expect(geo.compLeft).toBeGreaterThanOrEqual(0);
  expect(geo.compRight).toBeLessThanOrEqual(320);
});
