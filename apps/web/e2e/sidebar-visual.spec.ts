import { expect, test } from '@playwright/test';

// Issue #128 acceptance (dogfood 侧栏视觉三件, claude.ai 参照面): the ⌘K chip
// is the official bordered pill (r7 01/02 probe: 26×20 box, 1px
// --border-default ring, right-anchored) sitting clear of the 搜索 label —
// the row-content lift rule must not demote it into the label's flow; the
// hover and selected faces share ONE geometry (the official 32px inset face,
// V2 骨架方角 #792 P6) with the selected state one cds alpha step deeper than
// the hover instead of a different shape; the machine-online dot keeps its
// absolute anchor (same lift-rule hazard as the kbd chip).
//
// #943/#910 重钉：类名载体全退役——行 = nav 内的 link/button（一级
// role/tag + 文本），选中态 = aria-current="page"，侧栏 = aside
// （complementary），在线点 = data-testid="online-dot"（二级：aria 不可见
// 的纯装饰结构钩子）。探针期望值不动（本域 token 槽与行几何零改动，
// #915 翻值后的现值即新正典）。

/** Parse a computed rgb()/rgba() color. */
const parse = (c: string) => {
  const m = c.match(/[\d.]+/g)?.map(Number);
  if (m == null || m.length < 3) throw new Error(`unparsable color ${c}`);
  return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
};

/** Composite an rgba foreground over an opaque background. */
const over = (fg: string, bg: string) => {
  const f = parse(fg);
  const b = parse(bg);
  return {
    r: f.a * f.r + (1 - f.a) * b.r,
    g: f.a * f.g + (1 - f.a) * b.g,
    b: f.a * f.b + (1 - f.a) * b.b,
  };
};

const dist = (x: { r: number; g: number; b: number }, y: { r: number; g: number; b: number }) =>
  Math.abs(x.r - y.r) + Math.abs(x.g - y.g) + Math.abs(x.b - y.b);

/** 侧栏行集合（nav 内的 link + button 行）——类名退役后的行载体。 */
const ROWS = 'nav a, nav button';

