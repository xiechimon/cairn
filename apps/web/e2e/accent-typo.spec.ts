import { expect, test } from '@playwright/test';

// Issue #390 acceptance (品牌与排版组, 2026-09-28 triage #6/#8/#9) —
// base-ui-theme P5 #791 起更名 accent-typo: 品牌只走 spot 紫（indigo 整族
// 已删），本 spec 钉品牌色消费面 + 焦点环 + danger 对。
// - 字重基线: 正文 computed font-weight = 400 (DESIGN.md §Typography 三档
//   400/500/600 的锚点; inter-var fvar wght 100–900 default 400 且
//   @font-face 已声明全档范围, 浏览器按请求档实例化, 无需
//   font-variation-settings)。500/600 档抽钉 .todo-card-title /
//   .sched-empty h2, 顺带钉 var 字体真载入 (font-display: optional 下
//   fallback 静默接管是本面最隐蔽的回退)。
// - 侧栏头 = 品牌槽: mark 用真资产 logo.svg 作 alpha mask, 随
//   currentColor 双主题换色 (mark 图单点替换位 = 该 mask url);
//   名 = BRAND.manifestName。头部 43px 行几何与 /app/team 导航由
//   sidebar-seam / sidebar-nav 既有断言守。
// - .res-back: hover 无背景变化 (现状即无 hover 面, 此处把律钉死防回潮);
//   键盘 focus 环由 app.css 全局 :focus-visible 规则承载 (#388, 2px
//   --focus-ring + offset 2)——本 spec 断言该环在 res-back 上双主题生效
//   （Paper 暗 #f0926d / 亮 #b4532a）。
// - P5 danger：--destructive 两值（暗 #ffabb7 / 亮 #9e2c49）压 --card
//   面拼对比度（文本 ≥4.5，§5.1 门）。--destructive-foreground 已判死退役
//   （#987 §3.1），destructive 改按 base-nova 形 text-destructive 消费。
// - P4 行 hover：more-menu 普通行 hover = --accent-soft，删除行 =
//   --danger-soft（与 token 值探针逐值比对，不估算）。
// - 侧栏底 = 主区 --card: 断言行放在 visual-polish.spec.ts (原 #123
//   层级断言的翻转, 同票更新)。

