import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  test(`font baseline: body 400, var font really loaded (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app/schedules?scenario=01');

    const m = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        bodyWeight: getComputedStyle(document.body).fontWeight,
        bodyFontLoaded: document.fonts.check('400 14px "instrumentSans"'),
      };
    });
    expect(m.bodyFontLoaded).toBe(true);
    expect(m.bodyWeight).toBe('400');
  });

  test(`empty-state headline rides the Paper EmptyState title tier (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app/schedules?scenario=11');
    const w = await page.evaluate(
      () => getComputedStyle(document.querySelector('.sched-empty h2')!).fontWeight,
    );
    expect(w).toBe('500');
  });

  test(`sidebar header is the toggle then the serif wordmark, no logo (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app/schedules?scenario=01');

    const m = await page.evaluate(async () => {
      await document.fonts.ready;
      const row = document.querySelector('.sidebar-team-row');
      const toggle = row?.querySelector('.sidebar-team-collapse');
      const name = row?.querySelector('.sidebar-team-name');
      if (!row || !toggle || !name) throw new Error('sidebar head missing');
      const cs = getComputedStyle(name);
      const t = toggle.getBoundingClientRect();
      const icon = toggle.querySelector('svg')!.getBoundingClientRect();
      const n = name.getBoundingClientRect();
      return {
        marks: row.querySelectorAll('[data-testid="brand-mark"], .sidebar-brand-mark').length,
        family: cs.fontFamily,
        serifLoaded: document.fonts.check('500 18px "sourceSerif4"'),
        size: cs.fontSize,
        weight: cs.fontWeight,
        tracking: cs.letterSpacing,
        lineHeight: cs.lineHeight,
        nameText: name.textContent,
        nameHref: name.getAttribute('href'),
        toggle: { x: t.x - row.getBoundingClientRect().x, w: t.width, h: t.height },
        icon: { w: icon.width, h: icon.height },
        gap: n.x - t.right,
      };
    });
    expect(m.marks).toBe(0);
    expect(m.family).toContain('sourceSerif4');
    expect(m.serifLoaded).toBe(true);
    expect(m.size).toBe('18px');
    expect(m.weight).toBe('500');
    expect(m.tracking).toBe('normal');
    expect(m.lineHeight).toBe('18px');
    expect(m.nameText).toBe('Cairn');
    expect(m.nameHref).toBeNull();
    expect(m.toggle).toEqual({ x: 2, w: 28, h: 28 });
    expect(m.icon).toEqual({ w: 22, h: 22 });
    expect(m.gap).toBe(3);
  });

  test(`page shell back chevron hover shows no background change (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c');

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
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app/schedules?scenario=01');

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

  test(`the sidebar toggles hold face and geometry while pressed (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app/schedules?scenario=01');

    const read = (sel: string) =>
      page.evaluate((s) => {
        const el = document.querySelector(s)!;
        const cs = getComputedStyle(el);
        const icon = el.querySelector('svg')!.getBoundingClientRect();
        return {
          bg: cs.backgroundColor,
          shadow: cs.boxShadow.replaceAll('rgba(0, 0, 0, 0) 0px 0px 0px 0px', '').replaceAll(', ', '') || 'none',
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
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app/project/ZAQczKCu0MOAzC1ZqcFlX/settings?scenario=r2-24c');
    // keyboard modality: tab until the back chevron owns focus
    for (let i = 0; i < 40; i++) {
      const onBack = await page.evaluate(
        () => document.activeElement?.matches('[aria-label="返回"]') ?? false,
      );
      if (onBack) break;
      await page.keyboard.press('Tab');
    }

    await expect(page.locator('[aria-label="返回"]')).toBeFocused();
    const ring = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('[aria-label="返回"]')!);
      return { w: cs.outlineWidth, style: cs.outlineStyle, color: cs.outlineColor };
    });
    expect(ring.style).toBe('solid');
    expect(ring.w).toBe('2px');
    expect(ring.color).toBe(theme === 'dark' ? 'rgb(235, 181, 80)' : 'rgb(154, 101, 0)');
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
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app/schedules?scenario=01');

    const destructive = await resolveToken(page, '--destructive');
    const card = await resolveToken(page, '--card');

    expect(destructive).toBe(theme === 'dark' ? 'rgb(240, 154, 136)' : 'rgb(163, 58, 42)');
    expect(card).toBe(theme === 'dark' ? 'rgb(32, 32, 32)' : 'rgb(247, 247, 247)');
    expect(await contrastOf(page, destructive, card)).toBeGreaterThanOrEqual(4.5);
  });

  test(`P5 main-button pair passes 4.5 in both themes (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app/schedules?scenario=01');
    const bg = await resolveToken(page, '--card-button');
    const fg = await resolveToken(page, '--text-on-accent');
    expect(bg).toBe(theme === 'dark' ? 'rgb(235, 181, 80)' : 'rgb(154, 101, 0)');
    expect(fg).toBe(theme === 'dark' ? 'rgb(26, 20, 4)' : 'rgb(255, 255, 255)');
    expect(await contrastOf(page, fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  test(`Paper menu row hover rides menu-hover, delete row rides danger-soft (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app/todo/7ve0iOkQ-JBpSL98zSiGc?scenario=27');
    await page.getByTestId('side-chat').getByRole('button', { name: '更多操作…' }).click();
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

}

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`schedules empty-state hint icon stays beside its first text line (${theme}, ${width})`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((value) => localStorage.setItem('cairn-theme', value), theme);
      await page.goto('/app/schedules?scenario=11');
      const hint = page.locator('.sched-empty [data-slot="empty-content"] p');
      await expect(hint).toBeVisible();
      const geometry = await hint.evaluate(async (paragraph) => {
        await document.fonts.ready;
        const icon = paragraph.querySelector('svg')!.getBoundingClientRect();
        const text = [...paragraph.childNodes].find(
          (node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim().length > 0,
        )!;
        const start = text.textContent!.search(/\S/);
        const range = document.createRange();
        range.setStart(text, start);
        range.setEnd(text, start + 1);
        const first = range.getBoundingClientRect();
        range.setEnd(text, text.textContent!.length);
        const lines = [...range.getClientRects()];
        const box = paragraph.getBoundingClientRect();
        return {
          gap: first.left - icon.right,
          overlap: Math.min(first.bottom, icon.bottom) - Math.max(first.top, icon.top),
          lines: new Set(lines.map((line) => line.top)).size,
          width: box.width,
          maxWidth: 34 * Number.parseFloat(getComputedStyle(paragraph).fontSize),
          overflow: document.documentElement.scrollWidth > window.innerWidth,
        };
      });
      console.log(JSON.stringify({ theme, viewportWidth: width, ...geometry }));
      await testInfo.attach('hint-geometry', {
        body: JSON.stringify(geometry, null, 2),
        contentType: 'application/json',
      });
      if (process.env.HINT_EVIDENCE_DIR) {
        await page.screenshot({
          path: `${process.env.HINT_EVIDENCE_DIR}/${theme}-${width}.png`,
          fullPage: true,
        });
      }
      expect(geometry.gap).toBeGreaterThanOrEqual(0);
      expect(geometry.gap).toBeLessThanOrEqual(8);
      expect(geometry.overlap).toBeGreaterThan(0);
      expect(geometry.width).toBeLessThanOrEqual(geometry.maxWidth);
      expect(geometry.overflow).toBe(false);
      if (width === 390) expect(geometry.lines).toBeGreaterThan(1);
    });
  }
}