for (const theme of ['light', 'dark'] as const) {
  test(`⌘K chip is a bordered pill clear of the label (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app?scenario=01');

    const m = await page.evaluate((rowsSel) => {
      const rows = [...document.querySelectorAll(rowsSel)];
      const row = rows.find((el) => el.textContent?.includes('搜索'));
      const spans = row ? [...row.querySelectorAll('span, kbd')] : [];
      const kbd = spans.find((s) => s.textContent?.trim() === '⌘K');
      const label = spans.find((s) => s.textContent?.trim() === '搜索');
      const sidebar = document.querySelector('aside');
      if (!kbd || !row || !label || !sidebar) throw new Error('sidebar search row missing');
      const kr = kbd.getBoundingClientRect();
      const lr = label.getBoundingClientRect();
      const sr = sidebar.getBoundingClientRect();
      const cs = getComputedStyle(kbd);
      return {
        pos: cs.position,
        borderWidth: cs.borderTopWidth,
        kbdLeft: kr.x,
        kbdRight: kr.right,
        kbdHeight: kr.height,
        labelRight: lr.right,
        sidebarRight: sr.right,
      };
    }, ROWS);
    // absolute anchor — the lift rule for row content must not demote it
    // into the label's flow (the #128 overlap bug)
    expect(m.pos).toBe('absolute');
    // #983/#1004: the chip is the registry Kbd (border-less bg-muted box),
    // not the old hand-rolled bordered pill — border pin retires to 0.
    expect(m.borderWidth).toBe('0px');
    // clear of the 搜索 label, right-anchored at the official offset
    expect(m.kbdLeft).toBeGreaterThanOrEqual(m.labelRight);
    expect(m.sidebarRight - m.kbdRight).toBeGreaterThanOrEqual(12);
    expect(m.sidebarRight - m.kbdRight).toBeLessThanOrEqual(22);
    // the official 20px-tall chip box
    expect(m.kbdHeight).toBeGreaterThanOrEqual(18);
    expect(m.kbdHeight).toBeLessThanOrEqual(22);
  });

  test(`hover and selected pills share one geometry (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app?scenario=01');

    const geo = await page.evaluate((rowsSel) => {
      const pill = (el: Element) => {
        const cs = getComputedStyle(el, '::before');
        return {
          top: cs.top,
          bottom: cs.bottom,
          left: cs.left,
          right: cs.right,
          radius: cs.borderTopLeftRadius,
        };
      };
      const selected = document.querySelector('nav a[aria-current="page"]');
      const plain = [...document.querySelectorAll(rowsSel)].find(
        (el) =>
          el.getAttribute('aria-current') !== 'page' && el.textContent?.includes('定时'),
      );
      if (!selected || !plain) throw new Error('sidebar rows missing');
      const sidebar = document.querySelector('aside')!;
      return {
        selected: pill(selected),
        plain: pill(plain),
        rowMargin: getComputedStyle(selected).marginLeft,
        rowWidth: selected.getBoundingClientRect().width,
        sidebarWidth: sidebar.getBoundingClientRect().width,
        sidebarClientWidth: sidebar.clientWidth,
      };
    }, ROWS);
    // one face geometry for both states — selected is a deepen, not a shape
    expect(geo.plain).toEqual(geo.selected);
    // the official 32px inset face (r7 01/02 probe: 2px vertical inset),
    // CDS PR-3: 8px pill radius (--cds-radius-lg)
    expect(geo.selected.top).toBe('2px');
    expect(geo.selected.bottom).toBe('2px');
    expect(geo.selected.radius).toBe('8px');
    // no margin hack on the selected row → no right-edge clip; the row
    // fills the sidebar's content box (no solid seam; width == clientWidth)
    expect(geo.rowMargin).toBe('0px');
    expect(geo.rowWidth).toBe(geo.sidebarClientWidth);
    expect(geo.sidebarWidth).toBe(288);
  });

  test(`selected pill deepens the hover step (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app?scenario=01');

    const sidebarBg = await page.evaluate(
      () => getComputedStyle(document.querySelector('aside')!).backgroundColor,
    );
    await page.getByRole('complementary').getByRole('link', { name: '定时' }).hover();
    await page.waitForTimeout(300); // the 150ms color step settles
    const hoverBg = await page.evaluate((rowsSel) => {
      const el = [...document.querySelectorAll(rowsSel)].find((r) => r.matches(':hover'));
      if (!el) throw new Error('no hovered row');
      return getComputedStyle(el, '::before').backgroundColor;
    }, ROWS);
    const selectedBg = await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('nav a[aria-current="page"]')!, '::before')
          .backgroundColor,
    );

    const bg = parse(sidebarBg);
    const hover = over(hoverBg, sidebarBg);
    const selected = over(selectedBg, sidebarBg);
    // hover reads off the sidebar layer (tier-1 surface; 5% fg step is
    // softer on the mid tone than on canvas, so the bar is >3)
    expect(dist(hover, bg)).toBeGreaterThan(3);
    // selected = the deeper step of the same ladder, not a twin
    expect(dist(selected, bg)).toBeGreaterThan(dist(hover, bg) + 3);

    // hovering the selected row must not wash it back to the hover step
    await page.getByRole('link', { name: '工作台' }).hover();
    await page.waitForTimeout(300);
    const selectedHovered = await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('nav a[aria-current="page"]')!, '::before')
          .backgroundColor,
    );
    expect(selectedHovered).toBe(selectedBg);
  });
}

test('machine-online dot keeps its absolute anchor', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pacman-theme', 'dark'));
  // chief fixture scenarios set machineOnline on the 机器 row
  await page.goto('/app?scenario=100');

  const dot = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="online-dot"]');
    const row = el?.closest('a');
    if (!el || !row) throw new Error('machine-online dot missing');
    const cs = getComputedStyle(el);
    const dr = el.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    return {
      pos: cs.position,
      centerYDelta: Math.abs(dr.y + dr.height / 2 - (rr.y + rr.height / 2)),
    };
  });
  // same lift-rule hazard as the kbd chip: relative would drop it into the
  // label flow and off its vertical center
  expect(dot.pos).toBe('absolute');
  expect(dot.centerYDelta).toBeLessThan(2);
});
