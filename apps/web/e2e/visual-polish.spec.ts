import { expect, type Page, test } from '@playwright/test';

async function edgeContract(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((el) => {
    const ringProbe = document.createElement('div');
    ringProbe.style.boxShadow = 'var(--edge-ring)';
    const colorProbe = document.createElement('div');
    colorProbe.style.backgroundColor = 'var(--border)';
    const cardShadowProbe = document.createElement('div');
    cardShadowProbe.style.boxShadow = 'var(--card-shadow)';
    const edgeShadowProbe = document.createElement('div');
    edgeShadowProbe.style.boxShadow = 'var(--edge-shadow)';
    const plateShadowProbe = document.createElement('div');
    plateShadowProbe.style.boxShadow = 'var(--plate-shadow)';
    const cardLiftProbe = document.createElement('div');
    cardLiftProbe.style.boxShadow = 'var(--card-lift)';
    const panelShadowProbe = document.createElement('div');
    panelShadowProbe.style.boxShadow = 'var(--panel-shadow)';
    const borderTokenProbe = document.createElement('div');
    borderTokenProbe.style.backgroundColor = 'var(--border)';
    document.body.append(
      ringProbe,
      colorProbe,
      cardShadowProbe,
      edgeShadowProbe,
      plateShadowProbe,
      cardLiftProbe,
      panelShadowProbe,
      borderTokenProbe,
    );
    const cs = getComputedStyle(el);
    const out = {
      shadow: cs.boxShadow,
      ring: getComputedStyle(ringProbe).boxShadow,
      borderColor: getComputedStyle(colorProbe).backgroundColor,
      borderToken: getComputedStyle(borderTokenProbe).backgroundColor,
      borderColorOwn: cs.borderTopColor,
      cardShadow: getComputedStyle(cardShadowProbe).boxShadow,
      edgeShadow: getComputedStyle(edgeShadowProbe).boxShadow,
      plateShadow: getComputedStyle(plateShadowProbe).boxShadow,
      cardLift: getComputedStyle(cardLiftProbe).boxShadow,
      panelShadow: getComputedStyle(panelShadowProbe).boxShadow,
      radius: cs.borderTopLeftRadius,
      border: cs.borderTopWidth,
    };
    ringProbe.remove();
    colorProbe.remove();
    cardShadowProbe.remove();
    edgeShadowProbe.remove();
    plateShadowProbe.remove();
    cardLiftProbe.remove();
    panelShadowProbe.remove();
    borderTokenProbe.remove();
    return out;
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`board card rides the single-source edge ring + card-tier shadow (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01&view=board');

    const card = await edgeContract(page, '.todo-card');

    expect(card.border).toBe('0px');
    expect(card.radius).toBe('20px');
    expect(card.shadow).toContain('0px 0px 0px 1px');
    expect(card.shadow).not.toContain('inset');
    expect(card.shadow).toContain(card.panelShadow);
  });

  test(`board column container rides the same edge ring + card-tier shadow (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01&view=board');

    const column = await edgeContract(page, '.board-column');

    expect(column.border).toBe('0px');
    expect(column.radius).toBe('0px');
    expect(column.shadow).toBe('none');
  });

  test(`notify banner rides the same edge ring + card-tier shadow (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=notify-banner&view=board');

    const banner = await edgeContract(page, '.board-notify-banner');

    expect(banner.border).toBe('0px');
    expect(banner.radius).toBe('18px');
    expect(banner.shadow.startsWith(banner.ring)).toBe(true);
    expect(banner.ring.startsWith(`${banner.borderColor} `)).toBe(true);
    expect(banner.shadow).toContain(banner.cardShadow);
  });

  test(`account popover rides the V2 shell border, keeps the overlay-plate hard shadow (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=17');

    const menu = await edgeContract(page, '.user-menu');
    // Paper menu face: --radius-popover 10px + --shadow-popover
    // (light: outer hairline ring + soft pool; dark: inset highlight, no
    // solid border). Border width collapses to 0; separation rides shadow.
    expect(menu.border).toBe('0px');
    expect(menu.radius).toBe('18px');
    expect(menu.shadow).not.toBe('none');
    expect(menu.shadow).toContain('0px 0px 0px');
  });

  test(`sidebar sits on canvas beside the sheet, no seam of its own (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01&view=board');

    const probe = await page.evaluate(() => {
      const sidebar = document.querySelector('.board-sidebar');
      const main = document.querySelector('.board-sheet');
      if (!sidebar || !main) throw new Error('board layout missing');
      const cs = getComputedStyle(sidebar);
      return {
        sidebarBg: cs.backgroundColor,
        mainBg: getComputedStyle(main).backgroundColor,
        borderRight: cs.borderRightWidth,
        seamColor: cs.borderRightColor,
        topbarBorderWidth: getComputedStyle(document.querySelector('.board-topbar')!).borderBottomWidth,
        shadow: cs.boxShadow,
      };
    });
    expect(probe.sidebarBg).not.toBe(probe.mainBg);
    expect(probe.borderRight).toBe('1px');
    expect(probe.seamColor).not.toBe('transparent');
    expect(probe.topbarBorderWidth).toBe('0px');
    expect(probe.shadow).toBe('none');
  });

  test(`board grid lays out four even columns with no horizontal scroll (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01&view=board');

    const metrics = await page.locator('.board-scroller').evaluate((el) => {
      el.scrollLeft = 400;
      const cs = getComputedStyle(el);
      return {
        scrollbarWidth: cs.scrollbarWidth,
        // a rendered horizontal track would eat vertical box space
        trackGap: el.offsetHeight - el.clientHeight,
        scrollLeft: el.scrollLeft,
        scrollable: el.scrollWidth > el.clientWidth,
      };
    });
    // #692: the overflow policy flipped from always-hidden to reference-
    // aligned native (scrollbar-width: auto — drawn only while content
    // actually overflows). Resting at 1440 nothing overflows, so no track
    // renders (trackGap 0) and the #351 resting look is unchanged.
    expect(metrics.scrollbarWidth).toBe('auto');
    expect(metrics.trackGap).toBe(0);
    // #351: the even 4-column grid fits the desktop width — the horizontal
    // scroll is gone (overflow-x stays only as the narrow-window fallback)
    expect(metrics.scrollable).toBe(false);
    expect(metrics.scrollLeft).toBe(0);

    // repeat(4, minmax(0, 1fr)): every column lands on the same track width
    const widths = await page
      .locator('.board-column')
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
    expect(widths).toHaveLength(4);
    const first = widths[0] ?? 0;
    expect(first).toBeGreaterThan(0);
    for (const w of widths) expect(Math.abs(w - first)).toBeLessThanOrEqual(1);
  });
}

test('collapsed rail draws no seam either (Paper PR 7)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cairn-theme', 'dark');
    localStorage.setItem('cairn.sidebar-collapsed', '1');
  });
  await page.goto('/app?scenario=01&view=board');

  const rail = await page.locator('.board-sidebar--collapsed').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { borderRight: cs.borderRightWidth, shadow: cs.boxShadow };
  });
  expect(rail.borderRight).toBe('1px');
  expect(rail.shadow).toBe('none');
});
