import { expect, type Page, test } from '@playwright/test';

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
  test(`⌘K hint rides the search button tooltip (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01');
    const button = page.getByTestId('team-row').getByRole('button', { name: '搜索' });
    await button.hover();
    await expect(page.locator('kbd', { hasText: '⌘K' })).toBeVisible();
  });

  test(`hover and selected rows share one geometry (${theme})`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01');

    const geo = await page.evaluate(() => {
      const box = (el: Element) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, w: r.width, h: r.height, radius: getComputedStyle(el).borderRadius };
      };
      const selected = document.querySelector('aside nav a[aria-current="page"]');
      const plain = [...document.querySelectorAll('aside nav a')].find(
        (el) => el.getAttribute('aria-current') !== 'page' && el.textContent?.includes('定时'),
      );
      if (!selected || !plain) throw new Error('sidebar rows missing');
      return { selected: box(selected), plain: box(plain) };
    });
    // one face geometry for both states — selected is a fill, not a shape
    expect(geo.plain).toEqual(geo.selected);
    // DESIGN.md: nav row 32px, control radius 8px, inside the 12px padding
    expect(geo.selected).toEqual({ x: 12, w: 224, h: 32, radius: '8px' });
  });

  test(`selected row = sheet fill + hairline, distinct from hover (${theme})`, async ({
    page,
  }) => {
    await page.addInitScript((t) => localStorage.setItem('cairn-theme', t), theme);
    await page.goto('/app?scenario=01');

    const sidebarBg = await page.evaluate(
      () => getComputedStyle(document.querySelector('aside')!).backgroundColor,
    );
    const schedules = page.getByRole('complementary').getByRole('link', { name: '定时' });
    await schedules.hover();
    await page.waitForTimeout(300); // the 150ms color step settles
    const hoverBg = await schedules.evaluate((el) => getComputedStyle(el).backgroundColor);
    const selected = await page.evaluate(() => {
      const cs = getComputedStyle(document.querySelector('aside nav a[aria-current="page"]')!);
      return { bg: cs.backgroundColor, ring: cs.boxShadow };
    });

    expect(hoverBg).toBe(await resolve(page, '--sidebar-hover'));
    const bg = parse(sidebarBg);
    expect(dist(over(hoverBg, sidebarBg), bg)).toBeGreaterThan(3);
    expect(selected.bg).toBe(await resolve(page, '--background'));
    expect(selected.ring).not.toBe('none');
    expect(selected.bg).not.toBe(hoverBg);
  });
}

test('machine-online dot sits centered on the `机器` row', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('cairn-theme', 'dark');
    localStorage.setItem('cairn.sidebarResourcesCollapsed', '0');
  });
  // chief fixture scenarios count one machine online
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