for (const theme of ['light', 'dark'] as const) {
  test(`font baseline: body 400, card title 500, var font really loaded (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app?scenario=01');

    const m = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        bodyWeight: getComputedStyle(document.body).fontWeight,
        cardTitleWeight: getComputedStyle(document.querySelector('.todo-card-title')!).fontWeight,
        interLoaded: document.fonts.check('400 14px "inter"'),
      };
    });
    expect(m.interLoaded).toBe(true);
    expect(m.bodyWeight).toBe('400');
    expect(m.cardTitleWeight).toBe('500');
  });

  // schedules 空态走 Paper EmptyState（components/empty-state.tsx）：标题
  // h2 = text-card-title 500。
  test(`empty-state headline rides the Paper EmptyState title tier (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app/schedules?scenario=11');
    const w = await page.evaluate(
      () => getComputedStyle(document.querySelector('.sched-empty h2')!).fontWeight,
    );
    expect(w).toBe('500');
  });

  test(`sidebar header carries the Pacman pixel mark + name (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app?scenario=01');

    const m = await page.evaluate(() => {
      const row = document.querySelector('.sidebar-team-row');
      const mark = row?.querySelector('.sidebar-brand-mark');
      const name = row?.querySelector('.sidebar-team-name');
      if (!row || !mark || !name) throw new Error('sidebar brand head missing');
      const ms = getComputedStyle(mark);
      const r = mark.getBoundingClientRect();
      return {
        maskImage: ms.getPropertyValue('mask-image') || ms.getPropertyValue('-webkit-mask-image'),
        maskSize: ms.getPropertyValue('mask-size') || ms.getPropertyValue('-webkit-mask-size'),
        markPaint: ms.backgroundColor,
        rowInk: getComputedStyle(row).color,
        markText: mark.textContent,
        markBox: { w: r.width, h: r.height },
        nameText: name.textContent,
        nameHref: name.getAttribute('href'),
      };
    });
    // DESIGN.md 侧栏 item 1: logo.svg pixel mark at 16px, one grid cell per
    // CSS pixel, painted in the row ink through the mask
    expect(m.maskImage).toContain('/logo.svg');
    // A one-value mask-size means `<value> auto`. Chrome for Testing 153
    // serializes it as `100% auto`, Chromium 141 as `100%` (#1427).
    const maskSize = m.maskSize.trim().split(/\s+/);
    expect(maskSize.length === 1 ? [...maskSize, 'auto'] : maskSize).toEqual(['100%', 'auto']);
    expect(m.markPaint).toBe(m.rowInk);
    expect(m.markPaint).not.toBe('rgba(0, 0, 0, 0)');
    expect(m.markText).toBe('');
    expect(m.markBox).toEqual({ w: 16, h: 16 });
    expect(m.nameText).toContain('Pacman');
    // the head row keeps its /app/team navigation law
    expect(m.nameHref).toContain('/app/team');
  });

  test(`page shell back chevron hover shows no background change (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app/resources/machines/Kd8fG2hJ4mN9pQ1rStUvWx3?scenario=06');

    const read = () =>
      page.evaluate(() => {
        const cs = getComputedStyle(document.querySelector('[aria-label="返回"]')!);
        return { bg: cs.backgroundColor, color: cs.color };
      });
    const rest = await read();
    await page.hover('[aria-label="返回"]');
    await page.waitForTimeout(300); // past any 150ms color step
    const hovered = await read();
    expect(hovered).toEqual(rest);
  });

  test(`the sidebar collapse toggle rests bare and shows the row hover on hover (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app?scenario=01');

    const read = () =>
      page.evaluate(() => {
        const cs = getComputedStyle(document.querySelector('.sidebar-team-collapse')!);
        return { bg: cs.backgroundColor, shadow: cs.boxShadow };
      });
    const rest = await read();
    // no surface of its own at rest
    expect(rest.bg).toBe('rgba(0, 0, 0, 0)');
    expect(rest.shadow).toBe('none');

    // Paper Grouped sidebar: the workspace row's icon buttons take the
    // sidebar row hover (mockup .icon-btn:hover); the head no longer carries
    // a fill of its own for the tint to read as a shadow over.
    await page.hover('.sidebar-team-collapse');
    const hoverBg = await page.evaluate(() => {
      const el = document.createElement('div');
      el.style.backgroundColor = 'var(--sidebar-hover)';
      document.body.append(el);
      const out = getComputedStyle(el).backgroundColor;
      el.remove();
      return out;
    });
    await expect.poll(async () => (await read()).bg).toBe(hoverBg);
  });

  // XMON-69: the toggle is a bare 14px glyph, so whatever the press state does
  // to it is read as the glyph itself moving (the report: 图标往左侧缩一下).
  // Both directions are pinned — the expanded head's toggle and the rail's —
  // on the frame the mouse is *held* down, i.e. before either state flips.
  test(`the sidebar toggles hold face and geometry while pressed (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app?scenario=01');

    const read = (sel: string) =>
      page.evaluate((s) => {
        const el = document.querySelector(s)!;
        const cs = getComputedStyle(el);
        const icon = el.querySelector('svg')!.getBoundingClientRect();
        return {
          bg: cs.backgroundColor,
          shadow: cs.boxShadow,
          color: cs.color,
          opacity: cs.opacity,
          iconX: icon.x,
          iconY: icon.y,
          iconW: icon.width,
          iconH: icon.height,
        };
      }, sel);

    // the pointer settles on the target first (hover is a face of its own on
    // both toggles), so the delta read here is the press state alone.
    const press = async (sel: string) => {
      const bb = (await page.locator(sel).boundingBox())!;
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.waitForTimeout(300); // past any 150ms color step
      const hovered = await read(sel);
      await page.mouse.down();
      const held = await read(sel);
      await page.mouse.up();
      return { hovered, held };
    };

    // open sidebar: the head's collapse toggle
    const expanded = await press('.sidebar-team-collapse');
    expect(expanded.hovered.opacity).toBe('1');
    expect(expanded.held).toEqual(expanded.hovered);
    await expect(page.locator('.rail-toggle')).toBeVisible();

    // collapsed rail: the expand toggle, and its release is the expand path
    const rail = await press('.rail-toggle');
    expect(rail.hovered.opacity).toBe('1');
    expect(rail.held).toEqual(rail.hovered);
    await expect(page.locator('.board-sidebar--collapsed')).toHaveCount(0);
  });
}

