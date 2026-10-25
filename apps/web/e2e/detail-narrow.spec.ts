import { expect, test } from '@playwright/test';

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

test('N3: the degradation stops at 816px — the 3-pane shell survives above it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 815, height: 732 });
  await page.goto(DETAIL);
  await page.waitForSelector('[data-testid="transcript-col"]');
  expect((await overflowProbe(page)).sidebarVisible).toBe(false);

  await page.setViewportSize({ width: 816, height: 732 });
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
  expect(widths.sidebar).toBe(248);
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
