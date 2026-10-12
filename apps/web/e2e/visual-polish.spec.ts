import { expect, type Page, test } from '@playwright/test';

// Issue #123 acceptance (dogfood 观感三项, claude.ai 参照面): the sidebar's
// seam is a drawn 1px divider-token line and the floating shadow is gone per
// the #135 裁决 v2 revision — #390 同底律 supersedes #123's tone step: the
// sidebar shares the main-area surface token, the seam alone carries the
// layer separation; the board scroller's track stays hidden
// (scrollbar-width: none + ::-webkit-scrollbar display: none) — #351 turned
// it into an even 4-column grid with no desktop horizontal scroll.
// Issue #139 acceptance (边框体系统一) — 看板面已随 #414 切到 B 面配方，
// V2 骨架（#792 P6）收敛方角：the board card family rides shadcn's border
// recipe (1px real border in the --border scale + radius 0 + shadow-sm);
// the #139 inset ring + --card-shadow stack still holds on the not-yet-migrated
// surfaces (the notify banner), which is what the banner test pins.
// Issue #161 acceptance (卡片阴影/边框统一): the small-card family (todo /
// notify banner / column container) shares a tighter card-tier shadow
// (--card-shadow) so the cards read as grounded instead of floating;
// the account popover rides the overlay-plate tier (--plate-shadow, #854)
// because it opens over content and needs visible separation. Card, column and banner
// share the edge ring + radius 0 — the seam between the banner and the column
// container is visually continuous. The popover rides the V2 弹层壳
// (#790 P3: 1px 墨线框 + 圆角 0, more-menu 同律) instead of the card family.
// Each surface is asserted in both themes — the polish is a dual-theme contract.