for (const theme of ['light', 'dark'] as const) {
  test(`page shell back chevron keeps a keyboard focus ring (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app/resources/machines/Kd8fG2hJ4mN9pQ1rStUvWx3?scenario=06');
    // keyboard modality: tab until the back chevron owns focus
    for (let i = 0; i < 40; i++) {
      const onBack = await page.evaluate(
        () => document.activeElement?.matches('[aria-label="返回"]') ?? false,
      );
      if (onBack) break;
      await page.keyboard.press('Tab');
    }
    // #944/#910 载体：.res-back → aria-label 一级（back link 语义名）。
    await expect(page.locator('[aria-label="返回"]')).toBeFocused();
    const ring = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('[aria-label="返回"]')!);
      return { w: cs.outlineWidth, style: cs.outlineStyle, color: cs.outlineColor };
    });
    expect(ring.style).toBe('solid');
    expect(ring.w).toBe('2px');
    // the codebase ring recipe rides --focus-ring (Paper dark #f0926d / light #b4532a)
    expect(ring.color).toBe(theme === 'dark' ? 'rgb(240, 146, 109)' : 'rgb(180, 83, 42)');
  });
}

/** Resolve a token to its computed value through a probe element. */
async function resolveToken(
  page: import('@playwright/test').Page,
  token: string,
): Promise<string> {
  return page.evaluate((t) => {
    const probe = document.createElement('div');
    probe.style.backgroundColor = `var(${t})`;
    document.body.append(probe);
    const resolved = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return resolved;
  }, token);
}

/** WCAG relative-luminance contrast of two rgb() strings, measured in-page. */
async function contrastOf(
  page: import('@playwright/test').Page,
  fg: string,
  bg: string,
): Promise<number> {
  return page.evaluate(
    ([f, b]) => {
      const lum = (s: string) => {
        const c = s
          .replace(/^rgba?\(/, '')
          .replace(/\)$/, '')
          .split(',')
          .slice(0, 3)
          .map((v) => {
            const x = Number(v.trim()) / 255;
            return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
          });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      const [l1, l2] = [lum(f), lum(b)].sort((x, y) => y - x);
      return (l1 + 0.05) / (l2 + 0.05);
    },
    [fg, bg] as const,
  );
}

for (const theme of ['light', 'dark'] as const) {
  test(`P5 danger: destructive resolves and reads on card, passes 4.5 (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app?scenario=01');
    // --destructive-foreground 判死退役（#987 §3.1：官方 v4 集无此槽、base-nova
    // 件 0 消费）。destructive 现按 base-nova 形消费——text-destructive 压
    // bg-destructive/10 tint（button/badge），故钉 destructive 文字压 card 面
    // 的可读对（tint 非 token，取承载面 --card 作不透明底，实测见 #1002）。
    const destructive = await resolveToken(page, '--destructive');
    const card = await resolveToken(page, '--card');
    // 红系：暗侧高明度粉档（E 色板值，Paper 暗色轮沿用）、亮侧深玫红档，均压
    // Paper card 面过文本 4.5 门（暗 7.95，docs/verify/1396/contrast.txt /
    // 亮 7.22，docs/verify/paper-tokens/contrast.txt）
    expect(destructive).toBe(theme === 'dark' ? 'rgb(255, 171, 183)' : 'rgb(158, 44, 73)');
    expect(card).toBe(theme === 'dark' ? 'rgb(47, 42, 38)' : 'rgb(255, 255, 255)');
    expect(await contrastOf(page, destructive, card)).toBeGreaterThanOrEqual(4.5);
  });

  test(`P5 main-button pair passes 4.5 in both themes (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app?scenario=01');
    const bg = await resolveToken(page, '--card-button');
    const fg = await resolveToken(page, '--text-on-accent');
    expect(bg).toBe(theme === 'dark' ? 'rgb(240, 146, 109)' : 'rgb(180, 83, 42)');
    expect(fg).toBe(theme === 'dark' ? 'rgb(26, 22, 18)' : 'rgb(255, 255, 255)');
    expect(await contrastOf(page, fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  test(`Paper menu row hover rides menu-hover, delete row rides danger-soft (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('pacman-theme', t), theme);
    await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27');
    await page.locator('.detail-head-icon--more').click();
    const menu = page.locator('.more-menu');
    await expect(menu).toBeVisible();

    const soft = await resolveToken(page, '--menu-hover');
    const danger = await resolveToken(page, '--danger-soft');
    const normal = menu.locator('.more-menu-item', { hasText: '复制链接' });
    await normal.hover();
    await page.waitForTimeout(300); // past the 150ms color step
    await expect(normal).toHaveCSS('background-color', soft);

    const del = menu.locator('.more-menu-item[data-action="delete"]');
    await del.hover();
    await page.waitForTimeout(300);
    await expect(del).toHaveCSS('background-color', danger);
  });

  // P4 主钮提亮（brand 档 hover brightness 1.07，#791）的探针已随 brand 档
  // 退役删除（#982/#991 判决，#1003 施工）：主钮 = registry default 档，
  // hover 形态由上游类串承载并被 ui-registry-gate hash 账本钉住（#989）。
}
