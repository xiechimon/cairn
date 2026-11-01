import { mkdir } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { keyboardFocus, readRing, settleTransitions } from './helpers.js';

const parse = (c: string) => {
  const m = c.match(/[\d.]+/g)?.map(Number);
  if (m == null || m.length < 3) throw new Error(`unparsable color ${c}`);
  return { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 };
};

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

const resolve = (page: Page, token: string) =>
  page.evaluate((v) => {
    const el = document.createElement('div');
    el.style.backgroundColor = `var(${v})`;
    document.body.append(el);
    const out = getComputedStyle(el).backgroundColor;
    el.remove();
    return out;
  }, token);

for (const theme of ['light', 'dark'] as const) {
  test(`⌘K hint shows on the search row (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01');
    const button = page.getByRole('complementary').getByRole('button', { name: /搜索/ });
    await expect(button).toContainText('⌘K');
  });

  test(`hover and selected rows share one geometry (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01');

    const geo = await page.evaluate(() => {
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, w: r.width, h: r.height, radius: getComputedStyle(el).borderRadius };
      };
      const selected = document.querySelector(
        'aside [data-slot="sidebar-nav-row"][aria-current="page"]',
      );
      const plain = [...document.querySelectorAll('aside [data-slot="sidebar-nav-row"]')].find(
        (el) => el.getAttribute('aria-current') !== 'page' && el.textContent?.includes('定时'),
      );
      if (!selected || !plain) throw new Error('sidebar rows missing');
      return { selected: box(selected), plain: box(plain) };
    });
    expect(geo.plain).toEqual(geo.selected);
    expect(geo.selected).toEqual({ x: 12, w: 223, h: 32, radius: '8px' });
  });

  test(`selected row = sheet fill + hairline, distinct from hover (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01');

    const sidebarBg = await page.evaluate(
      () => getComputedStyle(document.querySelector('aside')!).backgroundColor,
    );
    const schedules = page.getByRole('complementary').getByRole('button', { name: '定时' });
    await schedules.hover();
    await page.waitForTimeout(300);
    const hoverBg = await schedules.evaluate((el) => getComputedStyle(el).backgroundColor);
    const selected = await page.evaluate(() => {
      const cs = getComputedStyle(
        document.querySelector('aside [data-slot="sidebar-nav-row"][aria-current="page"]')!,
      );
      return { bg: cs.backgroundColor, ring: cs.boxShadow };
    });

    expect(hoverBg).toBe(await resolve(page, '--sidebar-hover'));
    const bg = parse(sidebarBg);
    expect(dist(over(hoverBg, sidebarBg), bg)).toBeGreaterThan(3);
    expect(selected.bg).toBe(await resolve(page, '--sidebar-active'));
    expect(selected.ring).toBe('none');
    expect(selected.bg).not.toBe(hoverBg);
  });
}

test('machine-online dot sits centered on the `机器` row', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cairn-theme', 'dark');
    localStorage.setItem('cairn.sidebarResourcesCollapsed', '0');
  });
  await page.goto('/app?scenario=100');

  const dot = await page.evaluate(() => {
    const el = document.querySelector('[data-testid="online-dot"]');
    const row = el?.closest('a');
    if (!el || !row) throw new Error('machine-online dot missing');
    const dr = el.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    return {
      centerYDelta: Math.abs(dr.y + dr.height / 2 - (rr.y + rr.height / 2)),
      insideRow: dr.right <= rr.right && dr.left >= rr.left,
    };
  });
  expect(dot.centerYDelta).toBeLessThan(2);
  expect(dot.insideRow).toBe(true);
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`active team brand matches navigation fill without elevation (${theme}, ${width}px)`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 732 });
      await page.addInitScript((value) => {
        localStorage.setItem('cairn-theme', value);
        localStorage.setItem('cairn.locale', 'zh');
      }, theme);
      await page.goto('/app/team?scenario=01');
      if (width === 390) await page.locator('.app-menu-trigger').click();
      const brand = page.locator('.sidebar-team-name');
      await expect(brand).toHaveAttribute('aria-current', 'page');
      await page.mouse.move(width - 1, 500);
      await brand.evaluate((element) => (element as HTMLElement).blur());
      await settleTransitions(page);
      const phase = process.env.TEAM_BRAND_CAPTURE;
      if (phase === 'before' || phase === 'after') {
        const directory = resolvePath('..', '..', 'docs', 'verify', '2426');
        await mkdir(directory, { recursive: true });
        await page.screenshot({ path: resolvePath(directory, `${phase}-${theme}-${width}.png`) });
      }
      const active = await resolve(page, '--sidebar-active');
      await expect(brand).toHaveCSS('background-color', active);
      await expect(brand).toHaveCSS('box-shadow', 'none');
      await brand.hover();
      await settleTransitions(page);
      await expect(brand).toHaveCSS('background-color', active);
      await expect(brand).toHaveCSS('box-shadow', 'none');
      await keyboardFocus(page, brand);
      expect(await readRing(brand)).toEqual({ focused: true, outline: 'solid 2px', clippedBy: [] });
      await page
        .getByRole('complementary')
        .locator('[data-slot="sidebar-nav-row"]', { hasText: '工作台' })
        .click();
      await expect(page).toHaveURL('/app?scenario=01');
      if (width === 390) await page.locator('.app-menu-trigger').click();
      await page.mouse.move(width - 1, 500);
      await expect(brand).not.toHaveAttribute('aria-current', 'page');
      await expect(brand).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      await brand.click();
      if (width === 390) await page.locator('.app-menu-trigger').click();
      await page.getByRole('complementary').getByRole('button', { name: /搜索/ }).click();
      await expect(page.locator('html')).toHaveAttribute('data-search-open', '');
      if (width === 1440) {
        await expect(brand).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      }
    });
  }
}
