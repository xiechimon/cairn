import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  test(`font baseline: body 400, var font really loaded (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01');

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
    await page.goto('/app/resources/secrets?scenario=01');
    const headline = page.getByTestId('resource-empty').getByRole('heading', { level: 2 });
    await expect(headline).toBeVisible();
    expect(await headline.evaluate((el) => getComputedStyle(el).fontWeight)).toBe('500');
  });

  test(`sidebar header is the toggle then the serif wordmark, no logo (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01');

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

  test(`the sidebar collapse toggle rests bare and shows the row hover on hover (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
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

  test(`the sidebar toggles hold face and geometry while pressed (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01');

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
    await expect(page.getByTestId('sidebar-reopen')).toBeVisible();

    const collapsed = await press('[data-testid="sidebar-reopen"]');
    expect(collapsed.hovered.opacity).toBe('1');
    expect(collapsed.held).toEqual(collapsed.hovered);
    await expect(page.getByTestId('sidebar-reopen')).toHaveCount(0);
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
    await page.goto('/app?scenario=01');

    const destructive = await resolveToken(page, '--destructive');
    const card = await resolveToken(page, '--card');

    expect(destructive).toBe(theme === 'dark' ? 'rgb(240, 154, 136)' : 'rgb(163, 58, 42)');
    expect(card).toBe(theme === 'dark' ? 'rgb(32, 32, 32)' : 'rgb(247, 247, 247)');
    expect(await contrastOf(page, destructive, card)).toBeGreaterThanOrEqual(4.5);
  });

  test(`P5 main-button pair passes 4.5 in both themes (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01');
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