/** resolved single-source ring + the --border-default color it must ride */
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
    const borderTokenProbe = document.createElement('div');
    borderTokenProbe.style.backgroundColor = 'var(--border)';
    document.body.append(
      ringProbe,
      colorProbe,
      cardShadowProbe,
      edgeShadowProbe,
      plateShadowProbe,
      cardLiftProbe,
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
      radius: cs.borderTopLeftRadius,
      border: cs.borderTopWidth,
    };
    ringProbe.remove();
    colorProbe.remove();
    cardShadowProbe.remove();
    edgeShadowProbe.remove();
    plateShadowProbe.remove();
    cardLiftProbe.remove();
    borderTokenProbe.remove();
    return out;
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`board card rides the single-source edge ring + card-tier shadow (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app?scenario=01');

    const card = await edgeContract(page, '.todo-card');
    // #425 基切换后的配方（政策见 #411「配方类」）：base 形态的 Card 用
    // 1px ring 外环（`ring-1 ring-foreground/10`）替代 #414 的 1px 实描边 +
    // shadow-sm。**保留的原意图**：不得回到 #139 的 inset 环（分数缩放下发丝
    // 不匀）——那条断言是本测试的真回归守卫。半径与投影：2026-10-12 用户派
    // 「看板卡对齐 deepseek-harness 对话框观感」——圆角升卡族档 rounded-2xl
    // （=18px，dsh 卡件 16-20 区间），静止吃 --card-lift 微抬升柔光
    // （dsh elevation 律：描边承担分离、柔光只暗示贴地）。
    expect(card.border).toBe('0px');
    expect(card.radius).toBe('18px');
    expect(card.shadow).toContain('0px 0px 0px 1px');
    expect(card.shadow).not.toContain('inset');
    expect(card.shadow).toContain(card.cardLift);
  });

  test(`board column container rides the same edge ring + card-tier shadow (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app?scenario=01');

    const column = await edgeContract(page, '.board-column');
    // #414（B 面）：列容器与卡片同行——1px 实描边 + card-tier 投影。
    // 半径随卡族档（2026-10-12 用户派 dsh 对齐：rounded-2xl = 18px，
    // 卡/列/通知条同档）。
    expect(column.border).toBe('1px');
    expect(column.radius).toBe('18px');
    expect(column.borderColorOwn).toBe(column.borderToken);
    expect(column.shadow).not.toContain('inset');
  });

  test(`notify banner rides the same edge ring + card-tier shadow (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app?scenario=notify-banner');

    const banner = await edgeContract(page, '.board-notify-banner');
    // #161 通知条↔看板列边框对齐: the banner sits at the same elevation
    // tier as the column container — same ring, same shadow — so the two
    // surfaces read as one language. 半径随卡族档（2026-10-12 用户派 dsh
    // 对齐：rounded-2xl = 18px，卡/列/通知条同档）。
    expect(banner.border).toBe('0px');
    expect(banner.radius).toBe('18px');
    expect(banner.shadow.startsWith(banner.ring)).toBe(true);
    expect(banner.ring.startsWith(`${banner.borderColor} `)).toBe(true);
    expect(banner.shadow).toContain(banner.cardShadow);
  });

  test(`account popover rides the V2 shell border, keeps the overlay-plate hard shadow (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=17');

    const menu = await edgeContract(page, '.user-menu');
    // V2 弹层壳（#790 P3）: 1px 实框墨线,框色走 --border-default。
    // 半径：#1054 消费点清点——直角随 ADR 0012 D1 退役，接 registry
    // popover 依据 rounded-lg（=10px，plan-dropdown #1006 同词汇）；
    // 墨线/投影的 registry 化归 user-menu 弹层重建（协调者归属票）。
    expect(menu.border).toBe('1px');
    expect(menu.radius).toBe('10px');
    expect(menu.borderColorOwn).toBe(menu.borderColor);
    // #161: the popover opens over content and needs visible separation — NOT
    // --card-shadow. #854 换档：盘面投影正本从 --edge-shadow 的柔和档迁到
    // --plate-shadow。亮侧 = 硬偏移档（Base UI 官方 menu hero 实测值，直角 +
    // 1px 实线 + 硬投影三件套）；暗侧按 spec §2.7 + 用户 2026-10-05 裁定归
    // none，1px 墨线独承（即 hero 自己的暗色分支）——故逐主题断言。
    if (theme === 'dark') {
      expect(menu.shadow).toBe('none');
    } else {
      expect(menu.shadow).toContain(menu.plateShadow);
    }
  });

  test(`sidebar shares the main-area surface, seam drawn in the divider token (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app?scenario=01');

    const probe = await page.evaluate(() => {
      const sidebar = document.querySelector('.board-sidebar');
      const main = document.querySelector('.board-main');
      if (!sidebar || !main) throw new Error('board layout missing');
      const cs = getComputedStyle(sidebar);
      return {
        sidebarBg: cs.backgroundColor,
        mainBg: getComputedStyle(main).backgroundColor,
        borderRight: cs.borderRightWidth,
        seamColor: cs.borderRightColor,
        topbarBorderColor: getComputedStyle(
          document.querySelector('.board-topbar')!,
        ).borderBottomColor,
        shadow: cs.boxShadow,
      };
    });
    // #390 同底律: the sidebar rides the same surface token as the main
    // area — the #135 裁决 v2 seam (1px in the topbar-divider token, the
    // floating soft shadow gone) alone carries the layer separation
    expect(probe.sidebarBg).toBe(probe.mainBg);
    expect(probe.borderRight).toBe('1px');
    expect(probe.seamColor).toBe(probe.topbarBorderColor);
    expect(probe.shadow).toBe('none');
  });

  test(`board grid lays out four even columns with no horizontal scroll (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app?scenario=01');

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

test('collapsed rail keeps the same drawn-seam treatment (#135 裁决 v2)', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('pacman-theme', 'dark');
    localStorage.setItem('pacman.sidebar-collapsed', '1');
  });
  await page.goto('/app?scenario=01');

  const rail = await page.locator('.board-sidebar--collapsed').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { borderRight: cs.borderRightWidth, shadow: cs.boxShadow };
  });
  expect(rail.borderRight).toBe('1px');
  expect(rail.shadow).toBe('none');
});
